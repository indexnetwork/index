/**
 * Integration tests for CLI → Tool HTTP API calls.
 *
 * Verifies that every callTool invocation sends the correct tool name
 * and query shape. Catches the class of bug where the CLI sends
 * fabricated/wrong field names that the backend silently rejects.
 *
 * Each test spins up a mock server, calls the command handler, and
 * asserts on the tool name + query payload that was sent.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

import { ApiClient } from "../src/api.client";
import { handleOpportunity } from "../src/opportunity.command";
import { handleProfile } from "../src/profile.command";
import { handleIntent } from "../src/intent.command";
import { handleNetwork } from "../src/network.command";
import { handleContact } from "../src/contact.command";
import { handleScrape } from "../src/scrape.command";
import { handleSync } from "../src/sync.command";
import { createMockServer as createBaseMockServer } from "./helpers/mock-http";

// ── Mock server ──────────────────────────────────────────────────────

interface ToolCall {
  toolName: string;
  query: Record<string, unknown>;
}

function createMockServer() {
  const toolCalls: ToolCall[] = [];
  const toolResponses: Record<string, Record<string, unknown>> = {};
  const server = createBaseMockServer();
  server.onPattern("POST", /^\/api\/tools\/(.+)$/, async (req, match) => {
    const toolName = match[1];
    const parsedBody = (await req.json()) as { query?: Record<string, unknown> };
    toolCalls.push({ toolName, query: parsedBody.query ?? {} });
    return Response.json(toolResponses[toolName] ?? { success: true, data: {} });
  });

  return {
    url: server.url,
    toolCalls,
    /** Set a canned response for a tool name. */
    setToolResponse(toolName: string, response: Record<string, unknown>) {
      toolResponses[toolName] = response;
    },
    /** Register a REST handler for non-tool endpoints. */
    onRest(method: string, path: string, handler: (req: Request) => Response | Promise<Response>) {
      server.on(method, path, handler);
    },
    reset() {
      toolCalls.length = 0;
    },
    stop() {
      server.stop();
    },
  };
}

// Suppress console output from command handlers during tests
const noop = () => {};
const origLog = console.log;
const origWrite = process.stdout.write;

function suppressOutput() {
  console.log = noop;
  process.stdout.write = (() => true) as typeof process.stdout.write;
}

function restoreOutput() {
  console.log = origLog;
  process.stdout.write = origWrite;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("CLI tool call contracts", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(() => {
    mock = createMockServer();
    client = new ApiClient(mock.url, "test-token");
    suppressOutput();
  });

  afterAll(() => {
    mock.stop();
    restoreOutput();
  });

  beforeEach(() => {
    mock.reset();
  });

  // ── Profile ──────────────────────────────────────────────────────

  describe("profile", () => {
    it("search calls read_user_contexts with query", async () => {
      mock.setToolResponse("read_user_contexts", {
        success: true,
        data: { profiles: [], matchCount: 0 },
      });

      await handleProfile(client, "search", ["Jane Smith"], { json: true });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("read_user_contexts");
      expect(mock.toolCalls[0].query).toEqual({ query: "Jane Smith" });
    });

    it("create calls create_user_context with confirm and social URLs", async () => {
      mock.setToolResponse("create_user_context", { success: true, data: {} });

      await handleProfile(client, "create", [], {
        linkedin: "https://linkedin.com/in/jane",
        github: "https://github.com/jane",
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("create_user_context");
      expect(mock.toolCalls[0].query).toEqual({
        confirm: true,
        linkedinUrl: "https://linkedin.com/in/jane",
        githubUrl: "https://github.com/jane",
      });
    });

    it("update calls update_user_context with action", async () => {
      mock.setToolResponse("update_user_context", { success: true, data: {} });

      await handleProfile(client, "update", ["add Python to skills"], { details: "expert level" });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("update_user_context");
      expect(mock.toolCalls[0].query).toEqual({ action: "add Python to skills", details: "expert level" });
    });

    it("sync uses the synchronous enrichment endpoint", async () => {
      let enrichCalls = 0;
      mock.onRest("POST", "/api/enrichment/enrich", () => {
        enrichCalls += 1;
        return Response.json({
          enriched: true,
          profile: { name: "Test", intro: "Engineer", location: null, avatar: null, socials: [] },
        });
      });

      await handleProfile(client, "sync", [], { json: true });

      expect(enrichCalls).toBe(1);
      expect(mock.toolCalls).toHaveLength(0);
    });
  });

  // ── Intent ───────────────────────────────────────────────────────

  describe("intent", () => {
    it("create calls create_intent with description (CLI: intent create)", async () => {
      mock.setToolResponse("create_intent", { success: true, data: { message: "Intent created" } });

      await handleIntent(client, "create", {
        intentContent: "Looking for a CTO with AI experience",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("create_intent");
      expect(mock.toolCalls[0].query).toEqual({
        description: "Looking for a CTO with AI experience",
      });
    });

    it("update calls update_intent with intentId and description", async () => {
      mock.setToolResponse("update_intent", { success: true, data: {} });

      await handleIntent(client, "update", {
        intentId: "intent-123",
        intentContent: "Looking for a CTO with AI experience",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("update_intent");
      expect(mock.toolCalls[0].query).toEqual({
        intentId: "intent-123",
        description: "Looking for a CTO with AI experience",
      });
    });

    it("link resolves the intent ID then calls create_intent_index", async () => {
      mock.onRest("GET", "/api/intents/abc123", () =>
        Response.json({ intent: { id: "full-uuid-abc123", payload: "test", status: "active" } }),
      );
      mock.setToolResponse("create_intent_index", { success: true, data: {} });

      await handleIntent(client, "link", {
        intentId: "abc123",
        targetId: "index-456",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("create_intent_index");
      expect(mock.toolCalls[0].query).toEqual({
        intentId: "full-uuid-abc123",
        networkId: "index-456",
      });
    });

    it("unlink resolves the intent ID then calls delete_intent_index", async () => {
      mock.onRest("GET", "/api/intents/abc123", () =>
        Response.json({ intent: { id: "full-uuid-abc123", payload: "test", status: "active" } }),
      );
      mock.setToolResponse("delete_intent_index", { success: true, data: {} });

      await handleIntent(client, "unlink", {
        intentId: "abc123",
        targetId: "index-456",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("delete_intent_index");
      expect(mock.toolCalls[0].query).toEqual({
        intentId: "full-uuid-abc123",
        networkId: "index-456",
      });
    });

    it("archive calls delete_intent with intentId (CLI: intent archive)", async () => {
      mock.onRest("GET", "/api/intents/abc123", () =>
        Response.json({ intent: { id: "full-uuid-abc123", payload: "test", status: "active" } }),
      );
      mock.setToolResponse("delete_intent", { success: true, data: {} });

      await handleIntent(client, "archive", {
        intentId: "abc123",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("delete_intent");
      expect(mock.toolCalls[0].query).toEqual({ intentId: "full-uuid-abc123" });
    });
  });

  // ── Opportunity ──────────────────────────────────────────────────

  describe("opportunity", () => {
    it("accept uses the REST preflight and passes uptake acknowledgement IDs", async () => {
      mock.onRest("GET", "/api/opportunities/abc", () =>
        Response.json({ id: "full-uuid-abc", status: "pending" }),
      );
      let body: unknown;
      mock.onRest("PATCH", "/api/opportunities/full-uuid-abc/status", async (req) => {
        body = await req.json();
        return Response.json({ opportunity: { id: "full-uuid-abc", status: "accepted" } });
      });

      await handleOpportunity(client, "accept", {
        targetId: "abc",
        acknowledgeUptake: ["q-1", "q-2"],
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(0);
      expect(body).toEqual({
        status: "accepted",
        acknowledgedUptakeQuestionIds: ["q-1", "q-2"],
      });
    });

    it("reject uses REST without calling a tool", async () => {
      mock.onRest("GET", "/api/opportunities/xyz", () =>
        Response.json({ id: "full-uuid-xyz", status: "pending" }),
      );
      let body: unknown;
      mock.onRest("PATCH", "/api/opportunities/full-uuid-xyz/status", async (req) => {
        body = await req.json();
        return Response.json({ opportunity: { id: "full-uuid-xyz", status: "rejected" } });
      });

      await handleOpportunity(client, "reject", {
        targetId: "xyz",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(0);
      expect(body).toEqual({ status: "rejected" });
    });
  });

  // ── Network ──────────────────────────────────────────────────────

  describe("network", () => {
    it("update calls update_network with networkId and settings", async () => {
      mock.setToolResponse("update_network", { success: true, data: {} });

      await handleNetwork(client, "update", ["index-123"], {
        title: "New Name",
        prompt: "Updated description",
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("update_network");
      expect(mock.toolCalls[0].query).toEqual({
        networkId: "index-123",
        settings: { title: "New Name", prompt: "Updated description" },
      });
    });

    it("delete calls delete_network with networkId", async () => {
      mock.setToolResponse("delete_network", { success: true, data: {} });

      await handleNetwork(client, "delete", ["index-456"], {});

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("delete_network");
      expect(mock.toolCalls[0].query).toEqual({ networkId: "index-456" });
    });
  });

  // ── Contact ──────────────────────────────────────────────────────

  describe("contact", () => {
    it("list calls list_contacts", async () => {
      mock.setToolResponse("list_contacts", {
        success: true,
        data: { count: 0, contacts: [] },
      });

      await handleContact(client, "list", [], { json: true });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("list_contacts");
      expect(mock.toolCalls[0].query).toEqual({});
    });

    it("remove calls list_contacts then remove_contact with resolved userId", async () => {
      mock.setToolResponse("list_contacts", {
        success: true,
        data: {
          count: 1,
          contacts: [{ userId: "user-jane", email: "jane@example.com", name: "Jane", isGhost: false }],
        },
      });
      mock.setToolResponse("remove_contact", { success: true, data: {} });

      await handleContact(client, "remove", ["jane@example.com"], { json: true });

      expect(mock.toolCalls).toHaveLength(2);
      expect(mock.toolCalls[0].toolName).toBe("list_contacts");
      expect(mock.toolCalls[1].toolName).toBe("remove_contact");
      expect(mock.toolCalls[1].query).toEqual({ contactUserId: "user-jane" });
    });
  });

  // ── Scrape ───────────────────────────────────────────────────────

  describe("scrape", () => {
    it("calls scrape_url with url and objective", async () => {
      mock.setToolResponse("scrape_url", {
        success: true,
        data: { url: "https://example.com", contentLength: 100, content: "Hello" },
      });

      await handleScrape(client, ["https://example.com"], { json: true, objective: "Extract pricing" });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("scrape_url");
      expect(mock.toolCalls[0].query).toEqual({
        url: "https://example.com",
        objective: "Extract pricing",
      });
    });

    it("calls scrape_url without objective when not provided", async () => {
      mock.setToolResponse("scrape_url", {
        success: true,
        data: { url: "https://example.com", contentLength: 50, content: "Hi" },
      });

      await handleScrape(client, ["https://example.com"], { json: true });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].query).toEqual({
        url: "https://example.com",
        objective: undefined,
      });
    });
  });

  // ── Sync ─────────────────────────────────────────────────────────

  describe("sync", () => {
    it("calls 4 tools in parallel: read_user_contexts, read_networks, read_intents, list_contacts", async () => {
      mock.setToolResponse("read_user_contexts", { success: true, data: { profile: {} } });
      mock.setToolResponse("read_networks", { success: true, data: { networks: [] } });
      mock.setToolResponse("read_intents", { success: true, data: { intents: [] } });
      mock.setToolResponse("list_contacts", { success: true, data: { contacts: [] } });

      await handleSync(client, { json: true });

      const toolNames = mock.toolCalls.map((c) => c.toolName).sort();
      expect(toolNames).toEqual(["list_contacts", "read_intents", "read_networks", "read_user_contexts"]);

      // All should send empty queries
      for (const call of mock.toolCalls) {
        expect(call.query).toEqual({});
      }
    });
  });
});
