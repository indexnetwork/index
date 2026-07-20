/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { and, eq } from 'drizzle-orm/sql';

import { IntentController } from "../intent.controller";
import { IntentDatabaseAdapter, UserDatabaseAdapter, EnrichmentDatabaseAdapter, ChatDatabaseAdapter } from "../../adapters/database.adapter";
import { deleteNetworkAndMembers } from "./test-helpers";
import { ScopeViolationError } from '../../guards/agent-scope.guard';
import type { AuthenticatedUser } from "../../guards/auth.guard";
import db from '../../lib/drizzle/drizzle';
import { IntentEvents } from '../../events/intent.event';
import { intentNetworks as intentNetworksTable, intents as intentsTable, networkMembers as networkMembersTable, opportunityDiscoveryRuns as opportunityDiscoveryRunsTable } from '../../schemas/database.schema';
import { IntentNetworkMembershipError } from '../../services/intent.service';

// ═══════════════════════════════════════════════════════════════════════════════
// IntentDatabaseAdapter Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("IntentDatabaseAdapter Integration", () => {
  let adapter: IntentDatabaseAdapter;
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  let testIntentId: string;
  const testEmail = `test-intent-adapter-${Date.now()}@example.com`;

  beforeAll(async () => {
    adapter = new IntentDatabaseAdapter();
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) {
      await adapter.deleteByUserId(existingUser.id);
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Intent Adapter User",
      intro: "Test user for intent adapter tests",
      location: "Test City",
    });
    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);
  });

  afterAll(async () => {
    if (testUserId) {
      await adapter.deleteByUserId(testUserId);
      await userAdapter.deleteById(testUserId);
    }
  });

  test("getActiveIntents should return empty array for user with no intents", async () => {
    const intents = await adapter.getActiveIntents(testUserId);
    expect(intents).toEqual([]);
  });

  test("createIntent should create a new intent", async () => {
    const intentData = {
      userId: testUserId,
      payload: "Looking for AI/ML engineers for a startup project",
      summary: "AI/ML engineer search",
      confidence: 0.9,
      inferenceType: 'explicit' as const,
    };

    const created = await adapter.createIntent(intentData);

    expect(created).toBeDefined();
    expect(created.id).toBeDefined();
    expect(created.payload).toBe(intentData.payload);
    expect(created.summary).toBe(intentData.summary);
    expect(created.userId).toBe(testUserId);
    expect(created.isIncognito).toBe(false);
    expect(created.createdAt).toBeDefined();

    testIntentId = created.id;
    console.log(`Created test intent: ${testIntentId}`);
  });

  test("proposal creation atomically requires a current membership", async () => {
    const chatAdapter = new ChatDatabaseAdapter();
    const network = await chatAdapter.createNetwork({
      title: `Intent proposal membership ${Date.now()}`,
    });
    const allowedSourceId = `proposal-member-${crypto.randomUUID()}`;
    const deniedSourceId = `proposal-stale-${crypto.randomUUID()}`;
    let allowedIntentId: string | null = null;

    try {
      await chatAdapter.addMemberToNetwork(network.id, testUserId, 'member');
      const confirmationData = {
        userId: testUserId,
        payload: 'Find climate founders',
        sourceType: 'discovery_form' as const,
        sourceId: allowedSourceId,
      };
      const confirmations = await Promise.all([
        adapter.confirmProposalIntent(confirmationData, network.id),
        adapter.confirmProposalIntent(confirmationData, network.id),
      ]);
      expect(confirmations.map((result) => result.kind).sort()).toEqual(['created', 'existing']);
      const confirmedIds = confirmations.flatMap((result) => (
        result.kind === 'membership_required' ? [] : [result.intent.id]
      ));
      expect(new Set(confirmedIds).size).toBe(1);
      allowedIntentId = confirmedIds[0] ?? null;
      expect(allowedIntentId).not.toBeNull();
      expect(await adapter.isNetworkMember(network.id, testUserId)).toBe(true);

      const persisted = await db.select({ id: intentsTable.id })
        .from(intentsTable)
        .where(and(
          eq(intentsTable.userId, testUserId),
          eq(intentsTable.sourceId, allowedSourceId),
        ));
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.id).toBe(allowedIntentId);
      const assignments = await db.select({ intentId: intentNetworksTable.intentId })
        .from(intentNetworksTable)
        .where(and(
          eq(intentNetworksTable.intentId, allowedIntentId!),
          eq(intentNetworksTable.networkId, network.id),
        ));
      expect(assignments).toHaveLength(1);

      await db.update(networkMembersTable)
        .set({ deletedAt: new Date() })
        .where(eq(networkMembersTable.networkId, network.id));
      expect(await chatAdapter.isNetworkMember(network.id, testUserId)).toBe(false);

      const retry = await adapter.confirmProposalIntent(confirmationData, network.id);
      expect(retry.kind).toBe('existing');
      expect(retry.kind === 'existing' ? retry.intent.id : null).toBe(allowedIntentId);

      const denied = await adapter.confirmProposalIntent({
        userId: testUserId,
        payload: 'This must not persist',
        sourceType: 'discovery_form',
        sourceId: deniedSourceId,
      }, network.id);
      expect(denied).toEqual({ kind: 'membership_required' });
      expect(await adapter.getIntentBySourceId(deniedSourceId, testUserId)).toBeNull();
    } finally {
      await deleteNetworkAndMembers(network.id);
      if (allowedIntentId) {
        await db.delete(intentsTable).where(eq(intentsTable.id, allowedIntentId));
      }
    }
  }, 30_000);

  test("getActiveIntents should return active intents for user", async () => {
    // Should now find the intent we just created
    const intents = await adapter.getActiveIntents(testUserId);

    expect(intents.length).toBe(1);
    expect(intents[0].id).toBe(testIntentId);
    expect(intents[0].payload).toBe("Looking for AI/ML engineers for a startup project");
    expect(intents[0].summary).toBe("AI/ML engineer search");
    expect(intents[0].createdAt).toBeDefined();
  });

  test("updateIntent should update an existing intent", async () => {
    const updatedPayload = "Looking for senior AI/ML engineers with 5+ years experience";
    const updatedSummary = "Senior AI/ML engineer search";

    const updated = await adapter.updateIntent(testIntentId, {
      payload: updatedPayload,
      summary: updatedSummary,
    });

    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(testIntentId);
    expect(updated!.payload).toBe(updatedPayload);
    expect(updated!.summary).toBe(updatedSummary);
    expect(updated!.updatedAt).toBeDefined();
  });

  test("updateIntent should return null for non-existent intent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const updated = await adapter.updateIntent(fakeId, {
      payload: "This should not work",
    });

    expect(updated).toBeNull();
  });

  test("listIntents attaches an empty networks array for an intent in no networks", async () => {
    const { rows } = await adapter.listIntents(testUserId, { page: 1, limit: 10, archived: false });
    const row = rows.find((r) => r.id === testIntentId);
    expect(row).toBeDefined();
    expect(row!.networks).toEqual([]);
  });

  test("listIntents derives warming from fresh intents without a succeeded discovery run", async () => {
    const freshWarming = await adapter.createIntent({
      userId: testUserId,
      payload: 'Fresh intent waiting for discovery',
      summary: 'Fresh warming intent',
    });
    const freshComplete = await adapter.createIntent({
      userId: testUserId,
      payload: 'Fresh intent with completed discovery',
      summary: 'Fresh completed intent',
    });
    const oldIntent = await adapter.createIntent({
      userId: testUserId,
      payload: 'Old intent without discovery',
      summary: 'Old intent',
    });
    await db.update(intentsTable).set({
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    }).where(eq(intentsTable.id, oldIntent.id));
    const [run] = await db.insert(opportunityDiscoveryRunsTable).values({
      userId: testUserId,
      status: 'succeeded',
      input: { intentId: freshComplete.id },
      context: { userId: testUserId, userName: 'Test User', userEmail: testEmail },
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }).returning({ id: opportunityDiscoveryRunsTable.id });

    try {
      const { rows } = await adapter.listIntents(testUserId, { page: 1, limit: 100, archived: false });
      expect(rows.find((row) => row.id === freshWarming.id)?.warming).toBe(true);
      expect(rows.find((row) => row.id === freshComplete.id)?.warming).toBe(false);
      expect(rows.find((row) => row.id === oldIntent.id)?.warming).toBe(false);
    } finally {
      await db.delete(opportunityDiscoveryRunsTable).where(eq(opportunityDiscoveryRunsTable.id, run.id));
      for (const intent of [freshWarming, freshComplete, oldIntent]) {
        await db.delete(intentsTable).where(eq(intentsTable.id, intent.id));
      }
    }
  }, 30_000);

  test("listIntents attaches assigned networks and excludes soft-deleted ones", async () => {
    const chatAdapter = new ChatDatabaseAdapter();
    const live = await chatAdapter.createNetwork({ title: `Intent-Net Live ${Date.now()}` });
    const removed = await chatAdapter.createNetwork({ title: `Intent-Net Removed ${Date.now()}` });
    try {
      await adapter.assignIntentToNetwork(testIntentId, live.id);
      await adapter.assignIntentToNetwork(testIntentId, removed.id);
      await chatAdapter.softDeleteNetwork(removed.id);

      const { rows } = await adapter.listIntents(testUserId, { page: 1, limit: 10, archived: false });
      const row = rows.find((r) => r.id === testIntentId);
      expect(row).toBeDefined();
      // Only the live network is attached; the soft-deleted one is excluded.
      expect(row!.networks).toEqual([{ id: live.id, title: live.title }]);

      // getIntentById carries the same membership data.
      const single = await adapter.getIntentById(testIntentId, testUserId);
      expect(single!.networks).toEqual([{ id: live.id, title: live.title }]);
    } finally {
      // deleteNetworkAndMembers also clears the intent_networks rows for each network.
      await deleteNetworkAndMembers(live.id).catch(() => {});
      await deleteNetworkAndMembers(removed.id).catch(() => {});
    }
  }, 30_000);

  test('scoped short-prefix resolution ignores and hides out-of-scope rows', async () => {
    const chatAdapter = new ChatDatabaseAdapter();
    const visibleNetwork = await chatAdapter.createNetwork({ title: `Prefix Visible ${Date.now()}` });
    const hiddenNetwork = await chatAdapter.createNetwork({ title: `Prefix Hidden ${Date.now()}` });
    const sharedPrefix = testIntentId.slice(0, 8);
    const visibleId = `${sharedPrefix}-0000-4000-8000-000000000001`;
    const hiddenId = `${sharedPrefix}-1111-4000-8000-000000000002`;
    try {
      await db.insert(intentsTable).values([
        { id: visibleId, userId: testUserId, payload: 'Visible scoped prefix intent' },
        { id: hiddenId, userId: testUserId, payload: 'Hidden scoped prefix intent' },
      ]);
      await adapter.assignIntentToNetwork(visibleId, visibleNetwork.id);
      await adapter.assignIntentToNetwork(hiddenId, hiddenNetwork.id);

      expect(await adapter.resolveIntentId(sharedPrefix, testUserId)).toEqual({ ambiguous: true });
      expect(await adapter.resolveIntentId(sharedPrefix, testUserId, visibleNetwork.id)).toEqual({ id: visibleId });
      expect(await adapter.resolveIntentId(hiddenId.slice(0, 13), testUserId, visibleNetwork.id)).toBeNull();
    } finally {
      await deleteNetworkAndMembers(visibleNetwork.id).catch(() => {});
      await deleteNetworkAndMembers(hiddenNetwork.id).catch(() => {});
      await db.delete(intentsTable).where(eq(intentsTable.id, visibleId)).catch(() => {});
      await db.delete(intentsTable).where(eq(intentsTable.id, hiddenId)).catch(() => {});
    }
  }, 30_000);

  test("lifecycle transition is atomic, scoped, idempotent, and versioned per cycle", async () => {
    const scoped = await adapter.transitionIntentLifecycle({
      intentId: testIntentId,
      userId: testUserId,
      status: 'PAUSED',
      networkScopeId: '00000000-0000-4000-8000-000000000001',
    });
    expect(scoped).toEqual({ kind: 'scope_violation' });

    const paused = await adapter.transitionIntentLifecycle({
      intentId: testIntentId,
      userId: testUserId,
      status: 'PAUSED',
    });
    expect(paused.kind).toBe('success');
    if (paused.kind !== 'success') throw new Error('pause failed');
    expect(paused.changed).toBe(true);

    const repeatedPause = await adapter.transitionIntentLifecycle({
      intentId: testIntentId,
      userId: testUserId,
      status: 'PAUSED',
    });
    expect(repeatedPause).toMatchObject({
      kind: 'success', changed: false, lifecycleVersionMs: paused.lifecycleVersionMs,
    });
    expect((await adapter.getActiveIntents(testUserId)).some((intent) => intent.id === testIntentId)).toBe(false);
    const searchedPaused = await new ChatDatabaseAdapter().searchOwnIntents(testUserId, 'senior AI/ML', 10);
    expect(searchedPaused.some((intent) => intent.id === testIntentId)).toBe(false);
    const listedPaused = await adapter.listIntents(testUserId, { page: 1, limit: 10, archived: false });
    expect(listedPaused.rows.find((intent) => intent.id === testIntentId)?.status).toBe('PAUSED');

    const resumed = await adapter.transitionIntentLifecycle({
      intentId: testIntentId,
      userId: testUserId,
      status: 'ACTIVE',
    });
    expect(resumed.kind).toBe('success');
    if (resumed.kind !== 'success') throw new Error('resume failed');
    expect(resumed.lifecycleVersionMs).toBeGreaterThan(paused.lifecycleVersionMs);
    const repeatedResume = await adapter.transitionIntentLifecycle({
      intentId: testIntentId,
      userId: testUserId,
      status: 'ACTIVE',
    });
    expect(repeatedResume).toMatchObject({
      kind: 'success', changed: false, lifecycleVersionMs: resumed.lifecycleVersionMs,
    });

    const outOfScopeCompensation = await adapter.compensateFailedResume({
      intentId: testIntentId,
      userId: testUserId,
      lifecycleVersionMs: resumed.lifecycleVersionMs,
      networkScopeId: '00000000-0000-4000-8000-000000000001',
    });
    expect(outOfScopeCompensation).toBeNull();
    expect((await adapter.getIntentById(testIntentId, testUserId))?.status).toBe('ACTIVE');

    const staleCompensation = await adapter.compensateFailedResume({
      intentId: testIntentId,
      userId: testUserId,
      lifecycleVersionMs: resumed.lifecycleVersionMs - 1,
    });
    expect(staleCompensation?.status).toBe('ACTIVE');
    const compensated = await adapter.compensateFailedResume({
      intentId: testIntentId,
      userId: testUserId,
      lifecycleVersionMs: resumed.lifecycleVersionMs,
    });
    expect(compensated?.status).toBe('PAUSED');
    expect(compensated!.lifecycleVersionMs).toBeGreaterThan(resumed.lifecycleVersionMs);

    const resumedLater = await adapter.transitionIntentLifecycle({
      intentId: testIntentId,
      userId: testUserId,
      status: 'ACTIVE',
    });
    expect(resumedLater.kind).toBe('success');
    if (resumedLater.kind !== 'success') throw new Error('later resume failed');
    expect(resumedLater.lifecycleVersionMs).toBeGreaterThan(resumed.lifecycleVersionMs);

    await db.update(intentsTable).set({ status: 'FULFILLED' }).where(eq(intentsTable.id, testIntentId));
    const terminal = await adapter.transitionIntentLifecycle({
      intentId: testIntentId,
      userId: testUserId,
      status: 'ACTIVE',
    });
    expect(terminal).toEqual({ kind: 'conflict', status: 'FULFILLED', archived: false });
    await db.update(intentsTable).set({ status: 'ACTIVE' }).where(eq(intentsTable.id, testIntentId));
  }, 30_000);

  test("context-to-intent candidate search excludes paused intents and admits legacy null", async () => {
    const chatAdapter = new ChatDatabaseAdapter();
    const network = await chatAdapter.createNetwork({ title: `Intent-Search ${Date.now()}` });
    const embedding = [1, ...new Array(1999).fill(0)];
    try {
      await adapter.assignIntentToNetwork(testIntentId, network.id);
      await db.update(intentsTable)
        .set({ embedding, status: null })
        .where(eq(intentsTable.id, testIntentId));

      const active = await chatAdapter.searchIntentsByContextEmbedding({
        embedding,
        networkIds: [network.id],
        excludeUserId: '00000000-0000-4000-8000-000000000099',
        limit: 10,
        minScore: 0.9,
      });
      expect(active.some((intent) => intent.intentId === testIntentId)).toBe(true);

      await adapter.transitionIntentLifecycle({ intentId: testIntentId, userId: testUserId, status: 'PAUSED' });
      const paused = await chatAdapter.searchIntentsByContextEmbedding({
        embedding,
        networkIds: [network.id],
        excludeUserId: '00000000-0000-4000-8000-000000000099',
        limit: 10,
        minScore: 0.9,
      });
      expect(paused.some((intent) => intent.intentId === testIntentId)).toBe(false);
      await adapter.transitionIntentLifecycle({ intentId: testIntentId, userId: testUserId, status: 'ACTIVE' });
    } finally {
      await deleteNetworkAndMembers(network.id).catch(() => {});
    }
  }, 30_000);

  test("archiveIntent should set archivedAt timestamp", async () => {
    const result = await adapter.archiveIntent(testIntentId);

    expect(result.success).toBe(true);

    // Verify intent is now archived (not returned by getActiveIntents)
    const activeIntents = await adapter.getActiveIntents(testUserId);
    expect(activeIntents.length).toBe(0);

    // Verify the intent still exists but has archivedAt set
    const archivedIntent = await adapter.getIntentById(testIntentId, testUserId);
    expect(archivedIntent).not.toBeNull();
    expect(archivedIntent!.archivedAt).not.toBeNull();
  });

  test("archiveIntent should return error for non-existent intent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const result = await adapter.archiveIntent(fakeId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Intent not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// IntentController Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("IntentController Integration", () => {
  const controller = new IntentController();
  const userAdapter = new UserDatabaseAdapter();
  const intentAdapter = new IntentDatabaseAdapter();
  const profileAdapter = new EnrichmentDatabaseAdapter();
  let testUserId: string;
  let testIntentId: string;
  const testEmail = `test-intent-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) {
      await intentAdapter.deleteByUserId(existingUser.id);
      await profileAdapter.deleteProfile(existingUser.id);
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Intent Controller User",
      intro: "A software engineer interested in AI and distributed systems",
      location: "San Francisco, CA",
      socials: { x: "https://x.com/testintent", github: "https://github.com/testintent" },
    });
    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);

    await profileAdapter.saveProfile(testUserId, {
      userId: testUserId,
      identity: {
        name: "Test Intent Controller User",
        bio: "Software engineer specializing in AI systems",
        location: "San Francisco, CA",
      },
      narrative: {
        context: "Building AI-powered applications and exploring distributed systems",
      },
      attributes: {
        interests: ["AI", "distributed systems", "machine learning"],
        skills: ["Python", "TypeScript", "Go"],
      },
      embedding: null,
    });

    const created = await intentAdapter.createIntent({
      userId: testUserId,
      payload: "Intent for controller list/getById tests",
      summary: "Test intent",
    });
    testIntentId = created.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await intentAdapter.deleteByUserId(testUserId);
      await profileAdapter.deleteProfile(testUserId);
      await userAdapter.deleteById(testUserId);
    }
  });

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Intent Controller User",
  });

  test("REST list and detail normalize legacy null status to ACTIVE", async () => {
    await db.update(intentsTable).set({ status: null }).where(eq(intentsTable.id, testIntentId));
    const listReq = new Request("http://localhost/intents/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: 1, limit: 10 }),
    });
    const listRes = await controller.list(listReq, mockUser());
    const listData = (await listRes.json()) as { intents: Array<{ id: string; status: string }> };
    expect(listData.intents.find((intent) => intent.id === testIntentId)?.status).toBe('ACTIVE');

    const detailRes = await controller.getById(
      new Request("http://localhost/intents/" + testIntentId),
      mockUser(),
      { id: testIntentId },
    );
    const detailData = (await detailRes.json()) as { intent: { status: string } };
    expect(detailData.intent.status).toBe('ACTIVE');
    expect((await intentAdapter.getActiveIntents(testUserId)).some((intent) => intent.id === testIntentId)).toBe(true);
  });

  test("list should return 200 with intents and pagination", async () => {
    const req = new Request("http://localhost/intents/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: 1, limit: 10 }),
    });
    const res = await controller.list(req, mockUser());
    const data = (await res.json()) as { intents?: Array<{ id: string; warming?: unknown }>; pagination?: unknown };

    expect(res.status).toBe(200);
    expect(Array.isArray(data.intents)).toBe(true);
    expect(data.pagination).toBeDefined();
    expect(data.intents!.length).toBeGreaterThanOrEqual(1);
    expect(typeof data.intents!.find((intent) => intent.id === testIntentId)?.warming).toBe('boolean');
  });

  test("getById should return 404 when intent not found", async () => {
    const req = new Request("http://localhost/intents/00000000-0000-0000-0000-000000000000");
    const res = await controller.getById(req, mockUser(), { id: "00000000-0000-0000-0000-000000000000" });
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(404);
    expect(data.error).toBe("Intent not found");
  });

  test("getById should return 200 and intent when found", async () => {
    const req = new Request("http://localhost/intents/" + testIntentId);
    const res = await controller.getById(req, mockUser(), { id: testIntentId });
    const data = (await res.json()) as { intent?: { id: string; payload: string } };

    expect(res.status).toBe(200);
    expect(data.intent).toBeDefined();
    expect(data.intent!.id).toBe(testIntentId);
    expect(data.intent!.payload).toBe("Intent for controller list/getById tests");
  });

  test("status endpoint validates, resolves short IDs, and is idempotent", async () => {
    const invalid = await controller.updateStatus(
      new Request("http://localhost/intents/" + testIntentId + "/status", {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'FULFILLED' }),
      }),
      mockUser(),
      { id: testIntentId },
    );
    expect(invalid.status).toBe(400);

    const missing = await controller.updateStatus(
      new Request("http://localhost/intents/00000000-0000-4000-8000-000000000000/status", {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED' }),
      }),
      mockUser(),
      { id: '00000000-0000-4000-8000-000000000000' },
    );
    expect(missing.status).toBe(404);

    const pauseRequest = () => new Request("http://localhost/intents/" + testIntentId + "/status", {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PAUSED' }),
    });
    const paused = await controller.updateStatus(pauseRequest(), mockUser(), { id: testIntentId.slice(0, 8) });
    const pausedData = (await paused.json()) as { intent: { status: string; lifecycleVersionMs: number }; changed: boolean };
    expect(paused.status).toBe(200);
    expect(pausedData.intent.status).toBe('PAUSED');
    expect(pausedData.changed).toBe(true);

    const repeated = await controller.updateStatus(pauseRequest(), mockUser(), { id: testIntentId });
    const repeatedData = (await repeated.json()) as { intent: { lifecycleVersionMs: number }; changed: boolean };
    expect(repeated.status).toBe(200);
    expect(repeatedData.changed).toBe(false);
    expect(repeatedData.intent.lifecycleVersionMs).toBe(pausedData.intent.lifecycleVersionMs);

    const resumed = await controller.updateStatus(
      new Request("http://localhost/intents/" + testIntentId + "/status", {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      }),
      mockUser(),
      { id: testIntentId },
    );
    expect(resumed.status).toBe(200);
  });

  test('status endpoint returns stable retryable 503 and leaves a failed changed resume paused', async () => {
    await intentAdapter.transitionIntentLifecycle({
      intentId: testIntentId,
      userId: testUserId,
      status: 'PAUSED',
    });
    IntentEvents.onResumed = async () => {
      throw new Error('queue unavailable');
    };
    try {
      const response = await controller.updateStatus(
        new Request(`http://localhost/intents/${testIntentId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ACTIVE' }),
        }),
        mockUser(),
        { id: testIntentId },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'Failed to enqueue intent resume',
        code: 'enqueue_failed',
        retryable: true,
        intent: { id: testIntentId, status: 'PAUSED' },
      });
      expect((await intentAdapter.getIntentById(testIntentId, testUserId))?.status).toBe('PAUSED');
    } finally {
      IntentEvents.onResumed = async () => {};
    }
  });

  test("archive should return 200 when intent exists and status then conflicts", async () => {
    const req = new Request("http://localhost/intents/" + testIntentId + "/archive", { method: "PATCH" });
    const res = await controller.archive(req, mockUser(), { id: testIntentId });
    const data = (await res.json()) as { success?: boolean };

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    const conflict = await controller.updateStatus(
      new Request("http://localhost/intents/" + testIntentId + "/status", {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED' }),
      }),
      mockUser(),
      { id: testIntentId },
    );
    expect(conflict.status).toBe(409);
  });

});

describe('IntentController confirm authorization', () => {
  const user: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'alice@example.com',
    name: 'Alice',
  };
  const networkId = '22222222-2222-4222-8222-222222222222';

  const request = (body: Record<string, unknown>) => new Request('http://localhost/intents/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  test('allows current members and preserves a typed success response', async () => {
    const createFromProposal = mock(async () => ({ id: 'intent-member' }));
    const assertNetworkScope = mock(async () => {});
    const controller = new IntentController({
      service: { createFromProposal } as never,
      assertNetworkScope,
    });

    const response = await controller.confirm(request({
      proposalId: 'proposal-member',
      description: 'Find climate founders',
      networkId,
    }), user);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      proposalId: 'proposal-member',
      intentId: 'intent-member',
    });
    expect(assertNetworkScope).toHaveBeenCalledWith(expect.any(Request), networkId);
    expect(createFromProposal).toHaveBeenCalledWith(
      user.id,
      'Find climate founders',
      'proposal-member',
      networkId,
    );
  });

  test('maps non-member and stale-membership failures to a typed 403', async () => {
    const createFromProposal = mock(async () => {
      throw new IntentNetworkMembershipError(networkId);
    });
    const controller = new IntentController({
      service: { createFromProposal } as never,
      assertNetworkScope: mock(async () => {}),
    });

    const response = await controller.confirm(request({
      proposalId: 'proposal-stale',
      description: 'Find climate founders',
      networkId,
    }), user);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'forbidden',
      code: 'network_membership_required',
      detail: 'You are not a current member of this network',
      networkId,
    });
  });

  test('rejects malformed network IDs before scope or persistence checks', async () => {
    const createFromProposal = mock(async () => ({ id: 'intent-invalid' }));
    const assertNetworkScope = mock(async () => {});
    const controller = new IntentController({
      service: { createFromProposal } as never,
      assertNetworkScope,
    });

    const response = await controller.confirm(request({
      proposalId: 'proposal-invalid',
      description: 'Find climate founders',
      networkId: 'not-a-uuid',
    }), user);

    expect(response.status).toBe(400);
    expect(assertNetworkScope).not.toHaveBeenCalled();
    expect(createFromProposal).not.toHaveBeenCalled();
  });

  test('preserves no-network confirmation without agent-scope lookup', async () => {
    const createFromProposal = mock(async () => ({ id: 'intent-global' }));
    const assertNetworkScope = mock(async () => {});
    const controller = new IntentController({
      service: { createFromProposal } as never,
      assertNetworkScope,
    });

    const response = await controller.confirm(request({
      proposalId: 'proposal-global',
      description: 'Find climate founders',
    }), user);

    expect(response.status).toBe(200);
    expect(assertNetworkScope).not.toHaveBeenCalled();
    expect(createFromProposal).toHaveBeenCalledWith(
      user.id,
      'Find climate founders',
      'proposal-global',
      undefined,
    );
  });

  test('preserves matching agent scope and rejects mismatched scope before persistence', async () => {
    const createFromProposal = mock(async () => ({ id: 'intent-scoped' }));
    const matchingController = new IntentController({
      service: { createFromProposal } as never,
      assertNetworkScope: mock(async (_req, suppliedNetworkId) => {
        if (suppliedNetworkId !== networkId) throw new ScopeViolationError('scope mismatch');
      }),
    });
    const matching = await matchingController.confirm(request({
      proposalId: 'proposal-scoped',
      description: 'Find climate founders',
      networkId,
    }), user);
    expect(matching.status).toBe(200);
    expect(createFromProposal).toHaveBeenCalledTimes(1);

    const mismatchController = new IntentController({
      service: { createFromProposal } as never,
      assertNetworkScope: mock(async () => {
        throw new ScopeViolationError('scope mismatch');
      }),
    });
    await expect(mismatchController.confirm(request({
      proposalId: 'proposal-mismatch',
      description: 'Find climate founders',
      networkId,
    }), user)).rejects.toBeInstanceOf(ScopeViolationError);
    expect(createFromProposal).toHaveBeenCalledTimes(1);
  });
});
