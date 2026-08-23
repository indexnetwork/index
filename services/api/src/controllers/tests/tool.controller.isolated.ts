import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ToolController } from "../tool.controller";
import { ToolService } from "../../services/tool.service";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import type { ToolDeps } from '@indexnetwork/protocol';

import type { AuthenticatedUser } from "../../guards/auth.guard";

const paidIntegrationsEnabled = process.env.RUN_PAID_INTEGRATION_TESTS === '1';
const openRouterTest = paidIntegrationsEnabled && process.env.OPENROUTER_API_KEY
  ? test
  : test.skip;
const parallelsTest = paidIntegrationsEnabled && process.env.PARALLELS_API_KEY
  ? test
  : test.skip;

describe("ToolController Integration", () => {
  let controller: ToolController;
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  let testUserBId: string;
  // Use unique emails per run to avoid FK constraint issues from prior runs
  const runId = Date.now().toString(36);
  const testEmailA = `test-tool-ctrl-${runId}@example.com`;
  const testEmailB = `test-tool-ctrl-b-${runId}@example.com`;

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmailA,
    name: "Test Tool User",
  });

  /** Helper to invoke a tool and return parsed JSON. */
  async function invokeTool(toolName: string, query: Record<string, unknown> = {}, user: AuthenticatedUser = mockUser()) {
    const req = new Request(`http://localhost/api/tools/${toolName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const res = await controller.invoke(req, user, { toolName });
    const data = await res.json() as Record<string, unknown>;
    return { status: res.status, data };
  }

  beforeAll(async () => {
    const userA = await userAdapter.create({
      email: testEmailA,
      name: "Test Tool User",
      intro: "Integration test user for ToolController",
    });
    testUserId = userA.id;
    await userAdapter.update(testUserId, { onboarding: { completedAt: new Date().toISOString() } });

    const userB = await userAdapter.create({
      email: testEmailB,
      name: "Test Tool User B",
      intro: "Second test user for CLI contract tests",
    });
    testUserBId = userB.id;

    const noOpGraph = { invoke: async () => ({}) };
    const graphs = {
      profile: noOpGraph,
      intent: noOpGraph,
      index: noOpGraph,
      networkMembership: noOpGraph,
      intentIndex: noOpGraph,
      opportunity: noOpGraph,
      premise: noOpGraph,
    } as unknown as ToolDeps['graphs'];
    const toolService = new ToolService({ graphs });
    controller = new ToolController(toolService);
    console.log(`Created test users: A=${testUserId}, B=${testUserBId}`);
  }, 60_000);

  afterAll(async () => {
    for (const id of [testUserId, testUserBId]) {
      if (id) {
        try { await userAdapter.deleteById(id); } catch { /* FK constraint — user has memberships */ }
      }
    }
    console.log("Cleaned up test users");
  }, 90_000);

  // ── Existing ToolController tests ──────────────────────────────

  test("GET /tools should list available tools", async () => {
    const req = new Request("http://localhost/api/tools");
    const res = await controller.list(req, mockUser());
    const data = (await res.json()) as { tools?: Array<{ name: string; description: string; schema: unknown }> };

    expect(res.status).toBe(200);
    expect(data.tools).toBeDefined();
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools!.length).toBeGreaterThan(0);

    // Each tool should have name, description, and schema
    for (const tool of data.tools!) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.schema).toBeDefined();
    }

    // Verify known tools are present
    const toolNames = data.tools!.map((t) => t.name);
    expect(toolNames).toContain("read_intents");
    console.log(`Listed ${data.tools!.length} tools: ${toolNames.join(", ")}`);
  }, 30_000);

  test("POST /tools/read_intents should return intents for user", async () => {
    const { status, data } = await invokeTool("read_intents", {});
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("read_intents result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools blocks non-onboarding tools for incomplete users", async () => {
    const { status, data } = await invokeTool("list_opportunities", {}, {
      id: testUserBId,
      email: testEmailB,
      name: "Test Tool User B",
    });

    expect(status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Onboarding required");
    expect(String(data.message)).toContain("research_profile");
  }, 60_000);

  test("POST /tools/unknown_tool should return 404 error", async () => {
    const req = new Request("http://localhost/api/tools/unknown_tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: {} }),
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "unknown_tool" });
    const data = (await res.json()) as { error?: string };

    expect(res.status).toBe(404);
    expect(data.error).toBeDefined();
    expect(data.error).toContain("not found");
    console.log("unknown_tool error:", data.error);
  }, 60_000);

  test("POST /tools/read_networks should return indexes for user", async () => {
    const { status, data } = await invokeTool("read_networks", {});
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("read_networks result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/research_profile should return a result", async () => {
    const { status, data } = await invokeTool("research_profile", {});
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("research_profile result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/list_opportunities should return opportunities", async () => {
    const { status, data } = await invokeTool("list_opportunities", {});
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("list_opportunities result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  parallelsTest("POST /tools/scrape_url should handle a URL", async () => {
    const { status, data } = await invokeTool("scrape_url", { url: "https://example.com" });
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("scrape_url result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools with invalid JSON body should fallback to empty query and succeed", async () => {
    const req = new Request("http://localhost/api/tools/read_intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });

    const res = await controller.invoke(req, mockUser(), { toolName: "read_intents" });
    // Controller treats unparsable JSON as empty body {}, so tool executes with default query
    expect(res.status).toBe(200);
  }, 60_000);

  test("POST /tools/read_intent_indexes without params should return validation error", async () => {
    const { status, data } = await invokeTool("read_intent_indexes", {});
    expect(status).toBe(200);
    expect(data.success).toBe(false);
    expect(String(data.error)).toMatch(/indexId|intentId|networkId/i);
    console.log("read_intent_indexes result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  // ── CLI Tool Call Contracts ────────────────────────────────────
  //
  // Verifies the exact query shapes the CLI sends are accepted by
  // real tool handlers. Catches fabricated field names that compile
  // in TypeScript but fail silently at runtime.

  describe("CLI tool call contracts", () => {

    // ── Intent (CLI: intent update, link, unlink, links) ─────────

    test("update_intent with intentId + description (CLI: intent update)", async () => {
      const { status, data } = await invokeTool("update_intent", {
        intentId: "00000000-0000-0000-0000-000000000000",
        description: "Updated description",
      });
      // Tool should accept the query shape (not 400/404 on schema)
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("create_intent_index with intentId + indexId (CLI: intent link)", async () => {
      const { status, data } = await invokeTool("create_intent_index", {
        intentId: "00000000-0000-0000-0000-000000000000",
        indexId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("delete_intent_index with intentId + indexId (CLI: intent unlink)", async () => {
      const { status, data } = await invokeTool("delete_intent_index", {
        intentId: "00000000-0000-0000-0000-000000000000",
        indexId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("read_intent_indexes with intentId (CLI: intent links)", async () => {
      const { status, data } = await invokeTool("read_intent_indexes", {
        intentId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    // ── Opportunity (CLI: discover modes) ────────────────────────

    test("POST /tools/discover_opportunities reports the retained not-found contract", async () => {
      const { status, data } = await invokeTool("discover_opportunities", {});
      expect(status).toBe(404);
      expect(String(data.error)).toContain("not found");
    }, 60_000);

    test("list_opportunities with empty query (CLI: opportunity list)", async () => {
      const { status, data } = await invokeTool("list_opportunities", {});
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    }, 60_000);

    // ── Network (CLI: network update, delete) ────────────────────

    test("update_network with networkId + settings (CLI: network update)", async () => {
      const { status, data } = await invokeTool("update_network", {
        networkId: "00000000-0000-0000-0000-000000000000",
        settings: { title: "New Name", prompt: "Updated description" },
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("delete_network with networkId (CLI: network delete)", async () => {
      const { status, data } = await invokeTool("delete_network", {
        networkId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    // ── Membership (CLI: introduce prerequisite calls) ───────────

    test("read_network_memberships with userId (CLI: introduce step 1)", async () => {
      const { status, data } = await invokeTool("read_network_memberships", {
        userId: testUserId,
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    }, 60_000);

    test("read_intents with userId + indexId (CLI: introduce step 2)", async () => {
      const { status, data } = await invokeTool("read_intents", {
        userId: testUserId,
        indexId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      // May fail on membership check, not schema
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    // ── Scrape (CLI: scrape) ─────────────────────────────────────

    parallelsTest("scrape_url with url + objective (CLI: scrape)", async () => {
      const { status, data } = await invokeTool("scrape_url", {
        url: "https://example.com",
        objective: "Extract main content",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    // ── Sync (CLI: sync) ─────────────────────────────────────────

    test("all sync tools accept empty query (CLI: sync)", async () => {
      const syncTools = ["read_networks", "read_intents"];
      for (const toolName of syncTools) {
        const { status, data } = await invokeTool(toolName, {});
        expect(status).toBe(200);
        expect(data).toBeDefined();
      }
    }, 60_000);

    openRouterTest("create_intent with description (CLI: intent create)", async () => {
      const { status, data } = await invokeTool("create_intent", {
        description: "Looking for a CTO with AI experience",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("delete_intent with intentId (CLI: intent archive)", async () => {
      const { status, data } = await invokeTool("delete_intent", {
        intentId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("update_opportunity with opportunityId + status (CLI: opportunity accept)", async () => {
      const { status, data } = await invokeTool("update_opportunity", {
        opportunityId: "00000000-0000-0000-0000-000000000000",
        status: "accepted",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

  });
});
