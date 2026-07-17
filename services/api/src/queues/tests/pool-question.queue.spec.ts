/**
 * QuestionerQueue pool_discovery arm (IND-418): deterministic synthesis,
 * unattended budget, axis dedup — and proof the generator LLM is never
 * invoked for this mode.
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import type { QuestionPoolDiscriminator, QuestionerInput } from '@indexnetwork/protocol';

import { QuestionerQueue } from '../questioner.queue';
import type { AdapterPersistableQuestion, AdapterPersistedQuestion, PoolQuestionFreshnessOptions } from '../../adapters/questioner.adapter';

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

function pendingRow(mode: string): AdapterPersistedQuestion {
  return {
    id: `q-${mode}-${Math.random().toString(36).slice(2, 8)}`,
    detection: { mode: mode as AdapterPersistedQuestion['detection']['mode'], sourceType: 'intent', sourceId: 'intent-1', timestamp: 'now' },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: { title: 'T', prompt: 'P?', options: [{ label: 'a', description: 'd' }, { label: 'b', description: 'd' }], multiSelect: false },
    status: 'pending',
    answer: null,
    expiresAt: null,
    createdAt: 'now',
    conversationId: null,
  };
}

function poolInput(discriminators: QuestionPoolDiscriminator[]): QuestionerInput {
  return {
    mode: 'pool_discovery',
    userId: 'user-1',
    sourceType: 'intent',
    sourceId: 'intent-1',
    triggeredByIntentId: 'intent-1',
    context: {
      intentId: 'intent-1',
      intentText: 'find collaborators',
      intentFingerprint: 'fingerprint-v1',
      poolSize: 21,
      opportunityIds: ['opp-1'],
      runId: 'run-1',
      minedAt: '2026-07-14T14:00:00.000Z',
      discriminators,
    },
  } as QuestionerInput;
}

interface Harness {
  queue: QuestionerQueue;
  persisted: AdapterPersistableQuestion[][];
  agentInvocations: number;
  freshnessCalls: Array<PoolQuestionFreshnessOptions | undefined>;
  pushEnqueues: Array<{ questionId: string; userId: string }>;
  setPending(rows: AdapterPersistedQuestion[]): void;
  setAskedLabels(labels: string[]): void;
  setPushEnqueueFailure(error: Error | null): void;
  setFinalFresh(fresh: boolean): void;
  setRetryFresh(fresh: boolean): void;
}

function makeHarness(intentStatus: 'ACTIVE' | 'PAUSED' = 'ACTIVE'): Harness {
  const persisted: AdapterPersistableQuestion[][] = [];
  let pending: AdapterPersistedQuestion[] = [];
  let askedLabels: string[] = [];
  const state = {
    agentInvocations: 0,
    freshnessCalls: [] as Array<PoolQuestionFreshnessOptions | undefined>,
    pushEnqueues: [] as Array<{ questionId: string; userId: string }>,
    pushEnqueueFailure: null as Error | null,
    finalFresh: true,
    retryFresh: true,
  };
  const queue = new QuestionerQueue({
    adapter: {
      persist: async () => [],
      persistFreshPoolQuestion: async (question: AdapterPersistableQuestion) => {
        if (!state.finalFresh) return null;
        persisted.push([question]);
        return `id-${persisted.length}-0`;
      },
      isPoolQuestionFreshForDelivery: async () => state.retryFresh,
      findPending: async () => pending,
      listPoolQuestionLabels: async (_userId, _intentId, freshness) => {
        state.freshnessCalls.push(freshness);
        return askedLabels;
      },
    },
    agent: {
      invoke: async () => {
        state.agentInvocations++;
        return null;
      },
    },
    getIntentLifecycle: async (intentId) => ({ id: intentId, status: intentStatus, archivedAt: null }),
    poolQuestionPostPersist: async (questionId, userId) => {
      if (state.pushEnqueueFailure) throw state.pushEnqueueFailure;
      state.pushEnqueues.push({ questionId, userId });
    },
  });
  return {
    queue,
    persisted,
    get agentInvocations() {
      return state.agentInvocations;
    },
    get freshnessCalls() {
      return state.freshnessCalls;
    },
    get pushEnqueues() {
      return state.pushEnqueues;
    },
    setPending: (rows) => {
      pending = rows;
    },
    setAskedLabels: (labels) => {
      askedLabels = labels;
    },
    setPushEnqueueFailure: (error) => {
      state.pushEnqueueFailure = error;
    },
    setFinalFresh: (fresh) => {
      state.finalFresh = fresh;
    },
    setRetryFresh: (fresh) => {
      state.retryFresh = fresh;
    },
  };
}

describe('QuestionerQueue pool_discovery arm', () => {
  let h: Harness;

  beforeEach(() => {
    process.env.POOL_QUESTIONS_MODE = 'on';
    h = makeHarness();
  });

  it('persists the top discriminator without invoking the generator LLM', async () => {
    await h.queue.processJob('generate_questions', poolInput([discriminator('top'), discriminator('second')]));
    expect(h.agentInvocations).toBe(0);
    expect(h.persisted).toHaveLength(1);
    const [q] = h.persisted[0];
    expect(q.detection.mode).toBe('pool_discovery');
    expect(q.detection.triggeredBy).toBe('intent-1');
    expect(q.detection.pool?.discriminator.label).toBe('top');
    expect(q.detection.pool?.alternates.map((a) => a.label)).toEqual(['second']);
    expect(q.payload.options.map((o) => o.label)).toEqual(['Side A', 'Side B', 'Both matter']);
    // Evidence names the intent (context.intentText) so the card self-identifies on any surface.
    expect(q.payload.evidence).toBe('based on 21 people matching \u201cfind collaborators\u201d');
    expect(q.detection.pool?.intentText).toBe('find collaborators');
    expect(q.detection.pool?.intentFingerprint).toBe('fingerprint-v1');
    expect(h.freshnessCalls).toEqual([{
      currentIntentFingerprint: 'fingerprint-v1',
      currentIntentText: 'find collaborators',
    }]);
    expect(h.pushEnqueues).toEqual([{ questionId: 'id-1-0', userId: 'user-1' }]);
  });

  it('persists before enqueue failure and safely re-enqueues the same-cycle row on retry', async () => {
    h.setPushEnqueueFailure(new Error('redis unavailable'));
    await expect(h.queue.processJob('generate_questions', poolInput([discriminator('top')]))).rejects.toThrow('redis unavailable');
    expect(h.persisted).toHaveLength(1);
    expect(h.pushEnqueues).toEqual([]);

    const persisted = h.persisted[0][0];
    h.setPending([{
      id: 'id-1-0',
      detection: persisted.detection,
      actors: persisted.actors,
      payload: persisted.payload,
      status: 'pending',
      answer: null,
      expiresAt: null,
      createdAt: 'now',
      conversationId: null,
    }]);
    h.setPushEnqueueFailure(null);
    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(1);
    expect(h.pushEnqueues).toEqual([{ questionId: 'id-1-0', userId: 'user-1' }]);
  });

  it('fails closed for legacy pool jobs without an intent fingerprint', async () => {
    const input = poolInput([discriminator('legacy')]);
    delete (input.context as { intentFingerprint?: string }).intentFingerprint;
    h.setFinalFresh(false);
    await h.queue.processJob('generate_questions', input);

    expect(h.persisted).toHaveLength(0);
    expect(h.pushEnqueues).toEqual([]);
    expect(h.freshnessCalls).toEqual([{ currentIntentText: 'find collaborators' }]);
  });

  it('skips before persistence when the tied intent is paused', async () => {
    h = makeHarness('PAUSED');
    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.agentInvocations).toBe(0);
    expect(h.persisted).toHaveLength(0);
  });

  it('skips a different-cycle pending pool question without enqueueing it', async () => {
    h.setPending([pendingRow('pool_discovery')]);
    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(0);
    expect(h.pushEnqueues).toEqual([]);
  });

  it('re-enqueues the existing same-cycle pending question on Questioner retry', async () => {
    const existing = pendingRow('pool_discovery');
    existing.id = 'same-cycle-question';
    existing.detection.triggeredBy = 'intent-1';
    existing.detection.pool = {
      poolSize: 21,
      runId: 'run-1',
      minedAt: '2026-07-14T14:00:00.000Z',
      discriminator: discriminator('top'),
      alternates: [],
    };
    h.setPending([existing]);

    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(0);
    expect(h.pushEnqueues).toEqual([{ questionId: 'same-cycle-question', userId: 'user-1' }]);
  });

  it('does not revive stale same-cycle delivery on retry', async () => {
    const existing = pendingRow('pool_discovery');
    existing.id = 'stale-same-cycle-question';
    existing.detection.triggeredBy = 'intent-1';
    existing.detection.pool = {
      poolSize: 21,
      opportunityIds: ['opp-1'],
      intentFingerprint: 'fingerprint-v1',
      runId: 'run-1',
      minedAt: '2026-07-14T14:00:00.000Z',
      discriminator: discriminator('top'),
      alternates: [],
    };
    h.setPending([existing]);
    h.setRetryFresh(false);

    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(0);
    expect(h.pushEnqueues).toEqual([]);
  });

  it.each([
    ['below overlap'],
    ['changed fingerprint'],
    ['missing fingerprint'],
  ])('has no created or post-persist effect when the final gate rejects %s', async () => {
    h.setFinalFresh(false);
    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(0);
    expect(h.pushEnqueues).toEqual([]);
  });

  it('re-reads MODE and persists nothing when it is off', async () => {
    process.env.POOL_QUESTIONS_MODE = 'off';
    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(0);
    expect(h.pushEnqueues).toEqual([]);
  });

  it('skips when the intent already has 3 pending questions of any mode', async () => {
    h.setPending([pendingRow('intent'), pendingRow('discovery'), pendingRow('negotiation')]);
    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(0);
  });

  it('dedups already-asked axes (case/whitespace-insensitive) and asks the next one', async () => {
    h.setAskedLabels(['  TOP ']);
    await h.queue.processJob('generate_questions', poolInput([discriminator('top'), discriminator('second')]));
    expect(h.persisted).toHaveLength(1);
    expect(h.persisted[0][0].detection.pool?.discriminator.label).toBe('second');
    expect(h.persisted[0][0].detection.pool?.alternates).toEqual([]);
  });

  it('persists nothing when every discriminator was already asked', async () => {
    h.setAskedLabels(['top']);
    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(0);
  });
});
