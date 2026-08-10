import { describe, expect, test } from 'bun:test';

import { NotificationController } from '../notification.controller';
import { NotificationService } from '../../services/notification.service';

describe('NotificationController stream', () => {
  test('returns an SSE response with connected frame', async () => {
    const controller = new NotificationController({
      subscribe: () => ({
        onMessage: () => {},
        cleanup: () => {},
      }),
    } as NotificationService);

    const response = await controller.stream(new Request('http://localhost/notifications/stream'), {
      id: 'user-1',
      email: 'test@example.com',
    });

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    await reader.cancel();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain('"type":"connected"');
  });
});
