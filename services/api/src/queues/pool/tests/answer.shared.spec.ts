import { describe, expect, it, mock } from 'bun:test';

import type { QuestionPoolSnapshot } from '@indexnetwork/protocol';

import { applyPoolAnswer, beatOneMessage, beatTwoMessage, enqueuePoolRerun } from '../answer.shared';

function pool(assignments: Array<{ opportunityId: string; side: string }>): QuestionPoolSnapshot {
  return {
    poolSize: assignments.length,
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
    const writes: Array<{ id: string; factor: number; side: string; weight: number; detail: string }> = [];
    const outcome = await applyPoolAnswer({
      ...baseInput,
      pool: pool([
        { opportunityId: 'opp-a', side: 'Builders' },
        { opportunityId: 'opp-b', side: 'Advisors' },
      ]),
    }, {
      listLivePool: async () => [
        { id: 'opp-a', metadata: {} },
        { id: 'opp-b', metadata: {} },
        { id: 'opp-unknown', metadata: {} },
      ],
      applyAdjustments: async (batch) => {
        writes.push(...batch.map(({ opportunityId, adjustment, signal }) => ({
          id: opportunityId,
          factor: adjustment.factor,
          side: adjustment.side,
          weight: signal.weight,
          detail: signal.detail,
        })));
      },
    });

    expect(outcome).toEqual({ kind: 'applied', promoted: 1, demoted: 1, unknownAdjusted: 1 });
    expect(writes).toEqual([
      { id: 'opp-a', factor: 1, side: 'Builders', weight: 1, detail: 'Builders vs advisors: Builders' },
      { id: 'opp-b', factor: 0.6, side: 'Advisors', weight: -1, detail: 'Builders vs advisors: Builders' },
      { id: 'opp-unknown', factor: 0.9, side: 'unknown', weight: 0, detail: 'Builders vs advisors: unassigned' },
    ]);
  });

  it('skips every write when more than 30% of assignments left the live pool', async () => {
    const applyAdjustments = mock(async () => {});
    const outcome = await applyPoolAnswer({
      ...baseInput,
      pool: pool([
        { opportunityId: 'opp-a', side: 'Builders' },
        { opportunityId: 'opp-b', side: 'Builders' },
        { opportunityId: 'opp-c', side: 'Advisors' },
        { opportunityId: 'opp-d', side: 'Advisors' },
      ]),
    }, {
      listLivePool: async () => [
        { id: 'opp-a', metadata: {} },
        { id: 'opp-b', metadata: {} },
      ],
      applyAdjustments,
    });

    expect(outcome.kind).toBe('stale');
    expect(applyAdjustments).not.toHaveBeenCalled();
  });

  it('does not read or write the pool for Both matter', async () => {
    const listLivePool = mock(async () => [{ id: 'opp-a', metadata: {} }]);
    const applyAdjustments = mock(async () => {});
    const outcome = await applyPoolAnswer({
      ...baseInput,
      selectedOption: 'Both matter',
      pool: pool([{ opportunityId: 'opp-a', side: 'Builders' }]),
    }, { listLivePool, applyAdjustments });

    expect(outcome).toEqual({ kind: 'none' });
    expect(listLivePool).not.toHaveBeenCalled();
    expect(applyAdjustments).not.toHaveBeenCalled();
  });
});

describe('pool answer narration', () => {
  it('uses deterministic count-only Beat-1 templates', () => {
    expect(beatOneMessage({ kind: 'applied', promoted: 2, demoted: 1, unknownAdjusted: 3 }))
      .toContain('2 matches prioritized, 1 deprioritized');
    expect(beatOneMessage({ kind: 'applied', promoted: 2, demoted: 1, unknownAdjusted: 3 }, false))
      .toBe('Noted — I saved your preference. It will shape the fresh matches I am searching for now.');
    expect(beatOneMessage({ kind: 'stale', staleRatio: 0.5 })).toContain("didn't reshuffle");
    expect(beatOneMessage({ kind: 'none' })).toContain('keeping your matches ranked as they are');
  });

  it('uses deterministic Beat-2 candidate-count templates', () => {
    expect(beatTwoMessage(2)).toContain('found 2 new people');
    expect(beatTwoMessage(0)).toContain('no new people yet');
    expect(beatTwoMessage(null)).toContain('matches are refreshed');
  });
});

describe('enqueuePoolRerun', () => {
  it('uses one active job id for every answer in the debounce window', async () => {
    const uniqueJobs = new Set<string>();
    const addJob = mock(async (_data, options) => {
      if (options?.jobId) uniqueJobs.add(options.jobId);
      return {} as never;
    });

    await Promise.all([
      enqueuePoolRerun({ userId: 'user-1', intentId: 'intent-1' }, { addJob }),
      enqueuePoolRerun({ userId: 'user-1', intentId: 'intent-1' }, { addJob }),
      enqueuePoolRerun({ userId: 'user-1', intentId: 'intent-1' }, { addJob }),
    ]);

    expect(addJob).toHaveBeenCalledTimes(3);
    expect(uniqueJobs).toEqual(new Set(['pool-rerun-intent-1']));
    const options = addJob.mock.calls[0]?.[1];
    expect(options).toMatchObject({ delay: 60_000, removeOnComplete: true, removeOnFail: true });
  });
});
