import { describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import { notificationStreamChannel } from '../../lib/notification-stream-events';
import { NotificationService } from '../notification.service';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeSubscriber(subscribeResult: Promise<number>) {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    subscribe: mock(() => subscribeResult),
    unsubscribe: mock(async () => 0),
    disconnect: mock(() => {}),
  };
}

describe('NotificationService', () => {
  test('rejects failed readiness and disconnects the dedicated subscriber', async () => {
    const subscriber = fakeSubscriber(Promise.reject(new Error('subscribe failed')));
    const service = new NotificationService(() => subscriber);

    await expect(service.open('user-1')).rejects.toThrow('subscribe failed');

    expect(subscriber.subscribe).toHaveBeenCalledWith(notificationStreamChannel('user-1'));
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
  });

  test('awaits readiness, buffers until a handler exists, and cleans up once', async () => {
    const readiness = deferred<number>();
    const subscriber = fakeSubscriber(readiness.promise);
    const service = new NotificationService(() => subscriber);
    const channel = notificationStreamChannel('user-1');
    let opened = false;

    const opening = service.open('user-1').then((subscription) => {
      opened = true;
      return subscription;
    });
    await Promise.resolve();
    subscriber.emit('message', channel, 'before-ready');
    expect(opened).toBe(false);

    readiness.resolve(1);
    const subscription = await opening;
    subscriber.emit('message', channel, 'before-handler');

    const received: string[] = [];
    subscription.onMessage((data) => received.push(data));
    expect(received).toEqual(['before-ready', 'before-handler']);

    subscriber.emit('message', channel, 'after-handler');
    expect(received).toEqual(['before-ready', 'before-handler', 'after-handler']);

    await subscription.cleanup();
    await subscription.cleanup();
    subscriber.emit('message', channel, 'after-cleanup');

    expect(received).toEqual(['before-ready', 'before-handler', 'after-handler']);
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).toHaveBeenCalledWith(channel);
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
  });
});
