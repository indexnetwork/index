import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AgentDispatcherImpl } from '../agent-dispatcher.service';
import type { AgentWithRelations } from '../../adapters/agent.database.adapter';

function makeAgent(overrides: Partial<AgentWithRelations> = {}): AgentWithRelations {
  return {
    id: overrides.id ?? 'agent-1',
    ownerId: overrides.ownerId ?? 'user-1',
    name: 'Test Agent',
    description: null,
    type: overrides.type ?? 'personal',
    status: 'active',
    metadata: {},
    lastSeenAt: overrides.lastSeenAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    transports: [],
    permissions: [],
  };
}

const FRESH = new Date(Date.now() - 10_000); // 10s ago — well within 90s
const STALE = new Date(Date.now() - 120_000); // 2m ago — beyond 90s

describe('AgentDispatcherImpl.dispatch', () => {
  let enqueueTimeout: ReturnType<typeof mock>;
  let findAuthorizedAgents: ReturnType<typeof mock>;
  let dispatcher: AgentDispatcherImpl;

  beforeEach(() => {
    enqueueTimeout = mock(async () => 'job-id');
    findAuthorizedAgents = mock(async () => []);
    dispatcher = new AgentDispatcherImpl(
      { findAuthorizedAgents },
      { enqueueTimeout } as unknown as ConstructorParameters<typeof AgentDispatcherImpl>[1],
    );
  });

  const scope = { action: 'negotiation.respond', scopeType: 'network', scopeId: 'net-1' };
  const payload = { negotiationId: 'neg-1', history: [] } as Parameters<AgentDispatcherImpl['dispatch']>[2];

  it('returns no_agent when no personal agent is registered', async () => {
    findAuthorizedAgents.mockResolvedValue([]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result).toEqual({ handled: false, reason: 'no_agent' });
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('returns timeout when all personal agents are stale', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastSeenAt: STALE })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('returns timeout when the personal agent has never been seen', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastSeenAt: null })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('timeout');
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('parks with the provided timeoutMs when a fresh personal agent exists', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastSeenAt: FRESH })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result).toEqual({ handled: false, reason: 'waiting', resumeToken: 'neg-1' });
    expect(enqueueTimeout).toHaveBeenCalledWith('neg-1', 0, 300_000);
  });

  it('parks when at least one of multiple agents is fresh', async () => {
    findAuthorizedAgents.mockResolvedValue([
      makeAgent({ id: 'a-stale', lastSeenAt: STALE }),
      makeAgent({ id: 'a-fresh', lastSeenAt: FRESH }),
    ]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('waiting');
    expect(enqueueTimeout).toHaveBeenCalledTimes(1);
  });

  it('ignores system agents when checking freshness', async () => {
    findAuthorizedAgents.mockResolvedValue([
      makeAgent({ type: 'system', lastSeenAt: FRESH }),
      makeAgent({ type: 'personal', lastSeenAt: STALE }),
    ]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('timeout');
  });
});
