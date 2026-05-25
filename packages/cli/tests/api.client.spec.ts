import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { ApiClient } from "../src/api.client";
import { createMockServer } from "./helpers/mock-http";

describe("ApiClient", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(async () => {
    mock = await createMockServer();
    client = new ApiClient(mock.url, "test-token-123");
  });

  afterAll(async () => {
    await mock.stop();
  });

  describe("listSessions", () => {
    it("returns sessions from the API", async () => {
      mock.on("GET", "/api/chat/sessions", () =>
        Response.json({
          sessions: [
            { id: "s1", title: "First", createdAt: "2026-01-01" },
            { id: "s2", title: "Second", createdAt: "2026-01-02" },
          ],
        }),
      );

      const sessions = await client.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe("s1");
      expect(sessions[1].title).toBe("Second");
    });

    it("sends the authorization header", async () => {
      let receivedAuth = "";
      mock.on("GET", "/api/chat/sessions", (req) => {
        receivedAuth = req.headers.get("authorization") ?? "";
        return Response.json({ sessions: [] });
      });

      await client.listSessions();
      expect(receivedAuth).toBe("Bearer test-token-123");
    });

    it("throws on 401 with an auth error", async () => {
      mock.on("GET", "/api/chat/sessions", () =>
        Response.json({ error: "Invalid or expired access token" }, { status: 401 }),
      );

      try {
        await client.listSessions();
        expect(true).toBe(false); // should not reach
      } catch (e: unknown) {
        expect((e as Error).message).toContain("expired");
      }
    });
  });

  describe("getMe", () => {
    it("returns the current user", async () => {
      mock.on("GET", "/api/auth/me", () =>
        Response.json({
          user: { id: "u1", name: "Test User", email: "test@example.com" },
        }),
      );

      const user = await client.getMe();
      expect(user.name).toBe("Test User");
      expect(user.email).toBe("test@example.com");
    });
  });

  describe("listIntents", () => {
    it("sends a POST to /api/intents/list and returns intents", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/intents/list", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({
          intents: [
            { id: "i1", payload: "Looking for a co-founder", summary: "Co-founder search", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", archivedAt: null },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      });

      const result = await client.listIntents();
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].id).toBe("i1");
      expect(result.pagination.total).toBe(1);
      expect(receivedBody).toEqual({});
    });

    it("passes pagination and filter options in the request body", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/intents/list", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({ intents: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 } });
      });

      await client.listIntents({ limit: 5, archived: true });
      expect(receivedBody.limit).toBe(5);
      expect(receivedBody.archived).toBe(true);
    });
  });

  describe("getIntent", () => {
    it("fetches a single intent by ID", async () => {
      mock.on("GET", "/api/intents/i1", () =>
        Response.json({
          intent: { id: "i1", payload: "Looking for a co-founder", summary: "Co-founder search", status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", archivedAt: null },
        }),
      );

      const intent = await client.getIntent("i1");
      expect(intent.id).toBe("i1");
      expect(intent.payload).toBe("Looking for a co-founder");
    });
  });

  describe("streamChat", () => {
    it("returns a readable response for SSE streaming", async () => {
      mock.on("POST", "/api/chat/stream", async (req) => {
        const body = await req.json();
        expect(body.message).toBe("hello");

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('event: status\ndata: {"message":"Processing..."}\n\n'));
            controller.enqueue(encoder.encode('event: done\ndata: {"sessionId":"s1","response":"Hi there"}\n\n'));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      const response = await client.streamChat({ message: "hello" });
      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      // Read the full body
      const text = await response.text();
      expect(text).toContain("event: status");
      expect(text).toContain("event: done");
    });

    it("includes sessionId when provided", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/chat/stream", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return new Response("event: done\ndata: {}\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      await client.streamChat({ message: "hi", sessionId: "abc" });
      expect(receivedBody.sessionId).toBe("abc");
    });
  });

  // ── Network methods ──────────────────────────────────────────────

  describe("listNetworks", () => {
    it("returns networks from the API", async () => {
      mock.on("GET", "/api/indexes", () =>
        Response.json({
          indexes: [
            { id: "n1", title: "Test Network", memberCount: 5, isPersonal: false },
            { id: "n2", title: "Personal", memberCount: 1, isPersonal: true },
          ],
        }),
      );

      const networks = await client.listNetworks();
      expect(networks).toHaveLength(2);
      expect(networks[0].id).toBe("n1");
      expect(networks[0].title).toBe("Test Network");
    });
  });

  describe("createNetwork", () => {
    it("sends title and prompt in request body", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/indexes", async (req) => {
        receivedBody = (await req.json()) as Record<string, unknown>;
        return Response.json({
          index: { id: "n1", title: "New Net", joinPolicy: "invite_only" },
        });
      });

      const result = await client.createNetwork("New Net", "A description");
      expect(receivedBody.title).toBe("New Net");
      expect(receivedBody.prompt).toBe("A description");
      expect(result.id).toBe("n1");
    });

    it("omits prompt when not provided", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/indexes", async (req) => {
        receivedBody = (await req.json()) as Record<string, unknown>;
        return Response.json({
          index: { id: "n1", title: "Minimal", joinPolicy: "invite_only" },
        });
      });

      await client.createNetwork("Minimal");
      expect(receivedBody.prompt).toBeUndefined();
    });
  });

  describe("getNetwork", () => {
    it("returns network details", async () => {
      mock.on("GET", "/api/indexes/n1", () =>
        Response.json({
          index: { id: "n1", title: "Test", prompt: "A network", memberCount: 3 },
        }),
      );

      const network = await client.getNetwork("n1");
      expect(network.title).toBe("Test");
      expect(network.memberCount).toBe(3);
    });
  });

  describe("getNetworkMembers", () => {
    it("returns members list", async () => {
      mock.on("GET", "/api/indexes/n1/members", () =>
        Response.json({
          members: [
            { userId: "u1", user: { name: "Alice", email: "alice@test.com" }, permissions: ["owner"] },
          ],
        }),
      );

      const members = await client.getNetworkMembers("n1");
      expect(members).toHaveLength(1);
      expect(members[0].user.name).toBe("Alice");
    });
  });

  describe("joinNetwork", () => {
    it("sends POST to join endpoint", async () => {
      mock.on("POST", "/api/indexes/n1/join", () =>
        Response.json({ index: { id: "n1", title: "Public Net" } }),
      );

      const result = await client.joinNetwork("n1");
      expect(result.title).toBe("Public Net");
    });
  });

  describe("leaveNetwork", () => {
    it("sends POST to leave endpoint", async () => {
      mock.on("POST", "/api/indexes/n1/leave", () =>
        Response.json({ success: true }),
      );

      await client.leaveNetwork("n1");
      // No throw = success
    });
  });

  describe("searchUsers", () => {
    it("sends query and indexId as search params", async () => {
      let receivedUrl = "";
      // The mock server matches on pathname, so we need to handle query params
      mock.on("GET", "/api/indexes/search-users", (req) => {
        receivedUrl = req.url;
        return Response.json({
          users: [{ id: "u1", name: "Alice", email: "alice@test.com" }],
        });
      });

      const users = await client.searchUsers("alice@test.com", "n1");
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe("alice@test.com");
      expect(receivedUrl).toContain("q=alice%40test.com");
      expect(receivedUrl).toContain("indexId=n1");
    });
  });

  describe("addNetworkMember", () => {
    it("sends userId in request body", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/indexes/n1/members", async (req) => {
        receivedBody = (await req.json()) as Record<string, unknown>;
        return Response.json({
          member: { userId: "u1" },
          message: "Member added",
        });
      });

      const result = await client.addNetworkMember("n1", "u1");
      expect(receivedBody.userId).toBe("u1");
      expect(result.message).toBe("Member added");
    });
  });
});
