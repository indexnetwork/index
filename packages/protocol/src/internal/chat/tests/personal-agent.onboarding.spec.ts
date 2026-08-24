import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";

import { createPersonalAgentPersona, PERSONAL_AGENT_ONBOARDING_TOOL_NAMES, filterOnboardingTools } from "../personal-agent.persona.js";
import { buildOnboardingSystemContent, isOnboardingFlow, SIGNAL_NEW_SIGNAL_KICKOFF } from "../personal-agent.prompt.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";

const EXPECTED_TOOLS = [
  "research_profile",
  "create_intent",
] as const;

const FORBIDDEN_TOOLS = [
  "scrape_url",
  "read_premises",
  "create_premise",
  "update_premise",
  "retract_premise",
  "import_gmail_contacts",
  "import_contacts",
  "list_contacts",
  "add_contact",
  "discover_opportunities",
  "get_discovery_run",
  "list_opportunities",
  "update_opportunity",
  "list_negotiations",
  "respond_to_negotiation",
  "read_networks",
  "create_network",
  "update_network",
  "delete_network",
  "read_network_memberships",
  "create_network_membership",
  "delete_network_membership",
  "register_agent",
  "list_agents",
  "grant_agent_permission",
] as const;

function makeContext(onboarding: Record<string, unknown> = {}): ResolvedToolContext {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    userName: "Alice",
    userEmail: "alice@example.com",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Alice",
      email: "alice@example.com",
      onboarding,
    },
    userProfile: null,
    userNetworks: [{
      networkId: "22222222-2222-4222-8222-222222222222",
      networkTitle: "Climate Builders",
      isPersonal: false,
      permissions: ["member"],
      indexPrompt: null,
      memberPrompt: null,
      autoAssign: false,
      joinedAt: new Date("2026-07-01T00:00:00.000Z"),
    }],
    isOnboarding: true,
    hasName: true,
  } as unknown as ResolvedToolContext;
}

describe("onboarding flow of the PersonalAgent persona", () => {
  it("is selected by incomplete-onboarding session state in global scope, never by a persona id", () => {
    expect(isOnboardingFlow(makeContext(), "global")).toBe(true);
    expect(isOnboardingFlow(makeContext(), "intent")).toBe(false);
    const complete = { ...makeContext(), isOnboarding: false } as ResolvedToolContext;
    expect(isOnboardingFlow(complete, "global")).toBe(false);
  });

  it("composes the onboarding fragment for a mid-onboarding global session", () => {
    const ctx = makeContext();
    const persona = createPersonalAgentPersona({ agentName: "Alice's Agent" }, "global");
    const prompt = persona.buildSystemContent(ctx, { iteration: 1 } as never);
    expect(prompt).toContain("restricted setup assistant");
    expect(prompt).toBe(buildOnboardingSystemContent(ctx, { agentName: "Alice's Agent" }, { iteration: 1 } as never));
  });

  it("introduces itself as the user's own agent, never a product noun", () => {
    const ctx = makeContext();
    const named = createPersonalAgentPersona({ agentName: "Alice's Agent" }, "global")
      .buildSystemContent(ctx, { iteration: 1 } as never);
    expect(named).toContain("You are Alice's Agent, the restricted setup assistant for Alice.");
    expect(named).not.toContain("Onboarding Agent");

    // ensureNegotiatorAgent runs at auth, so a nameless row is the unexpected
    // case — it still must not reintroduce a product noun.
    const nameless = createPersonalAgentPersona({}, "global")
      .buildSystemContent(ctx, { iteration: 1 } as never);
    expect(nameless).toContain("You are Alice's personal agent, the restricted setup assistant.");
    expect(nameless).not.toContain("Onboarding Agent");
  });

  it("pins the exact positive allowlist and excludes every forbidden family", () => {
    expect(PERSONAL_AGENT_ONBOARDING_TOOL_NAMES).toEqual(EXPECTED_TOOLS);
    const registry = [...EXPECTED_TOOLS, ...FORBIDDEN_TOOLS, "future_shared_tool"]
      .map((name) => ({ name }));
    expect(filterOnboardingTools(registry).map((tool) => tool.name)).toEqual([...EXPECTED_TOOLS]);

    const allowed = new Set<string>(PERSONAL_AGENT_ONBOARDING_TOOL_NAMES);
    for (const forbidden of FORBIDDEN_TOOLS) expect(allowed.has(forbidden)).toBe(false);
    expect(allowed.has("future_shared_tool")).toBe(false);
  });
});

describe("buildOnboardingSystemContent", () => {
  it("runs the approved profile flow during the profile phase", () => {
    const prompt = buildOnboardingSystemContent(makeContext(), {}, {
      currentMessage: "onboarding-profile-kickoff",
      recentTools: [],
      ctx: makeContext(),
    });
    expect(prompt).toContain("PROFILE PHASE (ACTIVE)");
    expect(prompt).toContain("explicitly ask the user to approve it or provide corrections");
    expect(prompt).toContain("Do not start signal-intake questions during this profile phase");
  });

  it("reuses the shipped live guided intake only after durable profile approval", () => {
    const ctx = makeContext({
      profileConfirmedAt: "2026-07-01T00:00:00.000Z",
      currentStep: "first_signal",
    });
    const prompt = buildOnboardingSystemContent(ctx, {}, {
      currentMessage: SIGNAL_NEW_SIGNAL_KICKOFF,
      recentTools: [],
      ctx,
    });
    expect(prompt).toContain("NEW SIGNAL INTAKE (ACTIVE)");
    expect(prompt).toContain("plain conversation");
    expect(prompt).toContain("Climate Builders");
    expect(prompt).toContain("proposal-only");
    expect(prompt).toContain("browser confirms the proposal");
  });

  it("advertises every allowed tool name and no forbidden tool name", () => {
    const prompt = buildOnboardingSystemContent(makeContext());
    for (const allowed of EXPECTED_TOOLS) expect(prompt).toContain(allowed);
    for (const forbidden of FORBIDDEN_TOOLS) expect(prompt).not.toContain(forbidden);
  });
});
