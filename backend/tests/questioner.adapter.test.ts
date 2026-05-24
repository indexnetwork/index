import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

import { questions } from '../src/schemas/database.schema';
import { QuestionerAdapter } from '../src/adapters/questioner.adapter';
import type { AdapterPersistableQuestion } from '../src/adapters/questioner.adapter';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let adapter: QuestionerAdapter;

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
});
