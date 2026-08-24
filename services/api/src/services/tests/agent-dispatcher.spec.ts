import { describe, it, expect } from 'bun:test';
import { AgentDispatcherImpl } from '../agent-dispatcher.service';
import type { AgentWithRelations } from '../../adapters/agent.database.adapter';

/**
 * AgentDispatcherImpl only answers external-agent availability for the
 * opportunity graph's unlimited-maxTurns rule. Negotiation turns are
 * submitted through MCP and applied by NegotiationGraph.
 */

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

const STALE = new Date(Date.now() - 120_000); // 2m ago
const FRESH = new Date(Date.now() - 10_000); // 10s ago

describe('AgentDispatcherImpl.hasExternalAgent', () => {
  const scope = { action: 'negotiation.respond', scopeType: 'network', scopeId: 'net-1' };

  const makeDispatcher = (agents: AgentWithRelations[]) =>
    new AgentDispatcherImpl({ findAuthorizedAgents: async () => agents });

  it('is type-only: a stale external agent still counts (maxTurns rule, IND-410)', async () => {
    const dispatcher = makeDispatcher([makeAgent({ lastNegotiationPickupAt: STALE })]);
    expect(await dispatcher.hasExternalAgent('user-1', scope)).toBe(true);
  });

  it('a fresh external agent counts too', async () => {
    const dispatcher = makeDispatcher([makeAgent({ lastNegotiationPickupAt: FRESH })]);
    expect(await dispatcher.hasExternalAgent('user-1', scope)).toBe(true);
  });

  it('ignores personal negotiator and system rows', async () => {
    const dispatcher = makeDispatcher([
      makeAgent({ type: 'personal', lastNegotiationPickupAt: FRESH }),
      makeAgent({ type: 'system', lastNegotiationPickupAt: FRESH }),
    ]);
    expect(await dispatcher.hasExternalAgent('user-1', scope)).toBe(false);
  });

  it('ignores an external agent not selected to handle negotiations', async () => {
    const dispatcher = makeDispatcher([makeAgent({ handleNegotiations: false })]);
    expect(await dispatcher.hasExternalAgent('user-1', scope)).toBe(false);
  });

  it('returns false when no agents exist', async () => {
    const dispatcher = makeDispatcher([]);
    expect(await dispatcher.hasExternalAgent('user-1', scope)).toBe(false);
  });
});
