import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { AgentController } from '../agent.controller';

const touchLastSeenMock = mock(async (_agentId: string): Promise<void> => {});
const getByIdMock = mock(async (_agentId: string, _userId: string) => ({ id: _agentId }));
const countDeliveriesSinceMock = mock(async (_agentId: string, _since: Date) => ({
  ambient: 2,
  digest: 1,
}));

const agents = {
  touchLastSeen: touchLastSeenMock,
  getById: getByIdMock,
};
const deliveries = {
  countDeliveriesSince: countDeliveriesSinceMock,
};

function makeController(): AgentController {
  return new AgentController(agents as never, undefined, undefined, deliveries as never);
}

describe('AgentController.getDeliveryStats', () => {
  beforeEach(() => {
    countDeliveriesSinceMock.mockClear();
    getByIdMock.mockClear();
    touchLastSeenMock.mockClear();
  });

  it('returns counts when since parses', async () => {
    const ctrl = makeController();
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
    const ctrl = makeController();
    const req = new Request('http://x/agents/agent-1/opportunities/delivery-stats');
    const user = { id: 'user-1' };
    const res = await ctrl.getDeliveryStats(req, user as never, { id: 'agent-1' } as never);
    expect(res.status).toBe(400);
  });

  it('rejects malformed since with 400', async () => {
    const ctrl = makeController();
    const req = new Request(
      'http://x/agents/agent-1/opportunities/delivery-stats?since=not-a-date',
    );
    const user = { id: 'user-1' };
    const res = await ctrl.getDeliveryStats(req, user as never, { id: 'agent-1' } as never);
    expect(res.status).toBe(400);
  });
});
