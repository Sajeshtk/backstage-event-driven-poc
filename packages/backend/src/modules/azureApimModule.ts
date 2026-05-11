import {
  createBackendModule,
  coreServices,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { AzureApimEntityProvider } from './AzureApimEntityProvider';

export default createBackendModule({
  pluginId: 'catalog',
  moduleId: 'azure-apim-provider',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        scheduler: coreServices.scheduler,
        logger: coreServices.logger,
      },
      async init({ catalog, config, scheduler, logger }) {
        const providers = AzureApimEntityProvider.fromConfig(config, {
          logger,
          scheduler,
        });
        for (const provider of providers) {
          catalog.addEntityProvider(provider);
        }
      },
    });
  },
});
