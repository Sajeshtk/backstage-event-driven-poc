import {
  LoggerService,
  SchedulerService,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { Entity } from '@backstage/catalog-model';
import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';

interface SapCpiProviderConfig {
  tokenHost: string;
  tmnHost: string;
  clientId: string;
  clientSecret: string;
}

interface ProviderSchedule {
  frequency: Record<string, number>;
  timeout: Record<string, number>;
}

interface IFlow {
  Id: string;
  Name: string;
  Version: string;
  Type: string;
  DeployedBy: string;
  DeployedOn: string;
  Status: string;
}

interface ParsedIFlowId {
  prefix: string;
  customer: string;
  environment: string;
  direction: string;
  sourceSystem: string;
  targetSystem: string;
  domain: string;
  isStructured: boolean;
}

export class SapCpiEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly id: string,
    private readonly config: SapCpiProviderConfig,
    private readonly options: {
      logger: LoggerService;
      scheduler: SchedulerService;
      schedule: ProviderSchedule;
    },
  ) {}

  static fromConfig(
    config: Config,
    options: { logger: LoggerService; scheduler: SchedulerService },
  ): SapCpiEntityProvider[] {
    const providersConfig = config.getOptionalConfig('catalog.providers.sapCpi');
    if (!providersConfig) return [];

    return providersConfig.keys().map(id => {
      const c = providersConfig.getConfig(id);
      const scheduleConfig = c.getOptionalConfig('schedule');
      const schedule: ProviderSchedule = scheduleConfig
        ? {
            frequency: scheduleConfig.get<Record<string, number>>('frequency'),
            timeout: scheduleConfig.get<Record<string, number>>('timeout'),
          }
        : { frequency: { minutes: 5 }, timeout: { minutes: 2 } };

      return new SapCpiEntityProvider(
        id,
        {
          tokenHost: c.getString('tokenHost'),
          tmnHost: c.getString('tmnHost'),
          clientId: c.getString('clientId'),
          clientSecret: c.getString('clientSecret'),
        },
        { logger: options.logger, scheduler: options.scheduler, schedule },
      );
    });
  }

  getProviderName(): string {
    return `SapCpiEntityProvider:${this.id}`;
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.options.scheduler.scheduleTask({
      id: this.getProviderName(),
      frequency: this.options.schedule.frequency,
      timeout: this.options.schedule.timeout,
      fn: async () => {
        await this.refresh();
      },
    });
  }

  async refresh(): Promise<void> {
    if (!this.connection) return;

    const { logger } = this.options;
    logger.info(`Syncing SAP CPI iFlows [provider=${this.id}]`);

    let token: string;
    try {
      token = await this.fetchToken();
    } catch (err) {
      logger.error(`Failed to get SAP CPI OAuth token [provider=${this.id}]: ${err}`);
      return;
    }

    let iflows: IFlow[];
    try {
      iflows = await this.fetchIFlows(token);
    } catch (err) {
      logger.error(`Failed to fetch SAP CPI iFlows [provider=${this.id}]: ${err}`);
      return;
    }

    logger.info(`Found ${iflows.length} iFlows from SAP CPI [provider=${this.id}]`);

    const systems = new Map<string, Entity>();
    const users = new Map<string, Entity>();
    const components: Entity[] = [];

    for (const iflow of iflows) {
      const parsed = parseIFlowId(iflow.Id);
      const systemName = parsed.isStructured
        ? `sap-cpi-${sanitizeName(parsed.customer)}`
        : 'sap-cpi-default';

      if (!systems.has(systemName)) {
        systems.set(systemName, buildSystemEntity(systemName, parsed, this.id));
      }

      if (iflow.DeployedBy) {
        const userSlug = emailToSlug(iflow.DeployedBy);
        if (!users.has(userSlug)) {
          users.set(userSlug, buildUserEntity(iflow.DeployedBy, this.id));
        }
      }

      components.push(buildComponentEntity(iflow, parsed, systemName, this.id, this.config.tmnHost));
    }

    const entities: Entity[] = [...systems.values(), ...users.values(), ...components];

    await this.connection.applyMutation({
      type: 'full',
      entities: entities.map(entity => ({
        entity,
        locationKey: `sap-cpi-provider:${this.id}`,
      })),
    });
  }

  private async fetchToken(): Promise<string> {
    const { tokenHost, clientId, clientSecret } = this.config;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(
      `${tokenHost}/oauth/token?grant_type=client_credentials`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Token request failed: HTTP ${response.status}`);
    }

    const json = await response.json() as { access_token: string; token_type: string };
    return `${json.token_type ?? 'Bearer'} ${json.access_token}`;
  }

  private async fetchIFlows(authHeader: string): Promise<IFlow[]> {
    const { tmnHost } = this.config;
    const response = await fetch(
      `${tmnHost}/api/v1/IntegrationRuntimeArtifacts`,
      {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`IntegrationRuntimeArtifacts request failed: HTTP ${response.status}`);
    }

    const json = await response.json() as { d: { results: IFlow[] } };
    return json.d.results.filter(item => item.Type === 'INTEGRATION_FLOW');
  }
}

function parseIFlowId(id: string): ParsedIFlowId {
  // Pattern 1: IF_<CUSTOMER>_<ENV>_<DIRECTION>-<SOURCE>[-_]<TARGET>_<DOMAIN>
  // e.g. IF_BAT_DEV_IN-BIZOM-SAPDEV_CUSTOMER_MASTER_INTERFACE
  const ifMatch = id.match(/^IF_([A-Z]+)_([A-Z]+)_(IN|OUT|INOUT)-([A-Z0-9]+)[_-]([A-Z0-9]+)_(.+)$/i);
  if (ifMatch) {
    return {
      prefix: 'IF',
      customer: ifMatch[1].toUpperCase(),
      environment: ifMatch[2].toUpperCase(),
      direction: ifMatch[3].toUpperCase(),
      sourceSystem: ifMatch[4].toUpperCase(),
      targetSystem: ifMatch[5].toUpperCase(),
      domain: ifMatch[6].replace(/_/g, ' ').toLowerCase(),
      isStructured: true,
    };
  }

  // Pattern 2: Retry_<CUSTOMER>_<SRC>_to_<TGT>_<DOMAIN>
  // e.g. Retry_BAT_SAP_to_BIZOM_Customer_master
  const retryMatch = id.match(/^Retry_([A-Z]+)_([A-Z0-9]+)_to_([A-Z0-9]+)_(.+)$/i);
  if (retryMatch) {
    return {
      prefix: 'Retry',
      customer: retryMatch[1].toUpperCase(),
      environment: 'DEV',
      direction: 'OUT',
      sourceSystem: retryMatch[2].toUpperCase(),
      targetSystem: retryMatch[3].toUpperCase(),
      domain: retryMatch[4].replace(/_/g, ' ').toLowerCase(),
      isStructured: true,
    };
  }

  // Pattern 3: <CUSTOMER>_<DOMAIN_WORDS>_<SRC>_to_<TGT>
  // e.g. BAT_Customer_Credit_Interface_SAP_to_Bizom
  const toMatch = id.match(/^([A-Z]+)_(.+)_([A-Z][A-Z0-9]*)_to_([A-Z][A-Z0-9]*)$/i);
  if (toMatch) {
    return {
      prefix: '',
      customer: toMatch[1].toUpperCase(),
      environment: 'unknown',
      direction: 'OUT',
      sourceSystem: toMatch[3].toUpperCase(),
      targetSystem: toMatch[4].toUpperCase(),
      domain: toMatch[2].replace(/_/g, ' ').toLowerCase(),
      isStructured: true,
    };
  }

  return {
    prefix: '',
    customer: 'tarento',
    environment: 'unknown',
    direction: 'unknown',
    sourceSystem: 'unknown',
    targetSystem: 'unknown',
    domain: id,
    isStructured: false,
  };
}

function emailToSlug(email: string): string {
  return sanitizeName(email.split('@')[0].replace(/\./g, '-'));
}

function buildUserEntity(email: string, providerId: string): Entity {
  const localPart = email.split('@')[0];
  const displayName = localPart
    .split('.')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'User',
    metadata: {
      name: emailToSlug(email),
      namespace: 'default',
      title: displayName,
      annotations: {
        'backstage.io/managed-by-location': `sap-cpi-provider:${providerId}`,
        'backstage.io/managed-by-origin-location': `sap-cpi-provider:${providerId}`,
      },
    },
    spec: {
      profile: {
        displayName,
        email,
      },
      memberOf: [],
    },
  };
}

function buildSystemEntity(
  systemName: string,
  parsed: ParsedIFlowId,
  providerId: string,
): Entity {
  const title = parsed.isStructured
    ? `SAP CPI – ${parsed.customer} Integrations`
    : 'SAP CPI – Default';

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'System',
    metadata: {
      name: systemName,
      namespace: 'sap-cpi',
      title,
      description: parsed.isStructured
        ? `Integration flows for ${parsed.customer} running on SAP Cloud Integration`
        : 'Integration flows running on SAP Cloud Integration',
      tags: ['sap-cpi', parsed.customer.toLowerCase()],
      annotations: {
        'backstage.io/managed-by-location': `sap-cpi-provider:${providerId}`,
        'backstage.io/managed-by-origin-location': `sap-cpi-provider:${providerId}`,
      },
    },
    spec: {
      owner: 'group:default/guests',
    },
  };
}

function buildComponentEntity(
  iflow: IFlow,
  parsed: ParsedIFlowId,
  systemName: string,
  providerId: string,
  tmnHost: string,
): Entity {
  const lifecycle = statusToLifecycle(iflow.Status);

  const tags: string[] = ['sap-cpi', 'integration-flow'];
  if (parsed.isStructured) {
    tags.push(parsed.customer.toLowerCase());
    if (parsed.environment !== 'unknown') tags.push(parsed.environment.toLowerCase());
    if (parsed.direction !== 'unknown') tags.push(parsed.direction.toLowerCase());
    if (parsed.sourceSystem !== 'unknown') tags.push(parsed.sourceSystem.toLowerCase());
    if (parsed.targetSystem !== 'unknown') tags.push(parsed.targetSystem.toLowerCase());
  }

  const deployerName = iflow.DeployedBy
    ? iflow.DeployedBy.split('@')[0].replace(/\./g, ' ')
    : 'unknown';
  const deployedDate = iflow.DeployedOn
    ? iflow.DeployedOn.split('T')[0]
    : '';

  let description: string;
  if (parsed.isStructured && parsed.sourceSystem !== 'unknown') {
    description = `${directionLabel(parsed.direction)} integration flow connecting ${parsed.sourceSystem} to ${parsed.targetSystem} (${parsed.domain}). Version ${iflow.Version} · Deployed by ${deployerName}${deployedDate ? ` on ${deployedDate}` : ''} · Status: ${iflow.Status}`;
  } else {
    description = `SAP CPI integration flow (version ${iflow.Version}). Deployed by ${deployerName}${deployedDate ? ` on ${deployedDate}` : ''} · Status: ${iflow.Status}`;
  }

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: sanitizeName(iflow.Id),
      namespace: 'sap-cpi',
      title: humanReadableTitle(iflow.Id, parsed),
      description,
      tags,
      links: [
        {
          url: `${tmnHost}/api/v1/IntegrationRuntimeArtifacts('${iflow.Id}')`,
          title: 'SAP CPI – Runtime Artifact',
          icon: 'dashboard',
        },
        {
          url: tmnHost,
          title: 'SAP CPI Portal',
          icon: 'scaffolder',
        },
      ],
      annotations: {
        'backstage.io/managed-by-location': `sap-cpi-provider:${providerId}`,
        'backstage.io/managed-by-origin-location': `sap-cpi-provider:${providerId}`,
        'sap.com/iflow-id': iflow.Id,
        'sap.com/iflow-version': iflow.Version,
        'sap.com/iflow-status': iflow.Status,
        'sap.com/deployed-by': iflow.DeployedBy,
        'sap.com/deployed-on': iflow.DeployedOn,
        'sap.com/tenant-host': tmnHost,
        ...(parsed.isStructured && parsed.sourceSystem !== 'unknown' && {
          'sap.com/source-system': parsed.sourceSystem,
          'sap.com/target-system': parsed.targetSystem,
          'sap.com/environment': parsed.environment,
          'sap.com/direction': parsed.direction,
        }),
      },
    },
    spec: {
      type: 'integration-flow',
      lifecycle,
      owner: iflow.DeployedBy
        ? `user:default/${emailToSlug(iflow.DeployedBy)}`
        : 'group:default/guests',
      system: `sap-cpi/${systemName}`,
    },
  };
}

function statusToLifecycle(status: string): string {
  if (status === 'STARTED') return 'production';
  if (status === 'STOPPED') return 'deprecated';
  return 'experimental';
}

function directionLabel(direction: string): string {
  if (direction === 'IN') return 'Inbound';
  if (direction === 'OUT') return 'Outbound';
  if (direction === 'INOUT') return 'Bidirectional';
  return direction;
}

function humanReadableTitle(id: string, parsed: ParsedIFlowId): string {
  if (!parsed.isStructured) {
    // Humanize raw ID: split on underscores, preserve ALL-CAPS words, title-case others
    return id
      .split('_')
      .map(w => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
  }
  const domain = parsed.domain
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  if (parsed.sourceSystem !== 'unknown' && parsed.targetSystem !== 'unknown') {
    return `${parsed.sourceSystem} → ${parsed.targetSystem}: ${domain}`;
  }
  return domain;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]/g, '-')
    .replace(/^[-_.]/, 'x')
    .replace(/[-_.]$/, '')
    .slice(0, 63);
}
