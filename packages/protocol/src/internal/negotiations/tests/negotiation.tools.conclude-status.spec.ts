/**
 * MCP conclude → opportunity status (follow-up from the conversational-questions
 * ledger).
 *
 * `respond_to_negotiation` finalizes the negotiation itself — task completed,
 * outcome artifact written — but used to leave `opportunities.status` on
 * whatever it was before ('negotiating'). The row is the input to the
 * transition hook, the radar buckets, and the expiry sweep, so a conclude that
 * skips it leaves a phantom active opportunity behind.
 *
 * These tests pin the write AND its route: the status must go through
 * `updateOpportunityStatus`, the host waist whose post-commit emit is what the
 * transition hook observes (`ConversationDatabaseAdapter.updateOpportunityStatus`
 * in the API service). A raw column update would satisfy "status changed" and
 * still leave the hook blind, so the fake below emits from that method only —
 * exactly as the adapter does.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createNegotiationTools } from "../negotiation.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

type ToolDepsFixture = Record<string, unknown>;

const OPPORTUNITY_ID = "opp-1";

function makeContext(userId: string): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" },
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureRespondTool(deps: ToolDepsFixture) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string>; querySchema?: z.ZodType } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown }) => {
    if (def.name === "respond_to_negotiation") captured = def as typeof captured;
    return def;
  };
  createNegotiationTools(defineTool as never, deps as unknown as ToolDeps);
  return captured!;
}

function turnMessage(senderUserId: string, action: string) {
  return {
    senderId: `agent:${senderUserId}`,
    parts: [{ kind: "data", data: { action, assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "m" } }],
  };
}

function makeFixture(options: { priorTurns: number; maxTurns?: number; dispatchResult?: unknown }) {
  const statusWrites: Array<{ opportunityId: string; status: string }> = [];
  /** Mirrors the host adapter: the transition emit hangs off this method only. */
  const transitions: Array<{ id: string; status: string }> = [];
  const taskStates: string[] = [];
  const priorMessages = Array.from({ length: options.priorTurns }, () => turnMessage("user-src", "outreach"));

  const deps = {
    negotiationDatabase: {
      getTask: async () => ({
        id: "task-1",
        conversationId: "conv-1",
        state: "waiting_for_agent",
        metadata: {
          type: "negotiation",
          sourceUserId: "user-src",
          candidateUserId: "user-cand",
          opportunityId: OPPORTUNITY_ID,
          maxTurns: options.maxTurns ?? 6,
        },
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-02"),
      }),
      getMessagesForConversation: async () => priorMessages,
      getNegotiationMessages: async () => priorMessages,
      createMessage: async () => ({ id: "msg-1", senderId: "s", role: "agent", parts: [], createdAt: new Date() }),
      updateTaskState: async (_id: string, state: string) => { taskStates.push(state); },
      createArtifact: async () => ({ id: "artifact-1" }),
      updateOpportunityStatus: async (opportunityId: string, status: string) => {
        statusWrites.push({ opportunityId, status });
        transitions.push({ id: opportunityId, status });
        return { id: opportunityId, status };
      },
    },
    negotiationTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
    agentDispatcher: { dispatch: async () => options.dispatchResult ?? { handled: false, reason: "waiting" } },
  } satisfies ToolDepsFixture;

  return { deps, statusWrites, transitions, taskStates };
}

describe("respond_to_negotiation — terminal conclude writes the opportunity status", () => {
  test.each([
    ["accept", "pending", "user-cand"],
    ["decline", "rejected", "user-cand"],
  ] as const)("%s advances the opportunity to %s and fires the transition", async (action, expectedStatus, caller) => {
    const fixture = makeFixture({ priorTurns: 1 });
    const tool = captureRespondTool(fixture.deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext(caller),
      query: {
        negotiationId: "task-1",
        action,
        reasoning: "Decided",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    }));

    expect(result.success).toBe(true);
    expect(fixture.taskStates).toContain("completed");
    expect(fixture.statusWrites).toEqual([{ opportunityId: OPPORTUNITY_ID, status: expectedStatus }]);
    expect(fixture.transitions).toEqual([{ id: OPPORTUNITY_ID, status: expectedStatus }]);
  });

  test("the turn cap stalls the opportunity rather than leaving it negotiating", async () => {
    // maxTurns 3 with 2 prior turns: the caller's counter is the cap turn.
    const fixture = makeFixture({ priorTurns: 2, maxTurns: 3 });
    const tool = captureRespondTool(fixture.deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: {
        negotiationId: "task-1",
        action: "counter",
        reasoning: "Keep going",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        message: "One more round",
      },
    }));

    expect(result.success).toBe(true);
    expect(fixture.taskStates).toContain("completed");
    expect(fixture.statusWrites).toEqual([{ opportunityId: OPPORTUNITY_ID, status: "stalled" }]);
    expect(fixture.transitions).toEqual([{ id: OPPORTUNITY_ID, status: "stalled" }]);
  });

  test("a counterparty turn that concludes the negotiation writes the status too", async () => {
    const fixture = makeFixture({
      priorTurns: 2,
      dispatchResult: {
        handled: true,
        turn: { action: "decline", assessment: { reasoning: "Not a fit", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } },
      },
    });
    const tool = captureRespondTool(fixture.deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: {
        negotiationId: "task-1",
        action: "counter",
        reasoning: "Proposal",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        message: "Here is my counter",
      },
    }));

    expect(result.success).toBe(true);
    expect(fixture.statusWrites).toEqual([{ opportunityId: OPPORTUNITY_ID, status: "rejected" }]);
    expect(fixture.transitions).toEqual([{ id: OPPORTUNITY_ID, status: "rejected" }]);
  });

  test("a non-terminal turn leaves the opportunity status alone", async () => {
    const fixture = makeFixture({ priorTurns: 1 });
    const tool = captureRespondTool(fixture.deps);

    await tool.handler({
      context: makeContext("user-cand"),
      query: {
        negotiationId: "task-1",
        action: "counter",
        reasoning: "Keep going",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        message: "One more round",
      },
    });

    expect(fixture.taskStates).not.toContain("completed");
    expect(fixture.statusWrites).toEqual([]);
  });

  test("a failed status write does not turn a completed conclude into a tool error", async () => {
    const fixture = makeFixture({ priorTurns: 1 });
    (fixture.deps.negotiationDatabase as { updateOpportunityStatus: () => Promise<never> }).updateOpportunityStatus =
      async () => { throw new Error("status write failed"); };
    const tool = captureRespondTool(fixture.deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: {
        negotiationId: "task-1",
        action: "decline",
        reasoning: "Not a fit",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    }));

    expect(result.success).toBe(true);
    expect(fixture.taskStates).toContain("completed");
  });
});
