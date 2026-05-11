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
import { ApiManagementClient } from '@azure/arm-apimanagement';
import { ClientSecretCredential } from '@azure/identity';

interface ApimProviderConfig {
  subscriptionId: string;
  resourceGroup: string;
  serviceName: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

interface ProviderSchedule {
  frequency: Record<string, number>;
  timeout: Record<string, number>;
}

export class AzureApimEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly id: string,
    private readonly apimConfig: ApimProviderConfig,
    private readonly options: {
      logger: LoggerService;
      scheduler: SchedulerService;
      schedule: ProviderSchedule;
    },
  ) {}

  static fromConfig(
    config: Config,
    options: { logger: LoggerService; scheduler: SchedulerService },
  ): AzureApimEntityProvider[] {
    const providersConfig = config.getOptionalConfig(
      'catalog.providers.azureApim',
    );
    if (!providersConfig) return [];

    return providersConfig.keys().map(id => {
      const c = providersConfig.getConfig(id);
      const scheduleConfig = c.getOptionalConfig('schedule');
      const schedule: ProviderSchedule = scheduleConfig
        ? {
            frequency: scheduleConfig.get<Record<string, number>>('frequency'),
            timeout: scheduleConfig.get<Record<string, number>>('timeout'),
          }
        : { frequency: { minutes: 30 }, timeout: { minutes: 5 } };

      return new AzureApimEntityProvider(
        id,
        {
          subscriptionId: c.getString('subscriptionId'),
          resourceGroup: c.getString('resourceGroup'),
          serviceName: c.getString('serviceName'),
          tenantId: c.getString('tenantId'),
          clientId: c.getString('clientId'),
          clientSecret: c.getString('clientSecret'),
        },
        { logger: options.logger, scheduler: options.scheduler, schedule },
      );
    });
  }

  getProviderName(): string {
    return `AzureApimEntityProvider:${this.id}`;
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
    const { subscriptionId, resourceGroup, serviceName, tenantId, clientId, clientSecret } =
      this.apimConfig;

    logger.info(`Syncing Azure APIM APIs [provider=${this.id}]`);

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const client = new ApiManagementClient(credential, subscriptionId);
    const entities: Entity[] = [];

    try {
      for await (const api of client.api.listByService(resourceGroup, serviceName)) {
        if (!api.name) continue;

        const spec = await this.fetchSpec(
          client,
          resourceGroup,
          serviceName,
          api.name,
          api.serviceUrl ?? `https://${serviceName}.azure-api.net`,
        );

        entities.push({
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'API',
          metadata: {
            name: sanitizeName(api.name),
            namespace: 'azureapim-live',
            title: api.displayName ?? api.name,
            description: api.description || `Live-synced from Azure APIM instance: ${serviceName}`,
            tags: ['apim-live', serviceName.toLowerCase()],
            labels: {
              source: 'apim-live',
              environment: 'live',
              'apim-instance': serviceName,
            },
            annotations: {
              'backstage.io/managed-by-location': `azure-apim-provider:${this.id}`,
              'backstage.io/managed-by-origin-location': `azure-apim-provider:${this.id}`,
              'azure.com/apim-instance': serviceName,
              'azure.com/subscription-id': subscriptionId,
              'azure.com/resource-group': resourceGroup,
              'azure.com/apim-api-path': api.path ?? '',
              'azure.com/apim-api-version': api.apiVersion ?? '',
            },
          },
          spec: {
            type: 'openapi',
            lifecycle: 'production',
            owner: 'group:default/guests',
            system: 'azure-apim-account-2',
            definition: spec,
          },
        });
      }
    } catch (err) {
      logger.error(
        `Failed to list APIM APIs [provider=${this.id}]: ${err}`,
      );
      return;
    }

    logger.info(
      `Found ${entities.length} APIs from Azure APIM [provider=${this.id}]`,
    );

    await this.connection.applyMutation({
      type: 'full',
      entities: entities.map(entity => ({
        entity,
        locationKey: `azure-apim-provider:${this.id}`,
      })),
    });
  }

  private async fetchSpec(
    client: ApiManagementClient,
    resourceGroup: string,
    serviceName: string,
    apiId: string,
    serviceUrl: string,
  ): Promise<string> {
    try {
      const result = await client.apiExport.get(
        resourceGroup,
        serviceName,
        apiId,
        'openapi+json-link',
        'true',
      );
      const exportResult = result as any;
      const downloadUrl =
        exportResult.properties?.value?.link ??
        exportResult.value?.link ??
        exportResult.properties?.link;
      if (!downloadUrl) {
        this.options.logger.warn(
          `No download URL in export result for ${apiId}, using minimal fallback`,
        );
      } else {
        const response = await fetch(downloadUrl);
        if (response.ok) {
          return await response.text();
        }
        this.options.logger.warn(
          `Fetch of OpenAPI spec failed for ${apiId}: HTTP ${response.status}`,
        );
      }
    } catch (err) {
      this.options.logger.warn(
        `Could not fetch OpenAPI spec for ${apiId}, using minimal fallback. Reason: ${err}`,
      );
    }

    return JSON.stringify({
      openapi: '3.0.0',
      info: { title: apiId, version: '1.0.0' },
      servers: [{ url: serviceUrl }],
      paths: {},
    });
  }
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]/g, '-')
    .replace(/^[-_.]/, 'x')
    .replace(/[-_.]$/, '')
    .slice(0, 63);
}
