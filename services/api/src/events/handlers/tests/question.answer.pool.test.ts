/**
 * Interview-mode chaining on pool_discovery answers (IND-418).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import type { QuestionPoolDiscriminator } from '@indexnetwork/protocol';

import { chainPoolQuestionFactory } from '../question.answer.pool';
import type { AdapterPersistableQuestion, AdapterPersistedQuestion } from '../../../adapters/questioner.adapter';

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
        discriminator: discriminator('asked'),
        alternates,
      },
    },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: { title: 'T', prompt: 'P?', options: [{ label: 'a', description: 'd' }, { label: 'b', description: 'd' }], multiSelect: false },
    status: 'answered',
    answer: { selectedOptions: ['a'], answeredBy: 'user-1', answeredAt: 'now' },
    expiresAt: null,
    createdAt: 'now',
    conversationId: null,
  };
}

function makeHarness(row: AdapterPersistedQuestion | null, askedLabels: string[] = ['asked']) {
  const persisted: AdapterPersistableQuestion[][] = [];
  const chain = chainPoolQuestionFactory({
    adapter: {
      getById: async () => row,
      persist: async (batch: AdapterPersistableQuestion[]) => {
        persisted.push(batch);
        return batch.map((_, i) => `chained-${i}`);
      },
      listPoolQuestionLabels: async () => askedLabels,
    },
  });
  return { chain, persisted };
}

const input = { userId: 'user-1', questionId: 'q-answered', intentId: 'intent-1' };

describe('chainPoolQuestion', () => {
  beforeEach(() => {
    process.env.POOL_QUESTIONS_MODE = 'on';
  });
  afterEach(() => {
    delete process.env.POOL_QUESTIONS_MODE;
  });

  it('persists the next alternate as a new pool question', async () => {
    const { chain, persisted } = makeHarness(answeredQuestion([discriminator('next'), discriminator('later')]));
    await chain(input);
    expect(persisted).toHaveLength(1);
    const [q] = persisted[0];
    expect(q.detection.mode).toBe('pool_discovery');
    expect(q.detection.pool?.discriminator.label).toBe('next');
    expect(q.detection.pool?.alternates.map((a) => a.label)).toEqual(['later']);
    // Snapshot provenance carries over from the answered question's pass.
    expect(q.detection.pool?.runId).toBe('run-1');
  });

  it('is a no-op when POOL_QUESTIONS_MODE is off', async () => {
    delete process.env.POOL_QUESTIONS_MODE;
    const { chain, persisted } = makeHarness(answeredQuestion([discriminator('next')]));
    await chain(input);
    expect(persisted).toHaveLength(0);
  });

  it('is a no-op when there are no alternates', async () => {
    const { chain, persisted } = makeHarness(answeredQuestion([]));
    await chain(input);
    expect(persisted).toHaveLength(0);
  });

  it('drops alternates below the VoI bar', async () => {
    const { chain, persisted } = makeHarness(answeredQuestion([discriminator('weak', 0.05)]));
    await chain(input);
    expect(persisted).toHaveLength(0);
  });

  it('dedups alternates that were already asked (including the just-answered axis)', async () => {
    const { chain, persisted } = makeHarness(
      answeredQuestion([discriminator('asked'), discriminator('fresh')]),
      ['asked'],
    );
    await chain(input);
    expect(persisted).toHaveLength(1);
    expect(persisted[0][0].detection.pool?.discriminator.label).toBe('fresh');
  });

  it('is a no-op when the answered question has no pool snapshot', async () => {
    const row = answeredQuestion([discriminator('next')]);
    delete (row.detection as { pool?: unknown }).pool;
    const { chain, persisted } = makeHarness(row);
    await chain(input);
    expect(persisted).toHaveLength(0);
  });
});
