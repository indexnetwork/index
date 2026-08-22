/**
 * The MCP answer lane (`answer_pending_question`).
 *
 * The listing says "open question 3, 'Timing'" to a client that could do
 * nothing about it. These specs pin the lane that closes the gap: the tool
 * resolves scope from the negotiation the client is looking at, hands the
 * SHOWN number to the same host record the listing's numbers come from
 * (anti-divergence, the #1470 pattern: one fixture, both surfaces), and
 * refuses — before the host — anyone who is not a party.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createNegotiationAnswerTools } from "../negotiation.answer.tools.js";
import { createNegotiationTools } from "../negotiation.tools.js";
import { negotiationQuestionSettlementId } from "../negotiation.question-safety.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { NegotiationToolDeps } from "../negotiation.tools.port.js";

const VIEWER = "user-src";
const COUNTERPARTY = "user-cand";
const OUTSIDER = "user-else";
const INTENT_ID = "intent-1";
const OPPORTUNITY_ID = "opp-1";
const TASK_ID = "task-1";

function makeContext(userId = VIEWER, opts: { scopeNetworkId?: string; pinIntent?: boolean } = {}): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" },
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...(opts.scopeNetworkId ? { scopeType: "network" as const, scopeId: opts.scopeNetworkId } : {}),
    ...(opts.pinIntent ? { scopeType: "intent" as const, scopeId: INTENT_ID } : {}),
  } as unknown as ResolvedToolContext;
}

function captureTool(name: string, register: (defineTool: never) => void) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string>; querySchema: z.ZodType } | undefined;
  const defineTool = (def: { name: string; handler: unknown; querySchema: z.ZodType }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  register(defineTool as never);
  return captured!;
}

function parkedTask(recipientUserId = VIEWER) {
  return {
    id: TASK_ID,
    conversationId: "conv-1",
    state: "input_required",
    metadata: {
      type: "negotiation",
      sourceUserId: VIEWER,
      candidateUserId: COUNTERPARTY,
      opportunityId: OPPORTUNITY_ID,
      networkId: "network-1",
      turnContext: {
        askUserBinding: {
          settlementId: negotiationQuestionSettlementId(TASK_ID),
          recipientUserId,
          recipientIntentId: INTENT_ID,
          networkId: "network-1",
          opportunityId: OPPORTUNITY_ID,
        },
      },
    },
    createdAt: new Date("2026-08-20T18:00:00Z"),
    updatedAt: new Date("2026-08-20T20:04:00Z"),
  };
}

function askUserMessage(recipientUserId = VIEWER) {
  return {
    senderId: `agent:${recipientUserId}`,
    taskId: TASK_ID,
    parts: [{ kind: "data", data: { action: "ask_user", assessment: { reasoning: "Negotiation parked pending the client's answer." }, message: null } }],
  };
}

/**
 * ONE question record for both surfaces (the #1470 pattern): the listing's
 * park host and the answer host both read this enumeration, so the number the
 * listing prints must be the number that routes the answer.
 */
function sharedQuestionRecord(question = 3, label = "Timing") {
  const record = [{ opportunityId: OPPORTUNITY_ID, question, label }];
  const hostCalls: Array<{ userId: string; intentId: string; question: number; answer: string }> = [];
  return {
    record,
    hostCalls,
    listingParkHost: { readOpenQuestions: async () => record },
    answerHost: {
      answerOpenQuestion: async (userId: string, input: { intentId: string; question: number; answer: string }) => {
        hostCalls.push({ userId, ...input });
        const match = record.find((entry) => entry.question === input.question);
        return match
          ? { status: "routed" as const, label: match.label }
          : { status: "unknown_question" as const, open: record.length };
      },
    },
  };
}

function makeDeps(overrides: {
  shared?: ReturnType<typeof sharedQuestionRecord>;
  withHost?: boolean;
  task?: Record<string, unknown> | null;
  intentIds?: Record<string, string | null>;
} = {}) {
  const shared = overrides.shared ?? sharedQuestionRecord();
  const task = overrides.task === undefined ? parkedTask() : overrides.task;
  const deps = {
    negotiationDatabase: {
      getTask: async () => task,
      getTasksForUser: async () => (task ? [task] : []),
      getNegotiationMessages: async () => [askUserMessage()],
      getMessagesForConversation: async () => [askUserMessage()],
      getIntentIdsForOpportunities: async () => overrides.intentIds ?? { [OPPORTUNITY_ID]: INTENT_ID },
      getOpportunityLifecyclesForNegotiations: async () => ({
        [OPPORTUNITY_ID]: { status: "negotiating", acceptedByOwner: false },
      }),
    },
    negotiationListingPark: shared.listingParkHost,
    ...(overrides.withHost === false ? {} : { negotiatorAnswerTools: shared.answerHost }),
  };
  return { deps, shared };
}

async function invoke(deps: Record<string, unknown>, context: ResolvedToolContext, query: Record<string, unknown>) {
  const tool = captureTool("answer_pending_question", (dt) =>
    createNegotiationAnswerTools(dt, deps as unknown as NegotiationToolDeps));
  return JSON.parse(await tool.handler({ context, query }));
}

describe("answer_pending_question (MCP)", () => {
  test("the number the listing shows is the number that routes — one record, both surfaces", async () => {
    const { deps, shared } = makeDeps();

    // Surface 1: the listing annotates the park with the record's number.
    const listing = captureTool("list_negotiations", (dt) =>
      createNegotiationTools(dt, deps as unknown as ToolDeps));
    const listed = JSON.parse(await listing.handler({ context: makeContext(VIEWER, { pinIntent: true }), query: {} }));
    expect(listed.success).toBe(true);
    const shownNumber = listed.data.negotiations[0].park.question;
    expect(shownNumber).toBe(3);

    // Surface 2: answering with exactly the shown number routes to the record.
    const result = await invoke(deps, makeContext(VIEWER), {
      negotiationId: TASK_ID,
      question: shownNumber,
      answer: "This week works.",
    });
    expect(result.success).toBe(true);
    expect(result.data.status).toBe("routed");
    expect(result.data.question).toBe("Timing");
    expect(shared.hostCalls).toEqual([{
      userId: VIEWER,
      intentId: INTENT_ID,
      question: 3,
      answer: "This week works.",
    }]);
  });

  test("resolves the intent from the caller's own actor on the negotiation's opportunity", async () => {
    const { deps, shared } = makeDeps();
    const result = await invoke(deps, makeContext(VIEWER), { negotiationId: TASK_ID, question: 3, answer: "yes" });
    expect(result.success).toBe(true);
    expect(shared.hostCalls[0]!.intentId).toBe(INTENT_ID);
  });

  test("a non-party is refused before the host runs", async () => {
    const { deps, shared } = makeDeps();
    const result = await invoke(deps, makeContext(OUTSIDER), { negotiationId: TASK_ID, question: 3, answer: "yes" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not a party");
    expect(shared.hostCalls).toEqual([]);
  });

  test("a network-bound agent cannot reach a negotiation outside its scope", async () => {
    const { deps, shared } = makeDeps();
    const result = await invoke(deps, makeContext(VIEWER, { scopeNetworkId: "network-other" }), {
      negotiationId: TASK_ID, question: 3, answer: "yes",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not in your bound network scope");
    expect(shared.hostCalls).toEqual([]);
  });

  test("an unknown number is an honest re-read instruction, never a resume", async () => {
    const { deps, shared } = makeDeps();
    const result = await invoke(deps, makeContext(VIEWER), { negotiationId: TASK_ID, question: 9, answer: "yes" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("does not name an open question");
    expect(result.error).toContain("1 currently open");
    expect(shared.hostCalls.length).toBe(1);
  });

  test("a missing host is an honest unavailability error", async () => {
    const { deps } = makeDeps({ withHost: false });
    const result = await invoke(deps, makeContext(VIEWER), { negotiationId: TASK_ID, question: 3, answer: "yes" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });

  test("an unresolvable caller intent refuses rather than routing blind", async () => {
    const { deps, shared } = makeDeps({ intentIds: { [OPPORTUNITY_ID]: null } });
    const result = await invoke(deps, makeContext(VIEWER), { negotiationId: TASK_ID, question: 3, answer: "yes" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not resolve your signal");
    expect(shared.hostCalls).toEqual([]);
  });
});

describe("list_negotiations — the input_required filter", () => {
  function captureListing(deps: Record<string, unknown>) {
    return captureTool("list_negotiations", (dt) => createNegotiationTools(dt, deps as unknown as ToolDeps));
  }

  test("input_required maps to the parked task state", async () => {
    const seenStates: Array<unknown> = [];
    const { deps } = makeDeps();
    const spiedDeps = {
      ...deps,
      negotiationDatabase: {
        ...deps.negotiationDatabase,
        getTasksForUser: async (_userId: string, options?: { state?: string }) => {
          seenStates.push(options?.state);
          return [parkedTask()];
        },
      },
    };
    const listing = captureListing(spiedDeps);
    const result = JSON.parse(await listing.handler({
      context: makeContext(VIEWER, { pinIntent: true }),
      query: { status: "input_required" },
    }));
    expect(result.success).toBe(true);
    expect(seenStates).toEqual(["input_required"]);
    expect(result.data.negotiations.length).toBe(1);
    expect(result.data.negotiations[0].status).toBe("input_required");
    expect(result.data.negotiations[0].park).toMatchObject({ waitingOn: "you", question: 3 });
  });

  test("active still maps to working, untouched", async () => {
    const seenStates: Array<unknown> = [];
    const { deps } = makeDeps();
    const spiedDeps = {
      ...deps,
      negotiationDatabase: {
        ...deps.negotiationDatabase,
        getTasksForUser: async (_userId: string, options?: { state?: string }) => {
          seenStates.push(options?.state);
          return [];
        },
      },
    };
    const listing = captureListing(spiedDeps);
    const result = JSON.parse(await listing.handler({
      context: makeContext(VIEWER, { pinIntent: true }),
      query: { status: "active" },
    }));
    expect(result.success).toBe(true);
    expect(seenStates).toEqual(["working"]);
  });
});
