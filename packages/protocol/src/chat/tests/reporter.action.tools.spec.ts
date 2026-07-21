import { describe, expect, it, mock } from "bun:test";

import { createReporterActionTool } from "../reporter.action.tools.js";
import { filterReporterTools, REPORTER_TOOL_NAMES } from "../reporter.persona.js";
import { buildReporterSystemContent } from "../reporter.prompt.js";
import type { ResolvedToolContext, ToolContext } from "../../shared/agent/tool.factory.js";
import type { ChatGraphCompositeDatabase, UserDatabase } from "../../shared/interfaces/database.interface.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PREMISE_ID = "22222222-2222-4222-8222-222222222222";
const INTENT_ID = "33333333-3333-4333-8333-333333333333";

function context(): ResolvedToolContext {
  return {
    userId: USER_ID,
    userName: "Alice",
    userEmail: "alice@example.com",
    user: { id: USER_ID, name: "Alice", email: "alice@example.com" },
    userProfile: null,
    userNetworks: [],
    indexScope: [],
    isOnboarding: false,
    hasName: true,
    sessionId: "conversation-1",
  } as unknown as ResolvedToolContext;
}

function deps(overrides: {
  actionToolsEnabled?: boolean;
  premise?: Record<string, unknown> | null;
  intent?: Record<string, unknown> | null;
} = {}): ToolContext {
  const store = { createProposal: mock(async () => {}) };
  const database = {
    getPremise: mock(async () => overrides.premise ?? {
      id: PREMISE_ID,
      userId: USER_ID,
      status: "ACTIVE",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      assertion: { text: "I build products", tier: "assertive" },
    }),
  };
  const userDb = {
    getIntent: mock(async () => overrides.intent ?? {
      id: INTENT_ID,
      userId: USER_ID,
      payload: "Find product collaborators",
      summary: null,
      status: "ACTIVE",
      archivedAt: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  };
  return {
    database: database as unknown as ChatGraphCompositeDatabase,
    userDb: userDb as unknown as UserDatabase,
    actionToolsEnabled: overrides.actionToolsEnabled ?? true,
    actionProposalStore: store,
  } as unknown as ToolContext;
}

describe("reporter cleanup action proposals", () => {
  it("does not change the reporter allowlist when the action gate is off", () => {
    expect(filterReporterTools(REPORTER_TOOL_NAMES.map((name) => ({ name })))).toHaveLength(10);
    expect(createReporterActionTool(deps({ actionToolsEnabled: false }), context(), {} as UserDatabase)).toBeNull();
  });

  it("is present only when the composition root enables the action gate", () => {
    expect(createReporterActionTool(deps({ actionToolsEnabled: true }), context(), {} as UserDatabase)?.name)
      .toBe("propose_cleanup_actions");
    expect(createReporterActionTool(deps({ actionToolsEnabled: false }), context(), {} as UserDatabase)).toBeNull();
    expect(buildReporterSystemContent({ ...context(), actionToolsEnabled: true })).toContain("same-turn owner-scoped reads");
    expect(buildReporterSystemContent(context())).not.toContain("same-turn owner-scoped reads");
  });

  it("validates owner state, persists a plan, and emits the fenced proposal block", async () => {
    const tool = createReporterActionTool(deps(), context(), deps().userDb as UserDatabase)!;
    const output = JSON.parse(String(await tool.invoke({
      actions: [
        { type: "retract_premise", premiseId: PREMISE_ID },
        { type: "pause_signal", intentId: INTENT_ID, evidence: "This turn read zero live opportunities." },
        { type: "retract_premise", premiseId: "not-a-full-id" },
      ],
    }))) as { data: { message: string; actions: Array<{ skipped?: boolean; reason?: string }> } };
    expect(output.data.message).toContain("```agent_action_proposal");
    expect(output.data.actions).toHaveLength(3);
    expect(output.data.actions[2]?.skipped).toBe(true);
    expect(output.data.actions[2]?.reason).toContain("full UUID");
  });

  it("rejects an empty pause evidence string", async () => {
    const tool = createReporterActionTool(deps(), context(), deps().userDb as UserDatabase)!;
    await expect(tool.invoke({
      actions: [{ type: "pause_signal", intentId: INTENT_ID, evidence: "  " }],
    })).rejects.toThrow();
  });
});
