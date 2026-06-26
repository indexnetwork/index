import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

import { questions, opportunities } from '../src/schemas/database.schema';
import { QuestionerAdapter } from '../src/adapters/questioner.adapter';
import type { AdapterPersistableQuestion } from '../src/adapters/questioner.adapter';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let adapter: QuestionerAdapter;

const SELECTED_INTENT_ID = '00000000-0000-4000-8000-00000000a111';
const OTHER_INTENT_ID = '00000000-0000-4000-8000-00000000a222';
const SELECTED_OPPORTUNITY_ID = '00000000-0000-4000-8000-00000000b111';
const OTHER_OPPORTUNITY_ID = '00000000-0000-4000-8000-00000000b222';

beforeAll(() => {
  client = postgres(process.env.DATABASE_URL!, { prepare: false });
  db = drizzle(client);
  adapter = new QuestionerAdapter(db);
});

afterAll(async () => {
  // Clean up all test rows (regardless of status) by deterministic marker
  await db.delete(questions).where(
    sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: 'test-user-1' }])}::jsonb`,
  );
  await db.delete(questions).where(
    sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: 'test-user-2' }])}::jsonb`,
  );
  await db.delete(opportunities).where(sql`${opportunities.id} IN (${SELECTED_OPPORTUNITY_ID}, ${OTHER_OPPORTUNITY_ID})`);
  await client.end({ timeout: 5 });
});

function makePersistable(
  overrides: Partial<AdapterPersistableQuestion> = {},
): AdapterPersistableQuestion {
  return {
    detection: {
      mode: 'discovery',
      sourceType: 'opportunity',
      sourceId: 'test-opp-1',
      timestamp: new Date().toISOString(),
    },
    actors: [{ userId: 'test-user-1', role: 'subject' as const }],
    payload: {
      title: 'Stage',
      prompt: 'What stage?',
      options: [
        { label: 'Early', description: 'Pre-seed' },
        { label: 'Growth', description: 'Series A+' },
      ],
      multiSelect: false,
    },
    strategy: 'refine_intent',
    ...overrides,
  };
}

describe('QuestionerAdapter', () => {
  it('persists a batch of questions', async () => {
    const batch = [
      makePersistable(),
      makePersistable({ strategy: 'surface_missing_detail' }),
    ];
    await adapter.persist(batch);
    const pending = await adapter.findPending('test-user-1');
    expect(pending.length).toBeGreaterThanOrEqual(2);
  });

  it('findPending returns only pending questions for the given user', async () => {
    const pending = await adapter.findPending('test-user-1');
    for (const q of pending) {
      expect(q.status).toBe('pending');
      expect(q.actors.some((a) => a.userId === 'test-user-1')).toBe(true);
    }
  });

  it('findPending filters by mode', async () => {
    const pending = await adapter.findPending('test-user-1', {
      mode: 'discovery',
    });
    for (const q of pending) {
      expect(q.detection.mode).toBe('discovery');
    }
  });

  it('answers a question', async () => {
    const pending = await adapter.findPending('test-user-1');
    expect(pending.length).toBeGreaterThan(0);
    const questionId = pending[0].id;
    await adapter.answer(questionId, 'test-user-1', {
      selectedOptions: ['Early'],
      answeredBy: 'test-user-1',
      answeredAt: new Date().toISOString(),
    });
    const after = await adapter.findPending('test-user-1');
    const answered = after.find((q) => q.id === questionId);
    // It should no longer appear in pending
    expect(answered).toBeUndefined();
  });

  it('dismisses a question', async () => {
    const pending = await adapter.findPending('test-user-1');
    expect(pending.length).toBeGreaterThan(0);
    const questionId = pending[0].id;
    await adapter.dismiss(questionId, 'test-user-1');
    const after = await adapter.findPending('test-user-1');
    const dismissed = after.find((q) => q.id === questionId);
    expect(dismissed).toBeUndefined();
  });

  it('answer returns false for wrong userId', async () => {
    // Persist a fresh question for this test
    const ids = await adapter.persist([makePersistable()]);
    const result = await adapter.answer(ids[0], 'wrong-user', {
      selectedOptions: ['Early'],
      answeredBy: 'wrong-user',
      answeredAt: new Date().toISOString(),
    });
    expect(result).toBe(false);
  });

  it('dismiss returns false for wrong userId', async () => {
    const ids = await adapter.persist([makePersistable()]);
    const result = await adapter.dismiss(ids[0], 'wrong-user');
    expect(result).toBe(false);
  });

  it('answer returns false for already-answered question', async () => {
    const ids = await adapter.persist([makePersistable()]);
    const answer = {
      selectedOptions: ['Early'],
      answeredBy: 'test-user-1',
      answeredAt: new Date().toISOString(),
    };
    const first = await adapter.answer(ids[0], 'test-user-1', answer);
    expect(first).toBe(true);
    // Second answer attempt should fail (status is no longer pending)
    const second = await adapter.answer(ids[0], 'test-user-1', answer);
    expect(second).toBe(false);
  });

  it('dismiss returns false for already-dismissed question', async () => {
    const ids = await adapter.persist([makePersistable()]);
    const first = await adapter.dismiss(ids[0], 'test-user-1');
    expect(first).toBe(true);
    const second = await adapter.dismiss(ids[0], 'test-user-1');
    expect(second).toBe(false);
  });

  it('findPending filters by a modes set, excluding other modes', async () => {
    await adapter.persist([
      makePersistable({
        detection: { mode: 'profile', sourceType: 'profile', sourceId: 'test-user-2', timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
      makePersistable({
        detection: { mode: 'negotiation', sourceType: 'opportunity', sourceId: 'test-opp-2', timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
    ]);
    const pending = await adapter.findPending('test-user-2', {
      modes: ['profile', 'intent', 'discovery'],
    });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    for (const q of pending) {
      expect(q.detection.mode).not.toBe('negotiation');
    }
    const all = await adapter.findPending('test-user-2');
    expect(all.some((q) => q.detection.mode === 'negotiation')).toBe(true);
  });

  it('findPending applies the SQL limit preserving oldest-first order', async () => {
    await adapter.persist([
      makePersistable({
        detection: { mode: 'intent', sourceType: 'intent', sourceId: 'test-intent-2a', timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
      makePersistable({
        detection: { mode: 'intent', sourceType: 'intent', sourceId: 'test-intent-2b', timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
    ]);
    const all = await adapter.findPending('test-user-2');
    expect(all.length).toBeGreaterThan(1);
    const limited = await adapter.findPending('test-user-2', { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].id).toBe(all[0].id);
  });

  it('findPending filters by selected intent scope across direct intent and negotiation questions', async () => {
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: 'test-user-2' }])}::jsonb`);
    await db.delete(opportunities).where(sql`${opportunities.id} IN (${SELECTED_OPPORTUNITY_ID}, ${OTHER_OPPORTUNITY_ID})`);

    await db.insert(opportunities).values([
      {
        id: SELECTED_OPPORTUNITY_ID,
        detection: { source: 'opportunity_graph', triggeredBy: SELECTED_INTENT_ID, timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'peer', intent: SELECTED_INTENT_ID }],
        interpretation: { summary: 'Selected opportunity', reasoning: 'Selected intent match', confidence: 0.9, category: 'connection' },
        context: {},
        confidence: '0.9',
        status: 'pending',
      },
      {
        id: OTHER_OPPORTUNITY_ID,
        detection: { source: 'opportunity_graph', triggeredBy: OTHER_INTENT_ID, timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'peer', intent: OTHER_INTENT_ID }],
        interpretation: { summary: 'Other opportunity', reasoning: 'Other intent match', confidence: 0.8, category: 'connection' },
        context: {},
        confidence: '0.8',
        status: 'pending',
      },
    ]).onConflictDoNothing();

    const insertedIds = await adapter.persist([
      makePersistable({
        detection: { mode: 'intent', sourceType: 'intent', sourceId: SELECTED_INTENT_ID, timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
      makePersistable({
        detection: { mode: 'negotiation', sourceType: 'opportunity', sourceId: SELECTED_OPPORTUNITY_ID, timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
      makePersistable({
        detection: { mode: 'negotiation', sourceType: 'opportunity', sourceId: OTHER_OPPORTUNITY_ID, timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
    ]);

    const scoped = await adapter.findPending('test-user-2', { scopeType: 'intent', scopeId: SELECTED_INTENT_ID });
    const scopedIds = new Set(scoped.map((q) => q.id));
    expect(scopedIds.has(insertedIds[0])).toBe(true);
    expect(scopedIds.has(insertedIds[1])).toBe(true);
    expect(scopedIds.has(insertedIds[2])).toBe(false);
  });
});
