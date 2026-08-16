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

  describe("API-key credential transport", () => {
    it("uses x-api-key on authenticated reads", async () => {
      const apiKeyClient = new ApiClient(mock.url, "cli-key-123");
      const received: Array<{ path: string; apiKey: string; authorization: string }> = [];
      mock.on("GET", "/api/conversations", (req) => {
        received.push({
          path: "/api/conversations",
          apiKey: req.headers.get("x-api-key") ?? "",
          authorization: req.headers.get("authorization") ?? "",
        });
        return Response.json({ conversations: [] });
      });

      await apiKeyClient.listConversations();

      expect(received).toEqual([
        { path: "/api/conversations", apiKey: "cli-key-123", authorization: "" },
      ]);
    });

    it("revokes only the exact stored API-key ID using the key itself", async () => {
      const apiKeyClient = new ApiClient(mock.url, "cli-key-123");
      let receivedBody: Record<string, unknown> = {};
      let receivedApiKey = "";
      mock.on("POST", "/api/auth/cli-credential/revoke", async (req) => {
        receivedApiKey = req.headers.get("x-api-key") ?? "";
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({ success: true });
      });

      await expect(apiKeyClient.revokeApiKey("exact-key-id", "target-key-456")).resolves.toBeUndefined();
      expect(receivedApiKey).toBe("cli-key-123");
      expect(receivedBody).toEqual({ keyId: "exact-key-id", targetKey: "target-key-456" });
    });

    it("defaults target proof to the caller token for self-revocation", async () => {
      const apiKeyClient = new ApiClient(mock.url, "self-cli-key");
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/auth/cli-credential/revoke", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({ success: true });
      });

      await apiKeyClient.revokeApiKey("self-key-id");

      expect(receivedBody).toEqual({ keyId: "self-key-id", targetKey: "self-cli-key" });
    });

    it("requires typed revocation success", async () => {
      const apiKeyClient = new ApiClient(mock.url, "cli-key-123");
      mock.on("POST", "/api/auth/cli-credential/revoke", () => Response.json({ success: false }));

      await expect(apiKeyClient.revokeApiKey("exact-key-id"))
        .rejects.toThrow("revocation was not confirmed");
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
          pagination: { current: 1, total: 1, count: 1, totalCount: 1 },
        });
      });

      const result = await client.listIntents();
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0].id).toBe("i1");
      expect(result.pagination.totalCount).toBe(1);
      expect(receivedBody).toEqual({});
    });

    it("passes pagination and filter options in the request body", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/intents/list", async (req) => {
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({ intents: [], pagination: { current: 1, total: 0, count: 0, totalCount: 0 } });
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

  describe("updateIntent", () => {
    it("uses the canonical description field", async () => {
      let body: { query?: Record<string, unknown> } = {};
      mock.on("POST", "/api/tools/update_intent", async (req) => {
        body = await req.json() as { query?: Record<string, unknown> };
        return Response.json({ success: true, data: { intentId: "i1" } });
      });

      await client.updateIntent("i1", "Find an AI co-founder");
      expect(body.query).toEqual({ intentId: "i1", description: "Find an AI co-founder" });
    });
  });

  describe("updateOpportunityStatus", () => {
    it("uses REST for rejection without uptake acknowledgements", async () => {
      let body: Record<string, unknown> = {};
      mock.on("PATCH", "/api/opportunities/o1/status", async (req) => {
        body = await req.json() as Record<string, unknown>;
        return Response.json({ opportunity: { id: "o1", status: "rejected" } });
      });

      await client.updateOpportunityStatus("o1", "rejected");
      expect(body).toEqual({ status: "rejected" });
    });

    it("includes uptake acknowledgements only for acceptance", async () => {
      let body: Record<string, unknown> = {};
      mock.on("PATCH", "/api/opportunities/o1/status", async (req) => {
        body = await req.json() as Record<string, unknown>;
        return Response.json({ opportunity: { id: "o1", status: "accepted" } });
      });

      await client.updateOpportunityStatus("o1", "accepted", ["q1"]);
      expect(body).toEqual({ status: "accepted", acknowledgedUptakeQuestionIds: ["q1"] });
    });
  });

  describe("confirmIntent", () => {
    it("posts proposalId and description, returns the created intent ID", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/intents/confirm", async (req) => {
        receivedBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ success: true, proposalId: "p1", intentId: "i9" });
      });

      const result = await client.confirmIntent("p1", "Find a co-founder");
      expect(receivedBody.proposalId).toBe("p1");
      expect(receivedBody.description).toBe("Find a co-founder");
      expect(receivedBody.networkId).toBeUndefined();
      expect(result.intentId).toBe("i9");
    });

    it("includes networkId when provided", async () => {
      let receivedBody: Record<string, unknown> = {};
      mock.on("POST", "/api/intents/confirm", async (req) => {
        receivedBody = (await req.json()) as Record<string, unknown>;
        return Response.json({ success: true, proposalId: "p1", intentId: "i9" });
      });

      await client.confirmIntent("p1", "Find a co-founder", "n1");
      expect(receivedBody.networkId).toBe("n1");
    });
  });

  // ── Network methods ──────────────────────────────────────────────

  describe("listNetworks", () => {
    it("returns networks from the API", async () => {
      mock.on("GET", "/api/networks", () =>
        Response.json({
          networks: [
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

  describe("createNetworkOrRequest", () => {
    it("returns a created result for direct staff creation", async () => {
      mock.on("POST", "/api/networks", () =>
        Response.json({ network: { id: "n1", title: "New Net", joinPolicy: "invite_only" } }),
      );

      await expect(client.createNetworkOrRequest("New Net", "A description")).resolves.toEqual({
        kind: "created",
        network: { id: "n1", title: "New Net", joinPolicy: "invite_only" },
      });
    });

    it("submits a request for the specific early-access 403", async () => {
      let requestBody: Record<string, unknown> = {};
      mock.on("POST", "/api/networks", () =>
        Response.json(
          { error: "Network creation is in early access. Submit a request at POST /network-requests." },
          { status: 403 },
        ),
      );
      mock.on("POST", "/api/network-requests", async (req) => {
        requestBody = await req.json() as Record<string, unknown>;
        return Response.json({
          request: { id: "request-1", title: "New Net", status: "pending", purpose: "A description", submittedAt: "2026-08-07T00:00:00Z" },
        }, { status: 201 });
      });

      const result = await client.createNetworkOrRequest("New Net", "A description");
      expect(requestBody).toEqual({ name: "New Net", purpose: "A description" });
      expect(result.kind).toBe("requested");
    });

    it("does not convert an unrelated 403 into a request", async () => {
      mock.on("POST", "/api/networks", () =>
        Response.json({ error: "Access denied" }, { status: 403 }),
      );

      await expect(client.createNetworkOrRequest("New Net")).rejects.toThrow("Access denied");
    });
  });

  describe("getNetwork", () => {
    it("returns network details", async () => {
      mock.on("GET", "/api/networks/n1", () =>
        Response.json({
          network: { id: "n1", title: "Test", prompt: "A network", memberCount: 3 },
        }),
      );

      const network = await client.getNetwork("n1");
      expect(network.title).toBe("Test");
      expect(network.memberCount).toBe(3);
    });
  });

  describe("getNetworkMembers", () => {
    it("returns members list", async () => {
      mock.on("GET", "/api/networks/n1/members", () =>
        Response.json({
          members: [
            { id: "u1", name: "Alice", email: "alice@test.com", permissions: ["owner"] },
          ],
        }),
      );

      const members = await client.getNetworkMembers("n1");
      expect(members).toHaveLength(1);
      expect(members[0].name).toBe("Alice");
    });
  });

  describe("joinNetwork", () => {
    it("sends POST to join endpoint", async () => {
      mock.on("POST", "/api/networks/n1/join", () =>
        Response.json({ network: { id: "n1", title: "Public Net" } }),
      );

      const result = await client.joinNetwork("n1");
      expect(result.title).toBe("Public Net");
    });
  });

  describe("leaveNetwork", () => {
    it("sends POST to leave endpoint", async () => {
      mock.on("POST", "/api/networks/n1/leave", () =>
        Response.json({ success: true }),
      );

      await client.leaveNetwork("n1");
      // No throw = success
    });
  });

  it("invites a member directly by email", async () => {
    let receivedBody: Record<string, unknown> = {};
    mock.on("POST", "/api/networks/n1/members/invite", async (req) => {
      receivedBody = await req.json() as Record<string, unknown>;
      return Response.json({
        user: { id: "u1", email: "alice@test.com" },
        created: true,
        alreadyMember: false,
        agentProvisioned: true,
      }, { status: 201 });
    });

    const result = await client.inviteNetworkMember("n1", "alice@test.com");
    expect(receivedBody).toEqual({ email: "alice@test.com" });
    expect(result.created).toBe(true);
  });
});
