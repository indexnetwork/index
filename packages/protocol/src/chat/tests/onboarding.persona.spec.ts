import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";

import { ONBOARDING_PERSONA, ONBOARDING_PERSONA_ID, ONBOARDING_TOOL_NAMES, filterOnboardingTools, narrowOnboardingTools } from "../onboarding.persona.js";
import { buildOnboardingSystemContent } from "../onboarding.prompt.js";
import { SIGNAL_NEW_SIGNAL_KICKOFF } from "../signal.prompt.js";
import type { ChatTools, ResolvedToolContext } from "../../shared/agent/tool.factory.js";

const EXPECTED_TOOLS = [
  "record_onboarding_privacy_consent",
  "read_user_contexts",
  "preview_user_context",
  "confirm_user_context",
  "ask_user_question",
  "create_intent",
  "complete_onboarding",
] as const;

const FORBIDDEN_TOOLS = [
  "scrape_url",
  "create_user_context",
  "update_user_context",
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

describe("ONBOARDING_PERSONA", () => {
  it("uses a first-class persisted persona with safe loop behavior", () => {
    expect(ONBOARDING_PERSONA_ID).toBe("onboarding");
    expect(ONBOARDING_PERSONA.id).toBe(ONBOARDING_PERSONA_ID);
    expect(ONBOARDING_PERSONA.loopBehaviors).toEqual({
      createIntentCallback: false,
      hallucinationRecovery: true,
    });
  });

  it("pins the exact positive allowlist and excludes every forbidden family", () => {
    expect(ONBOARDING_TOOL_NAMES).toEqual(EXPECTED_TOOLS);
    const registry = [...EXPECTED_TOOLS, ...FORBIDDEN_TOOLS, "future_shared_tool"]
      .map((name) => ({ name }));
    expect(filterOnboardingTools(registry).map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);

    const allowed = new Set<string>(ONBOARDING_TOOL_NAMES);
    for (const forbidden of FORBIDDEN_TOOLS) expect(allowed.has(forbidden)).toBe(false);
    expect(allowed.has("future_shared_tool")).toBe(false);
  });

  it("narrows consent provenance and requires an exact completion intent ID", async () => {
    const calls: Array<{ name: string; query: unknown }> = [];
    const tools = narrowOnboardingTools([
      {
        name: "record_onboarding_privacy_consent",
        invoke: async (query: unknown) => {
          calls.push({ name: "consent", query });
          return "ok";
        },
      },
      {
        name: "complete_onboarding",
        invoke: async (query: unknown) => {
          calls.push({ name: "complete", query });
          return "ok";
        },
      },
    ] as unknown as ChatTools);
    const consent = tools.find((candidate) => candidate.name === "record_onboarding_privacy_consent")!;
    const complete = tools.find((candidate) => candidate.name === "complete_onboarding")!;

    await expect(consent.invoke({ edgeosImportGranted: true })).rejects.toThrow();
    await consent.invoke({ publicProfileLookupGranted: false });
    await expect(complete.invoke({})).rejects.toThrow();
    await complete.invoke({ intentId: "44444444-4444-4444-8444-444444444444" });

    expect(calls).toEqual([
      {
        name: "consent",
        query: { publicProfileLookupGranted: false, source: "web_onboarding" },
      },
      {
        name: "complete",
        query: { intentId: "44444444-4444-4444-8444-444444444444" },
      },
    ]);
  });
});

describe("buildOnboardingSystemContent", () => {
  it("requires durable explicit lookup consent before profile preview", () => {
    const prompt = buildOnboardingSystemContent(makeContext(), {
      currentMessage: "onboarding-profile-kickoff",
      recentTools: [],
      ctx: makeContext(),
    });
    expect(prompt).toContain("No public-profile lookup decision is recorded yet");
    expect(prompt).toContain("Stop after asking");
    expect(prompt).toContain("Never perform or request public lookup before that write succeeds");
    expect(prompt).toContain("explicitly ask the user to approve it or provide corrections");
    expect(prompt).toContain("Do not use ask_user_question during this profile phase");
  });

  it("honors a durable refusal and never requires public lookup", () => {
    const ctx = makeContext({
      privacy: {
        publicProfileLookup: {
          granted: false,
          decidedAt: "2026-07-01T00:00:00.000Z",
          source: "web_onboarding",
        },
      },
    });
    const prompt = buildOnboardingSystemContent(ctx);
    expect(prompt).toContain("durably recorded as declined");
    expect(prompt).toContain("allowPublicLookup=false");
    expect(prompt).toContain("only information the user explicitly provides");
  });

  it("reuses the shipped live guided intake only after durable profile approval", () => {
    const ctx = makeContext({
      profileConfirmedAt: "2026-07-01T00:00:00.000Z",
      currentStep: "first_signal",
    });
    const prompt = buildOnboardingSystemContent(ctx, {
      currentMessage: SIGNAL_NEW_SIGNAL_KICKOFF,
      recentTools: [],
      ctx,
    });
    expect(prompt).toContain("NEW SIGNAL INTAKE (ACTIVE)");
    expect(prompt).toContain("Round 1 of 3: who they want to meet");
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
