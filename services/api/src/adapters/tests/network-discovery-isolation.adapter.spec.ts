import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { inArray } from 'drizzle-orm/sql';
import { v4 as uuidv4 } from 'uuid';

import db from '../../lib/drizzle/drizzle';
import { intentNetworks, intents, networkMembers, networks, opportunities, premiseNetworks, premises, userContexts, users } from '../../schemas/database.schema';
import { ChatDatabaseAdapter, OpportunityDatabaseAdapter } from '../database.adapter';
import { EmbedderAdapter } from '../embedder.adapter';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';

const TEST_PREFIX = `network_isolation_${Date.now()}_`;

function makeVector(seed: number): number[] {
  const values = Array.from({ length: 2000 }, (_, index) => Math.sin(seed + index) * 0.05);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}

const ids = {
  viewer: uuidv4(),
  activeCandidate: uuidv4(),
  removedCandidate: uuidv4(),
  deletedNetworkCandidate: uuidv4(),
  activeNetwork: uuidv4(),
  deletedNetwork: uuidv4(),
  selectedIntent: uuidv4(),
  otherViewerIntent: uuidv4(),
  activeIntent: uuidv4(),
  removedIntent: uuidv4(),
  deletedNetworkIntent: uuidv4(),
  activePremise: uuidv4(),
  removedPremise: uuidv4(),
  deletedNetworkPremise: uuidv4(),
  activeNet1Context: uuidv4(),
  activeGlobalContext: uuidv4(),
};

const vector = makeVector(17);
const createdOpportunityIds: string[] = [];
const provenance = {
  source: 'explicit' as const,
  confidence: 1,
  timestamp: new Date().toISOString(),
};
const validity = { volatile: false };

beforeAll(async () => {
  await db.insert(users).values([
    { id: ids.viewer, email: `${TEST_PREFIX}viewer@test.com`, name: 'Viewer' },
    { id: ids.activeCandidate, email: `${TEST_PREFIX}active@test.com`, name: 'Active candidate' },
    { id: ids.removedCandidate, email: `${TEST_PREFIX}removed@test.com`, name: 'Removed candidate' },
    { id: ids.deletedNetworkCandidate, email: `${TEST_PREFIX}deleted-network@test.com`, name: 'Deleted network candidate' },
  ]);
  await db.insert(networks).values([
    { id: ids.activeNetwork, title: `${TEST_PREFIX}active` },
    { id: ids.deletedNetwork, title: `${TEST_PREFIX}deleted`, deletedAt: new Date() },
  ]);
  await db.insert(networkMembers).values([
    { networkId: ids.activeNetwork, userId: ids.viewer, permissions: ['owner'] },
    // Contact is intentionally valid: discovery eligibility is permission-agnostic.
    { networkId: ids.activeNetwork, userId: ids.activeCandidate, permissions: ['contact'] },
    { networkId: ids.activeNetwork, userId: ids.removedCandidate, permissions: ['member'], deletedAt: new Date() },
    { networkId: ids.deletedNetwork, userId: ids.deletedNetworkCandidate, permissions: ['member'] },
  ]);
  await db.insert(intents).values([
    {
      id: ids.selectedIntent,
      userId: ids.viewer,
      payload: 'Paused selected intent',
      status: 'PAUSED',
      embedding: vector,
    },
    {
      id: ids.otherViewerIntent,
      userId: ids.viewer,
      payload: 'Another viewer intent',
      embedding: vector,
    },
    { id: ids.activeIntent, userId: ids.activeCandidate, payload: 'Active candidate intent', embedding: vector },
    { id: ids.removedIntent, userId: ids.removedCandidate, payload: 'Removed candidate intent', embedding: vector },
    { id: ids.deletedNetworkIntent, userId: ids.deletedNetworkCandidate, payload: 'Deleted network intent', embedding: vector },
  ]);
  await db.insert(intentNetworks).values([
    { intentId: ids.selectedIntent, networkId: ids.activeNetwork },
    { intentId: ids.otherViewerIntent, networkId: ids.activeNetwork },
    { intentId: ids.activeIntent, networkId: ids.activeNetwork },
    { intentId: ids.removedIntent, networkId: ids.activeNetwork },
    { intentId: ids.deletedNetworkIntent, networkId: ids.deletedNetwork },
  ]);
  await db.insert(premises).values([
    {
      id: ids.activePremise,
      userId: ids.activeCandidate,
      assertion: { text: 'Active premise', tier: 'assertive' },
      provenance,
      validity,
      status: 'ACTIVE',
      embedding: vector,
    },
    {
      id: ids.removedPremise,
      userId: ids.removedCandidate,
      assertion: { text: 'Removed premise', tier: 'assertive' },
      provenance,
      validity,
      status: 'ACTIVE',
      embedding: vector,
    },
    {
      id: ids.deletedNetworkPremise,
      userId: ids.deletedNetworkCandidate,
      assertion: { text: 'Deleted network premise', tier: 'assertive' },
      provenance,
      validity,
      status: 'ACTIVE',
      embedding: vector,
    },
  ]);
  await db.insert(premiseNetworks).values([
    { premiseId: ids.activePremise, networkId: ids.activeNetwork, relevancyScore: '1' },
    { premiseId: ids.removedPremise, networkId: ids.activeNetwork, relevancyScore: '1' },
    { premiseId: ids.deletedNetworkPremise, networkId: ids.deletedNetwork, relevancyScore: '1' },
  ]);
  await db.insert(userContexts).values([
    {
      id: ids.activeNet1Context,
      userId: ids.activeCandidate,
      networkId: ids.activeNetwork,
      text: 'B is a researcher in net1',
      embedding: vector,
      premiseHash: 'net1-hash',
      generatedAt: new Date(),
    },
    {
      id: ids.activeGlobalContext,
      userId: ids.activeCandidate,
      networkId: null,
      text: 'B is a researcher globally',
      embedding: vector,
      premiseHash: 'global-hash',
      generatedAt: new Date(),
    },
  ]);
}, 30_000);

afterAll(async () => {
  if (createdOpportunityIds.length > 0) {
    await db.delete(opportunities).where(inArray(opportunities.id, createdOpportunityIds));
  }
  await db.delete(premiseNetworks).where(inArray(premiseNetworks.premiseId, [
    ids.activePremise,
    ids.removedPremise,
    ids.deletedNetworkPremise,
  ]));
  await db.delete(premises).where(inArray(premises.id, [
    ids.activePremise,
    ids.removedPremise,
    ids.deletedNetworkPremise,
  ]));
  await db.delete(userContexts).where(inArray(userContexts.id, [
    ids.activeNet1Context,
    ids.activeGlobalContext,
  ]));
  await db.delete(intentNetworks).where(inArray(intentNetworks.intentId, [
    ids.selectedIntent,
    ids.otherViewerIntent,
    ids.activeIntent,
    ids.removedIntent,
    ids.deletedNetworkIntent,
  ]));
  await db.delete(intents).where(inArray(intents.id, [
    ids.selectedIntent,
    ids.otherViewerIntent,
    ids.activeIntent,
    ids.removedIntent,
    ids.deletedNetworkIntent,
  ]));
  await db.delete(networkMembers).where(inArray(networkMembers.networkId, [ids.activeNetwork, ids.deletedNetwork]));
  await db.delete(networks).where(inArray(networks.id, [ids.activeNetwork, ids.deletedNetwork]));
  await db.delete(users).where(inArray(users.id, [
    ids.viewer,
    ids.activeCandidate,
    ids.removedCandidate,
    ids.deletedNetworkCandidate,
  ]));
}, 30_000);

describe('network discovery adapter isolation', () => {
  const chat = new ChatDatabaseAdapter();
  const opportunity = new OpportunityDatabaseAdapter();
  const embedder = new EmbedderAdapter();

  it('returns permission-agnostic active memberships and exact active pairs only', async () => {
    const activeMembership = await chat.getNetworkMembership(ids.activeNetwork, ids.activeCandidate);
    expect(activeMembership?.permissions).toContain('contact');
    expect(await chat.getNetworkMembership(ids.activeNetwork, ids.removedCandidate)).toBeNull();
    expect(await chat.getNetworkMembership(ids.deletedNetwork, ids.deletedNetworkCandidate)).toBeNull();
    expect(await chat.getNetworkMemberships(ids.removedCandidate)).toEqual([]);

    const pairs = await chat.getActiveNetworkMembershipPairs([
      { userId: ids.activeCandidate, networkId: ids.activeNetwork },
      { userId: ids.activeCandidate, networkId: ids.activeNetwork },
      { userId: ids.removedCandidate, networkId: ids.activeNetwork },
      { userId: ids.deletedNetworkCandidate, networkId: ids.deletedNetwork },
    ]);
    expect(pairs).toEqual([{ userId: ids.activeCandidate, networkId: ids.activeNetwork }]);
  });

  it('atomically rejects create and reactivation when participant anchors are inactive', async () => {
    const makeInput = (candidateUserId: string, suffix: string) => ({
      detection: {
        source: 'opportunity_graph' as const,
        createdBy: 'agent-opportunity-finder',
        timestamp: new Date().toISOString(),
      },
      actors: [
        { userId: ids.viewer, networkId: ids.activeNetwork, role: 'peer' as const },
        { userId: candidateUserId, networkId: ids.activeNetwork, role: 'peer' as const },
      ],
      interpretation: {
        category: 'collaboration' as const,
        reasoning: `${TEST_PREFIX}${suffix}`,
        confidence: 0.9,
        signals: [],
      },
      context: { networkId: ids.activeNetwork },
      confidence: '0.9',
      status: 'pending' as const,
    });

    const eligibility = {
      ownerUserId: ids.viewer,
      allowedNetworkIds: [ids.activeNetwork],
      triggerIntentId: ids.otherViewerIntent,
    };
    const eligible = await opportunity.createOpportunityIfNetworkEligible(
      makeInput(ids.activeCandidate, 'atomic-eligible'),
      eligibility,
    );
    expect(eligible).not.toBeNull();
    if (eligible) createdOpportunityIds.push(eligible.id);

    const denied = await opportunity.createOpportunityIfNetworkEligible(
      makeInput(ids.removedCandidate, 'atomic-denied'),
      eligibility,
    );
    expect(denied).toBeNull();
    const deniedByScope = await opportunity.createOpportunityIfNetworkEligible(
      makeInput(ids.activeCandidate, 'atomic-foreign-scope'),
      { ...eligibility, allowedNetworkIds: [ids.deletedNetwork] },
    );
    expect(deniedByScope).toBeNull();

    const legacyRemoved = await opportunity.createOpportunity(
      makeInput(ids.removedCandidate, 'atomic-reactivation-denied'),
    );
    createdOpportunityIds.push(legacyRemoved.id);
    const reactivated = await opportunity.updateOpportunityStatusIfNetworkEligible(
      legacyRemoved.id,
      'pending',
      legacyRemoved.actors,
      eligibility,
    );
    expect(reactivated).toBeNull();
  }, 20_000);

  it('filters inactive candidate pairs from scoped generic and HyDE searches', async () => {
    const generic = await embedder.search<{ id: string; userId: string }>(vector, 'intents', {
      filter: { indexScope: [ids.activeNetwork] },
      limit: 20,
      minScore: 0.99,
    });
    expect(generic.some((result) => result.item.id === ids.activeIntent)).toBe(true);
    expect(generic.some((result) => result.item.id === ids.removedIntent)).toBe(false);

    const hyde = await embedder.searchWithHydeEmbeddings([
      { lens: 'intent eligibility', corpus: 'intents', embedding: vector },
      { lens: 'premise eligibility', corpus: 'premises', embedding: vector },
    ], {
      indexScope: [ids.activeNetwork],
      limitPerStrategy: 20,
      limit: 40,
      minScore: 0.99,
    });
    expect(hyde.some((candidate) => candidate.userId === ids.activeCandidate)).toBe(true);
    expect(hyde.some((candidate) => candidate.userId === ids.removedCandidate)).toBe(false);

    const deletedNetwork = await embedder.searchWithHydeEmbeddings([
      { lens: 'deleted network', corpus: 'intents', embedding: vector },
    ], {
      indexScope: [ids.deletedNetwork],
      limit: 20,
      minScore: 0.99,
    });
    expect(deletedNetwork).toEqual([]);
  });

  it('filters inactive candidate pairs from premise and context fallback searches', async () => {
    const single = await opportunity.searchPremisesBySimilarity({
      embedding: vector,
      networkIds: [ids.activeNetwork],
      excludeUserId: ids.viewer,
      limit: 20,
    });
    expect(single.map((row) => row.premiseId)).toContain(ids.activePremise);
    expect(single.map((row) => row.premiseId)).not.toContain(ids.removedPremise);

    const batch = await opportunity.searchPremisesBySimilarityBatch({
      sources: [{ premiseId: 'source-premise', embedding: vector }],
      networkIds: [ids.activeNetwork],
      excludeUserId: ids.viewer,
      limitPerSource: 20,
    });
    expect(batch.map((row) => row.premiseId)).toContain(ids.activePremise);
    expect(batch.map((row) => row.premiseId)).not.toContain(ids.removedPremise);

    const context = await chat.searchIntentsByContextEmbedding({
      embedding: vector,
      networkIds: [ids.activeNetwork],
      excludeUserId: ids.viewer,
      limit: 20,
      minScore: 0.99,
    });
    expect(context.map((row) => row.intentId)).toContain(ids.activeIntent);
    expect(context.map((row) => row.intentId)).not.toContain(ids.removedIntent);
  });

  it('searchUserContextsBySimilarity returns network-scoped contexts excluding self and the global row', async () => {
    const rows = await opportunity.searchUserContextsBySimilarity({
      embedding: vector,
      networkIds: [ids.activeNetwork],
      excludeUserId: ids.viewer,
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].contextId).toBe(ids.activeNet1Context);
    expect(rows[0].userId).toBe(ids.activeCandidate);
    expect(rows[0].networkId).toBe(ids.activeNetwork);
    expect(rows[0].text).toContain('researcher');
    expect(rows[0].similarity).toBeGreaterThan(0.99);
  });

  it('selects and transactionally patches only exact triggeredBy pool rows', async () => {
    const makePoolOpportunity = async (input: {
      triggeredBy: string;
      actorIntent: string;
      status: 'pending' | 'accepted';
      suffix: string;
    }) => opportunity.createOpportunity({
      detection: {
        source: 'opportunity_graph',
        createdBy: 'agent-opportunity-finder',
        triggeredBy: input.triggeredBy,
        timestamp: new Date().toISOString(),
      },
      actors: [
        {
          userId: ids.viewer,
          networkId: ids.activeNetwork,
          role: 'peer',
          intent: input.actorIntent,
        },
        { userId: ids.activeCandidate, networkId: ids.activeNetwork, role: 'peer' },
      ],
      interpretation: {
        category: 'collaboration',
        reasoning: `${TEST_PREFIX}${input.suffix}`,
        confidence: 0.9,
        signals: [],
      },
      context: { networkId: ids.activeNetwork },
      confidence: '0.9',
      status: input.status,
    });

    const exact = await makePoolOpportunity({
      triggeredBy: ids.selectedIntent,
      actorIntent: ids.selectedIntent,
      status: 'pending',
      suffix: 'pool-exact',
    });
    const actorOnly = await makePoolOpportunity({
      triggeredBy: ids.otherViewerIntent,
      actorIntent: ids.selectedIntent,
      status: 'pending',
      suffix: 'pool-actor-only',
    });
    const terminal = await makePoolOpportunity({
      triggeredBy: ids.selectedIntent,
      actorIntent: ids.selectedIntent,
      status: 'accepted',
      suffix: 'pool-terminal',
    });
    const hidden = await opportunity.createOpportunity({
      detection: {
        source: 'opportunity_graph',
        createdBy: 'agent-opportunity-finder',
        triggeredBy: ids.selectedIntent,
        timestamp: new Date().toISOString(),
      },
      actors: [
        { userId: ids.viewer, networkId: ids.activeNetwork, role: 'patient', intent: ids.selectedIntent },
        { userId: ids.activeCandidate, networkId: ids.activeNetwork, role: 'introducer' },
      ],
      interpretation: {
        category: 'collaboration',
        reasoning: `${TEST_PREFIX}pool-hidden-latent-patient`,
        confidence: 0.9,
        signals: [],
      },
      context: { networkId: ids.activeNetwork },
      confidence: '0.9',
      status: 'latent',
    });
    createdOpportunityIds.push(exact.id, actorOnly.id, terminal.id, hidden.id);

    const live = await opportunity.getLivePoolOpportunitiesForIntent(ids.viewer, ids.selectedIntent);
    expect(live.map((row) => row.id)).toContain(exact.id);
    expect(live.map((row) => row.id)).not.toContain(actorOnly.id);
    expect(live.map((row) => row.id)).not.toContain(terminal.id);
    expect(live.map((row) => row.id)).not.toContain(hidden.id);

    const writeFor = (opportunityId: string) => ({
      opportunityId,
      adjustment: {
        questionId: 'question-exact-scope',
        recipientUserId: ids.viewer,
        intentId: ids.selectedIntent,
        label: 'Builders vs advisors',
        side: 'Builders',
        factor: 1,
        appliedAt: new Date().toISOString(),
      },
      signal: {
        type: 'pool_discriminator',
        weight: 1,
        detail: 'Builders vs advisors: Builders',
        questionId: 'question-exact-scope',
        recipientUserId: ids.viewer,
        intentId: ids.selectedIntent,
      },
    });
    const applied = await opportunity.applyOpportunityPoolAdjustments(
      ids.viewer,
      ids.selectedIntent,
      computeIntentFingerprint('Paused selected intent', null),
      [writeFor(exact.id), writeFor(actorOnly.id), writeFor(terminal.id), writeFor(hidden.id)],
    );

    expect(applied).toEqual([exact.id]);
    expect((await opportunity.getOpportunity(exact.id))?.metadata?.poolAdjustments).toHaveLength(1);
    expect((await opportunity.getOpportunity(actorOnly.id))?.metadata?.poolAdjustments).toBeUndefined();
    expect((await opportunity.getOpportunity(terminal.id))?.metadata?.poolAdjustments).toBeUndefined();
    expect((await opportunity.getOpportunity(hidden.id))?.metadata?.poolAdjustments).toBeUndefined();
  }, 20_000);

  it('keeps paused owned-intent Radar history while blocking inactive participants and foreign scopes', async () => {
    const makeOpportunity = async (candidateUserId: string, suffix: string) => opportunity.createOpportunity({
      detection: {
        source: 'opportunity_graph',
        createdBy: 'agent-opportunity-finder',
        triggeredBy: ids.selectedIntent,
        timestamp: new Date().toISOString(),
      },
      actors: [
        { userId: ids.viewer, networkId: ids.activeNetwork, role: 'peer', intent: ids.selectedIntent },
        { userId: candidateUserId, networkId: ids.activeNetwork, role: 'peer' },
      ],
      interpretation: {
        category: 'collaboration',
        reasoning: `${TEST_PREFIX}${suffix}`,
        confidence: 0.9,
        signals: [],
      },
      context: { networkId: ids.activeNetwork },
      confidence: '0.9',
      status: 'pending',
    });

    const good = await makeOpportunity(ids.activeCandidate, 'good');
    const leaked = await makeOpportunity(ids.removedCandidate, 'removed');
    createdOpportunityIds.push(good.id, leaked.id);

    const radar = await opportunity.getOpportunitiesForUser(ids.viewer, {
      scopeType: 'intent',
      scopeId: ids.selectedIntent,
      statuses: ['pending'],
    });
    expect(radar.some((row) => row.id === good.id)).toBe(true);
    expect(radar.some((row) => row.id === leaked.id)).toBe(false);

    const foreign = await opportunity.getOpportunitiesForUser(ids.activeCandidate, {
      scopeType: 'intent',
      scopeId: ids.selectedIntent,
      statuses: ['pending'],
    });
    expect(foreign).toEqual([]);
  });
});
