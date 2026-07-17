import { describe, expect, it, mock } from 'bun:test';

import type { QuestionPoolSnapshot } from '@indexnetwork/protocol';

import { applyPoolAnswer, beatOneMessage, beatTwoMessage, enqueuePoolRerun } from '../answer.shared';
import type { PoolAdjustmentWrite } from '../answer.shared';

function pool(assignments: Array<{ opportunityId: string; side: string }>): QuestionPoolSnapshot {
  return {
    poolSize: assignments.length,
    opportunityIds: assignments.map((assignment) => assignment.opportunityId),
    intentFingerprint: 'fingerprint-v1',
    minedAt: '2026-07-15T12:00:00.000Z',
    discriminator: {
      label: 'Builders vs advisors',
      questionSeed: 'Which matters more?',
      sides: ['Builders', 'Advisors'],
      sideCounts: { Builders: 2, Advisors: 2 },
      voi: 0.7,
      evidenceRate: 1,
      assignments,
    },
    alternates: [],
  };
}

const baseInput = {
  userId: 'user-1',
  intentId: 'intent-1',
  questionId: 'question-1',
  selectedOption: 'Builders',
};

describe('applyPoolAnswer', () => {
  it('applies chosen, other, and live-unassigned factors with safe signals', async () => {
    const writes: Array<{ id: string; factor: number; side: string; weight: number; detail: string; recipientUserId: string; intentId: string; intentFingerprint?: string }> = [];
    const applyAdjustments = mock(async (recipientUserId: string, intentId: string, expectedFingerprint: string, batch: PoolAdjustmentWrite[]) => {
      expect(recipientUserId).toBe(baseInput.userId);
      expect(intentId).toBe(baseInput.intentId);
      expect(expectedFingerprint).toBe('fingerprint-v1');
      writes.push(...batch.map(({ opportunityId, adjustment, signal }) => {
        expect(signal.recipientUserId).toBe(adjustment.recipientUserId);
        expect(signal.intentId).toBe(adjustment.intentId);
        return {
          id: opportunityId,
          factor: adjustment.factor,
          side: adjustment.side,
          weight: signal.weight,
          detail: signal.detail,
          recipientUserId: adjustment.recipientUserId,
          intentId: adjustment.intentId,
          intentFingerprint: adjustment.intentFingerprint,
        };
      }));
      return batch.map((write) => write.opportunityId);
    });
    const outcome = await applyPoolAnswer({
      ...baseInput,
      pool: pool([
        { opportunityId: 'opp-a', side: 'Builders' },
        { opportunityId: 'opp-b', side: 'Advisors' },
      ]),
    }, {
      getIntentFingerprint: async () => 'fingerprint-v1',
      listLivePool: async () => [
        { id: 'opp-a', metadata: {} },
        { id: 'opp-b', metadata: {} },
        { id: 'opp-unknown', metadata: {} },
      ],
      applyAdjustments,
    });

    expect(outcome).toEqual({ kind: 'applied', promoted: 1, demoted: 1, unknownAdjusted: 1 });
    expect(applyAdjustments).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([
      { id: 'opp-a', factor: 1, side: 'Builders', weight: 1, detail: 'Builders vs advisors: Builders', recipientUserId: 'user-1', intentId: 'intent-1', intentFingerprint: 'fingerprint-v1' },
      { id: 'opp-b', factor: 0.6, side: 'Advisors', weight: -1, detail: 'Builders vs advisors: Builders', recipientUserId: 'user-1', intentId: 'intent-1', intentFingerprint: 'fingerprint-v1' },
      { id: 'opp-unknown', factor: 0.9, side: 'unknown', weight: 0, detail: 'Builders vs advisors: unassigned', recipientUserId: 'user-1', intentId: 'intent-1', intentFingerprint: 'fingerprint-v1' },
    ]);
  });

  it('skips every write when more than 30% of assignments left the live pool', async () => {
    const applyAdjustments = mock(async () => [] as string[]);
    const outcome = await applyPoolAnswer({
      ...baseInput,
      pool: pool([
        { opportunityId: 'opp-a', side: 'Builders' },
        { opportunityId: 'opp-b', side: 'Builders' },
        { opportunityId: 'opp-c', side: 'Advisors' },
        { opportunityId: 'opp-d', side: 'Advisors' },
      ]),
    }, {
      getIntentFingerprint: async () => 'fingerprint-v1',
      listLivePool: async () => [
        { id: 'opp-a', metadata: {} },
        { id: 'opp-b', metadata: {} },
      ],
      applyAdjustments,
    });

    expect(outcome.kind).toBe('stale');
    expect(applyAdjustments).not.toHaveBeenCalled();
  });

  it.each([
    [7, 'applied'],
    [6, 'stale'],
  ] as const)('accepts 70%% retained assignments and rejects below it (%s/10)', async (retained, expectedKind) => {
    const assignments = Array.from({ length: 10 }, (_, index) => ({
      opportunityId: `opp-${index}`,
      side: index % 2 === 0 ? 'Builders' : 'Advisors',
    }));
    const applyAdjustments = mock(async (_userId, _intentId, _fingerprint, writes: PoolAdjustmentWrite[]) =>
      writes.map((write) => write.opportunityId));
    const outcome = await applyPoolAnswer({
      ...baseInput,
      pool: pool(assignments),
    }, {
      getIntentFingerprint: async () => 'fingerprint-v1',
      listLivePool: async () => assignments.slice(0, retained).map(({ opportunityId }) => ({ id: opportunityId })),
      applyAdjustments,
    });
    expect(outcome.kind).toBe(expectedKind);
    expect(applyAdjustments).toHaveBeenCalledTimes(expectedKind === 'applied' ? 1 : 0);
  });

  it('rejects an old material intent fingerprint before reading or writing the pool', async () => {
    const listLivePool = mock(async () => [{ id: 'opp-a' }]);
    const applyAdjustments = mock(async () => [] as string[]);
    const outcome = await applyPoolAnswer({
      ...baseInput,
      pool: pool([{ opportunityId: 'opp-a', side: 'Builders' }]),
    }, {
      getIntentFingerprint: async () => 'fingerprint-v2',
      listLivePool,
      applyAdjustments,
    });
    expect(outcome).toEqual({ kind: 'stale', staleRatio: 1, reason: 'intent' });
    expect(listLivePool).not.toHaveBeenCalled();
    expect(applyAdjustments).not.toHaveBeenCalled();
  });

  it('does not read or write the live pool for Both matter', async () => {
    const listLivePool = mock(async () => [{ id: 'opp-a', metadata: {} }]);
    const applyAdjustments = mock(async () => [] as string[]);
    const outcome = await applyPoolAnswer({
      ...baseInput,
      selectedOption: 'Both matter',
      pool: pool([{ opportunityId: 'opp-a', side: 'Builders' }]),
    }, { getIntentFingerprint: async () => 'fingerprint-v1', listLivePool, applyAdjustments });

    expect(outcome).toEqual({ kind: 'none' });
    expect(listLivePool).not.toHaveBeenCalled();
    expect(applyAdjustments).not.toHaveBeenCalled();
  });

  it('counts only rows the transaction still found eligible after locking', async () => {
    const outcome = await applyPoolAnswer({
      ...baseInput,
      pool: pool([
        { opportunityId: 'opp-a', side: 'Builders' },
        { opportunityId: 'opp-b', side: 'Advisors' },
      ]),
    }, {
      getIntentFingerprint: async () => 'fingerprint-v1',
      listLivePool: async () => [
        { id: 'opp-a' },
        { id: 'opp-b' },
        { id: 'opp-unknown' },
      ],
      applyAdjustments: async () => ['opp-b', 'opp-unknown'],
    });

    expect(outcome).toEqual({ kind: 'applied', promoted: 0, demoted: 1, unknownAdjusted: 1 });
  });
});

describe('pool answer narration', () => {
  it('uses deterministic count-only Beat-1 templates', () => {
    expect(beatOneMessage({ kind: 'applied', promoted: 2, demoted: 1, unknownAdjusted: 3 }))
      .toContain('2 matches prioritized, 1 deprioritized');
    expect(beatOneMessage({ kind: 'applied', promoted: 2, demoted: 1, unknownAdjusted: 3 }, false))
      .toBe('Noted — I saved your preference. It will shape the fresh matches I am searching for now.');
    expect(beatOneMessage({ kind: 'stale', staleRatio: 0.5 })).toContain("didn't reshuffle");
    expect(beatOneMessage({ kind: 'applied', promoted: 1, demoted: 0, unknownAdjusted: 0 }, true, 'paused'))
      .toContain('paused');
    expect(beatOneMessage({ kind: 'applied', promoted: 1, demoted: 0, unknownAdjusted: 0 }, true, 'unavailable'))
      .toBe("Preference saved, but I couldn't start a fresh search right now.");
    expect(beatOneMessage({ kind: 'none' })).toContain('keeping your matches ranked as they are');
  });

  it('uses deterministic Beat-2 candidate-count templates', () => {
    expect(beatTwoMessage(2)).toContain('found 2 new people');
    expect(beatTwoMessage(0)).toContain('no new people yet');
    expect(beatTwoMessage(null)).toContain('matches are refreshed');
  });
});

describe('enqueuePoolRerun', () => {
  it('uses one sliding deduplication key and retains a trailing active-job answer', async () => {
    const deduplicationIds = new Set<string>();
    const addJob = mock(async (_data, options) => {
      if (options?.deduplication?.id) deduplicationIds.add(options.deduplication.id);
      return {} as never;
    });

    await Promise.all([
      enqueuePoolRerun({ userId: 'user-1', intentId: 'intent-1' }, { addJob }),
      enqueuePoolRerun({ userId: 'user-1', intentId: 'intent-1' }, { addJob }),
      enqueuePoolRerun({ userId: 'user-1', intentId: 'intent-1' }, { addJob }),
    ]);

    expect(addJob).toHaveBeenCalledTimes(3);
    expect(deduplicationIds).toEqual(new Set(['pool-rerun-intent-1']));
    const options = addJob.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      delay: 60_000,
      removeOnComplete: true,
      removeOnFail: true,
      deduplication: {
        id: 'pool-rerun-intent-1',
        ttl: 60_000,
        extend: true,
        replace: true,
        keepLastIfActive: true,
      },
    });
  });
});
