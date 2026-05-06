import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';
import { startConsumer } from './Consumer';

export const eventPluginPlugin = createBackendPlugin({
  pluginId: 'event-plugin',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
      },
      async init({ httpRouter }) {

        // Start RabbitMQ Consumer
        await startConsumer();

        // Register API routes
        httpRouter.use(
          await createRouter(),
        );
      },
    });
  },
});