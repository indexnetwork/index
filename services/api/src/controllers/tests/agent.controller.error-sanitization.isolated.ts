process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

import { afterAll, describe, expect, it, mock } from 'bun:test';
import { recordRequestAuthContext } from '../../lib/request-auth-context';

class NotFoundError extends Error {}
class ConflictError extends Error {}
class UnauthorizedError extends Error {}
class SeatViolationError extends Error {}

mock.module('../../services/negotiation-polling.service', () => ({
  negotiationPollingService: {},
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  SeatViolationError,
}));
mock.module('../../services/agent.service', () => ({ agentService: {} }));
mock.module('../../services/agent-test-message.service', () => ({
  AgentTestMessageService: class AgentTestMessageService {},
}));
mock.module('../../services/opportunity-delivery.service', () => ({ opportunityDeliveryService: {} }));
mock.module('../../guards/auth.guard', () => ({
  AuthGuard: class AuthGuard {},
  OwnerControlGuard: class OwnerControlGuard {},
  SessionOnlyGuard: class SessionOnlyGuard {},
  resolveApiKeyAgentId: async () => null,
  authorizeNegotiationRespondPrincipal: async (
    request: Request,
    agentId: string,
    resolve: (value: Request) => Promise<string | null>,
  ) => await resolve(request) === agentId,
  requireNegotiationCredentialPrincipal: (request: Request) => {
    const context = request as Request & { __unused?: never };
    void context;
    return {
      credentialId: 'credential-provider-free',
      agentId: AGENT_ID,
      audience: null,
      setupAttemptId: null,
    };
  },
}));
mock.module('../../guards/limiter.guard', () => ({ RateLimit: () => class RateLimitGuard {} }));
mock.module('../../lib/sentry', () => ({ captureAppException: mock(() => undefined) }));

const { AgentController } = await import('../agent.controller');

afterAll(() => mock.restore());

const AGENT_ID = 'agent-provider-free';
const OWNER = { id: 'owner-provider-free', email: 'owner@example.test', name: 'Owner' };
const REDIS_SECRET_URL = 'rediss://runtime-user:redis-password@private-cache.example.test:6380/0';

function pickupRequest(): Request {
  const request = new Request(`http://localhost/agents/${AGENT_ID}/negotiations/pickup`, {
    method: 'POST',
    headers: { 'x-index-hermes-run-id': 'run-provider-free' },
  });
  recordRequestAuthContext(request, {
    kind: 'api_key',
    agentId: AGENT_ID,
    credentialId: 'credential-provider-free',
    audience: 'hermes-negotiator',
    setupAttemptId: 'setup-provider-free',
  });
  return request;
}

function respondRequest(): Request {
  const request = new Request(`http://localhost/agents/${AGENT_ID}/negotiations/task-1/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'counter',
      message: 'Continue',
      assessment: {
        reasoning: 'provider-free fixture',
        suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
      },
    }),
  });
  recordRequestAuthContext(request, {
    kind: 'api_key',
    agentId: AGENT_ID,
    credentialId: 'credential-provider-free',
    audience: null,
    setupAttemptId: null,
  });
  return request;
}

function controller(rejection: unknown): AgentController {
  const negotiations = {
    pickup: async () => { throw rejection; },
    respond: async () => { throw rejection; },
  };
  return new AgentController(
    {} as never,
    negotiations as never,
    {} as never,
    {} as never,
    async () => AGENT_ID,
  );
}

function credentialBearingFailure(): Error {
  const error = new Error(`Redis queue failed at ${REDIS_SECRET_URL}`) as Error & {
    body?: unknown;
    details?: unknown;
    code?: string;
  };
  error.body = { redisUrl: REDIS_SECRET_URL, token: 'outbox-token-secret' };
  error.details = { connection: REDIS_SECRET_URL };
  error.code = 'ECONNRESET';
  return error;
}

async function expectSanitized(response: Response): Promise<void> {
  expect(response.status).toBe(500);
  const pluginResult = JSON.stringify(await response.json());
  expect(pluginResult).toBe('{"error":"Internal server error"}');
  expect(pluginResult).not.toContain(REDIS_SECRET_URL);
  expect(pluginResult).not.toContain('redis-password');
  expect(pluginResult).not.toContain('outbox-token-secret');
  expect(pluginResult).not.toContain('ECONNRESET');
}

describe('negotiation controller error sanitization', () => {
  it('returns a stable credential-free 500 for an unknown pickup queue failure', async () => {
    await expectSanitized(await controller(credentialBearingFailure()).pickupNegotiation(
      pickupRequest(),
      OWNER,
      { id: AGENT_ID },
    ));
  });

  it('returns a stable credential-free 500 for an unknown response outbox failure', async () => {
    await expectSanitized(await controller(credentialBearingFailure()).respondNegotiation(
      respondRequest(),
      OWNER,
      { id: AGENT_ID, negotiationId: 'task-1' },
    ));
  });

  it.each([
    [new SeatViolationError('seat violation'), 400],
    [new UnauthorizedError('not authorized'), 403],
    [new NotFoundError('not found'), 404],
    [new ConflictError('conflict'), 409],
  ] as const)('preserves typed domain errors for pickup and respond', async (error, status) => {
    const pickup = await controller(error).pickupNegotiation(pickupRequest(), OWNER, { id: AGENT_ID });
    expect(pickup.status).toBe(status);
    expect(await pickup.json()).toEqual({ error: error.message });

    const respond = await controller(error).respondNegotiation(
      respondRequest(), OWNER, { id: AGENT_ID, negotiationId: 'task-1' },
    );
    expect(respond.status).toBe(status);
    expect(await respond.json()).toEqual({ error: error.message });
  });
});
