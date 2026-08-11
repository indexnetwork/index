import { createRedisClient } from '../adapters/cache.adapter';
import { notificationStreamChannel } from '../lib/notification-stream-events';

export interface NotificationSubscription {
  onMessage(handler: (data: string) => void): void;
  cleanup(): Promise<void>;
}

export interface NotificationSubscriber {
  on(event: 'message', listener: (channel: string, data: string) => void): unknown;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  disconnect(): unknown;
}

/**
 * Opens ready, user-scoped notification subscriptions over Redis pub/sub.
 */
export class NotificationService {
  constructor(
    private readonly createSubscriber: () => NotificationSubscriber = createRedisClient,
  ) {}

  /**
   * Resolves only after Redis acknowledges the user-channel subscription.
   * Messages arriving before the consumer registers its handler are buffered.
   */
  async open(userId: string): Promise<NotificationSubscription> {
    const subscriber = this.createSubscriber();
    const channel = notificationStreamChannel(userId);
    let handler: ((data: string) => void) | null = null;
    let buffered: string[] = [];
    let cleaned = false;

    subscriber.on('message', (receivedChannel, data) => {
      if (cleaned || receivedChannel !== channel) return;
      if (handler) {
        handler(data);
      } else {
        buffered.push(data);
      }
    });

    try {
      await subscriber.subscribe(channel);
    } catch (error) {
      cleaned = true;
      buffered = [];
      try { await subscriber.disconnect(); } catch { /* best-effort cleanup */ }
      throw error;
    }

    return {
      onMessage(nextHandler) {
        if (cleaned) return;
        handler = nextHandler;
        const pending = buffered;
        buffered = [];
        for (const data of pending) handler(data);
      },
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        handler = null;
        buffered = [];
        try {
          await subscriber.unsubscribe(channel);
        } catch { /* disconnect still runs */ }
        try { await subscriber.disconnect(); } catch { /* best-effort cleanup */ }
      },
    };
  }
}
