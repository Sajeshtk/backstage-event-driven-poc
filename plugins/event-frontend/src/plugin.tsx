import {
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';

import { rootRouteRef } from './routes';
import EventIcon from '@material-ui/icons/Event';

export const page = PageBlueprint.make({
  params: {
    path: '/event',
    routeRef: rootRouteRef,
    title: 'Event Plugin',
    icon: <EventIcon />,
    loader: () =>
      import('./components/TodoPage').then(m => (
        <m.TodoPage />
      )),
  },
});

export const eventFrontendPlugin = createFrontendPlugin({
  pluginId: 'event-frontend',
  extensions: [page],
  routes: {
    root: rootRouteRef,
  },
});