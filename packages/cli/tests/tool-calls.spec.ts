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
  const restHandlers: Record<string, (req: Request) => Response | Promise<Response>> = {};
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
      restHandlers[`${method} ${path}`] = handler;
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
    it("search calls read_user_profiles with query", async () => {
      mock.setToolResponse("read_user_profiles", {
        success: true,
        data: { profiles: [], matchCount: 0 },
      });

      await handleProfile(client, "search", ["Jane Smith"], { json: true });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("read_user_profiles");
      expect(mock.toolCalls[0].query).toEqual({ query: "Jane Smith" });
    });

    it("create calls create_user_profile with confirm and social URLs", async () => {
      mock.setToolResponse("create_user_profile", { success: true, data: {} });

      await handleProfile(client, "create", [], {
        linkedin: "https://linkedin.com/in/jane",
        github: "https://github.com/jane",
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("create_user_profile");
      expect(mock.toolCalls[0].query).toEqual({
        confirm: true,
        linkedinUrl: "https://linkedin.com/in/jane",
        githubUrl: "https://github.com/jane",
      });
    });

    it("update calls update_user_profile with action", async () => {
      mock.setToolResponse("update_user_profile", { success: true, data: {} });

      await handleProfile(client, "update", ["add Python to skills"], { details: "expert level" });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("update_user_profile");
      expect(mock.toolCalls[0].query).toEqual({ action: "add Python to skills", details: "expert level" });
    });

    it("sync calls create_user_profile when no profile exists (CLI: profile sync)", async () => {
      mock.setToolResponse("read_user_profiles", {
        success: true,
        data: { hasProfile: false },
      });
      mock.setToolResponse("create_user_profile", { success: true, data: {} });

      await handleProfile(client, "sync", [], { json: true });

      const toolNames = mock.toolCalls.map((c) => c.toolName);
      expect(toolNames).toContain("read_user_profiles");
      expect(toolNames).toContain("create_user_profile");
      const createCall = mock.toolCalls.find((c) => c.toolName === "create_user_profile")!;
      expect(createCall.query).toEqual({ confirm: true });
    });

    it("sync calls update_user_profile when profile exists (CLI: profile sync)", async () => {
      mock.setToolResponse("read_user_profiles", {
        success: true,
        data: { hasProfile: true, profile: { name: "Test", bio: "Engineer" } },
      });
      mock.setToolResponse("update_user_profile", { success: true, data: {} });

      await handleProfile(client, "sync", [], { json: true });

      const toolNames = mock.toolCalls.map((c) => c.toolName);
      expect(toolNames).toContain("read_user_profiles");
      expect(toolNames).toContain("update_user_profile");
      const updateCall = mock.toolCalls.find((c) => c.toolName === "update_user_profile")!;
      expect(updateCall.query).toEqual({ action: "regenerate" });
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

    it("update calls update_intent with intentId and newDescription", async () => {
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
        newDescription: "Looking for a CTO with AI experience",
      });
    });

    it("link calls create_intent_index with intentId and networkId", async () => {
      mock.setToolResponse("create_intent_index", { success: true, data: {} });

      await handleIntent(client, "link", {
        intentId: "intent-123",
        targetId: "index-456",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("create_intent_index");
      expect(mock.toolCalls[0].query).toEqual({
        intentId: "intent-123",
        networkId: "index-456",
      });
    });

    it("unlink calls delete_intent_index with intentId and networkId", async () => {
      mock.setToolResponse("delete_intent_index", { success: true, data: {} });

      await handleIntent(client, "unlink", {
        intentId: "intent-123",
        targetId: "index-456",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("delete_intent_index");
      expect(mock.toolCalls[0].query).toEqual({
        intentId: "intent-123",
        networkId: "index-456",
      });
    });

    it("links calls read_intent_indexes with intentId", async () => {
      mock.setToolResponse("read_intent_indexes", {
        success: true,
        data: { indexes: [] },
      });

      await handleIntent(client, "links", {
        intentId: "intent-123",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("read_intent_indexes");
      expect(mock.toolCalls[0].query).toEqual({ intentId: "intent-123" });
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
    it("discover (search) calls discover_opportunities with searchQuery", async () => {
      mock.setToolResponse("discover_opportunities", { success: true, data: { message: "Found 3 matches" } });

      await handleOpportunity(client, "discover", {
        positionals: ["AI engineer with privacy expertise"],
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("discover_opportunities");
      expect(mock.toolCalls[0].query).toEqual({
        searchQuery: "AI engineer with privacy expertise",
      });
    });

    it("discover --target calls discover_opportunities with targetUserId and searchQuery", async () => {
      mock.setToolResponse("discover_opportunities", { success: true, data: {} });

      await handleOpportunity(client, "discover", {
        target: "user-abc",
        positionals: ["collaborate on LLM tooling"],
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("discover_opportunities");
      expect(mock.toolCalls[0].query).toEqual({
        targetUserId: "user-abc",
        searchQuery: "collaborate on LLM tooling",
      });
    });

    it("discover --introduce gathers entities then calls discover_opportunities with partyUserIds + entities", async () => {
      // Mock the prerequisite tool responses
      mock.setToolResponse("read_network_memberships", {
        success: true,
        data: {
          memberships: [{ networkId: "shared-index-1", indexTitle: "AI Network" }],
        },
      });
      mock.setToolResponse("read_user_profiles", {
        success: true,
        data: {
          profile: { name: "Test User", bio: "Engineer", skills: ["AI"] },
        },
      });
      mock.setToolResponse("read_intents", {
        success: true,
        data: {
          intents: [{ intentId: "i1", payload: "Looking for collaborators", summary: "Collab" }],
        },
      });
      mock.setToolResponse("discover_opportunities", { success: true, data: { message: "Draft created" } });

      await handleOpportunity(client, "discover", {
        introduce: "user-a",
        positionals: ["user-b", "both working on privacy ML"],
        json: true,
      });

      // Should have called: read_network_memberships x2, read_user_profiles x2, read_intents x2, discover_opportunities x1
      const toolNames = mock.toolCalls.map((c) => c.toolName);
      expect(toolNames.filter((n) => n === "read_network_memberships")).toHaveLength(2);
      expect(toolNames.filter((n) => n === "read_user_profiles")).toHaveLength(2);
      expect(toolNames.filter((n) => n === "read_intents")).toHaveLength(2);
      expect(toolNames.filter((n) => n === "discover_opportunities")).toHaveLength(1);

      // Verify the final discover_opportunities call has correct shape
      const createCall = mock.toolCalls.find((c) => c.toolName === "discover_opportunities")!;
      expect(createCall.query.partyUserIds).toEqual(["user-a", "user-b"]);
      expect(createCall.query.entities).toBeArray();
      expect(createCall.query.hint).toBe("both working on privacy ML");

      const entities = createCall.query.entities as Array<{ userId: string; networkId: string; profile?: unknown; intents?: unknown }>;
      expect(entities).toHaveLength(2);
      expect(entities[0].userId).toBe("user-a");
      expect(entities[0].networkId).toBe("shared-index-1");
      expect(entities[0].profile).toBeDefined();
      expect(entities[0].intents).toBeArray();
      expect(entities[1].userId).toBe("user-b");
      expect(entities[1].networkId).toBe("shared-index-1");
    });

    it("discover --introduce without hint omits hint field", async () => {
      mock.setToolResponse("read_network_memberships", {
        success: true,
        data: { memberships: [{ networkId: "idx-1" }] },
      });
      mock.setToolResponse("read_user_profiles", { success: true, data: { profile: { name: "X" } } });
      mock.setToolResponse("read_intents", { success: true, data: { intents: [] } });
      mock.setToolResponse("discover_opportunities", { success: true, data: {} });

      await handleOpportunity(client, "discover", {
        introduce: "user-a",
        positionals: ["user-b"],
        json: true,
      });

      const createCall = mock.toolCalls.find((c) => c.toolName === "discover_opportunities")!;
      expect(createCall.query.partyUserIds).toEqual(["user-a", "user-b"]);
      expect(createCall.query.hint).toBeUndefined();
    });

    it("discover --introduce fails gracefully when no shared indexes", async () => {
      mock.setToolResponse("read_network_memberships", {
        success: true,
        data: { memberships: [] },
      });

      await handleOpportunity(client, "discover", {
        introduce: "user-a",
        positionals: ["user-b"],
        json: true,
      });

      // Should NOT have called discover_opportunities — stopped at membership check
      expect(mock.toolCalls.filter((c) => c.toolName === "discover_opportunities")).toHaveLength(0);
      // Should only have the 2 membership lookups
      expect(mock.toolCalls).toHaveLength(2);
      expect(mock.toolCalls.every((c) => c.toolName === "read_network_memberships")).toBe(true);
    });

    it("accept calls update_opportunity with status accepted (CLI: opportunity accept)", async () => {
      mock.onRest("GET", "/api/opportunities/abc", () =>
        Response.json({ id: "full-uuid-abc", status: "pending" }),
      );
      mock.setToolResponse("update_opportunity", { success: true, data: {} });

      await handleOpportunity(client, "accept", {
        targetId: "abc",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("update_opportunity");
      expect(mock.toolCalls[0].query).toEqual({
        opportunityId: "full-uuid-abc",
        status: "accepted",
      });
    });

    it("reject calls update_opportunity with status rejected (CLI: opportunity reject)", async () => {
      mock.onRest("GET", "/api/opportunities/xyz", () =>
        Response.json({ id: "full-uuid-xyz", status: "pending" }),
      );
      mock.setToolResponse("update_opportunity", { success: true, data: {} });

      await handleOpportunity(client, "reject", {
        targetId: "xyz",
        json: true,
      });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("update_opportunity");
      expect(mock.toolCalls[0].query).toEqual({
        opportunityId: "full-uuid-xyz",
        status: "rejected",
      });
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

    it("add calls add_contact with email and name", async () => {
      mock.setToolResponse("add_contact", {
        success: true,
        data: { message: "Contact added" },
      });

      await handleContact(client, "add", ["jane@example.com"], { json: true, name: "Jane" });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("add_contact");
      expect(mock.toolCalls[0].query).toEqual({ email: "jane@example.com", name: "Jane" });
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

    it("import --gmail calls import_gmail_contacts", async () => {
      mock.setToolResponse("import_gmail_contacts", {
        success: true,
        data: { message: "Imported 5 contacts" },
      });

      await handleContact(client, "import", [], { json: true, gmail: true });

      expect(mock.toolCalls).toHaveLength(1);
      expect(mock.toolCalls[0].toolName).toBe("import_gmail_contacts");
      expect(mock.toolCalls[0].query).toEqual({});
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
    it("calls 4 tools in parallel: read_user_profiles, read_indexes, read_intents, list_contacts", async () => {
      mock.setToolResponse("read_user_profiles", { success: true, data: { profile: {} } });
      mock.setToolResponse("read_indexes", { success: true, data: { indexes: [] } });
      mock.setToolResponse("read_intents", { success: true, data: { intents: [] } });
      mock.setToolResponse("list_contacts", { success: true, data: { contacts: [] } });

      await handleSync(client, { json: true });

      const toolNames = mock.toolCalls.map((c) => c.toolName).sort();
      expect(toolNames).toEqual(["list_contacts", "read_indexes", "read_intents", "read_user_profiles"]);

      // All should send empty queries
      for (const call of mock.toolCalls) {
        expect(call.query).toEqual({});
      }
    });
  });
});
