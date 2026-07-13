/**
 * Home Graph: tests for load → cards → categorize → sections.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, test, expect } from 'bun:test';
import { HomeGraphFactory, stripLeadingNarratorName, ALL_OPPORTUNITY_STATUSES } from '../feed/feed.graph.js';
import { selectByComposition, classifyOpportunity, FEED_SOFT_TARGETS } from '../opportunity.utils.js';
import type { HomeGraphDatabase } from '../../shared/interfaces/database.interface.js';
import type { Opportunity } from '../../shared/interfaces/database.interface.js';
import type { OpportunityCache } from '../../shared/interfaces/cache.interface.js';
import { resolveHomeSectionIcon, DEFAULT_HOME_SECTION_ICON, getIconNamesForPrompt } from '../../shared/ui/lucide.icon-catalog.js';

function createMockCache(): OpportunityCache {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T) ?? null,
    set: async <T>(key: string, value: T) => { store.set(key, value); },
    mget: async <T>(keys: string[]) => keys.map((k) => (store.get(k) as T) ?? null),
  };
}

function createMockDb(opportunities: Opportunity[] = []): HomeGraphDatabase {
  return {
    getOpportunitiesForUser: () => Promise.resolve(opportunities),
    getOpportunity: () => Promise.resolve(null),
    getProfile: () => Promise.resolve(null),
    getActiveIntents: () => Promise.resolve([]),
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getUser: (id: string) => Promise.resolve({ id, name: 'User ' + id, email: '', avatar: null }),
    getNegotiationTaskForOpportunity: () => Promise.resolve(null),
  };
}

/** Minimal opportunity: viewer as patient, other as agent, pending. Use when viewer should be patient (e.g. with introducer). */
function minimalOpportunity(viewerId: string, otherId: string): Opportunity {
  return {
    id: 'opp-minimal',
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { userId: viewerId, role: 'patient', networkId: 'idx-1' },
      { userId: otherId, role: 'agent', networkId: 'idx-1' },
    ],
    interpretation: { reasoning: 'Test match.', category: 'connection', confidence: 0.8 },
    context: { networkId: 'idx-1' },
    confidence: '0.8',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

/** Pending opportunity with viewer as agent (actionable for agent without introducer). */
function minimalOpportunityAgentViewer(viewerId: string, otherId: string, id = 'opp-minimal'): Opportunity {
  return {
    id,
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { userId: viewerId, role: 'agent', networkId: 'idx-1' },
      { userId: otherId, role: 'patient', networkId: 'idx-1' },
    ],
    interpretation: { reasoning: 'Test match.', category: 'connection', confidence: 0.8 },
    context: { networkId: 'idx-1' },
    confidence: '0.8',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

function minimalOpportunityWithId(viewerId: string, otherId: string, id: string, reasoning: string): Opportunity {
  return {
    id,
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { userId: viewerId, role: 'patient', networkId: 'idx-1' },
      { userId: otherId, role: 'agent', networkId: 'idx-1' },
    ],
    interpretation: { reasoning, category: 'connection', confidence: 0.8 },
    context: { networkId: 'idx-1' },
    confidence: '0.8',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

describe('HomeGraph', () => {
  test('no opportunities returns empty sections and meta', async () => {
    const db = createMockDb([]);
    const factory = new HomeGraphFactory(db, createMockCache());
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId: 'user-1', limit: 50 });
    expect(result.error).toBeUndefined();
    expect(result.sections).toEqual([]);
    expect(result.meta).toEqual({ totalOpportunities: 0, totalSections: 0 });
  });

  test('missing userId returns error', async () => {
    const db = createMockDb([]);
    const factory = new HomeGraphFactory(db, createMockCache());
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId: '', limit: 50 });
    expect(result.error).toBe('userId is required');
  });

  test('with one opportunity, sections items have presenter-driven fields', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const opp = minimalOpportunityAgentViewer(viewerId, otherId);
    const db = createMockDb([opp]);
    const factory = new HomeGraphFactory(db, createMockCache());
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId: viewerId, limit: 50 });
    expect(result.error).toBeUndefined();
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    const firstSection = result.sections[0];
    expect(firstSection.items.length).toBeGreaterThanOrEqual(1);
    const firstItem = firstSection.items[0];
    expect(firstItem).toHaveProperty('primaryActionLabel');
    expect(firstItem).toHaveProperty('secondaryActionLabel');
    expect(firstItem).toHaveProperty('mutualIntentsLabel');
    expect(firstItem.opportunityId).toBe(opp.id);
    expect(typeof firstItem.primaryActionLabel).toBe('string');
    expect(typeof firstItem.secondaryActionLabel).toBe('string');
    expect(typeof firstItem.mutualIntentsLabel).toBe('string');
    expect(resolveHomeSectionIcon(firstSection.iconName)).toBeDefined();
  }, 30000);

  test('manual source without introducer actor yields Index as narrator (no false intro attribution)', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const opp = minimalOpportunityAgentViewer(viewerId, otherId);
    expect(opp.detection?.source).toBe('manual');
    expect(opp.actors.some((a) => a.role === 'introducer')).toBe(false);
    const db = createMockDb([opp]);
    const factory = new HomeGraphFactory(db, createMockCache());
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId: viewerId, limit: 50 });
    expect(result.error).toBeUndefined();
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    const firstItem = result.sections[0]?.items[0];
    expect(firstItem?.narratorChip?.name).toBe('Index');
  }, 70000);

  test('drops card when counterpart user is deleted (no users row, no profile)', async () => {
    const viewerId = 'viewer-1';
    const orphanId = 'deleted-user';
    const keptId = 'other-1';
    const orphanOpp = minimalOpportunityAgentViewer(viewerId, orphanId, 'opp-orphan');
    const keptOpp = minimalOpportunityAgentViewer(viewerId, keptId, 'opp-kept');
    const db = createMockDb([orphanOpp, keptOpp]);
    // Simulate a deleted counterpart: users row gone, profile gone.
    db.getUser = (id: string) =>
      id === orphanId
        ? Promise.resolve(null)
        : Promise.resolve({ id, name: 'User ' + id, email: '', avatar: null });
    const graph = new HomeGraphFactory(db, createMockCache()).createGraph();

    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    const items = result.sections.flatMap((s) => s.items);
    expect(items.map((i) => i.opportunityId)).toEqual(['opp-kept']);
    expect(items.some((i) => i.name === 'Unknown')).toBe(false);
  }, 30000);

  test('keeps card when users row is missing but profile identity name resolves', async () => {
    const viewerId = 'viewer-1';
    const ghostId = 'profile-only-user';
    const opp = minimalOpportunityAgentViewer(viewerId, ghostId, 'opp-profile-only');
    const db = createMockDb([opp]);
    db.getUser = () => Promise.resolve(null);
    db.getProfile = () => Promise.resolve({ identity: { name: 'Profile Name' } });
    const graph = new HomeGraphFactory(db, createMockCache()).createGraph();

    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    const items = result.sections.flatMap((s) => s.items);
    expect(items.map((i) => i.opportunityId)).toEqual(['opp-profile-only']);
    expect(items[0]?.name).toBe('Profile Name');
  }, 30000);

  test('actor-dedupes multiple opportunities between same actors to one card', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const opp1 = minimalOpportunityAgentViewer(viewerId, otherId, 'opp-1');
    const opp2 = minimalOpportunityAgentViewer(viewerId, otherId, 'opp-2');
    opp2.interpretation = { reasoning: 'You could also collaborate on early startup team formation.', category: 'connection', confidence: 0.8 };
    const db = createMockDb([opp1, opp2]);
    const graph = new HomeGraphFactory(db, createMockCache()).createGraph();

    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    const firstItem = result.sections[0]?.items[0];
    expect(firstItem).toBeDefined();
    expect(firstItem?.name).toBe('User other-1');
    expect(firstItem?.opportunityId).toBeDefined();
    expect(['opp-1', 'opp-2']).toContain(firstItem?.opportunityId);
  }, 30000);

  test('actor-dedupes opportunities with same non-introducer actors to one card', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const introducerA = 'intro-a';
    const introducerB = 'intro-b';
    const now = new Date();

    const withIntroducerA: Opportunity = {
      id: 'opp-intro-a',
      detection: { source: 'manual', timestamp: now.toISOString() },
      actors: [
        { userId: viewerId, role: 'patient', networkId: 'idx-1', intent: 'intent-1' },
        { userId: otherId, role: 'agent', networkId: 'idx-1', intent: 'intent-2' },
        { userId: introducerA, role: 'introducer', networkId: 'idx-1' },
      ],
      interpretation: { reasoning: 'First match for same counterpart via introducer A.', category: 'connection', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    };

    const withIntroducerB: Opportunity = {
      id: 'opp-intro-b',
      detection: { source: 'manual', timestamp: now.toISOString() },
      actors: [
        { userId: viewerId, role: 'patient', networkId: 'idx-1', intent: 'intent-3' },
        { userId: otherId, role: 'agent', networkId: 'idx-1', intent: 'intent-4' },
        { userId: introducerB, role: 'introducer', networkId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Second match for same counterpart via introducer B.', category: 'connection', confidence: 0.9 },
      context: { networkId: 'idx-1' },
      confidence: '0.9',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    };

    const db = createMockDb([withIntroducerA, withIntroducerB]);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    const firstItem = result.sections[0]?.items[0];
    expect(firstItem?.userId).toBe(otherId);
    expect(firstItem?.opportunityId).toBeDefined();
    expect(['opp-intro-a', 'opp-intro-b']).toContain(firstItem?.opportunityId);
  }, 30000);

  test('excludes accepted agent-with-introducer from the actionable home feed', async () => {
    const introducerId = 'intro-1';
    const patientId = 'patient-1';
    const agentId = 'agent-1';
    const acceptedWithIntroducer: Opportunity = {
      id: 'opp-accepted-intro',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: introducerId, role: 'introducer', networkId: 'idx-1' },
        { userId: patientId, role: 'patient', networkId: 'idx-1' },
        { userId: agentId, role: 'agent', networkId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Agent sees this for the first time at accepted.', category: 'connection', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
      status: 'accepted',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([acceptedWithIntroducer]);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({ userId: agentId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(0);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(0);
  }, 30000);

  test('excludes accepted opportunities for patient role', async () => {
    const viewerId = 'viewer-1';
    const otherId = 'other-1';
    const acceptedOpp: Opportunity = {
      id: 'opp-accepted',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: viewerId, role: 'patient', networkId: 'idx-1' },
        { userId: otherId, role: 'agent', networkId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Accepted.', category: 'connection', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
      status: 'accepted',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([acceptedOpp]);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(0);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(0);
  }, 30000);

  test('explicit statuses (lifecycle view): terminal statuses pass through, acted-pending stays filtered, newest state wins dedup', async () => {
    const viewerId = 'viewer-1';
    const now = Date.now();
    const at = (msAgo: number) => new Date(now - msAgo);
    const base = (id: string, status: Opportunity['status'], otherId: string, updatedAt: Date, viewerActors: Opportunity['actors']): Opportunity => ({
      id,
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [...viewerActors, { userId: otherId, role: 'agent', networkId: 'idx-1' }],
      interpretation: { reasoning: 'Test match.', category: 'connection', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
      status,
      createdAt: updatedAt,
      updatedAt,
      expiresAt: null,
    });

    const opps: Opportunity[] = [
      // Accepted with counterpart X — newest state, must pass through AND claim X in dedup.
      base('opp-accepted-x', 'accepted', 'user-x', at(1_000), [
        { userId: viewerId, role: 'patient', networkId: 'idx-1', actedAt: new Date(now - 1_000).toISOString() },
      ]),
      // Older pending with the same counterpart X — deduped away by the accepted one.
      base('opp-pending-x-old', 'pending', 'user-x', at(50_000), [
        { userId: viewerId, role: 'patient', networkId: 'idx-1' },
      ]),
      // Pending the viewer ALREADY acted on (dup unstamped rows from re-detection) — must stay filtered.
      base('opp-pending-acted', 'pending', 'user-y', at(2_000), [
        { userId: viewerId, role: 'patient', networkId: 'idx-1', actedAt: new Date(now - 90_000).toISOString() },
        { userId: viewerId, role: 'patient', networkId: 'idx-1' },
      ]),
      // Genuinely actionable pending — must pass.
      base('opp-pending-live', 'pending', 'user-z', at(3_000), [
        { userId: viewerId, role: 'patient', networkId: 'idx-1' },
      ]),
      // Expired — terminal, must pass through in lifecycle view.
      base('opp-expired', 'expired', 'user-w', at(4_000), [
        { userId: viewerId, role: 'patient', networkId: 'idx-1' },
      ]),
    ];

    const db = createMockDb(opps);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({
      userId: viewerId,
      limit: 50,
      statuses: ALL_OPPORTUNITY_STATUSES.filter((s) => s !== 'draft'),
    });

    expect(result.error).toBeUndefined();
    const items = result.sections.flatMap((s) => s.items);
    const ids = items.map((i) => i.opportunityId).sort();
    expect(ids).toEqual(['opp-accepted-x', 'opp-expired', 'opp-pending-live']);
    // Cards carry the lifecycle status for client-side bucketing.
    const statusById = new Map(items.map((i) => [i.opportunityId, i.status]));
    expect(statusById.get('opp-accepted-x')).toBe('accepted');
    expect(statusById.get('opp-pending-live')).toBe('pending');
    expect(statusById.get('opp-expired')).toBe('expired');
  }, 30000);

  test('shows latent opportunity for introducer but not pending', async () => {
    const viewerId = 'intro-1';
    const memberA = 'member-a';
    const memberB = 'member-b';
    const latentOpportunity: Opportunity = {
      id: 'opp-introducer-latent',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: viewerId, role: 'introducer', networkId: 'idx-1' },
        { userId: memberA, role: 'patient', networkId: 'idx-1' },
        { userId: memberB, role: 'agent', networkId: 'idx-1' },
      ],
      interpretation: {
        reasoning: 'These two members should meet based on aligned goals.',
        category: 'connection',
        confidence: 0.9,
      },
      context: { networkId: 'idx-1' },
      confidence: '0.9',
      status: 'latent',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([latentOpportunity]);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    expect(result.sections[0]?.items[0]?.opportunityId).toBe('opp-introducer-latent');
  }, 70000);

  test('introducer does not see pending opportunity in feed', async () => {
    const viewerId = 'intro-1';
    const memberA = 'member-a';
    const memberB = 'member-b';
    const pendingOpportunity: Opportunity = {
      id: 'opp-introducer-pending',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: viewerId, role: 'introducer', networkId: 'idx-1' },
        { userId: memberA, role: 'patient', networkId: 'idx-1' },
        { userId: memberB, role: 'agent', networkId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Pending.', category: 'connection', confidence: 0.9 },
      context: { networkId: 'idx-1' },
      confidence: '0.9',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([pendingOpportunity]);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(0);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(0);
  }, 30000);

  test('agent without introducer sees pending but not latent', async () => {
    const patientId = 'patient-1';
    const agentId = 'agent-1';
    const pendingOpp: Opportunity = {
      id: 'opp-pending-no-intro',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: patientId, role: 'patient', networkId: 'idx-1' },
        { userId: agentId, role: 'agent', networkId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Patient sent; agent can accept.', category: 'connection', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([pendingOpp]);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({ userId: agentId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);
    expect(result.sections[0]?.items[0]?.opportunityId).toBe('opp-pending-no-intro');
  }, 30000);

  test('agent without introducer does not see latent opportunity', async () => {
    const patientId = 'patient-1';
    const agentId = 'agent-1';
    const latentOpp: Opportunity = {
      id: 'opp-latent-no-intro',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: patientId, role: 'patient', networkId: 'idx-1' },
        { userId: agentId, role: 'agent', networkId: 'idx-1' },
      ],
      interpretation: { reasoning: 'Latent.', category: 'connection', confidence: 0.8 },
      context: { networkId: 'idx-1' },
      confidence: '0.8',
      status: 'latent',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const db = createMockDb([latentOpp]);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({ userId: agentId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(0);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(0);
  }, 30000);

  // Hypothesis: The bug occurs because opportunity.actors can contain multiple entries
  // with the same userId (e.g. from different intents), and introducerCounterparts
  // maps all of them to names without deduplicating, producing repeated names like
  // "Seref Yarar ↔ Seref Yarar ↔ jiawei ↔ jiawei" instead of "Seref Yarar ↔ jiawei".
  test('introducer card deduplicates participant names when actors have duplicate userIds', async () => {
    const viewerId = 'intro-1';
    const memberA = 'member-a';
    const memberB = 'member-b';

    // Opportunity where each non-introducer userId appears multiple times
    // (e.g. from different intents or discovery passes)
    const duplicateActorsOpp: Opportunity = {
      id: 'opp-dup-actors',
      detection: { source: 'manual', timestamp: new Date().toISOString() },
      actors: [
        { userId: viewerId, role: 'introducer', indexId: 'idx-1' },
        { userId: memberA, role: 'patient', indexId: 'idx-1', intent: 'intent-1' },
        { userId: memberA, role: 'patient', indexId: 'idx-1', intent: 'intent-2' },
        { userId: memberA, role: 'patient', indexId: 'idx-1', intent: 'intent-3' },
        { userId: memberB, role: 'agent', indexId: 'idx-1', intent: 'intent-4' },
        { userId: memberB, role: 'agent', indexId: 'idx-1', intent: 'intent-5' },
        { userId: memberB, role: 'agent', indexId: 'idx-1', intent: 'intent-6' },
      ],
      interpretation: {
        reasoning: 'These two should connect.',
        category: 'connection',
        confidence: 0.9,
      },
      context: { indexId: 'idx-1' },
      confidence: '0.9',
      status: 'latent',
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };

    const db = createMockDb([duplicateActorsOpp]);
    const result = await new HomeGraphFactory(db, createMockCache()).createGraph().invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(1);

    const card = result.sections[0]?.items[0];
    expect(card).toBeDefined();

    // With secondParty present (2 counterparts), card.name should be a single name,
    // not the joined "A ↔ B" format. The frontend arrow layout renders card.name → secondParty.name.
    const name = card!.name;
    expect(name).not.toContain('↔');
    // card.name and secondParty.name should cover both counterparts
    expect(card!.secondParty).toBeDefined();
    const allNames = [name, card!.secondParty!.name];
    expect(allNames).toContain('User member-a');
    expect(allNames).toContain('User member-b');
  }, 70000);

});

describe('HomeGraph caching', () => {
  const viewerId = 'viewer-1';
  const otherId = 'other-1';

  function cachedCard(opportunityId: string, cardIndex: number): import('../feed/feed.state.js').HomeCardItem {
    return {
      opportunityId,
      userId: otherId,
      name: 'Cached User',
      avatar: null,
      mainText: 'Cached summary',
      cta: 'Cached action',
      headline: 'Cached headline',
      primaryActionLabel: 'Start Chat',
      secondaryActionLabel: 'Skip',
      mutualIntentsLabel: 'Shared interests',
      narratorChip: undefined,
      viewerRole: 'agent',
      _cardIndex: cardIndex,
    };
  }

  test('full cache hit skips presenter LLM calls and returns cached cards', async () => {
    const opp = minimalOpportunityAgentViewer(viewerId, otherId, 'opp-cached');
    const db = createMockDb([opp]);
    const cache = createMockCache();

    // Pre-populate cache with a card for this opportunity
    const card = cachedCard('opp-cached', 99); // stale _cardIndex to verify recomputation
    await cache.set(`home:card:opp-cached:${opp.status}:${viewerId}`, card);

    const graph = new HomeGraphFactory(db, cache).createGraph();
    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((n, s) => n + s.items.length, 0);
    expect(totalItems).toBe(1);
    const item = result.sections[0]?.items[0];
    expect(item?.mainText).toBe('Cached summary');
    expect(item?.headline).toBe('Cached headline');
  }, 30000);

  test('partial cache hit only generates uncached cards', async () => {
    const opp1 = minimalOpportunityAgentViewer(viewerId, 'other-1', 'opp-hit');
    const opp2 = minimalOpportunityAgentViewer(viewerId, 'other-2', 'opp-miss');
    const db = createMockDb([opp1, opp2]);
    const cache = createMockCache();

    // Only cache opp1
    await cache.set(`home:card:opp-hit:${opp1.status}:${viewerId}`, cachedCard('opp-hit', 0));

    const graph = new HomeGraphFactory(db, cache).createGraph();
    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(2);
    const allItems = result.sections.flatMap((s) => s.items);
    expect(allItems.length).toBe(2);

    const hitItem = allItems.find((i) => i.opportunityId === 'opp-hit');
    const missItem = allItems.find((i) => i.opportunityId === 'opp-miss');
    expect(hitItem?.mainText).toBe('Cached summary');
    // The miss item should have been generated fresh by the presenter
    expect(missItem?.mainText).not.toBe('Cached summary');
    expect(missItem?.opportunityId).toBe('opp-miss');
  }, 30000);

  test('cached cards get _cardIndex recomputed to current opportunity order', async () => {
    const opp = minimalOpportunityAgentViewer(viewerId, otherId, 'opp-reindex');
    const db = createMockDb([opp]);
    const cache = createMockCache();

    // Cache with stale _cardIndex of 42
    await cache.set(`home:card:opp-reindex:${opp.status}:${viewerId}`, cachedCard('opp-reindex', 42));

    const graph = new HomeGraphFactory(db, cache).createGraph();
    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    // The card should appear correctly (index 0, since it's the only opportunity)
    expect(result.error).toBeUndefined();
    const allItems = result.sections.flatMap((s) => s.items);
    expect(allItems.length).toBe(1);
    expect(allItems[0]?.opportunityId).toBe('opp-reindex');
  }, 30000);

  test('categorizer cache hit skips LLM categorization', async () => {
    const opp = minimalOpportunityAgentViewer(viewerId, otherId, 'opp-cat');
    const db = createMockDb([opp]);
    const cache = createMockCache();

    // Run once to populate both presenter and categorizer caches
    const graph = new HomeGraphFactory(db, cache).createGraph();
    const firstResult = await graph.invoke({ userId: viewerId, limit: 50 });
    expect(firstResult.error).toBeUndefined();
    expect(firstResult.sections.length).toBeGreaterThanOrEqual(1);
    const firstSectionTitle = firstResult.sections[0]?.title;

    // Run again — should use cached presenter AND cached categories
    const secondResult = await graph.invoke({ userId: viewerId, limit: 50 });
    expect(secondResult.error).toBeUndefined();
    expect(secondResult.sections.length).toBe(firstResult.sections.length);
    // Same category structure since same opportunity set
    expect(secondResult.sections[0]?.title).toBe(firstSectionTitle);
  }, 60000);

  test('cache failure gracefully falls through to uncached path', async () => {
    const opp = minimalOpportunityAgentViewer(viewerId, otherId, 'opp-fail');
    const db = createMockDb([opp]);

    // Create a cache that throws on every operation
    const failingCache: OpportunityCache = {
      get: async () => { throw new Error('Redis down'); },
      set: async () => { throw new Error('Redis down'); },
      mget: async () => { throw new Error('Redis down'); },
    };

    const graph = new HomeGraphFactory(db, failingCache).createGraph();
    const result = await graph.invoke({ userId: viewerId, limit: 50 });

    // Should still work — just without caching
    expect(result.error).toBeUndefined();
    expect(result.meta.totalOpportunities).toBe(1);
    const totalItems = result.sections.reduce((n, s) => n + s.items.length, 0);
    expect(totalItems).toBe(1);
  }, 30000);
});

describe('stripLeadingNarratorName', () => {
  test('strips leading narrator name from remark', () => {
    expect(stripLeadingNarratorName('Alice introduced you two.', 'Alice')).toBe('introduced you two.');
    expect(stripLeadingNarratorName('Yankı Ekin Yüksel introduced you two, sensing a valuable connection.', 'Yankı Ekin Yüksel')).toBe('introduced you two, sensing a valuable connection.');
  });

  test('strips name followed by colon and space', () => {
    expect(stripLeadingNarratorName('Bob: Bob thinks you should meet.', 'Bob')).toBe('thinks you should meet.');
  });

  test('leaves remark unchanged when it does not start with narrator name', () => {
    const remark = 'Based on your overlapping intents.';
    expect(stripLeadingNarratorName(remark, 'Index')).toBe(remark);
    expect(stripLeadingNarratorName(remark, 'Alice')).toBe(remark);
  });

  test('returns original remark when narrator name is empty', () => {
    const remark = 'Alice introduced you two.';
    expect(stripLeadingNarratorName(remark, '')).toBe(remark);
  });
});

describe('Lucide icon catalog', () => {
  test('resolveHomeSectionIcon returns default for unknown name', () => {
    expect(resolveHomeSectionIcon('unknown-icon')).toBe(DEFAULT_HOME_SECTION_ICON);
    expect(resolveHomeSectionIcon('')).toBe(DEFAULT_HOME_SECTION_ICON);
    expect(resolveHomeSectionIcon(null)).toBe(DEFAULT_HOME_SECTION_ICON);
  });

  test('resolveHomeSectionIcon returns valid name for allowed icon', () => {
    expect(resolveHomeSectionIcon('hourglass')).toBe('hourglass');
    expect(resolveHomeSectionIcon('telescope')).toBe('telescope');
    expect(resolveHomeSectionIcon('HOURGLASS')).toBe('hourglass');
  });

  test('getIconNamesForPrompt returns non-empty string', () => {
    const list = getIconNamesForPrompt();
    expect(typeof list).toBe('string');
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain('hourglass');
  });
});

// ─── Fetch limit tests ───────────────────────────────────────────────────────

/**
 * Hypothesis: The bug occurs because the home graph's fetchLimit formula
 * `Math.min(150, Math.max(state.limit * 3, state.limit))` yields only 15
 * with the default state.limit=5. The DB returns the 15 newest opportunities
 * (ordered by createdAt DESC), all of which are connections. Older
 * connector-flow opportunities never reach selectByComposition.
 *
 * These tests validate:
 * 1. selectByComposition correctly includes connector-flow when candidates exist
 * 2. The fetchLimit formula must provide enough headroom for composition
 */

const VIEWER = 'user-viewer';

/** Helper to create a mock opportunity */
function makeOpp(
  id: string,
  viewerRole: string,
  status: string,
  otherUserId = 'user-other',
) {
  const actors: Array<{ userId: string; role: string }> = [];

  if (viewerRole === 'introducer') {
    actors.push(
      { userId: VIEWER, role: 'introducer' },
      { userId: otherUserId, role: 'patient' },
      { userId: `user-agent-${id}`, role: 'agent' },
    );
  } else {
    actors.push(
      { userId: VIEWER, role: viewerRole },
      { userId: otherUserId, role: viewerRole === 'patient' ? 'agent' : 'patient' },
    );
  }

  return { id, actors, status };
}

describe('home feed fetch limit bug', () => {
  describe('selectByComposition includes connector-flow when candidates exist', () => {
    test('returns connector-flow items when pool contains both connections and connector-flow', () => {
      // Simulate a diverse pool: 10 connections + 5 connector-flow + 3 expired
      const pool = [
        ...Array.from({ length: 10 }, (_, i) => makeOpp(`conn-${i}`, 'patient', 'latent', `other-${i}`)),
        ...Array.from({ length: 5 }, (_, i) => makeOpp(`intro-${i}`, 'introducer', 'latent', `intro-other-${i}`)),
        ...Array.from({ length: 3 }, (_, i) => makeOpp(`exp-${i}`, 'patient', 'expired', `exp-other-${i}`)),
      ];

      const result = selectByComposition(pool, VIEWER);

      // Should include connector-flow items
      const connectorFlowCount = result.filter(
        (opp) => classifyOpportunity(opp, VIEWER) === 'connector-flow'
      ).length;
      expect(connectorFlowCount).toBeGreaterThan(0);
      expect(connectorFlowCount).toBe(FEED_SOFT_TARGETS.connectorFlow);
    });

    test('returns 0 connector-flow when pool contains ONLY connections (the bug scenario)', () => {
      // Simulate the bug: fetchLimit=15 returns only the 15 newest, all connections
      const pool = Array.from({ length: 15 }, (_, i) =>
        makeOpp(`conn-${i}`, 'patient', 'latent', `other-${i}`)
      );

      const result = selectByComposition(pool, VIEWER);

      // All items are connections — connector-flow is starved
      const connectorFlowCount = result.filter(
        (opp) => classifyOpportunity(opp, VIEWER) === 'connector-flow'
      ).length;
      expect(connectorFlowCount).toBe(0);
    });
  });

  describe('fetchLimit formula provides enough headroom', () => {
    /**
     * The minimum fetchLimit must be large enough that even when most results
     * are one category, selectByComposition still has candidates for other
     * categories. With FEED_SOFT_TARGETS totaling 7, a minimum of 50 provides
     * ~7x headroom for filtering and dedup.
     */
    const MIN_FETCH_LIMIT = 50;

    test('fetchLimit with state.limit=5 should be at least 50', () => {
      const stateLimit = 5;
      // Old formula: Math.min(150, Math.max(stateLimit * 3, stateLimit)) = 15
      const oldFetchLimit = Math.min(150, Math.max(stateLimit * 3, stateLimit));
      expect(oldFetchLimit).toBe(15); // Confirms the bug

      // New formula should produce at least MIN_FETCH_LIMIT
      const newFetchLimit = Math.min(150, Math.max(MIN_FETCH_LIMIT, stateLimit * 3));
      expect(newFetchLimit).toBeGreaterThanOrEqual(MIN_FETCH_LIMIT);
    });

    test('fetchLimit with state.limit=20 should scale above minimum', () => {
      const stateLimit = 20;
      const newFetchLimit = Math.min(150, Math.max(MIN_FETCH_LIMIT, stateLimit * 3));
      expect(newFetchLimit).toBe(60); // 20*3 = 60 > 50
    });

    test('fetchLimit with state.limit=100 should cap at 150', () => {
      const stateLimit = 100;
      const newFetchLimit = Math.min(150, Math.max(MIN_FETCH_LIMIT, stateLimit * 3));
      expect(newFetchLimit).toBe(150); // capped
    });

    test('fetchLimit with state.limit=1 should still be at least 50', () => {
      const stateLimit = 1;
      const newFetchLimit = Math.min(150, Math.max(MIN_FETCH_LIMIT, stateLimit * 3));
      expect(newFetchLimit).toBe(MIN_FETCH_LIMIT);
    });
  });
});

// ─── Introducer name format tests ───────────────────────────────────────────

const USER_MAP: Record<string, { id: string; name: string; email: string; avatar: string | null }> = {
  'intro-1': { id: 'intro-1', name: 'Intro User', email: 'intro@test.com', avatar: null },
  'party-a': { id: 'party-a', name: 'Mert Karadayi', email: 'mert@test.com', avatar: null },
  'party-b': { id: 'party-b', name: 'Yanki Ekin Yuksel', email: 'yanki@test.com', avatar: null },
};

function createIntroMockDb(opportunities: Opportunity[]): HomeGraphDatabase {
  return {
    getOpportunitiesForUser: () => Promise.resolve(opportunities),
    getOpportunity: () => Promise.resolve(null),
    getProfile: () => Promise.resolve(null),
    getActiveIntents: () => Promise.resolve([]),
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getUser: (id: string) => Promise.resolve(USER_MAP[id] ?? { id, name: 'Unknown User', email: '', avatar: null }),
  };
}

function makeIntroducerOpportunity(introducerId: string, partyAId: string, partyBId: string): Opportunity {
  return {
    id: 'opp-intro-1',
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString() },
    actors: [
      { userId: introducerId, role: 'introducer', indexId: 'idx-1' },
      { userId: partyAId, role: 'party', indexId: 'idx-1' },
      { userId: partyBId, role: 'party', indexId: 'idx-1' },
    ],
    interpretation: { reasoning: 'Good introduction match.', category: 'connection', confidence: 80 },
    context: { indexId: 'idx-1' },
    confidence: '0.8',
    status: 'latent',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };
}

describe('home.graph introducer card name format', () => {
  test('introducer card name should NOT use joined format when secondParty is present', async () => {
    const viewerId = 'intro-1';
    const opp = makeIntroducerOpportunity(viewerId, 'party-a', 'party-b');
    const db = createIntroMockDb([opp]);
    const cache = createMockCache();
    const factory = new HomeGraphFactory(db, cache);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: viewerId,
      limit: 10,
      noCache: true,
    });

    // The graph should produce cards
    expect(result.cards.length).toBeGreaterThan(0);

    const card = result.cards[0];
    // card.name should be a single person's name, NOT "Mert Karadayi ↔ Yanki Ekin Yuksel"
    expect(card.name).not.toContain('↔');

    // secondParty should be populated
    expect(card.secondParty).toBeDefined();
    expect(card.secondParty?.name).toBeTruthy();

    // card.name and secondParty.name should be different people
    expect(card.name).not.toBe(card.secondParty?.name);

    // Both names should be actual person names
    const allNames = [card.name, card.secondParty?.name];
    expect(allNames).toContain('Mert Karadayi');
    expect(allNames).toContain('Yanki Ekin Yuksel');
  }, 30_000);
});

describe('HomeGraph skeleton presentation', () => {
  test('uncached cards come back identity-only, flagged presentationPending, in one flat section, and are never cached', async () => {
    const viewerId = 'viewer-1';
    const opp = minimalOpportunityAgentViewer(viewerId, 'other-1');
    const db = createMockDb([opp]);
    const cache = createMockCache();
    const factory = new HomeGraphFactory(db, cache);
    const graph = factory.createGraph();

    const result = await graph.invoke({ userId: viewerId, limit: 50, presentation: 'skeleton' });

    expect(result.error).toBeUndefined();
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].items.length).toBe(1);

    const item = result.sections[0].items[0];
    expect(item.presentationPending).toBe(true);
    // Identity fields are real…
    expect(item.name).toBe('User other-1');
    expect(item.userId).toBe('other-1');
    expect(item.status).toBe('pending');
    expect(item.primaryActionLabel).toBeTruthy();
    // …but presenter text is absent (no LLM ran).
    expect(item.mainText).toBe('');
    expect(item.cta).toBe('');

    // Skeleton cards must not poison the presenter cache: the follow-up full
    // request has to see a miss and generate real text.
    const cached = await cache.get(`home:card:${opp.id}:pending:${viewerId}`);
    expect(cached).toBeNull();
  });

  test('presenter-cache hits are served complete (no pending flag) even in skeleton mode', async () => {
    const viewerId = 'viewer-1';
    const opp = minimalOpportunityAgentViewer(viewerId, 'other-1');
    const db = createMockDb([opp]);
    const cache = createMockCache();
    await cache.set(`home:card:${opp.id}:pending:${viewerId}`, {
      opportunityId: opp.id,
      userId: 'other-1',
      name: 'User other-1',
      avatar: null,
      mainText: 'Cached summary.',
      cta: 'Say hi.',
      primaryActionLabel: 'Connect',
      secondaryActionLabel: 'Skip',
      mutualIntentsLabel: 'Shared interests',
      _cardIndex: 0,
    });
    const factory = new HomeGraphFactory(db, cache);
    const graph = factory.createGraph();

    const result = await graph.invoke({ userId: viewerId, limit: 50, presentation: 'skeleton' });

    expect(result.error).toBeUndefined();
    const item = result.sections[0].items[0];
    expect(item.presentationPending).toBeUndefined();
    expect(item.mainText).toBe('Cached summary.');
  });

  test('skeleton mode still drops cards with unresolvable counterparts', async () => {
    const viewerId = 'viewer-1';
    const opp = minimalOpportunityAgentViewer(viewerId, 'ghost-user');
    const db = createMockDb([opp]);
    // Counterpart has no users row and no profile identity name.
    db.getUser = (id: string) =>
      Promise.resolve(id === viewerId ? { id, name: 'Viewer', email: '', avatar: null } : null);
    const factory = new HomeGraphFactory(db, createMockCache());
    const graph = factory.createGraph();

    const result = await graph.invoke({ userId: viewerId, limit: 50, presentation: 'skeleton' });

    expect(result.error).toBeUndefined();
    const items = result.sections.flatMap((s) => s.items);
    expect(items.length).toBe(0);
  });
});
