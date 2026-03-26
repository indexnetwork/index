/**
 * Integration tests for all database adapters in database.adapter.ts.
 * Requires DATABASE_URL and migrated schema. Run: bun test src/adapters/database.adapter.spec.ts
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import db from '../../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
  indexes,
  indexMembers,
  intents,
  intentIndexes,
  opportunities,
  hydeDocuments,
} from '../../schemas/database.schema';
import {
  IntentDatabaseAdapter,
  ChatDatabaseAdapter,
  ProfileDatabaseAdapter,
  OpportunityDatabaseAdapter,
  IndexGraphDatabaseAdapter,
  HydeDatabaseAdapter,
} from '../database.adapter';
import { AuthDatabaseAdapter } from '../auth.adapter';

const TEST_PREFIX = 'db_adapter_spec_' + Date.now() + '_';

interface TestFixture {
  userAId: string;
  userBId: string;
  indexId: string;
  intent1Id: string;
  intent2Id: string | null;
  /** Extra intent ids created during tests (e.g. Chat createIntent) for cleanup */
  extraIntentIds: string[];
}
let fixture: TestFixture;
let intent2Id: string | null = null;

beforeAll(async () => {
  const userAId = uuidv4();
  const userBId = uuidv4();
  const indexId = uuidv4();
  const intent1Id = uuidv4();
  await db.insert(users).values([
    {
      id: userAId,
      email: TEST_PREFIX + userAId + '@test.com',
      name: TEST_PREFIX + 'UserA',
    },
    {
      id: userBId,
      email: TEST_PREFIX + userBId + '@test.com',
      name: TEST_PREFIX + 'UserB',
    },
  ]);
  await db.insert(userProfiles).values({
    userId: userAId,
    identity: { name: 'User A', bio: 'Bio A', location: '' },
    narrative: { context: 'Context A' },
    attributes: { interests: [], skills: [] },
  });
  await db.insert(indexes).values({
    id: indexId,
    title: TEST_PREFIX + 'Test Index',
    prompt: 'Test index prompt',
  });
  await db.insert(indexMembers).values([
    { indexId, userId: userAId, permissions: ['owner'], autoAssign: false },
    { indexId, userId: userBId, permissions: [], prompt: 'Member prompt', autoAssign: true },
  ]);
  await db.insert(intents).values({
    id: intent1Id,
    userId: userAId,
    payload: TEST_PREFIX + 'Intent 1 payload',
    summary: 'Summary 1',
    sourceType: 'discovery_form',
    sourceId: userAId,
  });
  await db.insert(intentIndexes).values({ intentId: intent1Id, indexId });
  fixture = { userAId, userBId, indexId, intent1Id, intent2Id: null, extraIntentIds: [] };
});

afterAll(async () => {
  const intentIds = [
    fixture.intent1Id,
    fixture.intent2Id,
    ...fixture.extraIntentIds,
  ].filter(Boolean) as string[];
  if (intentIds.length > 0) {
    await db.delete(intentIndexes).where(inArray(intentIndexes.intentId, intentIds));
    await db.delete(intents).where(inArray(intents.id, intentIds));
  }
  await db.delete(opportunities).where(sql`${opportunities.context}->>'indexId' = ${fixture.indexId}`);
  await db.delete(indexMembers).where(eq(indexMembers.indexId, fixture.indexId));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, [fixture.userAId, fixture.userBId]));
  await db.delete(indexes).where(eq(indexes.id, fixture.indexId));
  await db.delete(users).where(inArray(users.id, [fixture.userAId, fixture.userBId]));
});

// ═══════════════════════════════════════════════════════════════════════════════
// IntentDatabaseAdapter
// ═══════════════════════════════════════════════════════════════════════════════
describe('IntentDatabaseAdapter', () => {
  const adapter = new IntentDatabaseAdapter();

  it('should return empty array for user with no intents', async () => {
    const list = await adapter.getActiveIntents(fixture.userBId);
    expect(list).toEqual([]);
  });

  it('should return active intents for user', async () => {
    const list = await adapter.getActiveIntents(fixture.userAId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((i) => i.id === fixture.intent1Id && i.payload.includes('Intent 1'))).toBe(true);
  });

  it('should create intent and return row', async () => {
    const created = await adapter.createIntent({
      userId: fixture.userBId,
      payload: TEST_PREFIX + 'New intent payload',
      summary: 'New summary',
    });
    expect(created.id).toBeDefined();
    expect(created.payload).toContain('New intent payload');
    expect(created.userId).toBe(fixture.userBId);
    intent2Id = created.id;
    fixture.intent2Id = intent2Id;
  });

  it('should update intent', async () => {
    if (!intent2Id) throw new Error('intent2Id not set');
    const updated = await adapter.updateIntent(intent2Id, {
      payload: TEST_PREFIX + 'Updated payload',
      summary: 'Updated summary',
    });
    expect(updated).not.toBeNull();
    expect(updated!.payload).toContain('Updated payload');
    expect(updated!.summary).toBe('Updated summary');
  });

  it('should archive intent', async () => {
    if (!intent2Id) throw new Error('intent2Id not set');
    const result = await adapter.archiveIntent(intent2Id);
    expect(result.success).toBe(true);
    const list = await adapter.getActiveIntents(fixture.userBId);
    expect(list.some((i) => i.id === intent2Id)).toBe(false);
  });

  it('should return success: false when archiving non-existent intent', async () => {
    const result = await adapter.archiveIntent(uuidv4());
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ChatDatabaseAdapter
// ═══════════════════════════════════════════════════════════════════════════════
describe('ChatDatabaseAdapter', () => {
  const adapter = new ChatDatabaseAdapter();

  it('should get profile when exists', async () => {
    const profile = await adapter.getProfile(fixture.userAId);
    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe(fixture.userAId);
    expect(profile!.identity).toEqual({ name: 'User A', bio: 'Bio A', location: '' });
  });

  it('should get null profile when missing', async () => {
    const profile = await adapter.getProfile(fixture.userBId);
    expect(profile).toBeNull();
  });

  it('should get active intents for user', async () => {
    const list = await adapter.getActiveIntents(fixture.userAId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((i) => i.id === fixture.intent1Id)).toBe(true);
  });

  it('should create intent via Chat adapter', async () => {
    const created = await adapter.createIntent({
      userId: fixture.userBId,
      payload: TEST_PREFIX + 'Chat adapter intent',
    });
    expect(created.id).toBeDefined();
    expect(created.userId).toBe(fixture.userBId);
    fixture.extraIntentIds.push(created.id);
    const list = await adapter.getActiveIntents(fixture.userBId);
    expect(list.some((i) => i.id === created.id)).toBe(true);
    await adapter.archiveIntent(created.id);
  });

  it('should get intents in index for member by index id', async () => {
    const list = await adapter.getIntentsInIndexForMember(fixture.userAId, fixture.indexId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((i) => i.id === fixture.intent1Id)).toBe(true);
  });

  it('should get user by id', async () => {
    const user = await adapter.getUser(fixture.userAId);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(fixture.userAId);
    expect(user!.name).toContain('UserA');
  });

  it('should save profile and then get it', async () => {
    const profile = {
      userId: fixture.userBId,
      identity: { name: 'User B', bio: 'Bio B', location: '' },
      narrative: { context: 'Context B' },
      attributes: { interests: ['x'], skills: ['y'] },
      embedding: null as number[] | null,
    };
    await adapter.saveProfile(fixture.userBId, profile);
    const got = await adapter.getProfile(fixture.userBId);
    expect(got).not.toBeNull();
    expect(got!.identity.name).toBe('User B');
    expect(got!.attributes.interests).toEqual(['x']);
  });

  it('should save HyDE profile to hyde_documents', async () => {
    const desc = 'Hypothetical description';
    const embedding = new Array(2000).fill(0.1);
    await adapter.saveHydeDocument({
      sourceType: 'profile',
      sourceId: fixture.userAId,
      strategy: 'mirror',
      targetCorpus: 'profiles',
      hydeText: desc,
      hydeEmbedding: embedding,
    });
    const doc = await adapter.getHydeDocument('profile', fixture.userAId, 'mirror');
    expect(doc).not.toBeNull();
    expect(doc!.hydeText).toBe(desc);
  });

  it('should get index memberships for user', async () => {
    const memberships = await adapter.getIndexMemberships(fixture.userAId);
    expect(memberships.length).toBeGreaterThanOrEqual(1);
    const m = memberships.find((x) => x.indexId === fixture.indexId);
    expect(m).toBeDefined();
    expect(m!.indexTitle).toContain('Test Index');
  });

  it('should get user index ids for auto-assign member', async () => {
    const indexIds = await adapter.getUserIndexIds(fixture.userBId);
    expect(indexIds).toContain(fixture.indexId);
  });

  it('should get intent for indexing', async () => {
    const row = await adapter.getIntentForIndexing(fixture.intent1Id);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(fixture.intent1Id);
    expect(row!.userId).toBe(fixture.userAId);
  });

  it('should get index member context for member with autoAssign', async () => {
    const ctx = await adapter.getIndexMemberContext(fixture.indexId, fixture.userBId);
    expect(ctx).not.toBeNull();
    expect(ctx!.indexId).toBe(fixture.indexId);
    expect(ctx!.memberPrompt).toBe('Member prompt');
  });

  it('should report intent assigned to index', async () => {
    const assigned = await adapter.isIntentAssignedToIndex(fixture.intent1Id, fixture.indexId);
    expect(assigned).toBe(true);
  });

  it('should get index ids for intent', async () => {
    const indexIds = await adapter.getIndexIdsForIntent(fixture.intent1Id);
    expect(indexIds).toEqual([fixture.indexId]);
    const empty = await adapter.getIndexIdsForIntent(uuidv4());
    expect(empty).toEqual([]);
  });

  it('should assign and unassign intent to index', async () => {
    const newIntentId = uuidv4();
    await db.insert(intents).values({
      id: newIntentId,
      userId: fixture.userBId,
      payload: TEST_PREFIX + 'For assign test',
      sourceType: 'discovery_form',
      sourceId: fixture.userBId,
    });
    expect(await adapter.isIntentAssignedToIndex(newIntentId, fixture.indexId)).toBe(false);
    await adapter.assignIntentToIndex(newIntentId, fixture.indexId);
    expect(await adapter.isIntentAssignedToIndex(newIntentId, fixture.indexId)).toBe(true);
    await adapter.unassignIntentFromIndex(newIntentId, fixture.indexId);
    expect(await adapter.isIntentAssignedToIndex(newIntentId, fixture.indexId)).toBe(false);
    await db.delete(intents).where(eq(intents.id, newIntentId));
  });

  it('should get owned indexes for owner', async () => {
    const owned = await adapter.getOwnedIndexes(fixture.userAId);
    expect(owned.length).toBeGreaterThanOrEqual(1);
    const o = owned.find((x) => x.id === fixture.indexId);
    expect(o).toBeDefined();
    expect(o!.memberCount).toBeGreaterThanOrEqual(1);
    expect(o!.intentCount).toBeGreaterThanOrEqual(1);
  });

  it('should report index owner', async () => {
    expect(await adapter.isIndexOwner(fixture.indexId, fixture.userAId)).toBe(true);
    expect(await adapter.isIndexOwner(fixture.indexId, fixture.userBId)).toBe(false);
  });

  it('should get index members for member', async () => {
    const members = await adapter.getIndexMembersForMember(fixture.indexId, fixture.userBId);
    expect(members.length).toBeGreaterThanOrEqual(1);
    expect(members.some((m) => m.userId === fixture.userAId || m.userId === fixture.userBId)).toBe(true);
  });

  it('should get index members for owner', async () => {
    const members = await adapter.getIndexMembersForOwner(fixture.indexId, fixture.userAId);
    expect(members.length).toBeGreaterThanOrEqual(1);
  });

  it('should throw when getIndexMembersForOwner as non-owner', async () => {
    await expect(adapter.getIndexMembersForOwner(fixture.indexId, fixture.userBId)).rejects.toThrow('Access denied');
  });

  it('should get index intents for owner', async () => {
    const list = await adapter.getIndexIntentsForOwner(fixture.indexId, fixture.userAId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((i) => i.id === fixture.intent1Id)).toBe(true);
  });

  it('should get index intents for member', async () => {
    const list = await adapter.getIndexIntentsForMember(fixture.indexId, fixture.userBId);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('should report index membership', async () => {
    expect(await adapter.isIndexMember(fixture.indexId, fixture.userAId)).toBe(true);
    expect(await adapter.isIndexMember(fixture.indexId, fixture.userBId)).toBe(true);
    expect(await adapter.isIndexMember(fixture.indexId, uuidv4())).toBe(false);
  });

  describe('getUserByEmail (IND-166)', () => {
    const caseTestUserId = uuidv4();
    const caseTestEmail = TEST_PREFIX + 'CaseSensitive@Test.COM';
    const softDeleteUserId = uuidv4();
    const softDeleteEmail = TEST_PREFIX + 'softdeleted@test.com';

    it('setup: create test users for email lookup tests', async () => {
      // User with mixed-case email stored as-is (simulating pre-normalization data)
      await db.insert(users).values({
        id: caseTestUserId,
        email: caseTestEmail.toLowerCase(), // stored normalized
        name: TEST_PREFIX + 'CaseUser',
      });
      // Soft-deleted user
      await db.insert(users).values({
        id: softDeleteUserId,
        email: softDeleteEmail,
        name: TEST_PREFIX + 'DeletedUser',
        deletedAt: new Date(),
      });
    });

    it('should find user with case-insensitive email lookup', async () => {
      // Search with uppercase variant
      const found = await adapter.getUserByEmail(caseTestEmail);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(caseTestUserId);
    });

    it('should find user when searching with lowercase email', async () => {
      const found = await adapter.getUserByEmail(caseTestEmail.toLowerCase());
      expect(found).not.toBeNull();
      expect(found!.id).toBe(caseTestUserId);
    });

    it('should find user when searching with all-uppercase email', async () => {
      const found = await adapter.getUserByEmail(caseTestEmail.toUpperCase());
      expect(found).not.toBeNull();
      expect(found!.id).toBe(caseTestUserId);
    });

    it('should NOT find soft-deleted user', async () => {
      const found = await adapter.getUserByEmail(softDeleteEmail);
      expect(found).toBeNull();
    });

    it('should return null for non-existent email', async () => {
      const found = await adapter.getUserByEmail('nonexistent-' + Date.now() + '@test.com');
      expect(found).toBeNull();
    });

    it('cleanup: remove test users', async () => {
      await db.delete(users).where(inArray(users.id, [caseTestUserId, softDeleteUserId]));
    });
  });

  it('should update index settings as owner', async () => {
    const updated = await adapter.updateIndexSettings(fixture.indexId, fixture.userAId, {
      title: TEST_PREFIX + 'Updated Title',
    });
    expect(updated.title).toContain('Updated Title');
    const again = await adapter.getOwnedIndexes(fixture.userAId);
    const idx = again.find((x) => x.id === fixture.indexId);
    expect(idx!.title).toContain('Updated Title');
  });

  it('should throw when updateIndexSettings as non-owner', async () => {
    await expect(
      adapter.updateIndexSettings(fixture.indexId, fixture.userBId, { title: 'Hacked' })
    ).rejects.toThrow('Access denied');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ProfileDatabaseAdapter
// ═══════════════════════════════════════════════════════════════════════════════
describe('ProfileDatabaseAdapter', () => {
  const adapter = new ProfileDatabaseAdapter();

  it('should get profile when exists', async () => {
    const profile = await adapter.getProfile(fixture.userAId);
    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe(fixture.userAId);
  });

  it('should save profile (upsert)', async () => {
    const profile = {
      userId: fixture.userBId,
      identity: { name: 'P B', bio: 'Bio', location: '' },
      narrative: { context: 'N' },
      attributes: { interests: [], skills: [] },
      embedding: null as number[] | null,
    };
    await adapter.saveProfile(fixture.userBId, profile);
    const got = await adapter.getProfile(fixture.userBId);
    expect(got!.identity.name).toBe('P B');
  });

  it('should save HyDE profile to hyde_documents', async () => {
    await adapter.saveHydeDocument({
      sourceType: 'profile',
      sourceId: fixture.userBId,
      strategy: 'mirror',
      targetCorpus: 'profiles',
      hydeText: 'HyDE desc',
      hydeEmbedding: new Array(2000).fill(0.2),
    });
    const hydeAdapter = new HydeDatabaseAdapter();
    const doc = await hydeAdapter.getHydeDocument('profile', fixture.userBId, 'mirror');
    expect(doc).not.toBeNull();
    expect(doc!.hydeText).toBe('HyDE desc');
  });

  it('should get user', async () => {
    const user = await adapter.getUser(fixture.userAId);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(fixture.userAId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OpportunityDatabaseAdapter
// ═══════════════════════════════════════════════════════════════════════════════
describe('OpportunityDatabaseAdapter', () => {
  const adapter = new OpportunityDatabaseAdapter();

  it('should get profile when exists', async () => {
    const profile = await adapter.getProfile(fixture.userAId);
    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe(fixture.userAId);
  });

  it('should return null for user with no profile', async () => {
    const newUserId = uuidv4();
    await db.insert(users).values({
      id: newUserId,
      email: TEST_PREFIX + newUserId + '@test.com',
      name: 'NoProfile',
    });
    const profile = await adapter.getProfile(newUserId);
    expect(profile).toBeNull();
    await db.delete(users).where(eq(users.id, newUserId));
  });

  it('should create opportunity with JSONB actors and query by actor', async () => {
    const created = await adapter.createOpportunity({
      detection: {
        source: 'opportunity_graph',
        createdBy: 'agent-opportunity-finder',
        triggeredBy: fixture.intent1Id,
        timestamp: new Date().toISOString(),
      },
      actors: [
        { indexId: fixture.indexId, userId: fixture.userAId, role: 'agent', intent: fixture.intent1Id },
        { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
      ],
      interpretation: {
        category: 'collaboration',
        reasoning: 'Test opportunity',
        confidence: 0.85,
      },
      context: { indexId: fixture.indexId },
      confidence: '0.85',
    });
    expect(created.id).toBeDefined();
    expect(created.actors).toHaveLength(2);
    expect(created.status).toBe('pending');

    const forUserA = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId });
    expect(forUserA.some((o) => o.id === created.id)).toBe(true);
    const forUserB = await adapter.getOpportunitiesForUser(fixture.userBId);
    expect(forUserB.some((o) => o.id === created.id)).toBe(true);

    const byId = await adapter.getOpportunity(created.id);
    expect(byId).not.toBeNull();
    expect(byId!.interpretation.reasoning).toBe('Test opportunity');
  });

  it('should report deduplication (opportunityExistsBetweenActors)', async () => {
    const actorIds = [fixture.userAId, fixture.userBId];
    const exists = await adapter.opportunityExistsBetweenActors(actorIds, fixture.indexId);
    expect(exists).toBe(true);

    const otherUserId = uuidv4();
    const notExists = await adapter.opportunityExistsBetweenActors([fixture.userAId, otherUserId], fixture.indexId);
    expect(notExists).toBe(false);
  });

  it('should update opportunity status and persist', async () => {
    const list = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId, limit: 1 });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const opp = list[0];
    const updated = await adapter.updateOpportunityStatus(opp.id, 'accepted');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('accepted');
    const refetched = await adapter.getOpportunity(opp.id);
    expect(refetched!.status).toBe('accepted');
  });

  describe('role-based visibility (getOpportunitiesForUser)', () => {
    const thirdUserId = uuidv4();

    it('latent, no introducer: patient sees, agent does not', async () => {
      const created = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'agent-opportunity-finder', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'patient' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'agent' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Test', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
        status: 'latent',
      });
      const forPatient = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId });
      const forAgent = await adapter.getOpportunitiesForUser(fixture.userBId, { indexId: fixture.indexId });
      expect(forPatient.some((o) => o.id === created.id)).toBe(true);
      expect(forAgent.some((o) => o.id === created.id)).toBe(false);
    });

    it('latent, with introducer: only introducer sees', async () => {
      const created = await adapter.createOpportunity({
        detection: { source: 'manual', createdBy: fixture.userAId, timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'introducer' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
          { indexId: fixture.indexId, userId: thirdUserId, role: 'agent' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Test', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
        status: 'latent',
      });
      const forIntroducer = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId });
      const forPatient = await adapter.getOpportunitiesForUser(fixture.userBId, { indexId: fixture.indexId });
      expect(forIntroducer.some((o) => o.id === created.id)).toBe(true);
      expect(forPatient.some((o) => o.id === created.id)).toBe(false);
    });

    it('pending, no introducer: both patient and agent see', async () => {
      const created = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'agent-opportunity-finder', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'patient' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'agent' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Test', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
        status: 'pending',
      });
      const forPatient = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId });
      const forAgent = await adapter.getOpportunitiesForUser(fixture.userBId, { indexId: fixture.indexId });
      expect(forPatient.some((o) => o.id === created.id)).toBe(true);
      expect(forAgent.some((o) => o.id === created.id)).toBe(true);
    });

    it('pending, with introducer: introducer and patient see, agent does not', async () => {
      const created = await adapter.createOpportunity({
        detection: { source: 'manual', createdBy: fixture.userAId, timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'introducer' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
          { indexId: fixture.indexId, userId: thirdUserId, role: 'agent' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Test', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
        status: 'pending',
      });
      const forIntroducer = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId });
      const forPatient = await adapter.getOpportunitiesForUser(fixture.userBId, { indexId: fixture.indexId });
      const forAgent = await adapter.getOpportunitiesForUser(thirdUserId, { indexId: fixture.indexId });
      expect(forIntroducer.some((o) => o.id === created.id)).toBe(true);
      expect(forPatient.some((o) => o.id === created.id)).toBe(true);
      expect(forAgent.some((o) => o.id === created.id)).toBe(false);
    });

    it('accepted, with introducer: all actors see', async () => {
      const created = await adapter.createOpportunity({
        detection: { source: 'manual', createdBy: fixture.userAId, timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'introducer' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
          { indexId: fixture.indexId, userId: thirdUserId, role: 'agent' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Test', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
        status: 'accepted',
      });
      const forIntroducer = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId });
      const forPatient = await adapter.getOpportunitiesForUser(fixture.userBId, { indexId: fixture.indexId });
      const forAgent = await adapter.getOpportunitiesForUser(thirdUserId, { indexId: fixture.indexId });
      expect(forIntroducer.some((o) => o.id === created.id)).toBe(true);
      expect(forPatient.some((o) => o.id === created.id)).toBe(true);
      expect(forAgent.some((o) => o.id === created.id)).toBe(true);
    });

    it('latent, peers: both peers see', async () => {
      const created = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'agent-opportunity-finder', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'peer' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'peer' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Test', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
        status: 'latent',
      });
      const forPeerA = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId });
      const forPeerB = await adapter.getOpportunitiesForUser(fixture.userBId, { indexId: fixture.indexId });
      expect(forPeerA.some((o) => o.id === created.id)).toBe(true);
      expect(forPeerB.some((o) => o.id === created.id)).toBe(true);
    });
  });

  describe('draft visibility (getOpportunitiesForUser)', () => {
    it('without conversationId excludes draft opportunities', async () => {
      const created = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'agent', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'party' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'party' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Test', confidence: 0.8 },
        context: { indexId: fixture.indexId, conversationId: 'chat-session-1' },
        confidence: '0.8',
        status: 'draft',
      });
      const list = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId });
      expect(list.some((o) => o.id === created.id)).toBe(false);
    });

    it('with conversationId includes draft only for that session', async () => {
      const conv1 = 'conv-session-1';
      const conv2 = 'conv-session-2';
      const draft1 = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'agent', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'party' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'party' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Draft 1', confidence: 0.8 },
        context: { indexId: fixture.indexId, conversationId: conv1 },
        confidence: '0.8',
        status: 'draft',
      });
      const draft2 = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'agent', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'party' },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'party' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Draft 2', confidence: 0.8 },
        context: { indexId: fixture.indexId, conversationId: conv2 },
        confidence: '0.8',
        status: 'draft',
      });
      const forConv1 = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId, conversationId: conv1 });
      const forConv2 = await adapter.getOpportunitiesForUser(fixture.userAId, { indexId: fixture.indexId, conversationId: conv2 });
      expect(forConv1.some((o) => o.id === draft1.id)).toBe(true);
      expect(forConv1.some((o) => o.id === draft2.id)).toBe(false);
      expect(forConv2.some((o) => o.id === draft2.id)).toBe(true);
      expect(forConv2.some((o) => o.id === draft1.id)).toBe(false);
    });
  });

  describe('expireStaleOpportunities', () => {
    it('should expire opportunities past their expiresAt', async () => {
      const past = new Date(Date.now() - 60_000);
      const created = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'agent', intent: fixture.intent1Id },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Stale opp', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
        expiresAt: past,
      });
      expect(created.status).toBe('pending');

      const count = await adapter.expireStaleOpportunities();
      expect(count).toBeGreaterThanOrEqual(1);

      const refetched = await adapter.getOpportunity(created.id);
      expect(refetched!.status).toBe('expired');
    });

    it('should not expire opportunities with future expiresAt', async () => {
      const future = new Date(Date.now() + 3_600_000);
      const created = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'agent', intent: fixture.intent1Id },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Future opp', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
        expiresAt: future,
      });

      await adapter.expireStaleOpportunities();
      const refetched = await adapter.getOpportunity(created.id);
      expect(refetched!.status).toBe('pending');
    });

    it('should not expire accepted or rejected opportunities even if past expiresAt', async () => {
      const past = new Date(Date.now() - 60_000);
      const accepted = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'agent', intent: fixture.intent1Id },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Accepted opp', confidence: 0.9 },
        context: { indexId: fixture.indexId },
        confidence: '0.9',
        status: 'accepted',
        expiresAt: past,
      });
      const rejected = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'agent', intent: fixture.intent1Id },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'Rejected opp', confidence: 0.7 },
        context: { indexId: fixture.indexId },
        confidence: '0.7',
        status: 'rejected',
        expiresAt: past,
      });

      await adapter.expireStaleOpportunities();

      const refetchedAccepted = await adapter.getOpportunity(accepted.id);
      const refetchedRejected = await adapter.getOpportunity(rejected.id);
      expect(refetchedAccepted!.status).toBe('accepted');
      expect(refetchedRejected!.status).toBe('rejected');
    });

    it('should not expire opportunities without expiresAt', async () => {
      const created = await adapter.createOpportunity({
        detection: { source: 'opportunity_graph', createdBy: 'test', timestamp: new Date().toISOString() },
        actors: [
          { indexId: fixture.indexId, userId: fixture.userAId, role: 'agent', intent: fixture.intent1Id },
          { indexId: fixture.indexId, userId: fixture.userBId, role: 'patient' },
        ],
        interpretation: { category: 'collaboration', reasoning: 'No expiry opp', confidence: 0.8 },
        context: { indexId: fixture.indexId },
        confidence: '0.8',
      });

      await adapter.expireStaleOpportunities();
      const refetched = await adapter.getOpportunity(created.id);
      expect(refetched!.status).toBe('pending');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// IndexGraphDatabaseAdapter
// ═══════════════════════════════════════════════════════════════════════════════
describe('IndexGraphDatabaseAdapter', () => {
  const adapter = new IndexGraphDatabaseAdapter();

  it('should get intent for indexing', async () => {
    const row = await adapter.getIntentForIndexing(fixture.intent1Id);
    expect(row).not.toBeNull();
    expect(row!.id).toBe(fixture.intent1Id);
    expect(row!.payload).toContain('Intent 1');
  });

  it('should return null for non-existent intent', async () => {
    const row = await adapter.getIntentForIndexing(uuidv4());
    expect(row).toBeNull();
  });

  it('should get index member context', async () => {
    const ctx = await adapter.getIndexMemberContext(fixture.indexId, fixture.userBId);
    expect(ctx).not.toBeNull();
    expect(ctx!.indexId).toBe(fixture.indexId);
    expect(ctx!.memberPrompt).toBe('Member prompt');
  });

  it('should return null for non-member', async () => {
    const ctx = await adapter.getIndexMemberContext(fixture.indexId, uuidv4());
    expect(ctx).toBeNull();
  });

  it('should report intent assigned to index', async () => {
    expect(await adapter.isIntentAssignedToIndex(fixture.intent1Id, fixture.indexId)).toBe(true);
  });

  it('should get index ids for intent', async () => {
    const indexIds = await adapter.getIndexIdsForIntent(fixture.intent1Id);
    expect(indexIds).toEqual([fixture.indexId]);
    const empty = await adapter.getIndexIdsForIntent(uuidv4());
    expect(empty).toEqual([]);
  });

  it('should assign and unassign intent to index', async () => {
    const newIntentId = uuidv4();
    await db.insert(intents).values({
      id: newIntentId,
      userId: fixture.userBId,
      payload: TEST_PREFIX + 'Index graph assign test',
      sourceType: 'discovery_form',
      sourceId: fixture.userBId,
    });
    expect(await adapter.isIntentAssignedToIndex(newIntentId, fixture.indexId)).toBe(false);
    await adapter.assignIntentToIndex(newIntentId, fixture.indexId);
    expect(await adapter.isIntentAssignedToIndex(newIntentId, fixture.indexId)).toBe(true);
    await adapter.unassignIntentFromIndex(newIntentId, fixture.indexId);
    expect(await adapter.isIntentAssignedToIndex(newIntentId, fixture.indexId)).toBe(false);
    await db.delete(intentIndexes).where(eq(intentIndexes.intentId, newIntentId));
    await db.delete(intents).where(eq(intents.id, newIntentId));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HydeDatabaseAdapter
// ═══════════════════════════════════════════════════════════════════════════════
describe('HydeDatabaseAdapter', () => {
  const adapter = new HydeDatabaseAdapter();
  const sourceType = 'intent' as const;
  const sourceId = uuidv4();
  const strategy = 'mirror';
  const targetCorpus = 'profiles';
  const embedding = new Array(2000).fill(0).map((_, i) => (i % 100) / 100);

  afterAll(async () => {
    await adapter.deleteHydeDocumentsForSource(sourceType, sourceId);
  });

  describe('save and get by source+strategy', () => {
    it('should create HyDE document and retrieve by source+strategy', async () => {
      const saved = await adapter.saveHydeDocument({
        sourceType,
        sourceId,
        sourceText: 'Looking for a technical co-founder.',
        strategy,
        targetCorpus,
        hydeText: 'I am a technical co-founder seeking a business partner.',
        hydeEmbedding: embedding,
      });

      expect(saved.id).toBeDefined();
      expect(saved.sourceType).toBe(sourceType);
      expect(saved.sourceId).toBe(sourceId);
      expect(saved.strategy).toBe(strategy);
      expect(saved.targetCorpus).toBe(targetCorpus);
      expect(saved.hydeText).toContain('technical co-founder');
      expect(saved.hydeEmbedding).toHaveLength(2000);

      const found = await adapter.getHydeDocument(sourceType, sourceId, strategy);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(saved.id);
      expect(found!.hydeText).toBe(saved.hydeText);
    });
  });

  describe('saveHydeDocument (upsert)', () => {
    it('should upsert and replace existing document', async () => {
      const first = await adapter.saveHydeDocument({
        sourceType,
        sourceId,
        sourceText: 'First text',
        strategy,
        targetCorpus,
        hydeText: 'First hyde text',
        hydeEmbedding: embedding,
      });

      const updated = await adapter.saveHydeDocument({
        sourceType,
        sourceId,
        sourceText: 'Second text',
        strategy,
        targetCorpus,
        hydeText: 'Second hyde text (replaced)',
        hydeEmbedding: embedding.slice().reverse(),
      });

      expect(updated.id).toBe(first.id);
      expect(updated.hydeText).toBe('Second hyde text (replaced)');

      const found = await adapter.getHydeDocument(sourceType, sourceId, strategy);
      expect(found!.hydeText).toBe('Second hyde text (replaced)');
    });
  });

  describe('getHydeDocumentsForSource', () => {
    it('should return all documents for source', async () => {
      const secondStrategy = 'reciprocal';
      await adapter.saveHydeDocument({
        sourceType,
        sourceId,
        strategy: secondStrategy,
        targetCorpus: 'intents',
        hydeText: 'Reciprocal hyde for intents',
        hydeEmbedding: embedding,
      });

      const all = await adapter.getHydeDocumentsForSource(sourceType, sourceId);
      expect(all.length).toBeGreaterThanOrEqual(2);
      const strategies = all.map((d) => d.strategy);
      expect(strategies).toContain(strategy);
      expect(strategies).toContain(secondStrategy);
    });
  });

  describe('deleteHydeDocumentsForSource', () => {
    it('should delete by source and clear all strategies', async () => {
      const count = await adapter.deleteHydeDocumentsForSource(sourceType, sourceId);
      expect(count).toBeGreaterThanOrEqual(2);

      const after = await adapter.getHydeDocumentsForSource(sourceType, sourceId);
      expect(after).toHaveLength(0);

      const one = await adapter.getHydeDocument(sourceType, sourceId, strategy);
      expect(one).toBeNull();
    });
  });
});

describe('HydeDatabaseAdapter – deleteExpired and getStale', () => {
  const adapter = new HydeDatabaseAdapter();
  const sourceType = 'profile' as const;
  const sourceId = uuidv4();
  const embedding = new Array(2000).fill(0).map((_, i) => (i % 100) / 100);
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);

  afterAll(async () => {
    await adapter.deleteHydeDocumentsForSource(sourceType, sourceId);
  });

  it('should delete only expired documents', async () => {
    await adapter.saveHydeDocument({
      sourceType,
      sourceId,
      strategy: 'mentor',
      targetCorpus: 'profiles',
      hydeText: 'Expired doc',
      hydeEmbedding: embedding,
      expiresAt: past,
    });
    await adapter.saveHydeDocument({
      sourceType,
      sourceId,
      strategy: 'investor',
      targetCorpus: 'profiles',
      hydeText: 'Not expired doc',
      hydeEmbedding: embedding,
      expiresAt: future,
    });

    const deleted = await adapter.deleteExpiredHydeDocuments();
    expect(deleted).toBeGreaterThanOrEqual(1);

    const forSource = await adapter.getHydeDocumentsForSource(sourceType, sourceId);
    const mentorDoc = forSource.find((d) => d.strategy === 'mentor');
    const investorDoc = forSource.find((d) => d.strategy === 'investor');
    expect(mentorDoc).toBeUndefined();
    expect(investorDoc).toBeDefined();
  });

  it('should return stale documents by createdAt threshold', async () => {
    const staleThreshold = new Date(Date.now() + 10_000);
    const stale = await adapter.getStaleHydeDocuments(staleThreshold);
    expect(Array.isArray(stale)).toBe(true);
    for (const doc of stale) {
      expect(doc.createdAt.getTime()).toBeLessThan(staleThreshold.getTime());
    }
  });
});

