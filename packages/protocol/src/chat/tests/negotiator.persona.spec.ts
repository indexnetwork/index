/**
 * P4.1 negotiator persona — client-scoped persona unit tests.
 *
 * The negotiator persona is a pure addition on the P4.0 persona seam:
 * advocate prompt bound to the personal agent row identity and a
 * client-scoped tool allowlist. P4.5 (IND-413) expanded the allowlist —
 * signals, profile/premise writes, network joins, contacts — and enabled
 * hallucinationRecovery (create_intent makes ```intent_proposal blocks
 * legitimate). Direct discovery, network administration, onboarding
 * plumbing, and agent management stay excluded. These tests pin down the
 * persona config shape, the prompt's identity/grounding content, and the
 * tool-scoping rule.
 *
 * No LLM calls, no DB, no module mocks.
 */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";

import { NEGOTIATOR_PERSONA_ID, NEGOTIATOR_TOOL_NAMES, createNegotiatorPersona, filterNegotiatorTools } from "../negotiator.persona.js";
import { buildNegotiatorSystemContent } from "../negotiator.prompt.js";
import { ORCHESTRATOR_PERSONA_ID } from "../chat.persona.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  return {
    userId: "user-1",
    userName: "Alice Test",
    userEmail: "alice@example.com",
    user: { id: "user-1", name: "Alice Test", email: "alice@example.com" },
    userProfile: { bio: "Builder", skills: ["typescript"], interests: ["AI"] },
    userNetworks: [],
    indexName: undefined,
    isOwner: false,
    isOnboarding: false,
    hasName: true,
    contactsEnabled: false,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

const AGENT_OPTS = {
  agentName: "Alice's Negotiator",
  agentDescription: "Negotiates on your behalf across the network.",
};

// ─── Persona config ──────────────────────────────────────────────────────────

describe("createNegotiatorPersona", () => {
  it("uses the negotiator persona id (matches the conversations.persona value)", () => {
    const persona = createNegotiatorPersona(AGENT_OPTS);
    expect(persona.id).toBe(NEGOTIATOR_PERSONA_ID);
    expect(persona.id).toBe("negotiator");
    expect(persona.id).not.toBe(ORCHESTRATOR_PERSONA_ID);
  });

  it("keeps the discovery-coupled loop behavior OFF and hallucination recovery ON (P4.5)", () => {
    const persona = createNegotiatorPersona(AGENT_OPTS);
    // createIntentCallback only fires off discover_opportunities results —
    // discovery is retired for this persona, so it must stay off.
    expect(persona.loopBehaviors.createIntentCallback).toBe(false);
    // With create_intent in the toolset, ```intent_proposal blocks are
    // legitimate output — unbacked ones must be detected and stripped.
    expect(persona.loopBehaviors.hallucinationRecovery).toBe(true);
  });

  it("builds its prompt from the negotiator prompt module", () => {
    const persona = createNegotiatorPersona(AGENT_OPTS);
    const ctx = makeCtx();
    expect(persona.buildSystemContent(ctx, { iteration: 1 } as never)).toBe(
      buildNegotiatorSystemContent(ctx, AGENT_OPTS),
    );
  });
});

// ─── Prompt content ──────────────────────────────────────────────────────────

describe("buildNegotiatorSystemContent", () => {
  const ctx = makeCtx();
  const prompt = buildNegotiatorSystemContent(ctx, AGENT_OPTS);

  it("identifies as the user's personal negotiator agent by name", () => {
    expect(prompt).toContain("You are Alice's Negotiator");
    expect(prompt).toContain("working for Alice Test");
    expect(prompt).toContain(AGENT_OPTS.agentDescription);
  });

  it("is not the orchestrator identity", () => {
    expect(prompt).not.toContain("You are Index.");
    // Retired/excluded capabilities never appear in the tool table.
    expect(prompt).not.toContain("discover_opportunities");
    expect(prompt).not.toContain("create_network ");
    expect(prompt).not.toContain("complete_onboarding");
    expect(prompt).not.toContain("register_agent");
  });

  it("includes the preloaded client context", () => {
    expect(prompt).toContain('"id": "user-1"');
    expect(prompt).toContain('"bio": "Builder"');
    expect(prompt).toContain("alice@example.com");
  });

  it("references every allowlisted tool and no others in the tools table", () => {
    for (const name of NEGOTIATOR_TOOL_NAMES) {
      expect(prompt).toContain(name);
    }
  });

  it("omits the description line when the agent row has none", () => {
    const noDesc = buildNegotiatorSystemContent(ctx, { agentName: "Alice's Negotiator" });
    expect(noDesc).not.toContain("Negotiates on your behalf");
    expect(noDesc).toContain("You are Alice's Negotiator");
  });

  it("is deterministic (snapshot-safe across iterations)", () => {
    expect(buildNegotiatorSystemContent(ctx, AGENT_OPTS)).toBe(prompt);
    expect(buildNegotiatorSystemContent(ctx, AGENT_OPTS, { iteration: 3 } as never)).toBe(prompt);
  });
});

// ─── Intent pin (P4.2 / IND-403) ─────────────────────────────────────────────

describe("buildNegotiatorSystemContent — pinned signal (intent scope)", () => {
  const scopedCtx = makeCtx({ scopeType: "intent", scopeId: "intent-42" } as Partial<ResolvedToolContext>);

  it("renders the pinned-signal section when the session is intent-scoped", () => {
    const prompt = buildNegotiatorSystemContent(scopedCtx, AGENT_OPTS);
    expect(prompt).toContain("## Pinned signal");
    expect(prompt).toContain("intent id: intent-42");
    // Awareness, not a sandbox — the prompt must say the focus is not a wall.
    expect(prompt).toContain("This is a focus, not a wall");
  });

  it("includes the human-readable label when provided", () => {
    const prompt = buildNegotiatorSystemContent(scopedCtx, {
      ...AGENT_OPTS,
      pinnedIntentLabel: "Technical co-founder in Berlin",
    });
    expect(prompt).toContain("intent id: intent-42");
    expect(prompt).toContain("Technical co-founder in Berlin");
  });

  it("omits the section entirely for the unscoped DM", () => {
    const prompt = buildNegotiatorSystemContent(makeCtx(), AGENT_OPTS);
    expect(prompt).not.toContain("## Pinned signal");
    // A stray label without an intent scope must not leak into the prompt.
    const withLabel = buildNegotiatorSystemContent(makeCtx(), { ...AGENT_OPTS, pinnedIntentLabel: "Stray" });
    expect(withLabel).not.toContain("Stray");
  });

  it("ignores network scope (no pinned-signal section)", () => {
    const networkCtx = makeCtx({ scopeType: "network", scopeId: "net-1" } as Partial<ResolvedToolContext>);
    const prompt = buildNegotiatorSystemContent(networkCtx, AGENT_OPTS);
    expect(prompt).not.toContain("## Pinned signal");
  });
});

// ─── Tool scoping ────────────────────────────────────────────────────────────

/** Representative orchestrator registry (superset of the negotiator allowlist). */
const ORCHESTRATOR_REGISTRY_NAMES = [
  // enrichment / profile
  "read_user_contexts",
  "create_user_context",
  "update_user_context",
  "preview_user_context",
  "confirm_user_context",
  "complete_onboarding",
  "record_onboarding_privacy_consent",
  // intents
  "read_intents",
  "create_intent",
  "update_intent",
  "delete_intent",
  "create_intent_index",
  "read_intent_indexes",
  "delete_intent_index",
  "search_intents",
  // networks
  "read_networks",
  "create_network",
  "update_network",
  "delete_network",
  "read_network_memberships",
  "create_network_membership",
  "delete_network_membership",
  // opportunities / discovery
  "discover_opportunities",
  "list_opportunities",
  "update_opportunity",
  "get_discovery_run",
  "cancel_discovery_run",
  "confirm_opportunity_delivery",
  // utilities / integrations / contacts / agents
  "scrape_url",
  "read_docs",
  "import_gmail_contacts",
  "import_contacts",
  "list_contacts",
  "search_contacts",
  "add_contact",
  "remove_contact",
  "register_agent",
  "list_agents",
  "update_agent",
  "delete_agent",
  "grant_agent_permission",
  "revoke_agent_permission",
  // negotiations
  "list_negotiations",
  "get_negotiation",
  "respond_to_negotiation",
  // premises / questioner
  "create_premise",
  "read_premises",
  "update_premise",
  "retract_premise",
  "read_pending_questions",
  "ask_user_question",
];

describe("filterNegotiatorTools", () => {
  const registry = ORCHESTRATOR_REGISTRY_NAMES.map((name) => ({ name }));
  const filtered = filterNegotiatorTools(registry);
  const filteredNames = filtered.map((t) => t.name);

  it("keeps exactly the negotiator allowlist", () => {
    expect(new Set(filteredNames)).toEqual(new Set(NEGOTIATOR_TOOL_NAMES));
  });

  it("keeps the P4.5 capability groups (signals, knowledge writes, joins, contacts)", () => {
    for (const allowed of [
      "read_pending_questions",
      "create_intent",
      "update_intent",
      "delete_intent",
      "search_intents",
      "create_user_context",
      "update_user_context",
      "create_premise",
      "retract_premise",
      "read_networks",
      "create_network_membership",
      "delete_network_membership",
      "list_contacts",
      "import_contacts",
      "import_gmail_contacts",
      "update_opportunity",
      "scrape_url",
    ]) {
      expect(filteredNames).toContain(allowed);
    }
  });

  it("drops every retired/excluded tool", () => {
    for (const banned of [
      // discovery is retired — matching is signal-based
      "discover_opportunities",
      "get_discovery_run",
      "cancel_discovery_run",
      // network administration stays a human/UI act
      "create_network",
      "update_network",
      "delete_network",
      // onboarding plumbing
      "complete_onboarding",
      "record_onboarding_privacy_consent",
      // agent management
      "register_agent",
      "update_agent",
      "delete_agent",
      "grant_agent_permission",
      "revoke_agent_permission",
      // never chat-callable
      "confirm_opportunity_delivery",
      "read_docs",
      "ask_user_question",
    ]) {
      expect(filteredNames).not.toContain(banned);
    }
  });

  it("is a no-op on an already-scoped registry (idempotent)", () => {
    expect(filterNegotiatorTools(filtered)).toEqual(filtered);
  });

  it("the allowlist itself contains no retired or admin tool names", () => {
    const names = new Set<string>(NEGOTIATOR_TOOL_NAMES);
    expect(names.has("discover_opportunities")).toBe(false);
    expect(names.has("create_network")).toBe(false);
    expect(names.has("delete_network")).toBe(false);
    expect(names.has("complete_onboarding")).toBe(false);
    expect(names.has("register_agent")).toBe(false);
  });
});
