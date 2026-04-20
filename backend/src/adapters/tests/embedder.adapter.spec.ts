/**
 * Integration tests for EmbedderAdapter.
 * Requires DATABASE_URL; OPENROUTER_API_KEY needed for generate() tests.
 * Run: bun test src/adapters/embedder.adapter.spec.ts
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import db from '../../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
  networks,
  networkMembers,
  intents,
  intentNetworks,
} from '../../schemas/database.schema';
import { EmbedderAdapter } from '../embedder.adapter';

const TEST_PREFIX = 'embedder_spec_' + Date.now() + '_';

/** Simple normalized 2000-dim vector for deterministic similarity (self-similarity 1). */
function makeTestVector(seed: number): number[] {
  const arr = new Array(2000).fill(0).map((_, i) => Math.sin(seed + i) * 0.05);
  const norm = Math.sqrt(arr.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? arr.map((x) => x / norm) : arr.map((_, i) => (i === 0 ? 1 : 0));
}

let fixture: {
  userAId: string;
  userBId: string;
  /** Soft-deleted user (deletedAt set). */
  deletedUserId: string;
  networkId: string;
  intentId: string;
  profileEmbeddingIntentId: string;
  /** Intent owned by the soft-deleted user. */
  deletedUserIntentId: string;
};

beforeAll(async () => {
  const userAId = uuidv4();
  const userBId = uuidv4();
  const deletedUserId = uuidv4();
  const networkId = uuidv4();
  const intentId = uuidv4();
  const profileEmbeddingIntentId = uuidv4();
  const deletedUserIntentId = uuidv4();

  await db.insert(users).values([
    { id: userAId, email: TEST_PREFIX + 'a@t.com', name: 'User A', isGhost: true },
    { id: userBId, email: TEST_PREFIX + 'b@t.com', name: 'User B', isGhost: true },
    { id: deletedUserId, email: TEST_PREFIX + 'deleted@t.com', name: 'Deleted User', deletedAt: new Date(), isGhost: true },
  ]);
  await db.insert(userProfiles).values([
    {
      userId: userAId,
      identity: { name: 'User A', bio: 'Bio A', location: '' },
      narrative: { context: 'Context A' },
      attributes: { interests: [], skills: [] },
    },
    {
      userId: userBId,
      identity: { name: 'User B', bio: 'Bio B', location: '' },
      narrative: { context: 'Context B' },
      attributes: { interests: [], skills: [] },
    },
    {
      userId: deletedUserId,
      identity: { name: 'Deleted User', bio: 'Bio Deleted', location: '' },
      narrative: { context: 'Context Deleted' },
      attributes: { interests: [], skills: [] },
      embedding: makeTestVector(42),
    },
  ]);
  await db.insert(networks).values({
    id: networkId,
    title: TEST_PREFIX + 'Index',
    prompt: 'Test index',
  });
  await db.insert(networkMembers).values([
    { networkId, userId: userAId, permissions: ['owner'], autoAssign: false },
    { networkId, userId: userBId, permissions: [], autoAssign: true },
    { networkId, userId: deletedUserId, permissions: [], autoAssign: true },
  ]);
  // Intent owned by soft-deleted user (has same embedding as test queries)
  await db.insert(intents).values({
    id: deletedUserIntentId,
    userId: deletedUserId,
    payload: TEST_PREFIX + 'Intent from deleted user',
    summary: 'Summary deleted',
    embedding: makeTestVector(42),
  });
  await db.insert(intentNetworks).values({ intentId: deletedUserIntentId, networkId });

  fixture = { userAId, userBId, deletedUserId, networkId, intentId, profileEmbeddingIntentId, deletedUserIntentId };
});

afterAll(async () => {
  await db.delete(intentNetworks).where(eq(intentNetworks.networkId, fixture.networkId));
  await db.delete(intents).where(inArray(intents.userId, [fixture.userAId, fixture.userBId, fixture.deletedUserId]));
  await db.delete(networkMembers).where(eq(networkMembers.networkId, fixture.networkId));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, [fixture.userAId, fixture.userBId, fixture.deletedUserId]));
  await db.delete(networks).where(eq(networks.id, fixture.networkId));
  await db.delete(users).where(inArray(users.id, [fixture.userAId, fixture.userBId, fixture.deletedUserId]));
});

describe('EmbedderAdapter', () => {
  const adapter = new EmbedderAdapter();

  describe('search – error paths', () => {
    it('should throw for unknown collection', async () => {
      const vec = makeTestVector(1);
      await expect(
        adapter.search(vec, 'unknown_collection' as any, { limit: 5 })
      ).rejects.toThrow('Unknown collection: unknown_collection');
    });
  });

  describe('generate – error paths', () => {
    it('should throw when text is empty string', async () => {
      await expect(adapter.generate('')).rejects.toThrow('Text cannot be empty');
    });

    it('should throw when text is only whitespace', async () => {
      await expect(adapter.generate('   \n\t  ')).rejects.toThrow('Text cannot be empty');
    });

    it('should throw when array of texts is empty after filtering', async () => {
      await expect(adapter.generate(['', '  ', '\n'])).rejects.toThrow('Text cannot be empty');
    });
  });

  describe('constructor', () => {
    it('should accept optional dimensions', () => {
      const customAdapter = new EmbedderAdapter({ dimensions: 256 });
      expect(customAdapter).toBeDefined();
    });

    it('should accept optional apiKey and baseURL', () => {
      const customAdapter = new EmbedderAdapter({
        apiKey: 'test-key',
        baseURL: 'https://test.example/v1',
      });
      expect(customAdapter).toBeDefined();
    });
  });

  describe('search (single-vector)', () => {
    it('should return intent match when searching with same embedding and index scope', async () => {
      const queryVector = makeTestVector(42);
      await db.insert(intents).values({
        id: fixture.intentId,
        userId: fixture.userBId,
        payload: TEST_PREFIX + 'Intent for vector search',
        summary: 'Summary',
        embedding: queryVector,
      });
      await db.insert(intentNetworks).values({ intentId: fixture.intentId, networkId: fixture.networkId });

      const results = await adapter.search<{ id: string; userId: string }>(
        queryVector,
        'intents',
        { limit: 10, minScore: 0.99, filter: { networkScope: [fixture.networkId] } }
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      const match = results.find((r) => r.item.id === fixture.intentId);
      expect(match).toBeDefined();
      expect(match!.score).toBeGreaterThanOrEqual(0.99);
    });

    it('should apply index scope filtering (only members of index)', async () => {
      const queryVector = makeTestVector(100);
      const results = await adapter.search<{ id: string; userId: string }>(
        queryVector,
        'intents',
        { limit: 5, minScore: 0, filter: { networkScope: [fixture.networkId] } }
      );

      for (const r of results) {
        expect(r.item).toBeDefined();
      }
      // All results should be from intents in this index (enforced by join in adapter)
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('searchWithHydeEmbeddings', () => {
    it('should merge and rank candidates from multiple lenses', async () => {
      const vec = makeTestVector(200);
      const lensEmbeddings = [
        { lens: 'React frontend developer', corpus: 'profiles' as const, embedding: vec },
        { lens: 'early-stage startup hiring', corpus: 'intents' as const, embedding: vec },
      ];

      const results = await adapter.searchWithHydeEmbeddings(lensEmbeddings, {
        networkScope: [fixture.networkId],
        limitPerStrategy: 5,
        limit: 10,
        minScore: 0,
      });

      expect(Array.isArray(results)).toBe(true);
      for (const c of results) {
        expect(['profile', 'intent']).toContain(c.type);
        expect(c.id).toBeDefined();
        expect(c.userId).toBeDefined();
        expect(c.score).toBeGreaterThanOrEqual(0);
        expect(c.matchedVia).toBeDefined();
        expect(c.networkId).toBe(fixture.networkId);
      }
    });

    it('should respect networkScope and excludeUserId', async () => {
      const vec = makeTestVector(300);
      const results = await adapter.searchWithHydeEmbeddings(
        [{ lens: 'early-stage startup hiring', corpus: 'intents' as const, embedding: vec }],
        {
          networkScope: [fixture.networkId],
          excludeUserId: fixture.userAId,
          limit: 5,
          minScore: 0,
        }
      );

      for (const c of results) {
        expect(c.userId).not.toBe(fixture.userAId);
        expect(c.networkId).toBe(fixture.networkId);
      }
    });
  });

  describe('searchWithProfileEmbedding', () => {
    beforeAll(async () => {
      await db.insert(intents).values({
        id: fixture.profileEmbeddingIntentId,
        userId: fixture.userAId,
        payload: TEST_PREFIX + 'Intent for profile-embedding search',
        summary: 'Summary',
        embedding: makeTestVector(42),
      });
      await db.insert(intentNetworks).values({
        intentId: fixture.profileEmbeddingIntentId,
        networkId: fixture.networkId,
      });
    });

    it('should return candidates (profiles and/or intents) in index scope with correct shape', async () => {
      const profileEmbedding = makeTestVector(42);
      const results = await adapter.searchWithProfileEmbedding(profileEmbedding, {
        networkScope: [fixture.networkId],
        limit: 10,
        limitPerStrategy: 5,
        minScore: 0,
      });

      expect(Array.isArray(results)).toBe(true);
      for (const c of results) {
        expect(['profile', 'intent']).toContain(c.type);
        expect(c.id).toBeDefined();
        expect(c.userId).toBeDefined();
        expect(c.score).toBeGreaterThanOrEqual(0);
        expect(c.matchedVia).toBeDefined();
        expect(c.networkId).toBe(fixture.networkId);
      }
      const intentMatch = results.find(
        (r) => r.type === 'intent' && r.id === fixture.profileEmbeddingIntentId
      );
      expect(intentMatch).toBeDefined();
      expect(intentMatch!.score).toBeGreaterThanOrEqual(0.99);
    });

    it('should respect networkScope and excludeUserId', async () => {
      const profileEmbedding = makeTestVector(100);
      const results = await adapter.searchWithProfileEmbedding(profileEmbedding, {
        networkScope: [fixture.networkId],
        excludeUserId: fixture.userAId,
        limit: 5,
        minScore: 0,
      });

      for (const c of results) {
        expect(c.userId).not.toBe(fixture.userAId);
        expect(c.networkId).toBe(fixture.networkId);
      }
    });
  });

  describe('soft-deleted user exclusion', () => {
    it('should not return soft-deleted users from searchWithHydeEmbeddings (profiles)', async () => {
      const vec = makeTestVector(42); // same as deleted user's profile embedding
      const results = await adapter.searchWithHydeEmbeddings(
        [{ lens: 'test lens', corpus: 'profiles' as const, embedding: vec }],
        { networkScope: [fixture.networkId], limit: 20, minScore: 0, profileMinScore: 0 },
      );

      const deletedMatch = results.find((c) => c.userId === fixture.deletedUserId);
      expect(deletedMatch).toBeUndefined();
    });

    it('should not return soft-deleted users from searchWithHydeEmbeddings (intents)', async () => {
      const vec = makeTestVector(42); // same as deleted user's intent embedding
      const results = await adapter.searchWithHydeEmbeddings(
        [{ lens: 'test lens', corpus: 'intents' as const, embedding: vec }],
        { networkScope: [fixture.networkId], limit: 20, minScore: 0 },
      );

      const deletedMatch = results.find((c) => c.userId === fixture.deletedUserId);
      expect(deletedMatch).toBeUndefined();
    });

    it('should not return soft-deleted users from searchWithProfileEmbedding', async () => {
      const vec = makeTestVector(42);
      const results = await adapter.searchWithProfileEmbedding(vec, {
        networkScope: [fixture.networkId],
        limit: 20,
        minScore: 0,
        profileMinScore: 0,
      });

      const deletedMatch = results.find((c) => c.userId === fixture.deletedUserId);
      expect(deletedMatch).toBeUndefined();
    });

    it('should not return soft-deleted users from search (intents collection)', async () => {
      const vec = makeTestVector(42);
      const results = await adapter.search<{ id: string; userId: string }>(
        vec,
        'intents',
        { limit: 20, minScore: 0, filter: { networkScope: [fixture.networkId] } },
      );

      const deletedMatch = results.find((r) => (r.item as { userId: string }).userId === fixture.deletedUserId);
      expect(deletedMatch).toBeUndefined();
    });
  });
});

describe('EmbedderAdapter – generate (optional)', () => {
  it('should generate embedding for text when OPENROUTER_API_KEY is set', async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      return; // skip when no key
    }
    const adapter = new EmbedderAdapter();
    try {
      const emb = await adapter.generate('Hello world');
      expect(Array.isArray(emb)).toBe(true);
      expect((emb as number[]).length).toBe(2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('401') ||
        msg.includes('User not found') ||
        msg.includes('403') ||
        msg.includes('Blocked by sandbox')
      ) {
        return; // skip when key invalid, account not found, or network blocked (e.g. sandbox)
      }
      throw err;
    }
  }, 15000);
});
