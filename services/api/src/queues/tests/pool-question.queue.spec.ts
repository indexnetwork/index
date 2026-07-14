/**
 * QuestionerQueue pool_discovery arm (IND-418): deterministic synthesis,
 * unattended budget, axis dedup — and proof the generator LLM is never
 * invoked for this mode.
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import type { QuestionPoolDiscriminator, QuestionerInput } from '@indexnetwork/protocol';

import { QuestionerQueue } from '../questioner.queue';
import type { AdapterPersistableQuestion, AdapterPersistedQuestion } from '../../adapters/questioner.adapter';

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
      poolSize: 21,
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
  setPending(rows: AdapterPersistedQuestion[]): void;
  setAskedLabels(labels: string[]): void;
}

function makeHarness(): Harness {
  const persisted: AdapterPersistableQuestion[][] = [];
  let pending: AdapterPersistedQuestion[] = [];
  let askedLabels: string[] = [];
  const state = { agentInvocations: 0 };
  const queue = new QuestionerQueue({
    adapter: {
      persist: async (batch: AdapterPersistableQuestion[]) => {
        persisted.push(batch);
        return batch.map((_, i) => `id-${persisted.length}-${i}`);
      },
      findPending: async () => pending,
      listPoolQuestionLabels: async () => askedLabels,
    },
    agent: {
      invoke: async () => {
        state.agentInvocations++;
        return null;
      },
    },
  });
  return {
    queue,
    persisted,
    get agentInvocations() {
      return state.agentInvocations;
    },
    setPending: (rows) => {
      pending = rows;
    },
    setAskedLabels: (labels) => {
      askedLabels = labels;
    },
  };
}

describe('QuestionerQueue pool_discovery arm', () => {
  let h: Harness;

  beforeEach(() => {
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
    expect(q.payload.evidence).toBe('based on 21 people matching this intent');
  });

  it('skips when a pool_discovery question is already pending for the intent', async () => {
    h.setPending([pendingRow('pool_discovery')]);
    await h.queue.processJob('generate_questions', poolInput([discriminator('top')]));
    expect(h.persisted).toHaveLength(0);
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
