import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { AgentController } from '../agent.controller';

// Shared call log so tests can assert authorization happens before heartbeat updates.
const callOrder: string[] = [];

const touchLastSeenMock = mock(async (_agentId: string): Promise<void> => {
  callOrder.push('touch');
});
const getByIdMock = mock(async (_agentId: string, _userId: string) => {
  callOrder.push('getById');
  return { id: _agentId };
});
const negotiationPickupMock = mock(async (_agentId: string, _userId: string) => {
  callOrder.push('pickupNegotiation');
  return null;
});
const testMessagePickupMock = mock(async (_agentId: string) => {
  callOrder.push('pickupTestMessage');
  return null;
});
const opportunityPickupMock = mock(async (_agentId: string) => {
  callOrder.push('pickupOpportunity');
  return null;
});
const fetchPendingCandidatesMock = mock(async (_agentId: string, _limit?: number) => ({
  opportunities: [],
  totalPending: 0,
}));

const agents = {
  touchLastSeen: touchLastSeenMock,
  getById: getByIdMock,
};
const negotiations = {
  pickup: negotiationPickupMock,
};
const testMessages = {
  pickup: testMessagePickupMock,
};
const deliveries = {
  pickupPending: opportunityPickupMock,
  fetchPendingCandidates: fetchPendingCandidatesMock,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = 'agent-123';
const TEST_USER_ID = 'user-456';

const mockUser = { id: TEST_USER_ID, email: 'test@example.com' };

function makeController() {
  return new AgentController(
    agents as never,
    negotiations as never,
    testMessages as never,
    deliveries as never,
  );
}

function makeParams(id: string): Record<string, string> {
  return { id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentController pickup endpoints heartbeat', () => {
  let controller: InstanceType<typeof AgentController>;

  beforeEach(() => {
    controller = makeController();
    callOrder.length = 0;
    touchLastSeenMock.mockClear();
    negotiationPickupMock.mockClear();
    testMessagePickupMock.mockClear();
    opportunityPickupMock.mockClear();
    fetchPendingCandidatesMock.mockClear();
    getByIdMock.mockClear();
  });

  it('pickupNegotiation bumps lastSeenAt AFTER pickup authorizes the caller', async () => {
    const req = new Request('http://localhost/agents/agent-123/negotiations/pickup', { method: 'POST' });

    await controller.pickupNegotiation(req, mockUser as never, makeParams(TEST_AGENT_ID));

    expect(touchLastSeenMock).toHaveBeenCalledWith(TEST_AGENT_ID);
    // Pickup runs first (it enforces ownership); heartbeat fires only after.
    expect(callOrder).toEqual(['pickupNegotiation', 'touch']);
  });

  it('pickupTestMessage bumps lastSeenAt AFTER getById authorizes the caller', async () => {
    const req = new Request('http://localhost/agents/agent-123/test-messages/pickup', { method: 'POST' });

    await controller.pickupTestMessage(req, mockUser as never, makeParams(TEST_AGENT_ID));

    expect(touchLastSeenMock).toHaveBeenCalledWith(TEST_AGENT_ID);
    expect(callOrder).toEqual(['getById', 'pickupTestMessage', 'touch']);
  });

  it('pickupOpportunity bumps lastSeenAt AFTER getById authorizes the caller', async () => {
    const req = new Request('http://localhost/agents/agent-123/opportunities/pickup', { method: 'POST' });

    await controller.pickupOpportunity(req, mockUser as never, makeParams(TEST_AGENT_ID));

    expect(touchLastSeenMock).toHaveBeenCalledWith(TEST_AGENT_ID);
    // Pickup pins the order: getById (auth) → touch (heartbeat) → pickupPending (work).
    // The heartbeat cannot fire without getById, and work follows the heartbeat.
    expect(callOrder).toEqual(['getById', 'touch', 'pickupOpportunity']);
  });

  it('bumps lastSeenAt even when nothing pending (empty poll)', async () => {
    // All three pickup mocks already return null (empty). Verify heartbeat fires regardless.
    const negReq = new Request('http://localhost/agents/agent-123/negotiations/pickup', { method: 'POST' });
    const msgReq = new Request('http://localhost/agents/agent-123/test-messages/pickup', { method: 'POST' });
    const oppReq = new Request('http://localhost/agents/agent-123/opportunities/pickup', { method: 'POST' });

    await controller.pickupNegotiation(negReq, mockUser as never, makeParams(TEST_AGENT_ID));
    await controller.pickupTestMessage(msgReq, mockUser as never, makeParams(TEST_AGENT_ID));
    await controller.pickupOpportunity(oppReq, mockUser as never, makeParams(TEST_AGENT_ID));

    expect(touchLastSeenMock).toHaveBeenCalledTimes(3);
    expect(touchLastSeenMock).toHaveBeenNthCalledWith(1, TEST_AGENT_ID);
    expect(touchLastSeenMock).toHaveBeenNthCalledWith(2, TEST_AGENT_ID);
    expect(touchLastSeenMock).toHaveBeenNthCalledWith(3, TEST_AGENT_ID);
  });

  it('does NOT bump lastSeenAt when pickup throws (unauthorized probe)', async () => {
    negotiationPickupMock.mockImplementationOnce(async () => {
      callOrder.push('pickupNegotiation');
      throw new Error('Not authorized');
    });
    const req = new Request('http://localhost/agents/agent-999/negotiations/pickup', { method: 'POST' });

    await controller.pickupNegotiation(req, mockUser as never, makeParams('agent-999'));

    expect(negotiationPickupMock).toHaveBeenCalled();
    expect(touchLastSeenMock).not.toHaveBeenCalled();
    expect(callOrder).toEqual(['pickupNegotiation']);
  });
});

// ---------------------------------------------------------------------------
// GET /:id/opportunities/pending — ?limit query parameter
// ---------------------------------------------------------------------------

describe('AgentController getPendingOpportunities ?limit parameter', () => {
  let controller: InstanceType<typeof AgentController>;

  beforeEach(() => {
    controller = makeController();
    fetchPendingCandidatesMock.mockClear();
    getByIdMock.mockClear();
    touchLastSeenMock.mockClear();
  });

  // The controller only validates "parses to a finite number"; the service
  // does the [1, 20] clamp + integer truncation. So in-range out-of-bounds
  // values (0, -3, 21, 1.5) are passed through and normalized downstream;
  // only NaN/Infinity/non-numeric strings get a 400 here.

  it.each<[string, number]>([
    ['7', 7],
    ['1', 1],
    ['20', 20],
    ['21', 21], // service clamps to 20
    ['0', 0], // service clamps to 1
    ['-3', -3], // service clamps to 1
    ['1.5', 1.5], // service truncates to 1
  ])('forwards ?limit=%s to service as %p', async (param, forwarded) => {
    const req = new Request(`http://localhost/agents/${TEST_AGENT_ID}/opportunities/pending?limit=${param}`);
    await controller.getPendingOpportunities(req, mockUser as never, makeParams(TEST_AGENT_ID));
    expect(fetchPendingCandidatesMock).toHaveBeenCalledWith(TEST_AGENT_ID, forwarded);
  });

  it.each<[string, string]>([
    ['absent', `http://localhost/agents/${TEST_AGENT_ID}/opportunities/pending`],
    ['empty', `http://localhost/agents/${TEST_AGENT_ID}/opportunities/pending?limit=`],
  ])('passes undefined to service when ?limit is %s', async (_label, url) => {
    const req = new Request(url);
    await controller.getPendingOpportunities(req, mockUser as never, makeParams(TEST_AGENT_ID));
    expect(fetchPendingCandidatesMock).toHaveBeenCalledWith(TEST_AGENT_ID, undefined);
  });

  it.each(['abc', 'Infinity', '-Infinity', 'NaN'])(
    'returns 400 when ?limit=%s (not finite)',
    async (param) => {
      const req = new Request(`http://localhost/agents/${TEST_AGENT_ID}/opportunities/pending?limit=${param}`);
      const res = await controller.getPendingOpportunities(req, mockUser as never, makeParams(TEST_AGENT_ID));
      expect((res as Response).status).toBe(400);
      expect(fetchPendingCandidatesMock).not.toHaveBeenCalled();
    },
  );
});
