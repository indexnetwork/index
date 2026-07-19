import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";

import { ORCHESTRATOR_PERSONA, ORCHESTRATOR_PERSONA_ID } from "../chat.persona.js";
import { SIGNAL_PERSONA, SIGNAL_PERSONA_ID, SIGNAL_TOOL_NAMES, filterSignalTools, narrowSignalTools } from "../signal.persona.js";
import { buildSignalSystemContent } from "../signal.prompt.js";
import type { ChatTools, ResolvedToolContext } from "../../shared/agent/tool.factory.js";

const EXPECTED_SIGNAL_TOOLS = [
  "read_intents",
  "create_intent",
  "update_intent",
  "delete_intent",
  "search_intents",
  "read_intent_indexes",
  "create_intent_index",
  "delete_intent_index",
  "read_user_contexts",
  "preview_user_context",
  "confirm_user_context",
  "create_user_context",
  "update_user_context",
  "read_premises",
  "create_premise",
  "update_premise",
  "retract_premise",
  "read_networks",
  "read_network_memberships",
  "scrape_url",
  "ask_user_question",
] as const;

const FORBIDDEN_TOOLS = [
  // Opportunity and discovery-run capabilities.
  "discover_opportunities",
  "get_discovery_run",
  "cancel_discovery_run",
  "list_opportunities",
  "update_opportunity",
  "confirm_opportunity_delivery",
  // Negotiation capabilities.
  "list_negotiations",
  "get_negotiation",
  "respond_to_negotiation",
  // Contacts and imports.
  "list_contacts",
  "search_contacts",
  "add_contact",
  "remove_contact",
  "import_contacts",
  "import_gmail_contacts",
  // Agent administration.
  "register_agent",
  "list_agents",
  "update_agent",
  "delete_agent",
  "grant_agent_permission",
  "revoke_agent_permission",
  // Network administration and membership mutation.
  "create_network",
  "update_network",
  "delete_network",
  "create_network_membership",
  "delete_network_membership",
] as const;

function makeContext(): ResolvedToolContext {
  return {
    userId: "user-1",
    userName: "Alice",
    userEmail: "alice@example.com",
    user: { id: "user-1", name: "Alice", email: "alice@example.com" },
    userProfile: { context: "Product builder in Berlin" },
    userNetworks: [],
    isOwner: false,
    isOnboarding: false,
    hasName: true,
    contactsEnabled: false,
  } as unknown as ResolvedToolContext;
}

describe("SIGNAL_PERSONA", () => {
  it("uses the canonical persisted persona id", () => {
    expect(SIGNAL_PERSONA_ID).toBe("signal");
    expect(SIGNAL_PERSONA.id).toBe(SIGNAL_PERSONA_ID);
    expect(SIGNAL_PERSONA_ID).not.toBe(ORCHESTRATOR_PERSONA_ID);
  });

  it("disables only the discovery-coupled callback and retains proposal recovery", () => {
    expect(SIGNAL_PERSONA.loopBehaviors).toEqual({
      createIntentCallback: false,
      hallucinationRecovery: true,
    });
    expect(ORCHESTRATOR_PERSONA.loopBehaviors.createIntentCallback).toBe(true);
  });

  it("uses the Signal-specific prompt builder", () => {
    const ctx = makeContext();
    expect(SIGNAL_PERSONA.buildSystemContent(ctx, { iteration: 1 } as never)).toBe(
      buildSignalSystemContent(ctx),
    );
  });
});

describe("Signal Agent tool boundary", () => {
  it("pins the exact positive allowlist", () => {
    expect(SIGNAL_TOOL_NAMES).toEqual(EXPECTED_SIGNAL_TOOLS);
  });

  it("keeps exactly allowlisted tools from a shared registry", () => {
    const registry = [...EXPECTED_SIGNAL_TOOLS, ...FORBIDDEN_TOOLS, "read_docs"]
      .map((name) => ({ name }));
    expect(filterSignalTools(registry).map((tool) => tool.name)).toEqual(
      EXPECTED_SIGNAL_TOOLS,
    );
  });

  it("cannot admit forbidden capability families", () => {
    const allowed = new Set<string>(SIGNAL_TOOL_NAMES);
    for (const forbidden of FORBIDDEN_TOOLS) {
      expect(allowed.has(forbidden)).toBe(false);
    }
  });

  it("narrows shared handlers to proposal-only and self-only modes", async () => {
    const calls: Array<{ name: string; query: Record<string, unknown> }> = [];
    const shared = ["create_intent", "read_premises", "read_user_contexts", "read_intents", "search_intents", "read_intent_indexes"]
      .map((name) => ({
        name,
        invoke: async (query: Record<string, unknown>) => {
          calls.push({ name, query });
          return JSON.stringify({ success: true });
        },
      })) as unknown as ChatTools;
    const narrowed = narrowSignalTools(shared);

    await narrowed.find((candidate) => candidate.name === "create_intent")!.invoke({
      description: "Find climate founders",
      autoApprove: true,
    });
    await narrowed.find((candidate) => candidate.name === "read_premises")!.invoke({
      userId: "another-user",
      includeRetracted: true,
    });
    await narrowed.find((candidate) => candidate.name === "read_user_contexts")!.invoke({
      userId: "another-user",
    });
    await narrowed.find((candidate) => candidate.name === "read_intents")!.invoke({
      userId: "another-user",
      networkId: "another-network",
      limit: 10,
    });
    await narrowed.find((candidate) => candidate.name === "search_intents")!.invoke({
      query: "climate",
      limit: 5,
    });
    await narrowed.find((candidate) => candidate.name === "read_intent_indexes")!.invoke({
      intentId: "11111111-1111-4111-8111-111111111111",
      networkId: "22222222-2222-4222-8222-222222222222",
      userId: "another-user",
    });

    expect(calls).toEqual([
      {
        name: "create_intent",
        query: { description: "Find climate founders", autoApprove: false },
      },
      { name: "read_premises", query: { includeRetracted: true } },
      { name: "read_user_contexts", query: {} },
      { name: "read_intents", query: { limit: 10 } },
      { name: "search_intents", query: { query: "climate", limit: 5 } },
      {
        name: "read_intent_indexes",
        query: {
          intentId: "11111111-1111-4111-8111-111111111111",
          networkId: "22222222-2222-4222-8222-222222222222",
        },
      },
    ]);
  });
});

describe("buildSignalSystemContent", () => {
  const prompt = buildSignalSystemContent(makeContext());

  it("identifies the restricted role and grounds writes", () => {
    expect(prompt).toContain("You are Signal Agent");
    expect(prompt).toContain("Read before writing");
    expect(prompt).toContain("latest explicit request");
    expect(prompt).toContain("Matching happens separately in the background");
  });

  it("advertises every allowed capability and no forbidden tool", () => {
    for (const allowed of SIGNAL_TOOL_NAMES) {
      expect(prompt).toContain(allowed);
    }
    for (const forbidden of FORBIDDEN_TOOLS) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  it("includes preloaded identity and profile context", () => {
    expect(prompt).toContain('"name": "Alice"');
    expect(prompt).toContain("Product builder in Berlin");
  });
});
