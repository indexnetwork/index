import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AgentDispatcherImpl } from '../agent-dispatcher.service';
import type { AgentWithRelations } from '../../adapters/agent.database.adapter';

function makeAgent(overrides: Partial<AgentWithRelations> = {}): AgentWithRelations {
  return {
    id: overrides.id ?? 'agent-1',
    ownerId: overrides.ownerId ?? 'user-1',
    name: 'Test Agent',
    description: null,
    type: overrides.type ?? 'external',
    status: 'active',
    metadata: {},
    runtimeKind: overrides.runtimeKind ?? null,
    installationId: overrides.installationId ?? null,
    runtimeSetupAttemptId: overrides.runtimeSetupAttemptId ?? null,
    lastSeenAt: overrides.lastSeenAt ?? null,
    lastNegotiationPickupAt: overrides.lastNegotiationPickupAt ?? null,
    notifyOnOpportunity: true,
    dailySummaryEnabled: true,
    handleNegotiations: overrides.handleNegotiations ?? true,
    lastDailySummaryAt: null,
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

  it('returns no_agent when no external agent is registered', async () => {
    findAuthorizedAgents.mockResolvedValue([]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result).toEqual({ handled: false, reason: 'no_agent' });
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('returns timeout when all external agents are stale', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastNegotiationPickupAt: STALE })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('returns timeout when the external agent has never been seen', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastNegotiationPickupAt: null })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('timeout');
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('parks with the provided timeoutMs when a fresh external agent exists', async () => {
    findAuthorizedAgents.mockResolvedValue([makeAgent({ lastNegotiationPickupAt: FRESH })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result).toEqual({ handled: false, reason: 'waiting', resumeToken: expect.any(String) });
    expect(enqueueTimeout).toHaveBeenCalledWith(
      'neg-1', 0, 300_000, (result as { resumeToken: string }).resumeToken, undefined,
    );
  });

  it('parks when at least one of multiple agents is fresh', async () => {
    findAuthorizedAgents.mockResolvedValue([
      makeAgent({ id: 'a-stale', lastNegotiationPickupAt: STALE }),
      makeAgent({ id: 'a-fresh', lastNegotiationPickupAt: FRESH }),
    ]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('waiting');
    expect(enqueueTimeout).toHaveBeenCalledTimes(1);
  });

  it('ignores system agents when checking freshness', async () => {
    findAuthorizedAgents.mockResolvedValue([
      makeAgent({ type: 'system', lastNegotiationPickupAt: FRESH }),
      makeAgent({ type: 'external', lastNegotiationPickupAt: STALE }),
    ]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('timeout');
  });

  it('personal negotiator rows never trigger parking (IND-410)', async () => {
    // Even a "fresh" personal row must not park a turn — negotiators do not poll.
    findAuthorizedAgents.mockResolvedValue([makeAgent({ type: 'personal', lastNegotiationPickupAt: FRESH })]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result).toEqual({ handled: false, reason: 'no_agent' });
    expect(enqueueTimeout).not.toHaveBeenCalled();
  });

  it('ignores fresh but unselected external executors', async () => {
    findAuthorizedAgents.mockResolvedValue([
      makeAgent({ handleNegotiations: false, lastNegotiationPickupAt: FRESH }),
    ]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result).toEqual({ handled: false, reason: 'no_agent' });
  });

  it('uses negotiation pickup rather than unrelated lastSeenAt freshness', async () => {
    findAuthorizedAgents.mockResolvedValue([
      makeAgent({ lastSeenAt: FRESH, lastNegotiationPickupAt: STALE }),
    ]);
    const result = await dispatcher.dispatch('user-1', scope, payload, { timeoutMs: 300_000 });
    expect(result.reason).toBe('timeout');
  });
});

describe('AgentDispatcherImpl.hasExternalAgent', () => {
  const scope = { action: 'negotiation.respond', scopeType: 'network', scopeId: 'net-1' };

  const makeDispatcher = (agents: AgentWithRelations[]) =>
    new AgentDispatcherImpl(
      { findAuthorizedAgents: mock(async () => agents) },
      undefined,
    );

  it('is type-only: a stale external agent still counts (maxTurns rule, IND-410)', async () => {
    const dispatcher = makeDispatcher([makeAgent({ lastNegotiationPickupAt: STALE })]);
    expect(await dispatcher.hasExternalAgent('user-1', scope)).toBe(true);
  });

  it('ignores personal negotiator and system rows', async () => {
    const dispatcher = makeDispatcher([
      makeAgent({ type: 'personal', lastNegotiationPickupAt: FRESH }),
      makeAgent({ type: 'system', lastNegotiationPickupAt: FRESH }),
    ]);
    expect(await dispatcher.hasExternalAgent('user-1', scope)).toBe(false);
  });
});
