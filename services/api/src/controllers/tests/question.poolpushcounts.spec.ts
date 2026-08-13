import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm/sql';

import { UserDatabaseAdapter } from '../../adapters/database.adapter';
import { QuestionerAdapter, type AdapterPersistableQuestion } from '../../adapters/questioner.adapter';
import { QuestionController } from '../question.controller';
import { QuestionService } from '../../services/question.service';
import db from '../../lib/drizzle/drizzle';
import { questions } from '../../schemas/database.schema';
import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from '../../guards/auth.guard';
import { RouteRegistry } from '../../lib/router/router.decorators';

const EMAIL = 'test-pool-push-counts@example.com';

describe('pool push count and read isolation', () => {
  const users = new UserDatabaseAdapter();
  const adapter = new QuestionerAdapter(db);
  const service = new QuestionService(adapter);
  const controller = new QuestionController();
  let userId: string;
  const ids: string[] = [];

  async function persist(mode: 'intent' | 'pool_discovery', pushed: boolean): Promise<string> {
    const intentId = crypto.randomUUID();
    const detection: AdapterPersistableQuestion['detection'] = mode === 'intent'
      ? {
          mode,
          sourceType: 'intent',
          sourceId: intentId,
          triggeredBy: intentId,
          timestamp: new Date().toISOString(),
        }
      : {
          mode,
          sourceType: 'intent',
          sourceId: intentId,
          triggeredBy: intentId,
          timestamp: new Date().toISOString(),
          pool: {
            poolSize: 8,
            minedAt: new Date().toISOString(),
            runId: crypto.randomUUID(),
            discriminator: {
              label: 'Role',
              questionSeed: 'Which role?',
              sides: ['A', 'B'],
              sideCounts: { A: 4, B: 4 },
              voi: 0.9,
              evidenceRate: 1,
              assignments: [],
            },
            alternates: [],
          },
          ...(pushed ? {
            pushedAt: new Date().toISOString(),
            push: {
              version: 1,
              source: 'pool_discovery',
              recipientId: userId,
              intentId,
              cycleKey: `run:${intentId}`,
              messageId: intentId,
              // Deliberately the legacy literal: this fixture doubles as the
              // read-compat guard that push rows persisted before the unscoped
              // DM was removed still parse through the counting path.
              surfaces: ['personal_agent_badge', 'negotiator_dm'],
              claimedAt: new Date().toISOString(),
              deliveryStatus: 'delivered',
            },
          } : {}),
        };
    const [id] = await adapter.persist([{
      detection,
      actors: [{ userId, role: 'subject' }],
      payload: {
        title: 'Role',
        prompt: 'Which role?',
        options: [{ label: 'A', description: 'A' }, { label: 'B', description: 'B' }],
        multiSelect: false,
      },
      strategy: 'refine_intent',
    }]);
    ids.push(id);
    return id;
  }

  beforeAll(async () => {
    const existing = await users.findByEmail(EMAIL);
    if (existing) await users.deleteByEmail(EMAIL);
    userId = (await users.create({ email: EMAIL, name: 'Count User' })).id;
  });

  afterAll(async () => {
    await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`).catch(() => {});
    await users.deleteById(userId).catch(() => {});
  });

  test('counts is web-only and guarded by SessionOnlyGuard rather than AuthGuard', () => {
    const route = RouteRegistry.getRoutes(QuestionController).find((candidate) => candidate.methodName === 'counts');
    expect(route).toMatchObject({ method: 'GET', path: '/counts' });
    const guards = RouteRegistry.getGuards(QuestionController, 'counts');
    expect(guards[0]?.name).toBe('RateLimit(read)');
    expect(guards).toContain(SessionOnlyGuard);
    expect(guards).not.toContain(AuthGuard);
  });

  test('only delivered pool rows join the Personal Agent count and never the global list', async () => {
    const globalId = await persist('intent', false);
    await persist('pool_discovery', false);
    const pushedId = await persist('pool_discovery', true);

    expect(await service.countPending(userId)).toEqual({
      globalPending: 1,
      pushedPoolPending: 1,
      personalAgentPending: 2,
    });

    const response = await controller.list(
      new Request('http://localhost/questions?status=pending&noConversation=true'),
      { id: userId, email: EMAIL, name: 'Count User' } satisfies AuthenticatedUser,
    );
    const body = await response.json() as { questions: Array<{ id: string; detection: Record<string, unknown> }> };
    expect(body.questions.map((question) => question.id)).toEqual([globalId]);
    expect(JSON.stringify(body)).not.toContain('push');
    expect(JSON.stringify(body)).not.toContain('assignments');

    await service.answer(pushedId, userId, {
      selectedOptions: ['A'],
      answeredBy: userId,
      answeredAt: new Date().toISOString(),
    });
    expect((await service.countPending(userId)).pushedPoolPending).toBe(0);

    const dismissedId = await persist('pool_discovery', true);
    expect((await service.countPending(userId)).pushedPoolPending).toBe(1);
    await service.dismiss(dismissedId, userId);
    expect((await service.countPending(userId)).pushedPoolPending).toBe(0);
  }, 30_000);
});
