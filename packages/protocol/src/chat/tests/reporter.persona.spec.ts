import { describe, expect, it, mock } from "bun:test";

import { ORCHESTRATOR_PERSONA_ID } from "../chat.persona.js";
import { REPORTER_BRIEFING_KICKOFF, REPORTER_PERSONA, REPORTER_PERSONA_ID, REPORTER_TOOL_NAMES, filterReporterTools, narrowReporterTools } from "../reporter.persona.js";
import { buildReporterSystemContent, isReporterBriefingKickoff } from "../reporter.prompt.js";
import type { ChatTools, ResolvedToolContext } from "../../shared/agent/tool.factory.js";
import type { UserDatabase } from "../../shared/interfaces/database.interface.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const EXPECTED_TOOLS = [
  "read_intents",
  "search_intents",
  "read_user_contexts",
  "preview_user_context",
  "read_premises",
  "read_networks",
  "read_network_memberships",
  "read_pending_questions",
  "list_opportunities",
  "report_agent_activity",
] as const;

const FORBIDDEN_FAMILY_TOOLS = [
  "discover_opportunities",
  "get_discovery_run",
  "cancel_discovery_run",
  "list_negotiations",
  "get_negotiation",
  "respond_to_negotiation",
  "update_opportunity",
  "confirm_opportunity_delivery",
  "create_intent",
  "update_intent",
  "delete_intent",
  "create_premise",
  "update_premise",
  "retract_premise",
  "create_user_context",
  "update_user_context",
  "confirm_user_context",
  "answer_pending_question",
  "remember",
  "forget",
  "scrape_url",
  "create_network_membership",
  "delete_network_membership",
] as const;

function context(): ResolvedToolContext {
  return {
    userId: USER_ID,
    userName: "Alice",
    userEmail: "alice@example.com",
    user: { id: USER_ID, name: "Alice", email: "alice@example.com" },
    userProfile: { context: "Product builder in Berlin" },
    userNetworks: [],
    indexScope: [],
    isOnboarding: false,
    hasName: true,
  } as unknown as ResolvedToolContext;
}

function sharedTools(names: readonly string[]): ChatTools {
  return names.map((name) => ({
    name,
    invoke: mock(async () => JSON.stringify({ success: true, name })),
  })) as unknown as ChatTools;
}

function userDb(): UserDatabase {
  return {
    getActiveIntents: mock(async () => []),
    searchOwnIntents: mock(async () => []),
    getOpportunitiesForUser: mock(async () => []),
  } as unknown as UserDatabase;
}

describe("REPORTER_PERSONA", () => {
  it("uses the canonical read-only persona and disables loop side effects", () => {
    expect(REPORTER_PERSONA_ID).toBe("reporter");
    expect(REPORTER_PERSONA.id).toBe(REPORTER_PERSONA_ID);
    expect(REPORTER_PERSONA_ID).not.toBe(ORCHESTRATOR_PERSONA_ID);
    expect(REPORTER_PERSONA.loopBehaviors).toEqual({
      createIntentCallback: false,
      hallucinationRecovery: false,
    });
  });

  it("pins the exact positive allowlist", () => {
    expect(REPORTER_TOOL_NAMES).toEqual(EXPECTED_TOOLS);
  });

  it("keeps exactly allowlisted tools from a shared registry", () => {
    const registry = [...EXPECTED_TOOLS, ...FORBIDDEN_FAMILY_TOOLS, "read_docs"]
      .map((name) => ({ name }));
    expect(filterReporterTools(registry).map((candidate) => candidate.name)).toEqual(EXPECTED_TOOLS);
  });

  it("admits none of the forbidden negotiation, mutation, discovery, or memory families", () => {
    const allowed = new Set<string>(REPORTER_TOOL_NAMES);
    for (const forbidden of FORBIDDEN_FAMILY_TOOLS) {
      expect(allowed.has(forbidden)).toBe(false);
    }
  });

  it("uses the reporter prompt and briefing marker", () => {
    expect(REPORTER_PERSONA.buildSystemContent(context(), { iteration: 1 } as never))
      .toBe(buildReporterSystemContent(context()));
    expect(REPORTER_BRIEFING_KICKOFF).toBe("reporter-briefing-kickoff");
    expect(isReporterBriefingKickoff(REPORTER_BRIEFING_KICKOFF)).toBe(true);
    expect(isReporterBriefingKickoff("please report on my agent")).toBe(false);
    const briefing = buildReporterSystemContent(context(), {
      iteration: 1,
      currentMessage: REPORTER_BRIEFING_KICKOFF,
    } as never);
    expect(briefing).toContain("Call report_agent_activity first");
    expect(briefing).toContain("what did you do today?");
  });

  it("narrows shared self reads and opportunity rows to aggregate output", async () => {
    const tools = narrowReporterTools(
      sharedTools([...EXPECTED_TOOLS]),
      { context: context(), userDb: userDb() },
    );
    const contexts = tools.find((candidate) => candidate.name === "read_user_contexts")!;
    await contexts.invoke({});
    const memberships = tools.find((candidate) => candidate.name === "read_network_memberships")!;
    await memberships.invoke({});
    const opportunities = tools.find((candidate) => candidate.name === "list_opportunities")!;
    const parsed = JSON.parse(String(await opportunities.invoke({}))) as { data: { count: number } };
    expect(parsed.data.count).toBe(0);
    await expect(contexts.invoke({ userId: "other-user" })).rejects.toThrow();
  });
});
