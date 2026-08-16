import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm/sql';

import { QuestionerAdapter, type AdapterPersistableQuestion } from '../questioner.adapter';
import { UserDatabaseAdapter } from '../database.adapter';
import db from '../../lib/drizzle/drizzle';
import { withMinimumDatabaseHookBudget } from '../../lib/testing/database-test-budget';
import { intents, questions } from '../../schemas/database.schema';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { INTENT_QUESTION_DAILY_CAP_DEFAULT } from '@indexnetwork/protocol';

const SUMMARY = 'Prototype collaborators';

function recoveryQuestion(userId: string, intentId: string, fingerprint: string): AdapterPersistableQuestion {
  return {
    detection: {
      mode: 'intent',
      purpose: 'recovery',
      sourceType: 'intent',
      sourceId: intentId,
      triggeredBy: intentId,
      timestamp: new Date().toISOString(),
      recovery: { version: 1, intentFingerprint: fingerprint, completionSource: 'from_intent' },
    },
    actors: [{ userId, role: 'subject' }],
    payload: {
      title: 'Focus',
      prompt: 'Which aspect matters most?',
      options: [
        { label: 'Depth', description: 'Depth' },
        { label: 'Breadth', description: 'Breadth' },
      ],
      multiSelect: false,
    },
    strategy: 'refine_intent',
  };
}

const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe('QuestionerAdapter rolling daily cap per intent', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  const questionIds: string[] = [];
  const intentIds: string[] = [];
  let userId: string;

  async function createIntent(payload: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(intents).values({ id, userId, payload, summary: SUMMARY, status: 'ACTIVE' });
    intentIds.push(id);
    return id;
  }

  /**
   * Mirrors the production loop: answering rewrites the intent, which yields a
   * new fingerprint and re-arms recovery. Returns the new question id or null.
   */
  async function refineAndAsk(intentId: string, nextPayload: string): Promise<string | null> {
    await db.update(intents).set({ payload: nextPayload }).where(eq(intents.id, intentId));
    const fingerprint = computeIntentFingerprint(nextPayload, SUMMARY);
    const id = await adapter.persistFreshRecoveryQuestion(
      recoveryQuestion(userId, intentId, fingerprint),
      userId,
      fingerprint,
      INTENT_QUESTION_DAILY_CAP_DEFAULT,
    );
    if (id) questionIds.push(id);
    return id;
  }

  async function backdate(ids: readonly string[], hours: number): Promise<void> {
    await db.update(questions)
      .set({ createdAt: sql`NOW() - ${sql.raw(`INTERVAL '${hours} hours'`)}` })
      .where(inArray(questions.id, [...ids]));
  }

  beforeAll(async () => {
    userId = (await users.create({
      email: `questioner-dailycap-${crypto.randomUUID()}@example.com`,
      name: 'Daily Cap Owner',
    })).id;
  });

  afterAll(async () => {
    if (questionIds.length) await db.delete(questions).where(inArray(questions.id, questionIds)).catch(() => {});
    if (intentIds.length) await db.delete(intents).where(inArray(intents.id, intentIds)).catch(() => {});
    await users.deleteById(userId).catch(() => {});
  });

  test('allows two refinement rounds and refuses the third', async () => {
    const intentId = await createIntent('Find builders');

    expect(await refineAndAsk(intentId, 'Find builders in fintech')).not.toBeNull();
    expect(await refineAndAsk(intentId, 'Find builders in fintech, hands-on')).not.toBeNull();
    expect(await refineAndAsk(intentId, 'Find builders in fintech, hands-on, senior')).toBeNull();
  }, 30_000);

  test('counts answered, dismissed and intent-edit-voided rounds against the budget', async () => {
    const intentId = await createIntent('Find advisors');
    const first = await refineAndAsk(intentId, 'Find advisors in climate');
    const second = await refineAndAsk(intentId, 'Find advisors in climate, policy');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    // A question that was shown and then resolved or voided was still asked.
    await db.update(questions).set({ status: 'answered' }).where(eq(questions.id, first!));
    await db.update(questions).set({
      status: 'dismissed',
      detection: sql`jsonb_set(${questions.detection}::jsonb, '{voidedReason}', '"intent_edit"'::jsonb, true)`,
    }).where(eq(questions.id, second!));

    expect(await refineAndAsk(intentId, 'Find advisors in climate, policy, EU')).toBeNull();
  }, 30_000);

  test('rolls forward once the earlier rounds age out of the window', async () => {
    const intentId = await createIntent('Find designers');
    const first = await refineAndAsk(intentId, 'Find designers for mobile');
    const second = await refineAndAsk(intentId, 'Find designers for mobile, product');
    expect(await refineAndAsk(intentId, 'Find designers for mobile, product, senior')).toBeNull();

    await backdate([first!, second!], 25);

    expect(await refineAndAsk(intentId, 'Find designers for mobile, product, staff')).not.toBeNull();
  }, 30_000);

  test('does not roll forward while the earlier rounds are still inside the window', async () => {
    const intentId = await createIntent('Find researchers');
    const first = await refineAndAsk(intentId, 'Find researchers in ML');
    const second = await refineAndAsk(intentId, 'Find researchers in ML, applied');
    expect(await refineAndAsk(intentId, 'Find researchers in ML, applied, NLP')).toBeNull();

    // 23 hours is inside a rolling day even though it would be a new UTC date,
    // which is the case a calendar-day cap would have let through.
    await backdate([first!, second!], 23);

    expect(await refineAndAsk(intentId, 'Find researchers in ML, applied, vision')).toBeNull();
  }, 30_000);

  test('budgets each intent separately', async () => {
    const busy = await createIntent('Find engineers');
    await refineAndAsk(busy, 'Find engineers in robotics');
    await refineAndAsk(busy, 'Find engineers in robotics, control');
    expect(await refineAndAsk(busy, 'Find engineers in robotics, control, ROS')).toBeNull();

    const fresh = await createIntent('Find operators');
    expect(await refineAndAsk(fresh, 'Find operators in logistics')).not.toBeNull();
  }, 30_000);

  test('ignores chat questions when counting the budget', async () => {
    const intentId = await createIntent('Find founders');
    const chatId = crypto.randomUUID();
    await db.insert(questions).values({
      id: chatId,
      detection: {
        mode: 'chat',
        sourceType: 'conversation',
        sourceId: 'intake:who',
        triggeredBy: intentId,
        timestamp: new Date().toISOString(),
      },
      actors: [{ userId, role: 'subject' }],
      payload: { title: 'Who', prompt: 'Who would you like to meet?', options: [], multiSelect: false },
      status: 'pending',
    });
    questionIds.push(chatId);

    // The chat row shares the intent but is a conversation turn, not a
    // background refinement round, so both rounds must remain available.
    expect(await refineAndAsk(intentId, 'Find founders pre-seed')).not.toBeNull();
    expect(await refineAndAsk(intentId, 'Find founders pre-seed, B2B')).not.toBeNull();
    expect(await refineAndAsk(intentId, 'Find founders pre-seed, B2B, EU')).toBeNull();
  }, 30_000);
});
