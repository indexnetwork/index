import { describe, expect, mock, test } from 'bun:test';

import type { AuthenticatedUser } from '../../guards/auth.guard';
import { ScopeViolationError } from '../../guards/agent-scope.guard';
import type { NotificationStreamEvent } from '../../lib/notification-stream-events';
import { NotificationController } from '../notification.controller';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'test@example.com',
};

const request = () => new Request('http://localhost/notifications/stream');

function subscription() {
  return {
    onMessage: mock((_handler: (data: string) => void) => {}),
    cleanup: mock(async () => {}),
  };
}

function controllerWith(options: {
  open?: () => Promise<ReturnType<typeof subscription>>;
  snapshot?: () => Promise<NotificationStreamEvent[]>;
  scope?: string | null;
} = {}) {
  const activeSubscription = subscription();
  const open = mock(options.open ?? (async () => activeSubscription));
  const snapshot = mock(options.snapshot ?? (async () => []));
  const resolveNetworkScope = mock(async () => options.scope ?? null);
  const controller = new NotificationController(
    { open },
    { snapshot },
    resolveNetworkScope,
  );
  return { controller, activeSubscription, open, snapshot, resolveNetworkScope };
}

describe('NotificationController', () => {
  test('rejects scoped keys before opening a Redis subscription or reading a snapshot', async () => {
    const { controller, open, snapshot } = controllerWith({ scope: 'network-1' });

    await expect(controller.stream(request(), user)).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(controller.snapshot(request(), user)).rejects.toBeInstanceOf(ScopeViolationError);

    expect(open).toHaveBeenCalledTimes(0);
    expect(snapshot).toHaveBeenCalledTimes(0);
  });

  test('returns 503 without a connected frame when subscription readiness fails', async () => {
    const { controller } = controllerWith({
      open: async () => { throw new Error('subscribe failed'); },
    });

    const response = await controller.stream(request(), user);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(body).not.toContain('connected');
  });

  test('emits connected only after a successful open and cancellation cleans up once', async () => {
    const { controller, activeSubscription, open } = controllerWith();

    const response = await controller.stream(request(), user);
    expect(open).toHaveBeenCalledTimes(1);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"type":"connected"');

    await reader.cancel();
    await reader.cancel();
    expect(activeSubscription.cleanup).toHaveBeenCalledTimes(1);
  });

  test('returns the delivery service snapshot for unscoped callers', async () => {
    const events: NotificationStreamEvent[] = [{
      type: 'opportunity.new',
      id: 'opportunity-1',
      title: 'A promising connection',
      body: 'Open Index to review.',
    }];
    const { controller, snapshot } = controllerWith({ snapshot: async () => events });

    const response = await controller.snapshot(request(), user);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events });
    expect(snapshot).toHaveBeenCalledWith('user-1');
  });
});
