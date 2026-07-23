/**
 * IND-439 visibility-audit slice — visit-trigger wiring in GET /questions.
 *
 * Verifies the intent-scoped pending-questions fetch is the ONLY path that
 * reaches the visit-mining gate, and that the gate receives the correct
 * live-pool-question signal. Flag gating itself (default-off = strict no-op,
 * mode-off = no-op, debounce id/ttl) is covered by
 * queues/pool/tests/visitmining.queue.spec.ts; together they prove flag-off
 * leaves the endpoint's behavior byte-identical (the gate returns before
 * touching any queue, and the response below is built the same either way).
 *
 * The visit-mining module is mocked so no BullMQ/Redis connection is opened.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, beforeEach, describe, expect, test, mock } from 'bun:test';
import { inArray } from 'drizzle-orm/sql';

const enqueueCalls: Array<{ userId: string; intentId: string; hasLivePoolQuestion: boolean }> = [];

mock.module('../../queues/pool/visitmining.queue', () => ({
  maybeEnqueueVisitPoolMining: (input: { userId: string; intentId: string; hasLivePoolQuestion: boolean }) => {
    enqueueCalls.push(input);
  },
  poolVisitMiningQueue: { addVisitJob: async () => ({ id: 'unused' }) },
}));

afterAll(() => {
  mock.restore();
});

import { QuestionController } from '../question.controller';
import { QuestionerAdapter, type AdapterPersistableQuestion } from '../../adapters/questioner.adapter';
import { UserDatabaseAdapter } from '../../adapters/database.adapter';
import db from '../../lib/drizzle/drizzle';
import { questions } from '../../schemas/database.schema';
import type { AuthenticatedUser } from '../../guards/auth.guard';

describe('GET /questions visit-mining wiring (IND-439)', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  const controller = new QuestionController();
  let userId: string;
  let intentId: string;
  const createdQuestionIds: string[] = [];

  const mockUser = (): AuthenticatedUser => ({
    id: userId,
    email: 'visit-mining-spec@example.com',
    name: 'Visit Mining Spec User',
  });

  const listRequest = (query: string) =>
    new Request(`http://localhost/questions${query}`, { method: 'GET' });

  async function persistPoolQuestion(): Promise<string> {
    const batch: AdapterPersistableQuestion[] = [{
      detection: {
        mode: 'pool_discovery',
        sourceType: 'intent',
        sourceId: intentId,
        triggeredBy: intentId,
        timestamp: new Date().toISOString(),
      },
      actors: [{ userId, role: 'subject' }],
      payload: {
        title: 'Pool probe',
        prompt: 'Builder or advisor?',
        options: [
          { label: 'Builder', description: 'Builder' },
          { label: 'Advisor', description: 'Advisor' },
        ],
        multiSelect: false,
      },
      strategy: 'refine_intent',
    }];
    const [id] = await adapter.persist(batch);
    createdQuestionIds.push(id);
    return id;
  }

  beforeAll(async () => {
    userId = (await users.create({
      email: `visit-mining-${crypto.randomUUID()}@example.com`,
      name: 'Visit Mining Spec User',
    })).id;
    intentId = crypto.randomUUID();
  });

  beforeEach(() => {
    enqueueCalls.length = 0;
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
  });

  test('intent-scoped fetch reaches the gate with hasLivePoolQuestion=false when the funnel is empty', async () => {
    const res = await controller.list(
      listRequest(`?scopeType=intent&scopeId=${intentId}`),
      mockUser(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { questions: unknown[] };
    expect(body.questions).toEqual([]);
    expect(enqueueCalls).toEqual([
      { userId, intentId, hasLivePoolQuestion: false },
    ]);
  });

  test('intent-scoped fetch reports a live pending pool_discovery question', async () => {
    await persistPoolQuestion();
    const res = await controller.list(
      listRequest(`?scopeType=intent&scopeId=${intentId}`),
      mockUser(),
    );
    expect(res.status).toBe(200);
    expect(enqueueCalls).toEqual([
      { userId, intentId, hasLivePoolQuestion: true },
    ]);
  });

  test('passive exact-intent refetch never reaches the visit-mining gate', async () => {
    const res = await controller.list(
      listRequest(`?scopeType=intent&scopeId=${intentId}&passive=true`),
      mockUser(),
    );
    expect(res.status).toBe(200);
    expect(enqueueCalls).toEqual([]);
  });

  test('unscoped fetch never reaches the gate', async () => {
    const res = await controller.list(listRequest(''), mockUser());
    expect(res.status).toBe(200);
    expect(enqueueCalls).toEqual([]);
  });

  test('invalid scope input never reaches the gate', async () => {
    const res = await controller.list(
      listRequest('?scopeType=intent&scopeId=not-a-uuid'),
      mockUser(),
    );
    expect(res.status).toBe(400);
    expect(enqueueCalls).toEqual([]);
  });
});
