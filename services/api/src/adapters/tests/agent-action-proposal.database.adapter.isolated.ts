/** Explicit isolated adapter test: the database boundary is mocked here. */
import { describe, expect, it, mock } from 'bun:test';

const pendingId = '11111111-1111-4111-8111-111111111111';
const consumedId = '22222222-2222-4222-8222-222222222222';
let selectedRows: unknown[] = [];
const limit = mock(async () => selectedRows);
const where = mock(() => ({ limit }));
const from = mock(() => ({ where }));
const select = mock(() => ({ from }));

mock.module('../../lib/drizzle/drizzle', () => ({
  default: { select },
}));

const { AgentActionProposalDatabaseAdapter } = await import('../agent-action-proposal.database.adapter');

const pendingRow = {
  id: pendingId,
  userId: 'owner-user',
  conversationId: null,
  actions: [{
    type: 'narrow_signal' as const,
    entityId: 'intent-1',
    currentState: 'ACTIVE',
    proposedOperation: 'NARROW_SIGNAL',
    description: 'Canonical replacement',
    snapshot: { status: 'ACTIVE', updatedAt: new Date().toISOString(), payload: 'private payload' },
  }],
  status: 'pending' as const,
  result: null,
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
  }],
};

describe('AgentActionProposalDatabaseAdapter.getProposal', () => {
  it('returns canonical display fields without snapshots', async () => {
    selectedRows = [pendingRow];
    const adapter = new AgentActionProposalDatabaseAdapter();
    const proposal = await adapter.getProposal(pendingId, 'owner-user');

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
    expect(where).toHaveBeenCalled();
  });

  it('returns no row for an owner-scoped miss and preserves consumed results', async () => {
    const adapter = new AgentActionProposalDatabaseAdapter();
    selectedRows = [];
    await expect(adapter.getProposal(pendingId, 'other-user')).resolves.toBeNull();

    selectedRows = [consumedRow];
    await expect(adapter.getProposal(consumedId, 'owner-user')).resolves.toMatchObject({
      id: consumedId,
      status: 'consumed',
      result: [{ outcome: 'applied' }],
    });
  });
});
