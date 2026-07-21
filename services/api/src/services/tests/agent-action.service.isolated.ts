/** Explicit isolated test: run with scripts/test-isolated.sh or bun test this file. */
import { describe, expect, it, mock } from 'bun:test';

import { AgentActionService } from '../agent-action.service';

const USER_ID = 'user-1';
const PREMISE_A = '22222222-2222-4222-8222-222222222222';
const PREMISE_B = '33333333-3333-4333-8333-333333333333';
const INTENT_ID = '44444444-4444-4444-8444-444444444444';
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z');

function premise(id: string, userId = USER_ID, status: 'ACTIVE' | 'RETRACTED' = 'ACTIVE') {
  return {
    id,
    userId,
    status,
    updatedAt: UPDATED_AT,
    assertion: { text: 'owner premise', tier: 'assertive' as const },
  };
}

function intent(status: 'ACTIVE' | 'PAUSED' = 'ACTIVE') {
  return {
    id: INTENT_ID,
    userId: USER_ID,
    payload: 'Find collaborators',
    summary: null,
    status,
    archivedAt: null,
    updatedAt: UPDATED_AT,
  };
}

describe('AgentActionService isolated confirmation', () => {
  it('retracts both owner premises and replays the stored result', async () => {
    const rows = new Map([[PREMISE_A, premise(PREMISE_A)], [PREMISE_B, premise(PREMISE_B)]]);
    const proposal = {
      proposalId: '11111111-1111-4111-8111-111111111111',
      userId: USER_ID,
      actions: [PREMISE_A, PREMISE_B].map((entityId) => ({
        type: 'retract_premise' as const,
        entityId,
        currentState: 'ACTIVE',
        proposedOperation: 'RETRACT_PREMISE',
        snapshot: { status: 'ACTIVE', updatedAt: UPDATED_AT.toISOString() },
      })),
    };
    let consumed: unknown[] = [];
    const claim = mock(async () => ({ kind: 'claimed' as const, proposal }));
    const proposals = {
      claimProposal: claim,
      consumeProposal: mock(async (_id: string, _user: string, result: unknown[]) => { consumed = result; }),
    };
    const users = {
      retractPremise: mock(async (id: string) => {
        const row = rows.get(id);
        if (!row || row.userId !== USER_ID) return 'not_found' as const;
        row.status = 'RETRACTED';
        return 'applied' as const;
      }),
      updateIntentDescription: mock(async () => 'applied' as const),
    };
    const service = new AgentActionService(
      proposals,
      { getIntent: mock(async () => intent()), retractPremise: users.retractPremise, updateIntentDescription: users.updateIntentDescription, transitionStatus: mock(async () => ({ kind: 'success' as const, status: 'PAUSED' as const, changed: true, lifecycleVersionMs: 1, id: INTENT_ID })) },
      { getPremise: mock(async (id: string) => rows.get(id) ?? null) },
    );

    const first = await service.confirm(USER_ID, proposal.proposalId);
    expect(first.kind).toBe('success');
    if (first.kind !== 'success') throw new Error('expected success');
    expect(first.result.results.map((result) => result.outcome)).toEqual(['applied', 'applied']);
    expect(consumed).toHaveLength(2);

    claim.mockImplementationOnce(async () => ({ kind: 'replay' as const, result: consumed as never[] }));
    const second = await service.confirm(USER_ID, proposal.proposalId);
    expect(second).toEqual({ kind: 'success', result: { proposalId: proposal.proposalId, status: 'replayed', results: consumed } });
  });

  it('skips a non-owner premise and reports alreadyDone after a concurrent retract', async () => {
    const rows = new Map([[PREMISE_A, premise(PREMISE_A, 'other-user')], [PREMISE_B, premise(PREMISE_B, USER_ID, 'RETRACTED')]]);
    const proposal = {
      proposalId: '55555555-5555-4555-8555-555555555555',
      userId: USER_ID,
      actions: [
        { type: 'retract_premise' as const, entityId: PREMISE_A, currentState: 'UNKNOWN', proposedOperation: 'RETRACT_PREMISE', skipped: true, reason: 'not owned' },
        { type: 'retract_premise' as const, entityId: PREMISE_B, currentState: 'ACTIVE', proposedOperation: 'RETRACT_PREMISE', snapshot: { status: 'ACTIVE', updatedAt: UPDATED_AT.toISOString() } },
      ],
    };
    const service = new AgentActionService(
      { claimProposal: mock(async () => ({ kind: 'claimed' as const, proposal })), consumeProposal: mock(async () => {}) },
      { getIntent: mock(async () => intent()), retractPremise: mock(async () => 'not_found' as const), updateIntentDescription: mock(async () => 'applied' as const), transitionStatus: mock(async () => ({ kind: 'success' as const, status: 'PAUSED' as const, changed: true, lifecycleVersionMs: 1, id: INTENT_ID })) },
      { getPremise: mock(async (id: string) => rows.get(id) ?? null) },
    );

    const result = await service.confirm(USER_ID, proposal.proposalId);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('expected success');
    expect(result.result.results.map((item) => item.outcome)).toEqual(['skipped', 'alreadyDone']);
  });

  it('uses existing pause and update paths for action types', async () => {
    const transitionStatus = mock(async () => ({ kind: 'success' as const, status: 'PAUSED' as const, changed: true, lifecycleVersionMs: 1, id: INTENT_ID }));
    const updateIntentDescription = mock(async () => 'applied' as const);
    const proposals = {
      claimProposal: mock(async () => ({ kind: 'claimed' as const, proposal: {
        proposalId: '66666666-6666-4666-8666-666666666666', userId: USER_ID,
        actions: [
          { type: 'pause_signal' as const, entityId: INTENT_ID, currentState: 'ACTIVE', proposedOperation: 'PAUSE_SIGNAL', evidence: 'zero live opportunities', snapshot: { status: 'ACTIVE', updatedAt: UPDATED_AT.toISOString() } },
          { type: 'narrow_signal' as const, entityId: INTENT_ID, currentState: 'ACTIVE', proposedOperation: 'NARROW_SIGNAL', description: 'Find local product collaborators', snapshot: { status: 'ACTIVE', updatedAt: UPDATED_AT.toISOString() } },
        ],
      } })),
      consumeProposal: mock(async () => {}),
    };
    const service = new AgentActionService(
      proposals,
      { getIntent: mock(async () => intent()), retractPremise: mock(async () => 'applied' as const), updateIntentDescription, transitionStatus },
      { getPremise: mock(async () => null) },
    );

    const result = await service.confirm(USER_ID, '66666666-6666-4666-8666-666666666666');
    expect(result.kind).toBe('success');
    expect(transitionStatus).toHaveBeenCalledWith(INTENT_ID, USER_ID, 'PAUSED', UPDATED_AT.getTime());
    expect(updateIntentDescription).toHaveBeenCalledWith(INTENT_ID, USER_ID, 'Find local product collaborators', expect.any(Date));
  });
});
