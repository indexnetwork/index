import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm/sql';

import { UserDatabaseAdapter } from '../../adapters/database.adapter';
import { IntentController } from '../intent.controller';
import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from '../../guards/auth.guard';
import { RouteRegistry } from '../../lib/router/router.decorators';
import db from '../../lib/drizzle/drizzle';
import { intents } from '../../schemas/database.schema';

const EMAIL = 'test-intent-visit@example.com';
const OTHER_EMAIL = 'test-intent-visit-other@example.com';

describe('explicit intent visit ping', () => {
  const users = new UserDatabaseAdapter();
  const controller = new IntentController();
  let userId: string;
  let otherUserId: string;
  let intentId: string;

  const actor = (): AuthenticatedUser => ({ id: userId, email: EMAIL, name: 'Visit Owner' });

  beforeAll(async () => {
    for (const email of [EMAIL, OTHER_EMAIL]) {
      const existing = await users.findByEmail(email);
      if (existing) await users.deleteByEmail(email);
    }
    userId = (await users.create({ email: EMAIL, name: 'Visit Owner' })).id;
    otherUserId = (await users.create({ email: OTHER_EMAIL, name: 'Other Owner' })).id;
  });

  beforeEach(async () => {
    await db.delete(intents).where(eq(intents.userId, userId));
    intentId = crypto.randomUUID();
    await db.insert(intents).values({
      id: intentId,
      userId,
      payload: 'Visit test intent',
      status: 'ACTIVE',
    });
  });

  afterAll(async () => {
    await db.delete(intents).where(eq(intents.userId, userId)).catch(() => {});
    await users.deleteById(userId).catch(() => {});
    await users.deleteById(otherUserId).catch(() => {});
  });

  test('route is POST and guarded by SessionOnlyGuard rather than AuthGuard', () => {
    const route = RouteRegistry.getRoutes(IntentController).find((candidate) => candidate.methodName === 'visit');
    expect(route).toMatchObject({ method: 'POST', path: '/:id/visit' });
    const guards = RouteRegistry.getGuards(IntentController, 'visit');
    expect(guards).toContain(SessionOnlyGuard);
    expect(guards).not.toContain(AuthGuard);
  });

  test('owner ping is monotonic and does not touch intent.updatedAt', async () => {
    const [before] = await db.select({ updatedAt: intents.updatedAt }).from(intents).where(eq(intents.id, intentId));
    const firstResponse = await controller.visit(new Request(`http://localhost/intents/${intentId}/visit`, { method: 'POST' }), actor(), { id: intentId });
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as { lastVisitedAt: string };
    const secondResponse = await controller.visit(new Request(`http://localhost/intents/${intentId}/visit`, { method: 'POST' }), actor(), { id: intentId });
    const second = await secondResponse.json() as { lastVisitedAt: string };

    expect(new Date(second.lastVisitedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.lastVisitedAt).getTime());
    const [after] = await db.select({ updatedAt: intents.updatedAt, lastVisitedAt: intents.lastVisitedAt })
      .from(intents).where(eq(intents.id, intentId));
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    expect(after.lastVisitedAt?.toISOString()).toBe(second.lastVisitedAt);
  }, 30_000);

  test('foreign owner gets 404 and generic GET never stamps a visit', async () => {
    const foreign = await controller.visit(
      new Request(`http://localhost/intents/${intentId}/visit`, { method: 'POST' }),
      { id: otherUserId, email: OTHER_EMAIL, name: 'Other Owner' },
      { id: intentId },
    );
    expect(foreign.status).toBe(404);

    const get = await controller.getById(new Request(`http://localhost/intents/${intentId}`), actor(), { id: intentId });
    expect(get.status).toBe(200);
    const [row] = await db.select({ lastVisitedAt: intents.lastVisitedAt }).from(intents).where(eq(intents.id, intentId));
    expect(row.lastVisitedAt).toBeNull();
  }, 30_000);
});
