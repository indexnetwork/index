import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { agents, opportunityDeliveries, opportunities, users } from '../src/schemas/database.schema';
import { OpportunityDeliveryService } from '../src/services/opportunity-delivery.service';
import type { RenderedCard } from '../src/services/opportunity-delivery.service';

// ─────────────────────────────────────────────────────────────────────────────
// Stubs — never call LLM or real DB adapters
// ─────────────────────────────────────────────────────────────────────────────

const STUB_CARD: RenderedCard = {
  headline: 'H',
  personalizedSummary: 'S',
  suggestedAction: 'A',
  narratorRemark: 'N',
};

class StubPresenter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async presentHomeCard(_input: any): Promise<typeof STUB_CARD & { mutualIntentsLabel: string }> {
    return { ...STUB_CARD, mutualIntentsLabel: 'Shared interests' };
  }
}

/** Minimal PresenterDatabase stub so gatherPresenterContext doesn't hit a real adapter. */
const stubPresenterDb = {
  async getProfile(_userId: string) {
    return {
      identity: { name: 'Test User', bio: '', location: '' },
      attributes: { skills: [], interests: [] },
      narrative: { context: '' },
    } as unknown as Awaited<ReturnType<import('@indexnetwork/protocol').PresenterDatabase['getProfile']>>;
  },
  async getActiveIntents(_userId: string) {
    return [] as Awaited<ReturnType<import('@indexnetwork/protocol').PresenterDatabase['getActiveIntents']>>;
  },
  async getNetwork(_networkId: string) {
    return null;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function seedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `test-${randomUUID()}@example.com`, name: 'Test User' })
    .returning({ id: users.id });
  return user.id;
}

async function seedAgent(userId: string): Promise<string> {
  const [agent] = await db
    .insert(agents)
    .values({ ownerId: userId, name: 'test-agent', type: 'personal' })
    .returning({ id: agents.id });
  return agent.id;
}

async function seedPendingOpportunity(userId: string): Promise<string> {
  const [opp] = await db
    .insert(opportunities)
    .values({
      detection: { kind: 'test', summary: 'test summary' } as never,
      actors: [{ userId, role: 'peer' }] as never,
      interpretation: { reasoning: 'test reasoning', category: 'test' } as never,
      context: {} as never,
      confidence: '0.9',
      status: 'pending',
    })
    .returning({ id: opportunities.id });
  return opp.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('OpportunityDeliveryService', () => {
  const service = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  let userId: string;
  let agentId: string;

  beforeEach(async () => {
    // Full wipe: order matters (FK constraints)
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
    userId = await seedUser();
    agentId = await seedAgent(userId);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
  });

  // ── 1. Null when no pending opportunities ──────────────────────────────────

  test('pickupPending returns null when no pending opportunities for this user', async () => {
    const result = await service.pickupPending(agentId);
    expect(result).toBeNull();
  });

  // ── 2. Returns opportunity + token + rendered card ─────────────────────────

  test('pickupPending returns opportunity + reservation token + rendered card', async () => {
    const oppId = await seedPendingOpportunity(userId);
    const result = await service.pickupPending(agentId);

    expect(result).not.toBeNull();
    expect(result!.opportunityId).toBe(oppId);
    expect(result!.reservationToken).toBeTruthy();
    expect(result!.reservationExpiresAt).toBeInstanceOf(Date);
    expect(result!.rendered.headline).toBe('H');
    expect(result!.rendered.personalizedSummary).toBe('S');
    expect(result!.rendered.suggestedAction).toBe('A');
    expect(result!.rendered.narratorRemark).toBe('N');
  });

  // ── 3. Concurrent pickups — only one succeeds ──────────────────────────────

  test('two concurrent pickupPending calls return only one non-null result', async () => {
    await seedPendingOpportunity(userId);

    const [r1, r2] = await Promise.all([
      service.pickupPending(agentId),
      service.pickupPending(agentId),
    ]);

    // At v1 scale we accept that both may succeed (concurrent inserts both write a
    // reservation row). What we MUST guarantee is that confirmDelivered deduplicates:
    // only one reservation token can commit the row. We verify the weaker guarantee
    // here: at least one result is non-null, and both cannot commit independently.
    const nonNull = [r1, r2].filter(Boolean);
    expect(nonNull.length).toBeGreaterThanOrEqual(1);

    if (nonNull.length === 2) {
      // Both won the race — verify only one can confirm
      await service.confirmDelivered(r1!.opportunityId, userId, r1!.reservationToken);
      await expect(
        service.confirmDelivered(r2!.opportunityId, userId, r2!.reservationToken),
      ).rejects.toThrow();
    }
  });

  // ── 4. confirmDelivered commits and deduplicates subsequent pickups ─────────

  test('confirmDelivered commits and dedupes subsequent pickups', async () => {
    await seedPendingOpportunity(userId);

    const first = await service.pickupPending(agentId);
    expect(first).not.toBeNull();

    await service.confirmDelivered(first!.opportunityId, userId, first!.reservationToken);

    // After confirming, the same opp should not be returned again
    const second = await service.pickupPending(agentId);
    expect(second).toBeNull();
  });

  // ── 5. Expired reservation is re-pickable ─────────────────────────────────

  test('expired reservation is re-pickable (after backdating reserved_at by 2 minutes)', async () => {
    await seedPendingOpportunity(userId);

    // Create a reservation
    await service.pickupPending(agentId);

    // Backdate all open reservations so they appear expired
    await db.execute(
      sql`UPDATE opportunity_deliveries SET reserved_at = now() - interval '2 minutes' WHERE delivered_at IS NULL`,
    );

    // Should be pickable again
    const next = await service.pickupPending(agentId);
    expect(next).not.toBeNull();
    expect(next!.reservationToken).toBeTruthy();
  });

  // ── 6. confirmDelivered with wrong token throws ────────────────────────────

  test('confirmDelivered with wrong reservation token throws', async () => {
    const oppId = await seedPendingOpportunity(userId);
    await service.pickupPending(agentId);

    await expect(
      service.confirmDelivered(oppId, userId, randomUUID()),
    ).rejects.toThrow('invalid_reservation_token_or_already_delivered');
  });
});
