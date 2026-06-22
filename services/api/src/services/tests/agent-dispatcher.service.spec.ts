import { describe, it, expect, beforeEach } from 'bun:test';
import type { NegotiationTimeoutQueue, NegotiationTurnPayload } from '@indexnetwork/protocol';

import { AgentDispatcherImpl } from '../agent-dispatcher.service';
import type { AgentWithRelations } from '../../adapters/agent.database.adapter';

function makeAgent(overrides: Partial<AgentWithRelations> = {}): AgentWithRelations {
  return {
    id: 'agent-1',
    ownerId: 'user-1',
    name: 'Test Agent',
    description: null,
    type: 'personal',
    status: 'active',
    metadata: {},
    transports: [],
    permissions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AgentWithRelations;
}

const payload: NegotiationTurnPayload = {
  negotiationId: 'n-1',
  ownUser: { id: 'user-1', intents: [], profile: {} },
  otherUser: { id: 'user-2', intents: [], profile: {} },
  indexContext: { networkId: 'net-1' },
  seedAssessment: { reasoning: '', valencyRole: '' },
  history: [],
  isFinalTurn: false,
  isDiscoverer: true,
};

const scope = { action: 'manage:negotiations', scopeType: 'negotiation' as const };

describe('AgentDispatcherImpl.dispatch', () => {
  let agents: AgentWithRelations[];
  let timeoutEnqueued: boolean;
  let dispatcher: AgentDispatcherImpl;

  beforeEach(() => {
    agents = [];
    timeoutEnqueued = false;
    dispatcher = new AgentDispatcherImpl(
      { findAuthorizedAgents: async () => agents },
      {
        enqueueTimeout: async () => { timeoutEnqueued = true; return 'job-1'; },
        cancelTimeout: async () => {},
      } as unknown as NegotiationTimeoutQueue,
    );
  });

  it('returns no_agent when no personal agents exist', async () => {
    agents = [];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res).toEqual({ handled: false, reason: 'no_agent' });
    expect(timeoutEnqueued).toBe(false);
  });

  it('returns no_agent when only system agents exist', async () => {
    agents = [makeAgent({ type: 'system' })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res).toEqual({ handled: false, reason: 'no_agent' });
  });

  it('returns waiting and enqueues timeout when personal agent exists (long timeout)', async () => {
    agents = [makeAgent({ lastSeenAt: new Date() })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res).toEqual({ handled: false, reason: 'waiting', resumeToken: 'n-1' });
    expect(timeoutEnqueued).toBe(true);
  });

  it('returns timeout when personal agent exists but is stale', async () => {
    agents = [makeAgent()];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 30_000 });
    expect(res).toEqual({ handled: false, reason: 'timeout' });
    expect(timeoutEnqueued).toBe(false);
  });

  it('does not require transports — any fresh personal agent triggers waiting', async () => {
    agents = [makeAgent({ transports: [], lastSeenAt: new Date() })];
    const res = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(res).toEqual({ handled: false, reason: 'waiting', resumeToken: 'n-1' });
  });
});

describe('AgentDispatcherImpl.hasPersonalAgent', () => {
  it('returns true when a personal agent is authorized', async () => {
    const dispatcher = new AgentDispatcherImpl(
      { findAuthorizedAgents: async () => [makeAgent()] },
      undefined,
    );
    const result = await dispatcher.hasPersonalAgent('user-1', scope);
    expect(result).toBe(true);
  });

  it('returns false when only system agents exist', async () => {
    const dispatcher = new AgentDispatcherImpl(
      { findAuthorizedAgents: async () => [makeAgent({ type: 'system' })] },
      undefined,
    );
    const result = await dispatcher.hasPersonalAgent('user-1', scope);
    expect(result).toBe(false);
  });

  it('returns false when no agents exist', async () => {
    const dispatcher = new AgentDispatcherImpl(
      { findAuthorizedAgents: async () => [] },
      undefined,
    );
    const result = await dispatcher.hasPersonalAgent('user-1', scope);
    expect(result).toBe(false);
  });
});
