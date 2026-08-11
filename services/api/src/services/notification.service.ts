import { createRedisClient } from '../adapters/cache.adapter';
import { notificationStreamChannel } from '../lib/notification-stream-events';
import { log } from '../lib/log';

const logger = log.service.from('NotificationService');

/**
 * Subscribes to user-scoped notification SSE events on Redis pub/sub.
 */
export class NotificationService {
  subscribe(userId: string) {
    const sub = createRedisClient();
    const channel = notificationStreamChannel(userId);
    let cancelled = false;

    return {
      onMessage(handler: (data: string) => void) {
        sub.on('message', (_ch: string, data: string) => {
          if (!cancelled) handler(data);
        });
        sub.subscribe(channel).catch((err) => {
          logger.error('Redis subscribe failed', {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      cleanup() {
        cancelled = true;
        sub.unsubscribe(channel).then(() => sub.disconnect()).catch(() => {});
      },
    };
  }
}
