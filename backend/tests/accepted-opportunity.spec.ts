import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { conversations } from '../src/schemas/conversation.schema';
import { agents, opportunities, opportunityDeliveries, userSocials, users } from '../src/schemas/database.schema';
import { OpportunityDeliveryService } from '../src/services/opportunity-delivery.service';
import type { AcceptedCandidate, RenderedCard } from '../src/services/opportunity-delivery.service';

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

const FRONTEND_URL = 'https://test.index.network';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function seedUser(name = 'Test User'): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `test-${randomUUID()}@example.com`, name })
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

async function seedAcceptedOpportunity(
  actorUserIds: Array<{ userId: string; role: string }>,
  acceptedBy: string,
): Promise<string> {
  const [opp] = await db
    .insert(opportunities)
    .values({
      detection: { kind: 'test', summary: 'test summary' } as never,
      actors: actorUserIds as never,
      interpretation: { reasoning: 'test reasoning', category: 'test' } as never,
      context: {} as never,
      confidence: '0.9',
      status: 'accepted',
      acceptedBy,
    })
    .returning({ id: opportunities.id });
  return opp.id;
}

async function seedTelegramHandle(userId: string, handle: string): Promise<void> {
  await db.insert(userSocials).values({
    userId,
    label: 'telegram',
    value: handle,
  });
}

async function seedConversation(userA: string, userB: string): Promise<string> {
  const dmPair = [userA, userB].sort().join(':');
  const [conv] = await db
    .insert(conversations)
    .values({ dmPair })
    .returning({ id: conversations.id });
  return conv.id;
}

async function softDeleteUser(userId: string): Promise<void> {
  await db.execute(sql`UPDATE users SET deleted_at = now() WHERE id = ${userId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchAcceptedCandidates', () => {
  const service = new OpportunityDeliveryService(
    new StubPresenter() as never,
    stubPresenterDb as never,
  );

  let userB: string; // counterparty (receives notification)
  let userA: string; // accepter
  let agentB: string;

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
    await db.execute(sql`DELETE FROM user_socials`);
    await db.execute(sql`DELETE FROM conversation_participants`);
    await db.execute(sql`DELETE FROM conversations`);

    userB = await seedUser('User B');
    userA = await seedUser('User A');
    agentB = await seedAgent(userB);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM opportunity_deliveries`);
    await db.execute(sql`DELETE FROM opportunities`);
    await db.execute(sql`DELETE FROM user_socials`);
    await db.execute(sql`DELETE FROM conversation_participants`);
    await db.execute(sql`DELETE FROM conversations`);
  });

  test('returns empty when no accepted opportunities exist', async () => {
    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);
    expect(result).toEqual([]);
  });

  test('returns accepted opportunity with accepter name and conversation URL', async () => {
    const convId = await seedConversation(userA, userB);
    const oppId = await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userA,
    );

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);

    expect(result).toHaveLength(1);
    expect(result[0].opportunityId).toBe(oppId);
    expect(result[0].accepterUserId).toBe(userA);
    expect(result[0].accepterName).toBe('User A');
    expect(result[0].conversationUrl).toBe(`${FRONTEND_URL}/conversations/${convId}`);
    expect(result[0].telegramHandle).toBeNull();
    expect(result[0].rendered.headline).toBe('H');
    expect(result[0].rendered.personalizedSummary).toBe('S');
  });

  test('includes telegram handle when accepter has one', async () => {
    await seedTelegramHandle(userA, 'alice_tg');
    await seedConversation(userA, userB);
    await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userA,
    );

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);

    expect(result).toHaveLength(1);
    expect(result[0].telegramHandle).toBe('alice_tg');
  });

  test('falls back to frontend URL when no DM exists', async () => {
    await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userA,
    );

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);

    expect(result).toHaveLength(1);
    expect(result[0].conversationUrl).toBe(FRONTEND_URL);
  });

  test('excludes opportunities where the polling user is the accepter', async () => {
    await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userB, // userB accepted — so userB should NOT see this
    );

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);
    expect(result).toEqual([]);
  });

  test('excludes opportunities where the polling user is the introducer', async () => {
    const userC = await seedUser('User C');
    await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userC, role: 'peer' }, { userId: userB, role: 'introducer' }],
      userA,
    );

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);
    expect(result).toEqual([]);
  });

  test('deduplicates via committed delivery record with deliveredAtStatus=accepted', async () => {
    await seedConversation(userA, userB);
    const oppId = await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userA,
    );

    // First poll returns the opportunity
    const first = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);
    expect(first).toHaveLength(1);

    // Commit delivery with 'accepted' trigger
    await service.confirmOpportunityDelivery({ opportunityId: oppId, userId: userB, agentId: agentB, trigger: 'accepted' });

    // Second poll should be empty
    const second = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);
    expect(second).toEqual([]);
  }, 15_000);

  test('prior pending-status delivery does not block accepted-status delivery', async () => {
    await seedConversation(userA, userB);
    // Create opportunity as pending first, deliver it, then flip to accepted
    const [opp] = await db
      .insert(opportunities)
      .values({
        detection: { kind: 'test', summary: 'test summary' } as never,
        actors: [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }] as never,
        interpretation: { reasoning: 'test reasoning', category: 'test' } as never,
        context: {} as never,
        confidence: '0.9',
        status: 'pending',
      })
      .returning({ id: opportunities.id });

    // Commit ambient delivery while status is pending → deliveredAtStatus='pending'
    await service.confirmOpportunityDelivery({ opportunityId: opp.id, userId: userB, agentId: agentB, trigger: 'ambient' });

    // Now flip to accepted
    await db.execute(
      sql`UPDATE opportunities SET status = 'accepted', accepted_by = ${userA} WHERE id = ${opp.id}`,
    );

    // Accepted poll should return it since prior delivery was at 'pending' status
    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);
    expect(result).toHaveLength(1);
  });

  test('returns opportunity with empty accepterName when accepter is soft-deleted', async () => {
    await seedConversation(userA, userB);
    await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userA,
    );

    await softDeleteUser(userA);

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);

    // Opportunity still returned but with empty name (user row filtered out)
    expect(result).toHaveLength(1);
    expect(result[0].accepterName).toBe('');
    expect(result[0].telegramHandle).toBeNull();
  });

  test('respects limit parameter', async () => {
    await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userA,
    );
    const userC = await seedUser('User C');
    await seedAcceptedOpportunity(
      [{ userId: userC, role: 'peer' }, { userId: userB, role: 'peer' }],
      userC,
    );

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL, 1);
    expect(result).toHaveLength(1);
  });

  test('respects notify_on_opportunity=false (muted agent)', async () => {
    await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userA,
    );

    // Mute the agent
    await db.execute(sql`UPDATE agents SET notify_on_opportunity = false WHERE id = ${agentB}`);

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL);
    expect(result).toEqual([]);
  });

  test('clamps limit to [1, 20] range', async () => {
    // limit=0 should be clamped to 1
    await seedAcceptedOpportunity(
      [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }],
      userA,
    );

    const result = await service.fetchAcceptedCandidates(agentB, FRONTEND_URL, 0);
    expect(result).toHaveLength(1);
  });
});
