import { eventFrontendPlugin } from './plugin';

describe('event-frontend', () => {
  it('should export plugin', () => {
    expect(eventFrontendPlugin).toBeDefined();
  });
});
