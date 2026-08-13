import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm/sql';

import { QuestionerAdapter, type AdapterPersistableQuestion } from '../questioner.adapter';
import { UserDatabaseAdapter } from '../database.adapter';
import db from '../../lib/drizzle/drizzle';
import { withMinimumDatabaseHookBudget } from '../../lib/testing/database-test-budget';
import { intents, questions } from '../../schemas/database.schema';

function poolQuestion(userId: string, intentId: string, label: string): AdapterPersistableQuestion {
  const opportunityIds = [crypto.randomUUID()];
  return {
    detection: {
      mode: 'pool_discovery',
      sourceType: 'intent',
      sourceId: intentId,
      triggeredBy: intentId,
      timestamp: new Date().toISOString(),
      pool: {
        poolSize: 8,
        opportunityIds,
        minedAt: new Date().toISOString(),
        discriminator: {
          label,
          questionSeed: `Which ${label}?`,
          sides: ['Builder', 'Advisor'],
          sideCounts: { Builder: 1, Advisor: 0 },
          voi: 0.8,
          evidenceRate: 1,
          assignments: opportunityIds.map((opportunityId) => ({ opportunityId, side: 'Builder' })),
        },
        alternates: [],
      },
    },
    actors: [{ userId, role: 'subject' }],
    payload: {
      title: label,
      prompt: `Which ${label}?`,
      options: [
        { label: 'Builder', description: 'Builder' },
        { label: 'Advisor', description: 'Advisor' },
      ],
      multiSelect: false,
    },
    strategy: 'refine_intent',
  };
}

const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe('QuestionerAdapter pool axis dedup across voided questions', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  const questionIds: string[] = [];
  const intentIds: string[] = [];
  let userId: string;

  /** Fresh intent per case so the one-live-pool-question gate never masks the axis gate. */
  async function createIntent(): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(intents).values({
      id,
      userId,
      payload: 'Find builders',
      summary: 'Prototype collaborators',
      status: 'ACTIVE',
    });
    intentIds.push(id);
    return id;
  }

  /** Freshness and the mode flag are injected as satisfied so only the dedup gate can refuse. */
  async function persistAxis(intentId: string, label: string): Promise<string | null> {
    const id = await adapter.persistFreshPoolQuestion(
      poolQuestion(userId, intentId, label),
      userId,
      () => true,
      3,
      () => true,
    );
    if (id) questionIds.push(id);
    return id;
  }

  /** Mirrors how the lifecycle path retires a question: dismissed plus a void reason. */
  async function voidQuestion(id: string, reason: string): Promise<void> {
    await db.update(questions).set({
      status: 'dismissed',
      detection: sql`jsonb_set(${questions.detection}::jsonb, '{voidedReason}', ${JSON.stringify(reason)}::jsonb, true)`,
    }).where(eq(questions.id, id));
  }

  beforeAll(async () => {
    userId = (await users.create({
      email: `questioner-pooldedup-${crypto.randomUUID()}@example.com`,
      name: 'Pool Dedup Owner',
    })).id;
  });

  afterAll(async () => {
    if (questionIds.length) await db.delete(questions).where(inArray(questions.id, questionIds)).catch(() => {});
    if (intentIds.length) await db.delete(intents).where(inArray(intents.id, intentIds)).catch(() => {});
    await users.deleteById(userId).catch(() => {});
  });

  test('refuses an axis already asked on a question the intent edit voided', async () => {
    const intentId = await createIntent();
    const first = await persistAxis(intentId, 'Role in development');
    expect(first).not.toBeNull();

    // Answering a refinement question rewrites the intent, which voids the
    // outstanding pool question. The axis was still asked.
    await voidQuestion(first!, 'intent_edit');

    expect(await persistAxis(intentId, 'Role in development')).toBeNull();
    const [{ value: total }] = await db.select({ value: sql<number>`count(*)::int` })
      .from(questions)
      .where(sql`${questions.detection}->>'triggeredBy' = ${intentId}`);
    expect(total).toBe(1);
  }, 30_000);

  test('matches the axis case-insensitively and ignores whitespace differences', async () => {
    const intentId = await createIntent();
    const first = await persistAxis(intentId, 'Role in development');
    expect(first).not.toBeNull();
    await voidQuestion(first!, 'intent_edit');

    expect(await persistAxis(intentId, '  ROLE   in  Development ')).toBeNull();
  }, 30_000);

  test('still allows the axis when the pool, not the question, went stale', async () => {
    const intentId = await createIntent();
    const first = await persistAxis(intentId, 'Role in development');
    expect(first).not.toBeNull();

    // pool_drift means the candidate set changed underneath a still-valid axis,
    // so the same discriminator stays worth asking against the new pool.
    await voidQuestion(first!, 'pool_drift');

    expect(await persistAxis(intentId, 'Role in development')).not.toBeNull();
  }, 30_000);

  test('still allows a different axis after an intent edit void', async () => {
    const intentId = await createIntent();
    const first = await persistAxis(intentId, 'Role in development');
    expect(first).not.toBeNull();
    await voidQuestion(first!, 'intent_edit');

    expect(await persistAxis(intentId, 'Industry focus')).not.toBeNull();
  }, 30_000);
});
