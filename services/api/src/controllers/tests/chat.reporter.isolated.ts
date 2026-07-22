process.env.OPENROUTER_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';

import { afterEach, describe, expect, mock, test } from 'bun:test';

const AuthGuard = () => undefined;
const SessionOnlyGuard = () => undefined;
const resolveReporterSession = mock(() => Promise.resolve({
  session: {
    id: 'reporter-session-1',
    userId: 'reporter-user-1',
    title: null,
    persona: 'reporter',
    networkId: null,
    scopeType: null,
    scopeId: null,
    shareToken: null,
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    updatedAt: new Date('2026-07-22T00:00:00.000Z'),
  },
  created: true,
}));

mock.module('../../lib/drizzle/drizzle', () => ({ default: {} }));
mock.module('../../guards/auth.guard', () => ({ AuthGuard, SessionOnlyGuard }));
mock.module('../../guards/limiter.guard', () => ({ RateLimit: () => () => undefined }));
mock.module('../../services/chat.service', () => ({
  chatSessionService: { resolveReporterSession },
}));
mock.module('../../services/file.service', () => ({ fileService: {} }));
mock.module('../../services/agent.service', () => ({ agentService: {} }));
mock.module('../../services/user.service', () => ({ userService: {} }));
mock.module('../../queues/negotiations/reflect.queue', () => ({ negotiationReflectQueue: {} }));

import { RouteRegistry } from '../../lib/router/router.decorators';
import { ChatController } from '../chat.controller';

type AuthenticatedUser = { id: string; email: string | null; name: string };

const USER: AuthenticatedUser = {
  id: 'reporter-user-1',
  email: 'reporter@example.com',
  name: 'Reporter User',
};

describe('Reporter briefing session resolver (IND-484)', () => {
  const previousFlag = process.env.WEB_AGENT_SURFACE_ENABLED;

  afterEach(() => {
    resolveReporterSession.mockClear();
    if (previousFlag === undefined) delete process.env.WEB_AGENT_SURFACE_ENABLED;
    else process.env.WEB_AGENT_SURFACE_ENABLED = previousFlag;
  });

  test('returns the atomic creation claim and forwards only forceNew', async () => {
    process.env.WEB_AGENT_SURFACE_ENABLED = 'true';
    const controller = new ChatController();
    const request = new Request('http://localhost/chat/reporter/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceNew: true }),
    });

    const response = await controller.reporterSession(request, USER);
    const payload = await response.json() as { session: { id: string; persona: string }; created: boolean };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      session: { id: 'reporter-session-1', persona: 'reporter' },
      created: true,
    });
    expect(resolveReporterSession).toHaveBeenCalledWith(USER.id, true);
  });

  test('is session-only, flag-gated, and rejects caller-controlled persona fields', async () => {
    const controller = new ChatController();
    const request = (body: Record<string, unknown>) => new Request(
      'http://localhost/chat/reporter/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    delete process.env.WEB_AGENT_SURFACE_ENABLED;
    const disabled = await controller.reporterSession(request({}), USER);
    expect(disabled.status).toBe(404);
    expect(resolveReporterSession).not.toHaveBeenCalled();

    process.env.WEB_AGENT_SURFACE_ENABLED = 'true';
    const spoofed = await controller.reporterSession(
      request({ forceNew: false, persona: 'orchestrator' }),
      USER,
    );
    expect(spoofed.status).toBe(400);
    expect(resolveReporterSession).not.toHaveBeenCalled();

    const guardNames = RouteRegistry
      .getGuards(ChatController, 'reporterSession')
      .map((guard) => guard.name);
    expect(guardNames).toContain('SessionOnlyGuard');
    expect(guardNames).not.toContain('AuthGuard');
  });
});
