import { describe, expect, test } from 'bun:test';

import { notificationStreamChannel } from '../notification-stream-events';

describe('notificationStreamChannel', () => {
  test('scopes pub/sub to the authenticated user', () => {
    expect(notificationStreamChannel('user-123')).toBe('notifications:user:user-123');
  });
});
