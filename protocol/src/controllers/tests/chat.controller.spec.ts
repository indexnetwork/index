/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ChatController } from "../chat.controller";
import { ChatDatabaseAdapter, UserDatabaseAdapter, ProfileDatabaseAdapter, IntentDatabaseAdapter, IndexGraphDatabaseAdapter } from "../../adapters/database.adapter";
import type { AuthenticatedUser } from "../../guards/auth.guard";

// Integration test suite for ChatController using actual DB
describe("ChatController Integration", () => {
  let controller: ChatController;
  const userAdapter = new UserDatabaseAdapter();
  const profileAdapter = new ProfileDatabaseAdapter();
  const intentAdapter = new IntentDatabaseAdapter();
  const indexAdapter = new IndexGraphDatabaseAdapter();
  let testUserId: string;
  /** Index IDs created for getIntentsInIndexForMember tests; cleaned in afterAll */
  let testIndexId: string | null = null;
  let testIndexIdOther: string | null = null;

  beforeAll(async () => {
    const email = "test-chat-controller@example.com";

    const existingUser = await userAdapter.findByEmail(email);
    if (existingUser) {
      await intentAdapter.deleteByUserId(existingUser.id);
      await userAdapter.deleteByEmail(email);
    }

    const user = await userAdapter.create({
      email,
      name: "Test Chat User",
      privyId: `privy:chat:${Date.now()}`,
      intro: "A software developer interested in AI and distributed systems.",
      location: "New York, NY",
      socials: { x: "https://x.com/testchat" },
    });
    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);

    await profileAdapter.saveProfile(testUserId, {
      userId: testUserId,
      identity: {
        name: "Test Chat User",
        bio: "A software developer interested in AI and distributed systems.",
        location: "New York, NY",
      },
      narrative: {
        context: "Software developer with 5 years of experience, building AI-powered applications",
      },
      attributes: {
        skills: ["TypeScript", "Python", "Machine Learning"],
        interests: ["AI", "Distributed Systems", "Open Source"],
      },
      embedding: Array(2000).fill(0.01) as number[],
    });
    console.log(`Created test user profile for: ${testUserId}`);

    controller = new ChatController();
  });

  afterAll(async () => {
    for (const indexId of [testIndexId, testIndexIdOther]) {
      if (indexId) await indexAdapter.deleteIndexAndMembers(indexId);
    }
    if (testUserId) {
      await intentAdapter.deleteByUserId(testUserId);
      await profileAdapter.deleteProfile(testUserId);
      await userAdapter.deleteById(testUserId);
    }
  });

  describe("ChatDatabaseAdapter", () => {
    let adapter: ChatDatabaseAdapter;

    beforeAll(() => {
      adapter = new ChatDatabaseAdapter();
    });

    test("getProfile should return null for non-existent user", async () => {
      const profile = await adapter.getProfile("00000000-0000-0000-0000-000000000000");
      expect(profile).toBeNull();
    });

    test("getProfile should return profile for existing user", async () => {
      const profile = await adapter.getProfile(testUserId);
      expect(profile).not.toBeNull();
      expect(profile?.identity?.name).toBe("Test Chat User");
    });

    test("getUser should return null for non-existent user", async () => {
      const user = await adapter.getUser("00000000-0000-0000-0000-000000000000");
      expect(user).toBeNull();
    });

    test("getUser should return user for existing user", async () => {
      const user = await adapter.getUser(testUserId);
      expect(user).not.toBeNull();
      expect(user?.name).toBe("Test Chat User");
      expect(user?.email).toBe("test-chat-controller@example.com");
    });

    test("getActiveIntents should return empty array for user with no intents", async () => {
      const intents = await adapter.getActiveIntents(testUserId);
      expect(intents).toBeArray();
      expect(intents.length).toBe(0);
    });

    test("createIntent should create and return a new intent", async () => {
      const intentData = {
        userId: testUserId,
        payload: "Looking for collaborators on an AI project",
        summary: "AI collaboration",
        confidence: 0.9,
        inferenceType: 'explicit' as const,
        sourceType: 'discovery_form' as const,
      };

      const created = await adapter.createIntent(intentData);

      expect(created).not.toBeNull();
      expect(created.id).toBeDefined();
      expect(created.payload).toBe(intentData.payload);
      expect(created.summary).toBe(intentData.summary);
      expect(created.userId).toBe(testUserId);
    });

    test("getActiveIntents should return intents after creation", async () => {
      const intents = await adapter.getActiveIntents(testUserId);
      expect(intents).toBeArray();
      expect(intents.length).toBeGreaterThan(0);
      expect(intents[0].payload).toBe("Looking for collaborators on an AI project");
    });

    test("updateIntent should update an existing intent", async () => {
      // Get the intent we created
      const intents = await adapter.getActiveIntents(testUserId);
      expect(intents.length).toBeGreaterThan(0);

      const intentId = intents[0].id;
      const updated = await adapter.updateIntent(intentId, {
        payload: "Looking for collaborators on a machine learning project",
        summary: "ML collaboration"
      });

      expect(updated).not.toBeNull();
      expect(updated?.payload).toBe("Looking for collaborators on a machine learning project");
      expect(updated?.summary).toBe("ML collaboration");
    });

    test("archiveIntent should soft-delete an intent", async () => {
      // Get the intent we created
      const intents = await adapter.getActiveIntents(testUserId);
      expect(intents.length).toBeGreaterThan(0);

      const intentId = intents[0].id;
      const result = await adapter.archiveIntent(intentId);

      expect(result.success).toBe(true);

      // Verify intent no longer appears in active intents
      const activeIntents = await adapter.getActiveIntents(testUserId);
      const archivedIntent = activeIntents.find((i: { id: string }) => i.id === intentId);
      expect(archivedIntent).toBeUndefined();
    });

    test("archiveIntent should return error for non-existent intent", async () => {
      const result = await adapter.archiveIntent("00000000-0000-0000-0000-000000000001");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("getIntentsInIndexForMember should return empty for unknown index name", async () => {
      const intents = await adapter.getIntentsInIndexForMember(testUserId, "NonExistent Index Name");
      expect(intents).toBeArray();
      expect(intents.length).toBe(0);
    });

    test("getIntentsInIndexForMember should return intents when queried by index name", async () => {
      const index = await adapter.createIndex({
        title: "Open Mock Network",
        prompt: "Test index for chat adapter",
      });
      testIndexId = index.id;

      await adapter.addMemberToIndex(testIndexId, testUserId, 'member');

      // Ensure we have an active intent to assign (previous test may have archived the one it created)
      let activeIntents = await adapter.getActiveIntents(testUserId);
      if (activeIntents.length === 0) {
        await adapter.createIntent({
          userId: testUserId,
          payload: "Looking for collaborators on a machine learning project",
        });
        activeIntents = await adapter.getActiveIntents(testUserId);
      }
      expect(activeIntents.length).toBeGreaterThan(0);
      await adapter.assignIntentToIndex(activeIntents[0].id, testIndexId);

      const intents = await adapter.getIntentsInIndexForMember(testUserId, "Open Mock Network");
      expect(intents).toBeArray();
      expect(intents.length).toBe(1);
      expect(intents[0].payload).toBe("Looking for collaborators on a machine learning project");
    });

    test("getIntentsInIndexForMember should return intents when queried by index ID", async () => {
      expect(testIndexId).not.toBeNull();
      const intents = await adapter.getIntentsInIndexForMember(testUserId!, testIndexId!);
      expect(intents).toBeArray();
      expect(intents.length).toBe(1);
      expect(intents[0].id).toBeDefined();
      expect(intents[0].payload).toBeDefined();
      expect(intents[0].summary).toBeDefined();
      expect(intents[0].createdAt).toBeInstanceOf(Date);
    });

    test("getIntentsInIndexForMember should return empty when user is not a member of the index", async () => {
      const index = await adapter.createIndex({
        title: "Other Index User Not In",
        prompt: "Index without test user",
      });
      testIndexIdOther = index.id;

      const intents = await adapter.getIntentsInIndexForMember(testUserId, "Other Index User Not In");
      expect(intents).toBeArray();
      expect(intents.length).toBe(0);
    });
  });

  describe("ChatController.messageStream endpoint", () => {
    const mockUser = (): AuthenticatedUser => ({
      id: testUserId,
      privyId: `privy:chat:${Date.now()}`,
      email: "test-chat-controller@example.com",
      name: "Test Chat User",
    });

    test("messageStream should return 400 when message is missing", async () => {
      const req = new Request("http://localhost/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.messageStream(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBeDefined();
    });

    test("messageStream should return 400 for invalid JSON body", async () => {
      const req = {
        json: async () => { throw new Error('Invalid JSON'); }
      } as unknown as Request;
      const res = await controller.messageStream(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });
});
