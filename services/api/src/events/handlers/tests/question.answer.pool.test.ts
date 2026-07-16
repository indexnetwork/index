/**
 * Complete pool_discovery answer reaction (IND-418/419).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

import type { QuestionPoolDiscriminator } from '@indexnetwork/protocol';

import { handlePoolAnswerFactory } from '../question.answer.pool';
import type { AdapterPersistableQuestion, AdapterPersistedQuestion, PoolQuestionFreshnessOptions } from '../../../adapters/questioner.adapter';
import type { PoolAnswerOutcome, PoolLifecycleAdmission } from '../../../queues/pool/answer.shared';

function discriminator(label: string, voi = 0.5): QuestionPoolDiscriminator {
  return {
    label,
    questionSeed: `Which matters more for ${label}`,
    sides: ['Side A', 'Side B'],
    sideCounts: { 'Side A': 5, 'Side B': 4 },
    voi,
    evidenceRate: 0.9,
    assignments: [{ opportunityId: 'opp-1', side: 'Side A' }],
  };
}

function answeredQuestion(alternates: QuestionPoolDiscriminator[]): AdapterPersistedQuestion {
  return {
    id: 'q-answered',
    detection: {
      mode: 'pool_discovery',
      sourceType: 'intent',
      sourceId: 'intent-1',
      triggeredBy: 'intent-1',
      timestamp: 'now',
      pool: {
        poolSize: 21,
        minedAt: '2026-07-14T14:00:00.000Z',
        runId: 'run-1',
        intentText: 'Find collaborators',
        intentFingerprint: 'initial-fingerprint',
        discriminator: discriminator('asked'),
        alternates,
      },
    },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: { title: 'T', prompt: 'P?', options: [{ label: 'Side A', description: 'd' }, { label: 'Side B', description: 'd' }], multiSelect: false },
    status: 'answered',
    answer: { selectedOptions: ['Side A'], answeredBy: 'user-1', answeredAt: 'now' },
    expiresAt: null,
    createdAt: 'now',
    conversationId: null,
  };
}

function makeHarness(
  row: AdapterPersistedQuestion | null,
  askedLabels: string[] = ['asked'],
  outcome: PoolAnswerOutcome = { kind: 'applied', promoted: 1, demoted: 2, unknownAdjusted: 0 },
  admission: PoolLifecycleAdmission | Error = 'active',
  refinementError?: Error,
  refinementApplied = true,
  fingerprintError?: Error,
) {
  const persisted: AdapterPersistableQuestion[][] = [];
  const callOrder: string[] = [];
  const freshnessCalls: Array<PoolQuestionFreshnessOptions | undefined> = [];
  const pushEnqueues: Array<{ questionId: string; userId: string }> = [];
  const applyAnswer = mock(async () => outcome);
  const narrateBeatOne = mock(async () => {});
  const refineIntent = mock(async () => {
    callOrder.push('refine');
    if (refinementError) throw refinementError;
    return refinementApplied
      ? {
          applied: true,
          payload: 'Find collaborators who build prototypes',
          summary: 'Hands-on collaborators',
        }
      : { applied: false };
  });
  const enqueueRerun = mock(async () => {
    callOrder.push('rerun');
  });
  const updateAnsweredPoolIntentFingerprint = mock(async () => {
    if (fingerprintError) throw fingerprintError;
    return true;
  });
  const handle = handlePoolAnswerFactory({
    adapter: {
      getById: async () => row,
      persist: async (batch: AdapterPersistableQuestion[]) => {
        persisted.push(batch);
        return batch.map((_, index) => `chained-${index}`);
      },
      listPoolQuestionLabels: async (_userId, _intentId, freshness) => {
        freshnessCalls.push(freshness);
        return askedLabels;
      },
      updateAnsweredPoolIntentFingerprint,
    },
    applyAnswer,
    narrateBeatOne,
    refineIntent,
    enqueueRerun,
    poolQuestionPostPersist: async (questionId, userId) => {
      pushEnqueues.push({ questionId, userId });
    },
    getIntentAdmission: async () => {
      if (admission instanceof Error) throw admission;
      return admission;
    },
  });
  return {
    handle,
    persisted,
    applyAnswer,
    narrateBeatOne,
    refineIntent,
    enqueueRerun,
    updateAnsweredPoolIntentFingerprint,
    callOrder,
    freshnessCalls,
    pushEnqueues,
  };
}

const input = {
  userId: 'user-1',
  questionId: 'q-answered',
  intentId: 'intent-1',
  selectedOptions: ['Side A'],
};

describe('handlePoolAnswer', () => {
  beforeEach(() => {
    process.env.POOL_QUESTIONS_MODE = 'on';
    process.env.POOL_QUESTIONS_RANKING = 'on';
  });
  afterEach(() => {
    delete process.env.POOL_QUESTIONS_MODE;
    delete process.env.POOL_QUESTIONS_RANKING;
  });

  it('applies, narrates, enqueues Tier 1, and persists the next alternate', async () => {
    const harness = makeHarness(answeredQuestion([discriminator('next'), discriminator('later')]));
    await harness.handle(input);

    expect(harness.applyAnswer).toHaveBeenCalledTimes(1);
    expect(harness.narrateBeatOne).toHaveBeenCalledTimes(1);
    expect((harness.narrateBeatOne.mock.calls[0]?.[0] as { message: string }).message)
      .toContain('1 match prioritized, 2 deprioritized');
    expect(harness.refineIntent).toHaveBeenCalledTimes(1);
    expect(harness.enqueueRerun).toHaveBeenCalledTimes(1);
    expect(harness.callOrder).toEqual(['refine', 'rerun']);
    expect(harness.updateAnsweredPoolIntentFingerprint).toHaveBeenCalledTimes(1);
    expect(harness.persisted).toHaveLength(1);
    const [question] = harness.persisted[0];
    expect(question.detection.mode).toBe('pool_discovery');
    expect(question.detection.pool?.discriminator.label).toBe('next');
    expect(question.detection.pool?.alternates.map((alternate) => alternate.label)).toEqual(['later']);
    expect(question.detection.pool?.runId).toBe('run-1');
    expect(question.detection.pool?.intentFingerprint).not.toBe('initial-fingerprint');
    expect(harness.freshnessCalls).toEqual([{
      currentIntentFingerprint: question.detection.pool?.intentFingerprint,
      currentIntentText: question.detection.pool?.intentText,
    }]);
    expect(harness.pushEnqueues).toEqual([{ questionId: 'chained-0', userId: 'user-1' }]);
  });

  it('uses nonempty free text to refine even with Both matter selected', async () => {
    const harness = makeHarness(answeredQuestion([]), ['asked'], { kind: 'none' });
    await harness.handle({
      ...input,
      selectedOptions: ['Both matter'],
      freeText: 'Only people available this month',
    });
    expect(harness.refineIntent).toHaveBeenCalledWith({
      ...input,
      selectedOptions: ['Both matter'],
      freeText: 'Only people available this month',
    });
    expect(harness.updateAnsweredPoolIntentFingerprint).toHaveBeenCalledTimes(1);
    expect(harness.enqueueRerun).toHaveBeenCalledTimes(1);
    expect(harness.callOrder).toEqual(['refine', 'rerun']);
  });

  it('isolates refinement failure and still runs Tier 1 and chaining', async () => {
    const harness = makeHarness(
      answeredQuestion([discriminator('next')]),
      ['asked'],
      { kind: 'applied', promoted: 1, demoted: 2, unknownAdjusted: 0 },
      'active',
      new Error('intent graph unavailable'),
    );
    await harness.handle(input);
    expect(harness.refineIntent).toHaveBeenCalledTimes(1);
    expect(harness.enqueueRerun).toHaveBeenCalledTimes(1);
    expect(harness.persisted).toHaveLength(1);
    expect(harness.updateAnsweredPoolIntentFingerprint).not.toHaveBeenCalled();
  });

  it('does not stamp when refinement is a no-op, but still runs Tier 1 and chaining', async () => {
    const harness = makeHarness(
      answeredQuestion([discriminator('next')]),
      ['asked'],
      { kind: 'applied', promoted: 1, demoted: 2, unknownAdjusted: 0 },
      'active',
      undefined,
      false,
    );
    await harness.handle(input);
    expect(harness.updateAnsweredPoolIntentFingerprint).not.toHaveBeenCalled();
    expect(harness.enqueueRerun).toHaveBeenCalledTimes(1);
    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0][0].detection.pool?.intentFingerprint).toBe('initial-fingerprint');
  });

  it('isolates fingerprint persistence failure after an applied refinement', async () => {
    const harness = makeHarness(
      answeredQuestion([discriminator('next')]),
      ['asked'],
      { kind: 'applied', promoted: 1, demoted: 2, unknownAdjusted: 0 },
      'active',
      undefined,
      true,
      new Error('question write unavailable'),
    );
    await harness.handle(input);
    expect(harness.updateAnsweredPoolIntentFingerprint).toHaveBeenCalledTimes(1);
    expect(harness.enqueueRerun).toHaveBeenCalledTimes(1);
    expect(harness.persisted).toHaveLength(1);
  });

  it('narrates but does not enqueue Tier 1 for Both matter', async () => {
    const harness = makeHarness(answeredQuestion([]), ['asked'], { kind: 'none' });
    await harness.handle({ ...input, selectedOptions: ['Both matter'] });
    expect(harness.narrateBeatOne).toHaveBeenCalledTimes(1);
    expect(harness.refineIntent).not.toHaveBeenCalled();
    expect(harness.enqueueRerun).not.toHaveBeenCalled();
  });

  it('enqueues Tier 1 for a stale snapshot without claiming a local delta', async () => {
    const harness = makeHarness(answeredQuestion([]), ['asked'], { kind: 'stale', staleRatio: 0.5 });
    await harness.handle(input);
    expect(harness.enqueueRerun).toHaveBeenCalledTimes(1);
    const narration = harness.narrateBeatOne.mock.calls[0]?.[0] as { message: string };
    expect(narration.message).toContain("didn't reshuffle");
  });

  it('keeps Tier 0 answerable while paused but skips Tier 1 and chaining', async () => {
    const harness = makeHarness(
      answeredQuestion([discriminator('next')]),
      ['asked'],
      { kind: 'applied', promoted: 1, demoted: 2, unknownAdjusted: 0 },
      'paused',
    );
    await harness.handle(input);

    expect(harness.applyAnswer).toHaveBeenCalledTimes(1);
    expect(harness.refineIntent).not.toHaveBeenCalled();
    expect(harness.enqueueRerun).not.toHaveBeenCalled();
    expect(harness.persisted).toHaveLength(0);
    const narration = harness.narrateBeatOne.mock.calls[0]?.[0] as { message: string };
    expect(narration.message).toContain('paused');
    expect(narration.message).not.toContain('re-searching');
    expect(narration.message).not.toContain('about to find');
  });

  it.each([
    ['missing intent', 'unavailable' as const],
    ['lookup error', new Error('database unavailable')],
  ])('uses neutral narration and fails closed for %s', async (_name, admission) => {
    const harness = makeHarness(
      answeredQuestion([discriminator('next')]),
      ['asked'],
      { kind: 'applied', promoted: 1, demoted: 2, unknownAdjusted: 0 },
      admission,
    );
    await harness.handle(input);

    expect(harness.refineIntent).not.toHaveBeenCalled();
    expect(harness.enqueueRerun).not.toHaveBeenCalled();
    expect(harness.persisted).toHaveLength(0);
    const narration = harness.narrateBeatOne.mock.calls[0]?.[0] as { message: string };
    expect(narration.message).toBe("Preference saved, but I couldn't start a fresh search right now.");
    expect(narration.message).not.toContain('paused');
  });

  it('is a no-op when POOL_QUESTIONS_MODE is off', async () => {
    delete process.env.POOL_QUESTIONS_MODE;
    const harness = makeHarness(answeredQuestion([discriminator('next')]));
    await harness.handle(input);
    expect(harness.applyAnswer).not.toHaveBeenCalled();
    expect(harness.refineIntent).not.toHaveBeenCalled();
    expect(harness.persisted).toHaveLength(0);
  });

  it('drops alternates below the VoI bar', async () => {
    const harness = makeHarness(answeredQuestion([discriminator('weak', 0.05)]));
    await harness.handle(input);
    expect(harness.persisted).toHaveLength(0);
  });

  it('dedups alternates that were already asked', async () => {
    const harness = makeHarness(
      answeredQuestion([discriminator('asked'), discriminator('fresh')]),
      ['asked'],
    );
    await harness.handle(input);
    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0][0].detection.pool?.discriminator.label).toBe('fresh');
  });

  it('is a no-op when the answered question has no pool snapshot', async () => {
    const row = answeredQuestion([discriminator('next')]);
    delete (row.detection as { pool?: unknown }).pool;
    const harness = makeHarness(row);
    await harness.handle(input);
    expect(harness.applyAnswer).not.toHaveBeenCalled();
    expect(harness.persisted).toHaveLength(0);
  });
});
