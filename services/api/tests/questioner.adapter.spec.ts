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
    underspecificationType: 'missing_constraint',
    ...overrides,
  };
}

function makePoolPersistable(
  label: string,
  intentFingerprint?: string,
  intentText = 'Find collaborators',
  intentId = SELECTED_INTENT_ID,
): AdapterPersistableQuestion {
  return makePersistable({
    detection: {
      mode: 'pool_discovery',
      sourceType: 'intent',
      sourceId: intentId,
      triggeredBy: intentId,
      timestamp: new Date().toISOString(),
      pool: {
        poolSize: 12,
        minedAt: new Date().toISOString(),
        intentText,
        ...(intentFingerprint ? { intentFingerprint } : {}),
        discriminator: {
          label,
          questionSeed: `${label}?`,
          sides: ['Side A', 'Side B'],
          sideCounts: { 'Side A': 6, 'Side B': 6 },
          voi: 0.5,
          evidenceRate: 1,
          embedding: [0.2, 0.8],
          embeddingModel: 'model-v1',
          assignments: [],
        },
        alternates: [],
      },
    },
    actors: [{ userId: 'test-user-1', role: 'subject' }],
  });
}

describe('QuestionerAdapter', () => {
  it('persists a batch of questions with internal QUD metadata', async () => {
    const batch = [
      makePersistable(),
      makePersistable({
        strategy: 'surface_missing_detail',
        underspecificationType: null,
      }),
    ];
    const ids = await adapter.persist(batch);
    const pending = await adapter.findPending('test-user-1');
    expect(pending.length).toBeGreaterThanOrEqual(2);
    const inserted = ids.map((id) => pending.find((question) => question.id === id));
    expect(inserted[0]?.detection.underspecificationType).toBe('missing_constraint');
    expect(inserted[1]?.detection.underspecificationType).toBeNull();
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

  it('applies fingerprint and boundary-safe legacy freshness', async () => {
    const cappedLegacyText = 'x'.repeat(160);
    const ids = await adapter.persist([
      makePoolPersistable('pending-old', 'fingerprint-v1'),
      makePoolPersistable('answered-fresh', 'fingerprint-v2'),
      makePoolPersistable('dismissed-fresh', 'fingerprint-v2'),
      makePoolPersistable('answered-stale', 'fingerprint-v1'),
      makePoolPersistable('legacy-fresh', undefined, 'Find collaborators for local prototypes'),
      makePoolPersistable('legacy-short-prefix-stale', undefined, 'Find collaborators'),
      makePoolPersistable('legacy-capped-fresh', undefined, cappedLegacyText),
    ]);
    const answer = (selectedOptions: string[]) => ({
      selectedOptions,
      answeredBy: 'test-user-1',
      answeredAt: new Date().toISOString(),
    });
    expect(await adapter.answer(ids[1], 'test-user-1', answer(['Both matter']))).toBe(true);
    expect(await adapter.dismiss(ids[2], 'test-user-1')).toBe(true);
    expect(await adapter.answer(ids[3], 'test-user-1', answer(['Side A']))).toBe(true);
    expect(await adapter.answer(ids[4], 'test-user-1', answer(['Side B']))).toBe(true);
    expect(await adapter.dismiss(ids[5], 'test-user-1')).toBe(true);
    expect(await adapter.answer(ids[6], 'test-user-1', answer(['Side A']))).toBe(true);

    const freshness = {
      currentIntentFingerprint: 'fingerprint-v2',
      currentIntentText: 'Find collaborators for local prototypes',
    };
    expect((await adapter.listPoolQuestionLabels('test-user-1', SELECTED_INTENT_ID, freshness)).sort())
      .toEqual(['answered-fresh', 'dismissed-fresh', 'legacy-fresh', 'pending-old'].sort());
    expect((await adapter.listResolvedPoolAxes('test-user-1', SELECTED_INTENT_ID, freshness))
      .map((axis) => axis.label).sort())
      .toEqual(['answered-fresh', 'dismissed-fresh', 'legacy-fresh'].sort());

    // Backward-compatible callers without freshness context still see every status.
    expect((await adapter.listPoolQuestionLabels('test-user-1', SELECTED_INTENT_ID)).sort())
      .toEqual([
        'pending-old',
        'answered-fresh',
        'dismissed-fresh',
        'answered-stale',
        'legacy-fresh',
        'legacy-short-prefix-stale',
        'legacy-capped-fresh',
      ].sort());

    const cappedFreshAxes = await adapter.listResolvedPoolAxes('test-user-1', SELECTED_INTENT_ID, {
      currentIntentFingerprint: 'different-fingerprint',
      currentIntentText: `${cappedLegacyText} with uncapped suffix`,
    });
    expect(cappedFreshAxes.map((axis) => axis.label)).toEqual(['legacy-capped-fresh']);
  });

  it('filters freshness before capping resolved axes at 24', async () => {
    const fresh = Array.from({ length: 25 }, (_, index) =>
      makePoolPersistable(`fresh-${index}`, 'current', 'Current intent', OTHER_INTENT_ID));
    const stale = Array.from({ length: 24 }, (_, index) =>
      makePoolPersistable(`newer-stale-${index}`, 'stale', 'Stale intent', OTHER_INTENT_ID));
    const freshIds = await adapter.persist(fresh);
    await Bun.sleep(5);
    const staleIds = await adapter.persist(stale);
    const answer = {
      selectedOptions: ['Side A'],
      answeredBy: 'test-user-1',
      answeredAt: new Date().toISOString(),
    };
    await Promise.all([...freshIds, ...staleIds].map((id) => adapter.answer(id, 'test-user-1', answer)));

    const axes = await adapter.listResolvedPoolAxes('test-user-1', OTHER_INTENT_ID, {
      currentIntentFingerprint: 'current',
      currentIntentText: 'Current intent',
    });
    expect(axes).toHaveLength(24);
    expect(axes.every((axis) => axis.label.startsWith('fresh-'))).toBe(true);
  });

  it('reads only strict fresh answered owner preferences', async () => {
    const rows = [
      makePoolPersistable('valid', 'current'),
      makePoolPersistable('stale', 'old'),
      makePoolPersistable('legacy'),
      makePoolPersistable('both', 'current'),
      makePoolPersistable('multi', 'current'),
      makePoolPersistable('free-only', 'current'),
      makePoolPersistable('wrong-intent', 'current', 'Find collaborators', OTHER_INTENT_ID),
      makePoolPersistable('dismissed', 'current'),
      makePoolPersistable('wrong-owner', 'current'),
      makePoolPersistable('empty-option', 'current'),
      makePoolPersistable('malformed-axis', 'current'),
      makePoolPersistable('wrong-answerer', 'current'),
    ];
    rows[8] = {
      ...rows[8],
      actors: [{ userId: 'test-user-2', role: 'subject' }],
    };
    rows[10] = {
      ...rows[10],
      detection: {
        ...rows[10].detection,
        pool: rows[10].detection.pool
          ? {
              ...rows[10].detection.pool,
              discriminator: { ...rows[10].detection.pool.discriminator, sides: [] },
            }
          : undefined,
      },
    };
    const ids = await adapter.persist(rows);
    const answer = (selectedOptions: string[], answeredBy = 'test-user-1', freeText?: string) => ({
      selectedOptions,
      ...(freeText ? { freeText } : {}),
      answeredBy,
      answeredAt: new Date().toISOString(),
    });
    expect(await adapter.answer(ids[0], 'test-user-1', answer(['Side A']))).toBe(true);
    expect(await adapter.answer(ids[1], 'test-user-1', answer(['Side A']))).toBe(true);
    expect(await adapter.answer(ids[2], 'test-user-1', answer(['Side A']))).toBe(true);
    expect(await adapter.answer(ids[3], 'test-user-1', answer(['Both matter']))).toBe(true);
    expect(await adapter.answer(ids[4], 'test-user-1', answer(['Side A', 'Side B']))).toBe(true);
    expect(await adapter.answer(ids[5], 'test-user-1', answer([], 'test-user-1', 'Side A please'))).toBe(true);
    expect(await adapter.answer(ids[6], 'test-user-1', answer(['Side A']))).toBe(true);
    expect(await adapter.dismiss(ids[7], 'test-user-1')).toBe(true);
    expect(await adapter.answer(ids[8], 'test-user-2', answer(['Side A'], 'test-user-2'))).toBe(true);
    expect(await adapter.answer(ids[9], 'test-user-1', answer(['   ']))).toBe(true);
    expect(await adapter.answer(ids[10], 'test-user-1', answer(['Side A']))).toBe(true);
    expect(await adapter.answer(ids[11], 'test-user-1', answer(['Side A'], 'test-user-2'))).toBe(true);

    expect(await adapter.listAnsweredPoolPreferences('test-user-1', SELECTED_INTENT_ID, 'current')).toEqual([
      { questionId: ids[0], label: 'valid', sides: ['Side A', 'Side B'], chosenSide: 'Side A' },
    ]);
  });

  it('caps after filtering so newer non-preferences cannot hide an older valid answer', async () => {
    const [validId] = await adapter.persist([makePoolPersistable('older-valid', 'current')]);
    expect(await adapter.answer(validId, 'test-user-1', {
      selectedOptions: ['Side A'],
      answeredBy: 'test-user-1',
      answeredAt: new Date().toISOString(),
    })).toBe(true);

    const invalidIds = await adapter.persist(
      Array.from({ length: 12 }, (_, index) => makePoolPersistable(`newer-both-${index}`, 'current')),
    );
    for (const id of invalidIds) {
      expect(await adapter.answer(id, 'test-user-1', {
        selectedOptions: ['Both matter'],
        answeredBy: 'test-user-1',
        answeredAt: new Date().toISOString(),
      })).toBe(true);
    }

    expect(await adapter.listAnsweredPoolPreferences('test-user-1', SELECTED_INTENT_ID, 'current')).toContainEqual({
      questionId: validId,
      label: 'older-valid',
      sides: ['Side A', 'Side B'],
      chosenSide: 'Side A',
    });
  }, 20_000);

  it('updates an answered pool question fingerprint after refinement', async () => {
    const [id] = await adapter.persist([makePoolPersistable('stamp-after-refinement', 'before')]);
    expect(await adapter.answer(id, 'test-user-1', {
      selectedOptions: ['Side A'],
      answeredBy: 'test-user-1',
      answeredAt: new Date().toISOString(),
    })).toBe(true);
    expect(await adapter.updateAnsweredPoolIntentFingerprint(id, 'test-user-1', 'after')).toBe(true);
    expect((await adapter.getById(id))?.detection.pool?.intentFingerprint).toBe('after');
  });
});
