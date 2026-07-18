/**
 * IND-439 visibility-audit slice — aggregate question-funnel telemetry.
 *
 * Verifies the adapter aggregate groups by (mode, status, expired-past-TTL),
 * reports counts and date bounds only, and that the debug service payload
 * carries no question content or foreign user identifiers.
 *
 * Uses the real database adapter against the test DB. Because the aggregate
 * is deliberately whole-funnel (unscoped), assertions compare before/after
 * deltas for cells this spec creates instead of absolute totals.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm/sql';

import { QuestionerAdapter, type AdapterPersistableQuestion, type QuestionFunnelStage } from '../questioner.adapter';
import { UserDatabaseAdapter } from '../database.adapter';
import { debugService } from '../../services/debug.service';
import db from '../../lib/drizzle/drizzle';
import { questions } from '../../schemas/database.schema';

const cellKey = (row: Pick<QuestionFunnelStage, 'mode' | 'status' | 'expired'>): string =>
  `${row.mode}|${row.status}|${row.expired}`;

function toCellCounts(rows: QuestionFunnelStage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(cellKey(row), row.count);
  return counts;
}

describe('QuestionerAdapter.aggregateQuestionFunnel (IND-439)', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  let userId: string;
  const questionIds: string[] = [];
  let before: Map<string, number>;

  function persistable(mode: 'discovery' | 'enrichment' | 'negotiation'): AdapterPersistableQuestion {
    return {
      detection: {
        mode,
        sourceType: 'discovery',
        sourceId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
      actors: [{ userId, role: 'subject' }],
      payload: {
        title: 'Funnel probe',
        prompt: 'Which direction matters more?',
        options: [
          { label: 'A', description: 'Side A' },
          { label: 'B', description: 'Side B' },
        ],
        multiSelect: false,
      },
      strategy: 'surface_missing_detail',
    };
  }

  beforeAll(async () => {
    userId = (await users.create({
      email: `questioner-funnel-${crypto.randomUUID()}@example.com`,
      name: 'Funnel Probe User',
    })).id;

    before = toCellCounts(await adapter.aggregateQuestionFunnel());

    // Live pending discovery question (persist stamps a future TTL).
    const [liveId] = await adapter.persist([persistable('discovery')]);
    questionIds.push(liveId);

    // Pending enrichment question forced past its TTL (the audit's 759 case).
    const [expiredId] = await adapter.persist([persistable('enrichment')]);
    questionIds.push(expiredId);
    await db.update(questions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(questions.id, expiredId));

    // Answered negotiation question (non-expired terminal state).
    const [answeredId] = await adapter.persist([persistable('negotiation')]);
    questionIds.push(answeredId);
    await db.update(questions)
      .set({ status: 'answered' })
      .where(eq(questions.id, answeredId));
  });

  afterAll(async () => {
    if (questionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, questionIds));
    }
  });

  test('groups counts by (mode, status, expired) including expired-past-TTL pending rows', async () => {
    const after = toCellCounts(await adapter.aggregateQuestionFunnel());
    const delta = (key: string): number => (after.get(key) ?? 0) - (before.get(key) ?? 0);

    expect(delta('discovery|pending|false')).toBe(1);
    expect(delta('enrichment|pending|true')).toBe(1);
    expect(delta('negotiation|answered|false')).toBe(1);
  });

  test('rows expose counts and dates only — no content or identifier fields', async () => {
    const rows = await adapter.aggregateQuestionFunnel();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'count',
        'expired',
        'latestExpiresAt',
        'mode',
        'nearestExpiresAt',
        'newestCreatedAt',
        'oldestCreatedAt',
        'status',
      ]);
      expect(typeof row.count).toBe('number');
      if (row.oldestCreatedAt !== null) {
        expect(Number.isNaN(Date.parse(row.oldestCreatedAt))).toBe(false);
      }
    }
  });

  test('debug service pairs the funnel with the viewer pending splits', async () => {
    const result = await debugService.getQuestionFunnel(userId);
    expect(Object.keys(result).sort()).toEqual(['funnel', 'viewerPending']);
    expect(result.viewerPending).toEqual({
      globalPending: expect.any(Number),
      pushedPoolPending: expect.any(Number),
      personalAgentPending: expect.any(Number),
    });
    // The one live pending question this spec created is visible to its owner.
    expect(result.viewerPending.globalPending).toBeGreaterThanOrEqual(1);
  });
});
