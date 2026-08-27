import { afterAll as bunAfterAll, afterEach as bunAfterEach, beforeEach as bunBeforeEach, describe, expect, it as bunIt } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm/sql';

import db from '../../lib/drizzle/drizzle';
import { agents, opportunities, opportunityDeliveries, users } from '../../schemas/database.schema';
import { OpportunityDeliveryService } from '../opportunity-delivery.service';
import type { RenderedCard } from '../opportunity-delivery.service';
import type { PresenterDatabase } from '@indexnetwork/protocol';
import { OpportunityPresenter } from '@indexnetwork/protocol';
import { withMinimumDatabaseHookBudget, withMinimumDatabaseTestBudget } from '../../lib/testing/database-test-budget';

const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 90_000);
const afterEach = withMinimumDatabaseHookBudget(bunAfterEach, 60_000);
const beforeEach = withMinimumDatabaseHookBudget(bunBeforeEach, 45_000);
const it = withMinimumDatabaseTestBudget(bunIt, 45_000);

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
  async presentCard(_input: any): Promise<typeof STUB_CARD & { mutualIntentsLabel: string }> {
    return { ...STUB_CARD, mutualIntentsLabel: 'Shared interests' };
  }
}

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

const fixtureUserIds = new Set<string>();
const fixtureAgentIds = new Set<string>();
const fixtureOpportunityIds = new Set<string>();

async function seedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `test-${randomUUID()}@example.com`, name: 'Test User' })
    .returning({ id: users.id });
  fixtureUserIds.add(user.id);
  return user.id;
}

async function seedAgent(userId: string, notifyOnOpportunity = true): Promise<string> {
  const [agent] = await db
    .insert(agents)
    .values({ ownerId: userId, name: 'test-agent', type: 'external', notifyOnOpportunity })
    .returning({ id: agents.id });
  fixtureAgentIds.add(agent.id);
  return agent.id;
}

async function seedOpportunity(
  actorUserIds: string[],
  status: 'pending' | 'draft',
  createdByUserId?: string | null,
): Promise<string> {
  const actors = actorUserIds.map((userId) => ({ userId, role: 'peer' }));
  const detection: Record<string, unknown> = { kind: 'test', summary: 'test summary' };
  if (status === 'draft' && createdByUserId !== undefined) {
    detection.createdBy = createdByUserId;
  }
  const [opp] = await db
    .insert(opportunities)
    .values({
      detection: detection as never,
      actors: actors as never,
      interpretation: { reasoning: 'test reasoning', category: 'test' } as never,
      context: {} as never,
      confidence: '0.9',
      status,
    })
    .returning({ id: opportunities.id });
  fixtureOpportunityIds.add(opp.id);
  return opp.id;
}

async function cleanupFixtures(): Promise<void> {
  const opportunityIds = [...fixtureOpportunityIds];
  const agentIds = [...fixtureAgentIds];
  const userIds = [...fixtureUserIds];

  if (opportunityIds.length > 0) {
    await db.delete(opportunityDeliveries).where(inArray(opportunityDeliveries.opportunityId, opportunityIds));
    await db.delete(opportunities).where(inArray(opportunities.id, opportunityIds));
  }
  if (agentIds.length > 0) await db.delete(agents).where(inArray(agents.id, agentIds));
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));

  fixtureOpportunityIds.clear();
  fixtureAgentIds.clear();
  fixtureUserIds.clear();
}

afterEach(cleanupFixtures);
afterAll(cleanupFixtures);

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('OpportunityDeliveryService.pickupPending', () => {
  const service = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  // ── 1. Pending opp with notify_on_opportunity = true ─────────────────────

  it('returns a pending opportunity when the agent owner is an actor and notify_on_opportunity is true', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId, true);
    const oppId = await seedOpportunity([userId], 'pending');

    const result = await service.pickupPending(agentId);

    expect(result).not.toBeNull();
    expect(result!.opportunityId).toBe(oppId);
  });

  // ── 2. notify_on_opportunity = false mutes all results ───────────────────

  it('returns null when the agent has notify_on_opportunity = false', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId, false);
    await seedOpportunity([userId], 'pending');

    const result = await service.pickupPending(agentId);

    expect(result).toBeNull();
  });

  // ── 3. Draft opp delivered to non-initiator actor ────────────────────────

  // ── 4. Draft opp NOT delivered to the initiator ─────────────────────────

  // ── 5. Draft opp with null detection.createdBy is excluded by the SQL guard ─

});

describe('fetchPendingCandidates', () => {
  let userId: string;
  let agentId: string;
  const svc = new OpportunityDeliveryService(
    new StubPresenter() as unknown as OpportunityPresenter,
    stubPresenterDb as unknown as PresenterDatabase,
  );

  beforeEach(async () => {
    userId = await seedUser();
    agentId = await seedAgent(userId);
  });

  it('returns empty array when no eligible opportunities exist', async () => {
    const results = await svc.fetchPendingCandidates(agentId);
    expect(results.opportunities).toEqual([]);
    expect(results.totalPending).toBe(0);
  });

  it('returns candidate with rendered card for eligible pending opportunity', async () => {
    const opportunityId = await seedOpportunity([userId], 'pending');
    const results = await svc.fetchPendingCandidates(agentId);
    expect(results.opportunities).toHaveLength(1);
    expect(results.opportunities[0].opportunityId).toBe(opportunityId);
    expect(results.opportunities[0].rendered.headline).toBeTruthy();
    expect(results.opportunities[0].counterpartUserId).toBeNull();
    expect(results.totalPending).toBe(1);
  });

  it('returns counterpartUserId when opportunity has two actors', async () => {
    const otherUserId = await seedUser();
    const opportunityId = await seedOpportunity([userId, otherUserId], 'pending');
    const results = await svc.fetchPendingCandidates(agentId);
    expect(results.opportunities).toHaveLength(1);
    expect(results.opportunities[0].opportunityId).toBe(opportunityId);
    expect(results.opportunities[0].counterpartUserId).toBe(otherUserId);
  });

  it('excludes opportunity already committed in delivery ledger', async () => {
    const opportunityId = await seedOpportunity([userId], 'pending');
    await svc.confirmOpportunityDelivery({ opportunityId, userId, agentId, trigger: 'ambient' });
    const results = await svc.fetchPendingCandidates(agentId);
    expect(results.opportunities).toEqual([]);
    expect(results.totalPending).toBe(0);
  });

  it('excludes opportunity when agent has notify_on_opportunity=false', async () => {
    await seedOpportunity([userId], 'pending');
    const mutedUserId = await seedUser();
    const mutedAgentId = await seedAgent(mutedUserId, false);
    // seed opportunity for muted user
    await seedOpportunity([mutedUserId], 'pending');
    const results = await svc.fetchPendingCandidates(mutedAgentId);
    expect(results.opportunities).toEqual([]);
    expect(results.totalPending).toBe(0);
  });

  it('respects an explicit limit lower than the default cap', async () => {
    for (let i = 0; i < 5; i++) {
      await seedOpportunity([userId], 'pending');
    }
    const results = await svc.fetchPendingCandidates(agentId, 3);
    expect(results.opportunities).toHaveLength(3);
    expect(results.totalPending).toBe(5);
  });

  it('clamps limit above 20 to the 20-row cap', async () => {
    for (let i = 0; i < 25; i++) {
      await seedOpportunity([userId], 'pending');
    }
    const results = await svc.fetchPendingCandidates(agentId, 50);
    expect(results.opportunities).toHaveLength(20);
    expect(results.totalPending).toBe(25);
  }, 15_000);

  it('clamps limit at or below 0 to 1', async () => {
    for (let i = 0; i < 5; i++) {
      await seedOpportunity([userId], 'pending');
    }
    const results = await svc.fetchPendingCandidates(agentId, 0);
    expect(results.opportunities).toHaveLength(1);
  });

  it('clamps negative limit to 1', async () => {
    for (let i = 0; i < 5; i++) {
      await seedOpportunity([userId], 'pending');
    }
    const results = await svc.fetchPendingCandidates(agentId, -3);
    expect(results.opportunities).toHaveLength(1);
  });

  it('truncates fractional limit (1.9 → 1)', async () => {
    for (let i = 0; i < 5; i++) {
      await seedOpportunity([userId], 'pending');
    }
    const results = await svc.fetchPendingCandidates(agentId, 1.9);
    expect(results.opportunities).toHaveLength(1);
  });

  it('falls back to 20 when limit is non-finite (NaN)', async () => {
    for (let i = 0; i < 25; i++) {
      await seedOpportunity([userId], 'pending');
    }
    const results = await svc.fetchPendingCandidates(agentId, Number.NaN);
    expect(results.opportunities).toHaveLength(20);
    expect(results.totalPending).toBe(25);
  }, 15_000);

  it('uses 20 as default when limit is omitted', async () => {
    for (let i = 0; i < 25; i++) {
      await seedOpportunity([userId], 'pending');
    }
    const results = await svc.fetchPendingCandidates(agentId);
    expect(results.opportunities).toHaveLength(20);
    expect(results.totalPending).toBe(25);
  }, 15_000);
});

describe('confirmOpportunityDelivery', () => {
  let userId: string;
  let agentId: string;
  let opportunityId: string;
  const svc = new OpportunityDeliveryService(
    new StubPresenter() as unknown as OpportunityPresenter,
    stubPresenterDb as unknown as PresenterDatabase,
  );

  beforeEach(async () => {
    userId = await seedUser();
    agentId = await seedAgent(userId);
    opportunityId = await seedOpportunity([userId], 'pending');
  });

  it('returns confirmed and inserts delivery row on first call', async () => {
    const result = await svc.confirmOpportunityDelivery({ opportunityId, userId, agentId, trigger: 'ambient' });
    expect(result).toBe('confirmed');

    const rows = await db
      .select()
      .from(opportunityDeliveries)
      .where(eq(opportunityDeliveries.opportunityId, opportunityId));
    expect(rows).toHaveLength(1);
    expect(rows[0].deliveredAt).not.toBeNull();
    expect(rows[0].channel).toBe('openclaw');
  });

  it('returns already_delivered on second call', async () => {
    await svc.confirmOpportunityDelivery({ opportunityId, userId, agentId, trigger: 'ambient' });
    const result = await svc.confirmOpportunityDelivery({ opportunityId, userId, agentId, trigger: 'ambient' });
    expect(result).toBe('already_delivered');
  });

  it('throws not_authorized when user is not an actor', async () => {
    const otherId = await seedUser();
    await expect(svc.confirmOpportunityDelivery({ opportunityId, userId: otherId, agentId, trigger: 'ambient' })).rejects.toThrow('not_authorized');
  });

  it('writes the supplied trigger value to the ledger', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opportunityId = await seedOpportunity([userId], 'pending');

    const result = await svc.confirmOpportunityDelivery({ opportunityId, userId, agentId, trigger: 'ambient' });
    expect(result).toBe('confirmed');

    const [row] = await db
      .select({ trigger: opportunityDeliveries.trigger })
      .from(opportunityDeliveries)
      .where(eq(opportunityDeliveries.opportunityId, opportunityId));
    expect(row.trigger).toBe('ambient');
  });
});

describe('countDeliveriesSince', () => {
  const svc = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  it('counts deliveries grouped by trigger since the cutoff', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp1 = await seedOpportunity([userId], 'pending');
    const opp2 = await seedOpportunity([userId], 'pending');
    const opp3 = await seedOpportunity([userId], 'pending');

    await svc.confirmOpportunityDelivery({ opportunityId: opp1, userId, agentId, trigger: 'ambient' });
    await svc.confirmOpportunityDelivery({ opportunityId: opp2, userId, agentId, trigger: 'ambient' });
    await svc.confirmOpportunityDelivery({ opportunityId: opp3, userId, agentId, trigger: 'digest' });

    const result = await svc.countDeliveriesSince(agentId, new Date(Date.now() - 60_000));
    expect(result).toEqual({ ambient: 2, digest: 1 });
  });

  it('returns zero counts when nothing matches', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const result = await svc.countDeliveriesSince(agentId, new Date());
    expect(result).toEqual({ ambient: 0, digest: 0 });
  });

  it('excludes rows older than the cutoff', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp = await seedOpportunity([userId], 'pending');
    await svc.confirmOpportunityDelivery({ opportunityId: opp, userId, agentId, trigger: 'ambient' });

    const future = new Date(Date.now() + 60_000);
    const result = await svc.countDeliveriesSince(agentId, future);
    expect(result).toEqual({ ambient: 0, digest: 0 });
  });

  it('excludes rows where delivered_at is null (uncommitted reservations)', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp = await seedOpportunity([userId], 'pending');
    // Insert a reservation row directly (no delivered_at)
    await db.insert(opportunityDeliveries).values({
      opportunityId: opp,
      userId,
      agentId,
      channel: 'openclaw',
      trigger: 'ambient',
      deliveredAtStatus: 'pending',
      reservationToken: randomUUID(),
      reservedAt: new Date(),
    });

    const result = await svc.countDeliveriesSince(agentId, new Date(Date.now() - 60_000));
    expect(result).toEqual({ ambient: 0, digest: 0 });
  });
});

describe('getDeliveredOpportunities', () => {
  const svc = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  it('returns [] for an empty id list without querying', async () => {
    const userId = await seedUser();
    const rows = await svc.getDeliveredOpportunities({ userId, opportunityIds: [] });
    expect(rows).toEqual([]);
  });

  it('returns committed delivery rows with status and timestamp', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp = await seedOpportunity([userId], 'pending');

    await svc.confirmOpportunityDelivery({ opportunityId: opp, userId, agentId, trigger: 'digest' });

    const rows = await svc.getDeliveredOpportunities({ userId, opportunityIds: [opp] });
    expect(rows).toHaveLength(1);
    expect(rows[0].opportunityId).toBe(opp);
    expect(rows[0].deliveredAtStatus).toBe('pending');
    expect(rows[0].deliveredAt).toBeInstanceOf(Date);
  });

  it('only returns rows for the requested ids', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const oppA = await seedOpportunity([userId], 'pending');
    const oppB = await seedOpportunity([userId], 'pending');

    await svc.confirmOpportunityDelivery({ opportunityId: oppA, userId, agentId, trigger: 'digest' });
    await svc.confirmOpportunityDelivery({ opportunityId: oppB, userId, agentId, trigger: 'digest' });

    const rows = await svc.getDeliveredOpportunities({ userId, opportunityIds: [oppA] });
    expect(rows).toHaveLength(1);
    expect(rows[0].opportunityId).toBe(oppA);
  });

  it('does not return rows delivered to a different user', async () => {
    const userId = await seedUser();
    const otherId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp = await seedOpportunity([userId, otherId], 'pending');

    await svc.confirmOpportunityDelivery({ opportunityId: opp, userId, agentId, trigger: 'digest' });

    const rows = await svc.getDeliveredOpportunities({ userId: otherId, opportunityIds: [opp] });
    expect(rows).toEqual([]);
  });

  it('excludes uncommitted reservation rows (delivered_at IS NULL)', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp = await seedOpportunity([userId], 'pending');

    await db.insert(opportunityDeliveries).values({
      opportunityId: opp,
      userId,
      agentId,
      channel: 'openclaw',
      trigger: 'pending_pickup',
      deliveredAtStatus: 'pending',
      reservationToken: randomUUID(),
      reservedAt: new Date(),
    });

    const rows = await svc.getDeliveredOpportunities({ userId, opportunityIds: [opp] });
    expect(rows).toEqual([]);
  });

  it('returns one row per deliveredAtStatus for the same opportunity', async () => {
    const userId = await seedUser();
    const agentId = await seedAgent(userId);
    const opp = await seedOpportunity([userId], 'pending');

    // Delivered at pending, then the opportunity advanced and was delivered at accepted.
    await svc.confirmOpportunityDelivery({ opportunityId: opp, userId, agentId, trigger: 'digest' });
    await db.update(opportunities).set({ status: 'accepted' }).where(eq(opportunities.id, opp));
    await svc.confirmOpportunityDelivery({ opportunityId: opp, userId, agentId, trigger: 'accepted' });

    const rows = await svc.getDeliveredOpportunities({ userId, opportunityIds: [opp] });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.deliveredAtStatus))).toEqual(new Set(['pending', 'accepted']));
  });
});
