/** Config */
import { config } from "dotenv";
config({ path: 'backend/.env.test', override: true });
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { ToolController } from "../tool.controller";
import { ToolService } from "../../services/tool.service";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import { ComposioIntegrationAdapter } from "../../adapters/integration.adapter";
import { contactService } from "../../services/contact.service";
import { IntegrationService } from "../../services/integration.service";
import type { AuthenticatedUser } from "../../guards/auth.guard";

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
  async function invokeTool(toolName: string, query: Record<string, unknown> = {}) {
    const req = new Request(`http://localhost/api/tools/${toolName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const res = await controller.invoke(req, mockUser(), { toolName });
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

    const userB = await userAdapter.create({
      email: testEmailB,
      name: "Test Tool User B",
      intro: "Second test user for CLI contract tests",
    });
    testUserBId = userB.id;

    const integrationAdapter = new ComposioIntegrationAdapter();
    const integrationService = new IntegrationService(integrationAdapter, contactService);
    const toolService = new ToolService(contactService, integrationService, integrationAdapter);
    controller = new ToolController(toolService);
    console.log(`Created test users: A=${testUserId}, B=${testUserBId}`);
  });

  afterAll(async () => {
    // Remove contacts and memberships created during tests before deleting users
    if (testUserId) {
      try {
        // Remove any contacts added during tests
        const contacts = await invokeTool("list_contacts", {});
        const contactList = ((contacts.data as Record<string, unknown>)?.contacts as Array<{ userId: string }>) ?? [];
        for (const c of contactList) {
          await invokeTool("remove_contact", { contactUserId: c.userId });
        }
      } catch { /* ignore cleanup errors */ }
    }

    for (const id of [testUserId, testUserBId]) {
      if (id) {
        try { await userAdapter.deleteById(id); } catch { /* FK constraint — user has memberships */ }
      }
    }
    console.log("Cleaned up test users");
  });

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

  test("POST /tools/list_contacts should return contacts for user", async () => {
    const { status, data } = await invokeTool("list_contacts", {});
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("list_contacts result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/read_networks should return indexes for user", async () => {
    const { status, data } = await invokeTool("read_networks", {});
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("read_networks result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/read_user_profiles should return profile data", async () => {
    const { status, data } = await invokeTool("read_user_profiles", {});
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("read_user_profiles result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/list_opportunities should return opportunities", async () => {
    const { status, data } = await invokeTool("list_opportunities", {});
    expect(status).toBe(200);
    expect(data).toBeDefined();
    console.log("list_opportunities result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  test("POST /tools/scrape_url should handle a URL", async () => {
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

  test("POST /tools/read_intent_networks without params should return validation error", async () => {
    const { status, data } = await invokeTool("read_intent_networks", {});
    expect(status).toBe(200);
    expect(data.success).toBe(false);
    expect(String(data.error)).toMatch(/networkId|intentId/i);
    console.log("read_intent_networks result:", JSON.stringify(data).slice(0, 200));
  }, 60_000);

  // ── CLI Tool Call Contracts ────────────────────────────────────
  //
  // Verifies the exact query shapes the CLI sends are accepted by
  // real tool handlers. Catches fabricated field names that compile
  // in TypeScript but fail silently at runtime.

  describe("CLI tool call contracts", () => {

    // ── Profile (CLI: profile search, show, create, update) ──────

    test("read_user_profiles with query (CLI: profile search)", async () => {
      const { status, data } = await invokeTool("read_user_profiles", { query: "nonexistent-xyz" });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    }, 30_000);

    test("read_user_profiles with userId (CLI: profile show via tool)", async () => {
      const { status, data } = await invokeTool("read_user_profiles", { userId: testUserId });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    }, 30_000);

    // ── Intent (CLI: intent update, link, unlink, links) ─────────

    test("update_intent with intentId + newDescription (CLI: intent update)", async () => {
      const { status, data } = await invokeTool("update_intent", {
        intentId: "00000000-0000-0000-0000-000000000000",
        newDescription: "Updated description",
      });
      // Tool should accept the query shape (not 400/404 on schema)
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("create_intent_network with intentId + networkId (CLI: intent link)", async () => {
      const { status, data } = await invokeTool("create_intent_network", {
        intentId: "00000000-0000-0000-0000-000000000000",
        networkId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("delete_intent_network with intentId + networkId (CLI: intent unlink)", async () => {
      const { status, data } = await invokeTool("delete_intent_network", {
        intentId: "00000000-0000-0000-0000-000000000000",
        networkId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("read_intent_networks with intentId (CLI: intent links)", async () => {
      const { status, data } = await invokeTool("read_intent_networks", {
        intentId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    // ── Opportunity (CLI: discover modes) ────────────────────────

    test("create_opportunities with searchQuery (CLI: opportunity discover)", async () => {
      const { status, data } = await invokeTool("create_opportunities", {
        searchQuery: "AI engineer with privacy expertise",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 120_000);

    test("create_opportunities with targetUserId + searchQuery (CLI: discover --target)", async () => {
      const { status, data } = await invokeTool("create_opportunities", {
        targetUserId: testUserBId,
        searchQuery: "collaborate on open-source tooling",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 120_000);

    test("create_opportunities with partyUserIds + entities (CLI: discover --introduce)", async () => {
      const { status, data } = await invokeTool("create_opportunities", {
        partyUserIds: [testUserId, testUserBId],
        entities: [
          {
            userId: testUserId,
            profile: { name: "User A", bio: "Engineer" },
            intents: [{ intentId: "i1", payload: "Looking for collaborators" }],
            networkId: "00000000-0000-0000-0000-000000000000",
          },
          {
            userId: testUserBId,
            profile: { name: "User B", bio: "Designer" },
            intents: [{ intentId: "i2", payload: "Looking for engineers" }],
            networkId: "00000000-0000-0000-0000-000000000000",
          },
        ],
        hint: "both working on AI tools",
      });
      // May fail on permissions/membership/profile, but NOT schema validation
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 120_000);

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

    // ── Contact (CLI: contact list, add, remove) ─────────────────

    test("list_contacts with empty query (CLI: contact list)", async () => {
      const { status, data } = await invokeTool("list_contacts", {});
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    }, 60_000);

    test("add_contact with email + name (CLI: contact add)", async () => {
      const { status, data } = await invokeTool("add_contact", {
        email: "new-contact-test@example.com",
        name: "New Contact",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("remove_contact with contactUserId (CLI: contact remove)", async () => {
      const { status, data } = await invokeTool("remove_contact", {
        contactUserId: "00000000-0000-0000-0000-000000000000",
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

    test("read_intents with userId + networkId (CLI: introduce step 2)", async () => {
      const { status, data } = await invokeTool("read_intents", {
        userId: testUserId,
        networkId: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(200);
      // May fail on membership check, not schema
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    // ── Scrape (CLI: scrape) ─────────────────────────────────────

    test("scrape_url with url + objective (CLI: scrape)", async () => {
      const { status, data } = await invokeTool("scrape_url", {
        url: "https://example.com",
        objective: "Extract main content",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    // ── Sync (CLI: sync) ─────────────────────────────────────────

    test("all sync tools accept empty query (CLI: sync)", async () => {
      const syncTools = ["read_user_profiles", "read_networks", "read_intents", "list_contacts"];
      for (const toolName of syncTools) {
        const { status, data } = await invokeTool(toolName, {});
        expect(status).toBe(200);
        expect(data).toBeDefined();
      }
    }, 60_000);

    // ── Onboarding (CLI: onboarding complete) ────────────────────

    test("complete_onboarding with empty query (CLI: onboarding complete)", async () => {
      const { status, data } = await invokeTool("complete_onboarding", {});
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("create_intent with description (CLI: intent create)", async () => {
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

    test("create_user_profile with confirm (CLI: profile sync - no profile)", async () => {
      const { status, data } = await invokeTool("create_user_profile", {
        confirm: true,
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);

    test("update_user_profile with action (CLI: profile sync - has profile)", async () => {
      const { status, data } = await invokeTool("update_user_profile", {
        action: "regenerate",
      });
      expect(status).toBe(200);
      expect(String(data.error ?? "")).not.toContain("Invalid query");
    }, 60_000);
  });
});
