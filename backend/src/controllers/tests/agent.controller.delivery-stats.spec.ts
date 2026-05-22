import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Module mocks — must be registered BEFORE the controller is imported so that
// the module-level singletons inside agent.controller.ts resolve to our fakes.
// ---------------------------------------------------------------------------

const touchLastSeenMock = mock(async (_agentId: string): Promise<void> => {});
const getByIdMock = mock(async (_agentId: string, _userId: string) => {
  return { id: _agentId };
});

mock.module('../../services/agent.service', () => ({
  agentService: {
    touchLastSeen: touchLastSeenMock,
    getById: getByIdMock,
    listForUser: mock(async () => []),
    create: mock(async () => ({})),
    update: mock(async () => ({})),
    delete: mock(async () => {}),
    addTransport: mock(async () => ({})),
    removeTransport: mock(async () => {}),
    grantPermission: mock(async () => ({})),
    revokePermission: mock(async () => {}),
    listTokens: mock(async () => []),
    createToken: mock(async () => ({})),
    revokeToken: mock(async () => {}),
    hasPermission: mock(async () => true),
    findAuthorizedAgents: mock(async () => []),
    grantDefaultSystemPermissions: mock(async () => {}),
  },
}));

mock.module('../../services/negotiation-polling.service', () => ({
  negotiationPollingService: {
    pickup: mock(async () => null),
    respond: mock(async () => ({})),
  },
  NotFoundError: class NotFoundError extends Error {},
  ConflictError: class ConflictError extends Error {},
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

mock.module('../../services/agent-test-message.service', () => ({
  AgentTestMessageService: class {
    pickup = mock(async () => null);
    enqueue = mock(async () => ({}));
    confirmDelivered = mock(async () => {});
  },
}));

const countDeliveriesSinceMock = mock(async (_agentId: string, _since: Date) => ({
  ambient: 2,
  digest: 1,
}));

const opportunityDeliveryInstance = {
  pickupPending: mock(async () => null),
  confirmDelivered: mock(async () => {}),
  fetchPendingCandidates: mock(async () => []),
  countDeliveriesSince: countDeliveriesSinceMock,
};

mock.module('../../services/opportunity-delivery.service', () => ({
  OpportunityDeliveryService: class {
    pickupPending = mock(async () => null);
    confirmDelivered = mock(async () => {});
    fetchPendingCandidates = mock(async () => []);
    countDeliveriesSince = countDeliveriesSinceMock;
  },
  opportunityDeliveryService: opportunityDeliveryInstance,
}));

// Guards: bypass auth so we can call handlers directly
mock.module('../../guards/auth.guard', () => ({
  AuthGuard: {},
  AuthOrApiKeyGuard: {},
  resolveApiKeyAgentId: mock(async () => null),
}));

// ---------------------------------------------------------------------------
// Import controller after mocks are in place
// ---------------------------------------------------------------------------
const { AgentController } = await import('../agent.controller');

// ---------------------------------------------------------------------------
// Restore mocks after all tests
// ---------------------------------------------------------------------------
afterAll(() => {
  mock.restore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentController.getDeliveryStats', () => {
  // Reset call counts before each test
  beforeEach(() => {
    countDeliveriesSinceMock.mockClear();
    getByIdMock.mockClear();
    touchLastSeenMock.mockClear();
  });

  it('returns counts when since parses', async () => {
    const ctrl = new AgentController();
    const since = '2026-04-27T00:00:00.000Z';
    const req = new Request(
      `http://x/agents/agent-1/opportunities/delivery-stats?since=${encodeURIComponent(since)}`,
    );
    const user = { id: 'user-1' };
    const res = await ctrl.getDeliveryStats(req, user as never, { id: 'agent-1' } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ambient: 2, digest: 1 });
    expect(countDeliveriesSinceMock).toHaveBeenCalledWith('agent-1', new Date(since));
  });

  it('rejects missing since with 400', async () => {
    const ctrl = new AgentController();
    const req = new Request(`http://x/agents/agent-1/opportunities/delivery-stats`);
    const user = { id: 'user-1' };
    const res = await ctrl.getDeliveryStats(req, user as never, { id: 'agent-1' } as never);
    expect(res.status).toBe(400);
  });

  it('rejects malformed since with 400', async () => {
    const ctrl = new AgentController();
    const req = new Request(
      `http://x/agents/agent-1/opportunities/delivery-stats?since=not-a-date`,
    );
    const user = { id: 'user-1' };
    const res = await ctrl.getDeliveryStats(req, user as never, { id: 'agent-1' } as never);
    expect(res.status).toBe(400);
  });
});
