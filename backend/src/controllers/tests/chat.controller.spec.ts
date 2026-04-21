/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { ChatController } from "../chat.controller";
import { ChatDatabaseAdapter, UserDatabaseAdapter, ProfileDatabaseAdapter, IntentDatabaseAdapter, NetworkGraphDatabaseAdapter } from "../../adapters/database.adapter";
import { chatSessionService } from "../../services/chat.service";
import db from "../../lib/drizzle/drizzle";
import { networkMembers, personalNetworks } from "../../schemas/database.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";

// Response type for chat controller
interface ChatResponse {
  response?: string;
  routingDecision?: any;
  subgraphResults?: any;
  error?: string;
}

// Integration test suite for ChatController using actual DB
describe("ChatController Integration", () => {
  let controller: ChatController;
  const chatAdapter = new ChatDatabaseAdapter();
  const userAdapter = new UserDatabaseAdapter();
  const profileAdapter = new ProfileDatabaseAdapter();
  const intentAdapter = new IntentDatabaseAdapter();
  const indexAdapter = new NetworkGraphDatabaseAdapter();
  let testUserId: string;
  /** Index IDs created for getIntentsInNetworkForMember tests; cleaned in afterAll */
  let testNetworkId: string | null = null;
  let testNetworkIdOther: string | null = null;
  let unauthorizedStreamIndexId: string | null = null;

  beforeAll(async () => {
    const email = "test-chat-controller@example.com";

    const existingUser = await userAdapter.findByEmail(email);
    if (existingUser) {
      await intentAdapter.deleteByUserId(existingUser.id);
      await db.delete(networkMembers).where(eq(networkMembers.userId, existingUser.id));
      await db.delete(personalNetworks).where(eq(personalNetworks.userId, existingUser.id));
      await userAdapter.deleteByEmail(email);
    }

    const user = await userAdapter.create({
      email,
      name: "Test Chat User",
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
    for (const networkId of [testNetworkId, testNetworkIdOther, unauthorizedStreamIndexId]) {
      if (networkId) await indexAdapter.deleteNetworkAndMembers(networkId);
    }
    if (testUserId) {
      await intentAdapter.deleteByUserId(testUserId);
      await profileAdapter.deleteProfile(testUserId);
      await db.delete(networkMembers).where(eq(networkMembers.userId, testUserId));
      await db.delete(personalNetworks).where(eq(personalNetworks.userId, testUserId));
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

    test("getIntentsInNetworkForMember should return empty for unknown index name", async () => {
      const intents = await adapter.getIntentsInNetworkForMember(testUserId, "NonExistent Index Name");
      expect(intents).toBeArray();
      expect(intents.length).toBe(0);
    });

    test("getIntentsInNetworkForMember should return intents when queried by index name", async () => {
      const index = await adapter.createNetwork({
        title: "Commons",
        prompt: "Test index for chat adapter",
      });
      testNetworkId = index.id;

      await adapter.addMemberToNetwork(testNetworkId, testUserId, 'member');

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
      await adapter.assignIntentToNetwork(activeIntents[0].id, testNetworkId);

      const intents = await adapter.getIntentsInNetworkForMember(testUserId, "Commons");
      expect(intents).toBeArray();
      expect(intents.length).toBe(1);
      expect(intents[0].payload).toBe("Looking for collaborators on a machine learning project");
    });

    test("getIntentsInNetworkForMember should return intents when queried by index ID", async () => {
      expect(testNetworkId).not.toBeNull();
      const intents = await adapter.getIntentsInNetworkForMember(testUserId!, testNetworkId!);
      expect(intents).toBeArray();
      expect(intents.length).toBe(1);
      expect(intents[0].id).toBeDefined();
      expect(intents[0].payload).toBeDefined();
      expect(intents[0].summary).toBeDefined();
      expect(intents[0].createdAt).toBeInstanceOf(Date);
    });

    test("getIntentsInNetworkForMember should return empty when user is not a member of the index", async () => {
      const index = await adapter.createNetwork({
        title: "Other Index User Not In",
        prompt: "Index without test user",
      });
      testNetworkIdOther = index.id;

      const intents = await adapter.getIntentsInNetworkForMember(testUserId, "Other Index User Not In");
      expect(intents).toBeArray();
      expect(intents.length).toBe(0);
    });
  });

  describe("ChatController.message endpoint", () => {
    test("should return error for missing message", async () => {
      const mockRequest = {
        json: async () => ({})
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Message content is required');
    });

    test("should return error for invalid JSON body", async () => {
      const mockRequest = {
        json: async () => { throw new Error('Invalid JSON'); }
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;
      
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request body. Expected { message: string }');
    });

    test("should process a simple greeting message", async () => {
      const mockRequest = {
        json: async () => ({ message: "Hello, how are you?" })
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      console.log("Starting chat message processing...");
      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;
      console.log("Chat response:", data);

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe('string');
      expect(data.response!.length).toBeGreaterThan(0);
      // Non-streaming /message returns only { response, error }; routingDecision is only in the streaming endpoint.
    }, 120000); // Long timeout for LLM calls

    test("should process an intent-related message", async () => {
      const mockRequest = {
        json: async () => ({ message: "I'm looking for people who are interested in building AI agents" })
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      console.log("Starting intent-related message processing...");
      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;
      console.log("Chat response for intent message:", data);

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe('string');
      // Non-streaming /message returns only { response, error }; routingDecision is only in the streaming endpoint.
    }, 120000); // Long timeout for LLM calls

    test("should process a profile-related message", async () => {
      const mockRequest = {
        json: async () => ({ message: "Update my profile to include that I'm now focused on LLM applications" })
      } as unknown as Request;
      
      const mockUser: AuthenticatedUser = {
        id: testUserId,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      console.log("Starting profile-related message processing...");
      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;
      console.log("Chat response for profile message:", data);

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe('string');
    }, 120000); // Long timeout for LLM calls

    test("should create intent from hiring message with URL without leaking internal JSON or URLs in intent", async () => {
      // Scenario: User wants to hire developers and provides a GitHub URL for context.
      // The response must NOT contain internal pipeline JSON (classification, felicity_scores,
      // actions, indexScore, etc.). Created intents must NOT contain "More details at [url]"
      // or raw URLs in the description.
      const mockRequest = {
        json: async () => ({
          message: "I want to hire developers who would be interested in the following project: https://github.com/indexnetwork/index"
        })
      } as unknown as Request;

      const mockUser: AuthenticatedUser = {
        id: testUserId,
        email: "test-chat-controller@example.com",
        name: "Test Chat User"
      };

      const response = await controller.message(mockRequest, mockUser);
      const data = await response.json() as ChatResponse;

      expect(response.status).toBe(200);
      expect(data.response).toBeDefined();
      expect(typeof data.response).toBe("string");

      // Must NOT contain internal pipeline JSON (streamEvents was emitting nested model output)
      const internalJsonMarkers = [
        '"classification"',
        '"felicity_scores"',
        '"actions"',
        '"indexScore"',
        '"memberScore"',
        '"semantic_entropy"',
        '"referential_anchor"',
        '"intentMode"',
        '"referentialAnchor"',
      ];
      for (const marker of internalJsonMarkers) {
        expect(data.response).not.toContain(marker);
      }

      // Created intents must NOT contain URLs or "More details at" in payload
      const adapter = new ChatDatabaseAdapter();
      const intents = await adapter.getActiveIntents(testUserId);
      for (const intent of intents) {
        expect(intent.payload).not.toMatch(/https?:\/\//);
        expect(intent.payload.toLowerCase()).not.toContain("more details at");
      }
    }, 120000); // Long timeout for LLM + scraping
  });

  describe("ChatController other endpoints", () => {
    const mockUser = (): AuthenticatedUser => ({
      id: testUserId,
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

    test("messageStream should return 403 when scoped index is not a member index", async () => {
      const index = await chatAdapter.createNetwork({
        title: "Unauthorized Stream Index",
        prompt: "Index created for access validation",
      });
      unauthorizedStreamIndexId = index.id;

      const req = new Request("http://localhost/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "hello",
          networkId: unauthorizedStreamIndexId,
          useCheckpointer: false,
        }),
      });

      const res = await controller.messageStream(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(403);
      expect(data.error).toContain("not a member");
    });

    test("getSessions should return 200 with sessions array", async () => {
      const req = new Request("http://localhost/chat/sessions");
      const res = await controller.getSessions(req, mockUser());
      const data = (await res.json()) as { sessions?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    test("getSession should return 400 when sessionId is missing", async () => {
      const req = new Request("http://localhost/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.getSession(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toContain("sessionId");
    });

    test("getSession should return 404 when session not found", async () => {
      const req = new Request("http://localhost/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "00000000-0000-0000-0000-000000000000" }),
      });
      const res = await controller.getSession(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("Session not found");
    });

    test("getSession should return 200 with session and messages when found", async () => {
      const sessionId = await chatSessionService.createSession(testUserId, "Session for get test");
      const req = new Request("http://localhost/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const res = await controller.getSession(req, mockUser());
      const data = (await res.json()) as { session?: { id: string }; messages?: unknown[] };

      expect(res.status).toBe(200);
      expect(data.session).toBeDefined();
      expect(data.session!.id).toBe(sessionId);
      expect(Array.isArray(data.messages)).toBe(true);
    });

    test("deleteSession should return 400 when sessionId is missing", async () => {
      const req = new Request("http://localhost/chat/session/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.deleteSession(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toContain("sessionId");
    });

    test("deleteSession should return 404 when session not found", async () => {
      const req = new Request("http://localhost/chat/session/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "00000000-0000-0000-0000-000000000000" }),
      });
      const res = await controller.deleteSession(req, mockUser());
      expect(res.status).toBe(404);
    });

    test("deleteSession should return 200 when session deleted", async () => {
      const sessionId = await chatSessionService.createSession(testUserId, "Session to delete");
      const req = new Request("http://localhost/chat/session/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const res = await controller.deleteSession(req, mockUser());
      const data = (await res.json()) as { success?: boolean };

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("updateSessionTitle should return 400 when sessionId or title missing", async () => {
      const req = new Request("http://localhost/chat/session/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.updateSessionTitle(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toContain("sessionId and title");
    });

    test("updateSessionTitle should return 404 when session not found", async () => {
      const req = new Request("http://localhost/chat/session/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "00000000-0000-0000-0000-000000000000", title: "New Title" }),
      });
      const res = await controller.updateSessionTitle(req, mockUser());
      expect(res.status).toBe(404);
    });

    test("updateSessionTitle should return 200 when updated", async () => {
      const sessionId = await chatSessionService.createSession(testUserId, "Original Title");
      const req = new Request("http://localhost/chat/session/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, title: "Updated Title" }),
      });
      const res = await controller.updateSessionTitle(req, mockUser());
      const data = (await res.json()) as { success?: boolean; title?: string };

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.title).toBe("Updated Title");
    });
  });
});
