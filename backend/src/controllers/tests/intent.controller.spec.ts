/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { IntentController } from "../intent.controller";
import { IntentDatabaseAdapter, UserDatabaseAdapter, ProfileDatabaseAdapter } from "../../adapters/database.adapter";
import type { AuthenticatedUser } from "../../guards/auth.guard";

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
  const profileAdapter = new ProfileDatabaseAdapter();
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

  test("list should return 200 with intents and pagination", async () => {
    const req = new Request("http://localhost/intents/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: 1, limit: 10 }),
    });
    const res = await controller.list(req, mockUser());
    const data = (await res.json()) as { intents?: unknown[]; pagination?: unknown };

    expect(res.status).toBe(200);
    expect(Array.isArray(data.intents)).toBe(true);
    expect(data.pagination).toBeDefined();
    expect(data.intents!.length).toBeGreaterThanOrEqual(1);
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

  test("archive should return 200 when intent exists", async () => {
    const req = new Request("http://localhost/intents/" + testIntentId + "/archive", { method: "PATCH" });
    const res = await controller.archive(req, mockUser(), { id: testIntentId });
    const data = (await res.json()) as { success?: boolean };

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });

});
