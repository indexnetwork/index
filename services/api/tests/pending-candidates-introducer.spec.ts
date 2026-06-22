import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { agents, opportunityDeliveries, opportunities, users } from '../src/schemas/database.schema';
import { OpportunityDeliveryService } from '../src/services/opportunity-delivery.service';
import type { RenderedCard } from '../src/services/opportunity-delivery.service';

// ─────────────────────────────────────────────────────────────────────────────
// Stubs
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

async function seedAgent(userId: string): Promise<string> {
  const [agent] = await db
    .insert(agents)
    .values({ ownerId: userId, name: 'test-agent', type: 'personal' })
    .returning({ id: agents.id });
  return agent.id;
}

const NETWORK_ID = randomUUID();

function makeActors(
  introducerUserId: string,
  partyAUserId: string,
  partyBUserId: string,
) {
  return [
    { userId: introducerUserId, role: 'introducer', networkId: NETWORK_ID, approved: false },
    { userId: partyAUserId, role: 'patient', networkId: NETWORK_ID },
    { userId: partyBUserId, role: 'agent', networkId: NETWORK_ID },
  ];
}

async function seedOpportunity(
  actors: Array<Record<string, unknown>>,
  status: 'latent' | 'draft' | 'pending',
  detection?: Record<string, unknown>,
): Promise<string> {
  const [opp] = await db
    .insert(opportunities)
    .values({
      detection: (detection ?? { source: 'introducer_discovery', timestamp: new Date().toISOString() }) as never,
      actors: actors as never,
      interpretation: { reasoning: 'test reasoning', category: 'test', confidence: 80 } as never,
      context: {} as never,
      confidence: '0.8',
      status,
    })
    .returning({ id: opportunities.id });
  return opp.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchPendingCandidates — introducer opportunities', () => {
  const service = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  let introducerUserId: string;
  let partyAUserId: string;
  let partyBUserId: string;
  let agentId: string;

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);

    introducerUserId = await seedUser();
    partyAUserId = await seedUser();
    partyBUserId = await seedUser();
    agentId = await seedAgent(introducerUserId);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
  });

  // ── AC1: latent introducer opportunities are returned ─────────────────────

  test('returns latent introducer opportunities where viewer is the introducer with approved=false', async () => {
    const actors = makeActors(introducerUserId, partyAUserId, partyBUserId);
    const oppId = await seedOpportunity(actors, 'latent');

    const result = await service.fetchPendingCandidates(agentId);

    expect(result.opportunities.length).toBe(1);
    expect(result.opportunities[0].opportunityId).toBe(oppId);
  });

  // ── AC2: each item includes feedCategory ──────────────────────────────────

  test('each item includes feedCategory: connector-flow for introducer opportunities', async () => {
    const actors = makeActors(introducerUserId, partyAUserId, partyBUserId);
    await seedOpportunity(actors, 'latent');

    const result = await service.fetchPendingCandidates(agentId);

    expect(result.opportunities.length).toBe(1);
    expect(result.opportunities[0].feedCategory).toBe('connector-flow');
  });

  test('pending peer opportunity gets feedCategory: connection', async () => {
    const peerActors = [
      { userId: introducerUserId, role: 'peer', networkId: NETWORK_ID },
      { userId: partyAUserId, role: 'peer', networkId: NETWORK_ID },
    ];
    await seedOpportunity(peerActors, 'pending');

    const result = await service.fetchPendingCandidates(agentId);

    expect(result.opportunities.length).toBe(1);
    expect(result.opportunities[0].feedCategory).toBe('connection');
  });

  // ── AC3: response includes totalPending ───────────────────────────────────

  test('totalPending reflects all eligible opportunities before limit', async () => {
    // Create 5 latent introducer opportunities
    for (let i = 0; i < 5; i++) {
      const pA = await seedUser();
      const pB = await seedUser();
      await seedOpportunity(makeActors(introducerUserId, pA, pB), 'latent');
    }

    // Request only 2
    const result = await service.fetchPendingCandidates(agentId, 2);

    expect(result.opportunities.length).toBe(2);
    expect(result.totalPending).toBe(5);
  });

  // ── AC4: existing pending/draft opportunities continue to appear ──────────

  test('pending opportunities appear alongside latent (draft excluded by actionability gate)', async () => {
    // Pending peer opp — actionable
    const peerActors = [
      { userId: introducerUserId, role: 'peer', networkId: NETWORK_ID },
      { userId: partyAUserId, role: 'peer', networkId: NETWORK_ID },
    ];
    await seedOpportunity(peerActors, 'pending');

    // Draft opp created by someone else — isActionableForViewer returns false
    // for draft status, so it should NOT appear (mirrors feed graph behavior)
    const draftActors = [
      { userId: introducerUserId, role: 'patient', networkId: NETWORK_ID },
      { userId: partyBUserId, role: 'agent', networkId: NETWORK_ID },
    ];
    await seedOpportunity(draftActors, 'draft', {
      source: 'chat',
      createdBy: partyBUserId,
      timestamp: new Date().toISOString(),
    });

    // Latent introducer opp — actionable for introducer
    const introActors = makeActors(introducerUserId, partyAUserId, partyBUserId);
    await seedOpportunity(introActors, 'latent');

    const result = await service.fetchPendingCandidates(agentId);

    // Only pending + latent survive; draft is excluded by isActionableForViewer
    expect(result.opportunities.length).toBe(2);
    expect(result.totalPending).toBe(2);
  });

  // ── AC5: delivery dedup prevents re-delivery ──────────────────────────────

  test('already-delivered opportunities are filtered out', async () => {
    const actors = makeActors(introducerUserId, partyAUserId, partyBUserId);
    const oppId = await seedOpportunity(actors, 'latent');

    // Simulate a committed delivery
    await db.insert(opportunityDeliveries).values({
      opportunityId: oppId,
      userId: introducerUserId,
      agentId,
      channel: 'openclaw',
      trigger: 'ambient',
      deliveredAtStatus: 'latent',
      reservationToken: randomUUID(),
      reservedAt: new Date(),
      deliveredAt: new Date(),
    });

    const result = await service.fetchPendingCandidates(agentId);

    expect(result.opportunities.length).toBe(0);
    expect(result.totalPending).toBe(0);
  });

  // ── AC6: latent intros only surface for the introducer ────────────────────

  test('latent introducer opportunity does NOT surface for non-introducer actors', async () => {
    const actors = makeActors(introducerUserId, partyAUserId, partyBUserId);
    await seedOpportunity(actors, 'latent');

    // Create agent for partyA (patient) — should not see latent introducer opp
    const partyAAgentId = await seedAgent(partyAUserId);
    const result = await service.fetchPendingCandidates(partyAAgentId);

    expect(result.opportunities.length).toBe(0);
    expect(result.totalPending).toBe(0);
  });

  test('latent introducer opportunity does NOT surface when introducer has already approved', async () => {
    const actors = [
      { userId: introducerUserId, role: 'introducer', networkId: NETWORK_ID, approved: true },
      { userId: partyAUserId, role: 'patient', networkId: NETWORK_ID },
      { userId: partyBUserId, role: 'agent', networkId: NETWORK_ID },
    ];
    await seedOpportunity(actors, 'latent');

    const result = await service.fetchPendingCandidates(agentId);

    // isActionableForViewer: introducer only sees latent when approved === false
    expect(result.opportunities.length).toBe(0);
  });
});
