import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { OpportunityDatabaseAdapter } from '../opportunity.database.adapter';
import { conversations, networkMembers, networks, opportunities, tasks, users } from '../../schemas/database.schema';

const adapter = new OpportunityDatabaseAdapter();
const createdOpportunityIds: string[] = [];
const createdConversationIds: string[] = [];
const createdNetworkIds: string[] = [];
const createdUserIds: string[] = [];

async function createNegotiatingOpportunity() {
  const opportunity = await adapter.createOpportunity({
    detection: {
      source: 'opportunity_graph',
      timestamp: new Date().toISOString(),
    },
    actors: [
      { userId: crypto.randomUUID(), networkId: crypto.randomUUID(), role: 'patient' },
      { userId: crypto.randomUUID(), networkId: crypto.randomUUID(), role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'Compensation integration fixture',
      confidence: 0.8,
      signals: [],
    },
    context: {},
    confidence: '0.8',
    status: 'negotiating',
  });
  createdOpportunityIds.push(opportunity.id);
  return opportunity;
}

async function createNetworkEligibleNegotiatingOpportunity() {
  const ownerUserId = crypto.randomUUID();
  const candidateUserId = crypto.randomUUID();
  const networkId = crypto.randomUUID();
  createdUserIds.push(ownerUserId, candidateUserId);
  createdNetworkIds.push(networkId);
  await db.insert(users).values([
    { id: ownerUserId, email: `${ownerUserId}@test.local`, name: 'Compensation owner' },
    { id: candidateUserId, email: `${candidateUserId}@test.local`, name: 'Compensation candidate' },
  ]);
  await db.insert(networks).values({ id: networkId, title: 'Compensation network' });
  await db.insert(networkMembers).values([
    { networkId, userId: ownerUserId, permissions: ['owner'] },
    { networkId, userId: candidateUserId, permissions: ['member'] },
  ]);
  const opportunity = await adapter.createOpportunity({
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString() },
    actors: [
      { userId: ownerUserId, networkId, role: 'patient' },
      { userId: candidateUserId, networkId, role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'Network-eligible compensation fixture',
      confidence: 0.8,
      signals: [],
    },
    context: { networkId },
    confidence: '0.8',
    status: 'negotiating',
  });
  createdOpportunityIds.push(opportunity.id);
  return { opportunity, ownerUserId, networkId };
}

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
  }
  if (createdOpportunityIds.length > 0) {
    await db.delete(opportunities).where(inArray(opportunities.id, createdOpportunityIds));
  }
  if (createdNetworkIds.length > 0) {
    await db.delete(networkMembers).where(inArray(networkMembers.networkId, createdNetworkIds));
    await db.delete(networks).where(inArray(networks.id, createdNetworkIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe('OpportunityDatabaseAdapter.compensateTasklessNegotiatingOpportunity', () => {
  test('restores the exact taskless negotiating version to draft', async () => {
    const opportunity = await createNegotiatingOpportunity();

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );

    const [raw] = await db
      .select({ acceptedBy: opportunities.acceptedBy })
      .from(opportunities)
      .where(eq(opportunities.id, opportunity.id));

    expect(compensated).not.toBeNull();
    expect(compensated?.status).toBe('draft');
    expect(raw.acceptedBy).toBeNull();
  });

  test('returns null and preserves a newer status/version', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const newerUpdatedAt = new Date(opportunity.updatedAt.getTime() + 1_000);
    await db
      .update(opportunities)
      .set({ status: 'pending', updatedAt: newerUpdatedAt })
      .where(eq(opportunities.id, opportunity.id));

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(compensated).toBeNull();
    expect(preserved?.status).toBe('pending');
    expect(preserved?.updatedAt.getTime()).toBe(newerUpdatedAt.getTime());
  });

  test('network-eligible reactivation does not overwrite concurrent status drift', async () => {
    const { opportunity, ownerUserId, networkId } = await createNetworkEligibleNegotiatingOpportunity();
    await adapter.updateOpportunityStatus(opportunity.id, 'rejected');

    const reactivated = await adapter.updateOpportunityStatusIfNetworkEligible(
      opportunity.id,
      'negotiating',
      opportunity.actors,
      { ownerUserId, allowedNetworkIds: [networkId] },
      'negotiating',
    );
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(reactivated).toBeNull();
    expect(preserved?.status).toBe('rejected');
  });

  test('returns null when an active negotiation task predates the attempt boundary', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const [conversation] = await db.insert(conversations).values({}).returning();
    createdConversationIds.push(conversation.id);
    await db.insert(tasks).values({
      conversationId: conversation.id,
      state: 'input_required',
      metadata: { type: 'negotiation', opportunityId: opportunity.id },
      createdAt: new Date(opportunity.updatedAt.getTime() - 1_000),
    });

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(compensated).toBeNull();
    expect(preserved?.status).toBe('negotiating');
  });

  test('allows compensation when the only working task is stale', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const [conversation] = await db.insert(conversations).values({}).returning();
    createdConversationIds.push(conversation.id);
    const staleAt = new Date(opportunity.updatedAt.getTime() - 10 * 60 * 1000);
    await db.insert(tasks).values({
      conversationId: conversation.id,
      state: 'working',
      metadata: { type: 'negotiation', opportunityId: opportunity.id },
      createdAt: staleAt,
      updatedAt: staleAt,
    });

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );

    expect(compensated?.status).toBe('draft');
  });

  test('returns null when a negotiation task was created after the attempt boundary', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const [conversation] = await db.insert(conversations).values({}).returning();
    createdConversationIds.push(conversation.id);
    await db.insert(tasks).values({
      conversationId: conversation.id,
      metadata: { type: 'negotiation', opportunityId: opportunity.id },
      createdAt: new Date(opportunity.updatedAt.getTime() + 1_000),
    });

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(compensated).toBeNull();
    expect(preserved?.status).toBe('negotiating');
  });
});
