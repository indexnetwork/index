import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { agents, opportunities, opportunityDeliveries, users } from '../../schemas/database.schema';
import { OpportunityDeliveryService } from '../opportunity-delivery.service';
import type { RenderedCard } from '../opportunity-delivery.service';
import type { PresenterDatabase } from '@indexnetwork/protocol';
import { OpportunityPresenter } from '@indexnetwork/protocol';

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

async function seedAgent(userId: string, notifyOnOpportunity = true): Promise<string> {
  const [agent] = await db
    .insert(agents)
    .values({ ownerId: userId, name: 'test-agent', type: 'personal', notifyOnOpportunity })
    .returning({ id: agents.id });
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
  return opp.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('OpportunityDeliveryService.pickupPending', () => {
  const service = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  beforeEach(async () => {
    // Full wipe: order matters (FK constraints)
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
  });

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

  it('returns a draft opportunity to an actor who is NOT the initiator', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const agentB = await seedAgent(userB, true);
    // userA is the initiator; userB is also an actor
    const oppId = await seedOpportunity([userA, userB], 'draft', userA);

    const result = await service.pickupPending(agentB);

    expect(result).not.toBeNull();
    expect(result!.opportunityId).toBe(oppId);
  });

  // ── 4. Draft opp NOT delivered to the initiator ─────────────────────────

  it('does NOT return a draft opportunity to the initiator', async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const agentA = await seedAgent(userA, true);
    // userA is the initiator
    await seedOpportunity([userA, userB], 'draft', userA);

    const result = await service.pickupPending(agentA);

    expect(result).toBeNull();
  });

  // ── 5. Draft opp with null detection.createdBy is excluded by the SQL guard ─

  it('does not return a draft opp whose detection.createdBy is null, and does not throw', async () => {
    const userA = await seedUser();
    const agentA = await seedAgent(userA, true);
    // seed a draft opp with createdBy absent from detection
    const [opp] = await db
      .insert(opportunities)
      .values({
        detection: { kind: 'test', summary: 'no creator' } as never,
        actors: [{ userId: userA, role: 'peer' }] as never,
        interpretation: { reasoning: 'test', category: 'test' } as never,
        context: {} as never,
        confidence: '0.9',
        status: 'draft',
      })
      .returning({ id: opportunities.id });
    expect(opp.id).toBeTruthy();

    const result = await service.pickupPending(agentA);
    expect(result).toBeNull();
  });
});

describe('fetchPendingCandidates', () => {
  let userId: string;
  let agentId: string;
  const svc = new OpportunityDeliveryService(
    new StubPresenter() as unknown as OpportunityPresenter,
    stubPresenterDb as unknown as PresenterDatabase,
  );

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
    userId = await seedUser();
    agentId = await seedAgent(userId);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
  });

  it('returns empty array when no eligible opportunities exist', async () => {
    const results = await svc.fetchPendingCandidates(agentId);
    expect(results).toEqual([]);
  });

  it('returns candidate with rendered card for eligible pending opportunity', async () => {
    const opportunityId = await seedOpportunity([userId], 'pending');
    const results = await svc.fetchPendingCandidates(agentId);
    expect(results).toHaveLength(1);
    expect(results[0].opportunityId).toBe(opportunityId);
    expect(results[0].rendered.headline).toBeTruthy();
  });

  it('excludes opportunity already committed in delivery ledger', async () => {
    const opportunityId = await seedOpportunity([userId], 'pending');
    await svc.commitDelivery(opportunityId, userId, agentId);
    const results = await svc.fetchPendingCandidates(agentId);
    expect(results).toEqual([]);
  });

  it('excludes opportunity when agent has notify_on_opportunity=false', async () => {
    await seedOpportunity([userId], 'pending');
    const mutedUserId = await seedUser();
    const mutedAgentId = await seedAgent(mutedUserId, false);
    // seed opportunity for muted user
    await seedOpportunity([mutedUserId], 'pending');
    const results = await svc.fetchPendingCandidates(mutedAgentId);
    expect(results).toEqual([]);
  });
});

describe('commitDelivery', () => {
  let userId: string;
  let agentId: string;
  let opportunityId: string;
  const svc = new OpportunityDeliveryService(
    new StubPresenter() as unknown as OpportunityPresenter,
    stubPresenterDb as unknown as PresenterDatabase,
  );

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
    userId = await seedUser();
    agentId = await seedAgent(userId);
    opportunityId = await seedOpportunity([userId], 'pending');
  });

  it('returns confirmed and inserts delivery row on first call', async () => {
    const result = await svc.commitDelivery(opportunityId, userId, agentId);
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
    await svc.commitDelivery(opportunityId, userId, agentId);
    const result = await svc.commitDelivery(opportunityId, userId, agentId);
    expect(result).toBe('already_delivered');
  });

  it('throws not_authorized when user is not an actor', async () => {
    const otherId = await seedUser();
    await expect(svc.commitDelivery(opportunityId, otherId, agentId)).rejects.toThrow('not_authorized');
  });
});
