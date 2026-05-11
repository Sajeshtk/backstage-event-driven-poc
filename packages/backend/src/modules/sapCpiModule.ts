import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { SapCpiEntityProvider } from './SapCpiEntityProvider';

export default createBackendModule({
  pluginId: 'catalog',
  moduleId: 'sap-cpi-provider',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        scheduler: coreServices.scheduler,
        logger: coreServices.logger,
      },
      async init({ catalog, config, scheduler, logger }) {
        const providers = SapCpiEntityProvider.fromConfig(config, { logger, scheduler });
        for (const provider of providers) {
          catalog.addEntityProvider(provider);
        }
      },
    });
  },
});
