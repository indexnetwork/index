/** Explicit isolated adapter test: the database boundary is mocked here. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const pendingId = '11111111-1111-4111-8111-111111111111';
const consumedId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
let selectedRows: unknown[] = [];
let transactionRows: unknown[] = [];
let updateRows: unknown[] = [];
const limit = mock(async () => selectedRows);
const where = mock(() => ({ limit }));
const from = mock(() => ({ where }));
const select = mock(() => ({ from }));
const forUpdate = mock(async () => transactionRows);
const transactionLimit = mock(() => ({ for: forUpdate }));
const transactionWhere = mock(() => ({ limit: transactionLimit }));
const transactionFrom = mock(() => ({ where: transactionWhere }));
const transactionSelect = mock(() => ({ from: transactionFrom }));
const returning = mock(async () => updateRows);
const transactionUpdateWhere = mock(() => ({ returning }));
const transactionSet = mock(() => ({ where: transactionUpdateWhere }));
const transactionUpdate = mock(() => ({ set: transactionSet }));
const consumeWhere = mock(async () => []);
const consumeSet = mock(() => ({ where: consumeWhere }));
const update = mock(() => ({ set: consumeSet }));
const transaction = mock(async (callback: (tx: unknown) => Promise<unknown>) => callback({
  select: transactionSelect,
  update: transactionUpdate,
}));

mock.module('../../lib/drizzle/drizzle', () => ({
  default: { select, update, transaction },
}));

const {
  AGENT_ACTION_EXECUTION_LEASE_MS,
  AgentActionProposalDatabaseAdapter,
} = await import('../agent-action-proposal.database.adapter');

const pendingRow = {
  id: pendingId,
  userId: 'owner-user',
  conversationId,
  actions: [{
    type: 'narrow_signal' as const,
    entityId: 'intent-1',
    currentState: 'ACTIVE',
    proposedOperation: 'NARROW_SIGNAL',
    description: 'Canonical replacement',
    snapshot: { status: 'ACTIVE', updatedAt: new Date().toISOString(), payload: 'private payload' },
    internalSecret: 'private action metadata',
  }],
  status: 'pending' as const,
  result: null,
  executionLeaseAt: null,
  createdAt: new Date(),
  consumedAt: null,
};

const consumedRow = {
  ...pendingRow,
  id: consumedId,
  status: 'consumed' as const,
  result: [{
    type: 'pause_signal' as const,
    entityId: 'intent-2',
    operation: 'PAUSE_SIGNAL',
    previousState: 'ACTIVE',
    resultingState: 'PAUSED',
    outcome: 'applied' as const,
    internalSecret: 'private result metadata',
  }],
};

beforeEach(() => {
  selectedRows = [];
  transactionRows = [];
  updateRows = [];
});

describe('AgentActionProposalDatabaseAdapter.getProposal', () => {
  it('returns canonical display fields without snapshots', async () => {
    selectedRows = [pendingRow];
    const adapter = new AgentActionProposalDatabaseAdapter();
    const proposal = await adapter.getProposal(pendingId, 'owner-user', conversationId);

    expect(proposal).toEqual({
      id: pendingId,
      status: 'pending',
      result: null,
      actions: [{
        type: 'narrow_signal',
        entityId: 'intent-1',
        currentState: 'ACTIVE',
        proposedOperation: 'NARROW_SIGNAL',
        description: 'Canonical replacement',
      }],
    });
    expect(JSON.stringify(proposal)).not.toContain('private payload');
    expect(JSON.stringify(proposal)).not.toContain('private action metadata');
    expect(where).toHaveBeenCalled();
  });

  it('returns no row for an owner-or-conversation-scoped miss and preserves consumed results', async () => {
    const adapter = new AgentActionProposalDatabaseAdapter();
    selectedRows = [];
    await expect(adapter.getProposal(pendingId, 'other-user', conversationId)).resolves.toBeNull();
    await expect(adapter.getProposal(pendingId, 'owner-user', '44444444-4444-4444-8444-444444444444')).resolves.toBeNull();

    selectedRows = [consumedRow];
    const consumed = await adapter.getProposal(consumedId, 'owner-user', conversationId);
    expect(consumed).toMatchObject({
      id: consumedId,
      status: 'consumed',
      result: [{ outcome: 'applied' }],
    });
    expect(JSON.stringify(consumed)).not.toContain('private result metadata');
  });
});

describe('AgentActionProposalDatabaseAdapter execution lease', () => {
  const now = new Date('2026-07-18T12:00:00.000Z');

  it('rejects a fresh executing lease without updating the proposal', async () => {
    transactionRows = [{
      ...pendingRow,
      status: 'executing',
      executionLeaseAt: new Date(now.getTime() - 60_000),
    }];
    const adapter = new AgentActionProposalDatabaseAdapter(() => now);

    await expect(adapter.claimProposal(pendingId, 'owner-user', conversationId))
      .resolves.toEqual({ kind: 'in_progress' });
    expect(transactionUpdate).not.toHaveBeenCalled();
  });

  it('reclaims a stale executing lease under the row lock', async () => {
    const stale = {
      ...pendingRow,
      status: 'executing' as const,
      executionLeaseAt: new Date(now.getTime() - AGENT_ACTION_EXECUTION_LEASE_MS - 1),
    };
    transactionRows = [stale];
    updateRows = [{ ...stale, executionLeaseAt: now }];
    const adapter = new AgentActionProposalDatabaseAdapter(() => now);

    const claim = await adapter.claimProposal(pendingId, 'owner-user', conversationId);

    expect(claim).toMatchObject({ kind: 'claimed', proposal: { executionLeaseAt: now } });
    expect(transactionSet).toHaveBeenCalledWith({ status: 'executing', executionLeaseAt: now });
    expect(forUpdate).toHaveBeenCalledWith('update');
  });

  it('returns missing for another conversation and clears the lease on consume', async () => {
    const adapter = new AgentActionProposalDatabaseAdapter(() => now);
    await expect(adapter.claimProposal(
      pendingId,
      'owner-user',
      '44444444-4444-4444-8444-444444444444',
    )).resolves.toEqual({ kind: 'missing' });

    await adapter.consumeProposal(pendingId, 'owner-user', conversationId, []);
    expect(consumeSet).toHaveBeenCalledWith({
      status: 'consumed',
      result: [],
      executionLeaseAt: null,
      consumedAt: now,
    });
  });
});
