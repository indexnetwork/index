/**
 * `list_negotiations` and the park (#1472).
 *
 * The incident: a negotiation sat `input_required` on the client's side for
 * two hours with the open question "Timing: This week". Every #1470 surface
 * was correct — the precedence gate found the question, the prompt's
 * open-questions section named it — and then the model called this tool,
 * which renders lifecycle from OPPORTUNITY STATUS, where the pairing
 * legitimately reads `negotiating`. Holding a static context line saying one
 * thing and a just-executed tool saying another, it went with the tool:
 * "there are currently no open questions… nothing for you to decide".
 *
 * So these specs pin three things: a park on the viewer is named WITH its
 * question number (the same number the open-questions enumeration assigns), a
 * park on the counterparty is named WITHOUT its content, and a negotiation
 * with no park renders byte-for-byte as it did before.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createNegotiationTools } from "../negotiation.tools.js";
import { negotiationQuestionSettlementId } from "../negotiation.question-safety.js";
import { NEGOTIATION_PARK_REASONING } from "../negotiation.stall-gap.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

const VIEWER = "user-src";
const COUNTERPARTY = "user-cand";
const INTENT_ID = "intent-1";
const OPPORTUNITY_ID = "opp-1";
const TASK_ID = "task-1";

function makeContext(userId = VIEWER, intentId?: string): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" },
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...(intentId ? { scopeType: "intent" as const, scopeId: intentId } : {}),
  } as unknown as ResolvedToolContext;
}

function captureListing(deps: Record<string, unknown>) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string>; querySchema?: z.ZodType } | undefined;
  const defineTool = (def: { name: string; handler: unknown; querySchema?: z.ZodType }) => {
    if (def.name === "list_negotiations") captured = def as typeof captured;
    return def;
  };
  createNegotiationTools(defineTool as never, deps as unknown as ToolDeps);
  return captured!;
}

/** The parked task as the graph writes it: `input_required` + a coherent binding. */
function parkedTask(recipientUserId: string) {
  return {
    id: TASK_ID,
    conversationId: "conv-1",
    state: "input_required",
    metadata: {
      type: "negotiation",
      sourceUserId: VIEWER,
      candidateUserId: COUNTERPARTY,
      maxTurns: 6,
      opportunityId: OPPORTUNITY_ID,
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

function askUserMessage(senderUserId: string) {
  return {
    senderId: `agent:${senderUserId}`,
    taskId: TASK_ID,
    parts: [{ kind: "data", data: { action: "ask_user", assessment: { reasoning: NEGOTIATION_PARK_REASONING }, message: null } }],
  };
}

/**
 * The incident's own state: opportunity `negotiating` (which it legitimately
 * is), task `input_required` on the viewer, one open question numbered 1.
 */
function incidentDeps(overrides: {
  recipientUserId?: string;
  openQuestions?: Array<{ opportunityId: string; question: number; label: string }>;
  withHost?: boolean;
} = {}) {
  const recipientUserId = overrides.recipientUserId ?? VIEWER;
  const task = parkedTask(recipientUserId);
  return {
    negotiationDatabase: {
      getTasksForUser: async () => [task],
      getNegotiationMessages: async () => [askUserMessage(recipientUserId)],
      getMessagesForConversation: async () => [askUserMessage(recipientUserId)],
      getIntentIdsForOpportunities: async () => ({ [OPPORTUNITY_ID]: INTENT_ID }),
      getOpportunityLifecyclesForNegotiations: async () => ({
        [OPPORTUNITY_ID]: { status: "negotiating", acceptedByOwner: false },
      }),
    },
    ...(overrides.withHost === false ? {} : {
      negotiationListingPark: {
        readOpenQuestions: async () => overrides.openQuestions
          ?? [{ opportunityId: OPPORTUNITY_ID, question: 1, label: "Timing: This week" }],
      },
    }),
  };
}

async function listOne(deps: Record<string, unknown>, context = makeContext(VIEWER, INTENT_ID)) {
  const tool = captureListing(deps);
  const result = JSON.parse(await tool.handler({ context, query: {} }));
  expect(result.success).toBe(true);
  return result.data.negotiations[0];
}

describe("list_negotiations — a park on the viewer", () => {
  test("names the open question with the number the enumeration assigned", async () => {
    const negotiation = await listOne(incidentDeps());

    expect(negotiation.park).toMatchObject({
      waitingOn: "you",
      kind: "mid_flight",
      question: 1,
      questionLabel: "Timing: This week",
    });
    expect(negotiation.park.label).toContain("open question 1");
    expect(negotiation.park.label).toContain("Timing: This week");
  });

  test("carries whatever number the question record assigned, never a fresh one", async () => {
    // The listing enumerates ONE negotiation; the block enumerates three. If
    // the listing counted for itself this would read 1.
    const negotiation = await listOne(incidentDeps({
      openQuestions: [{ opportunityId: OPPORTUNITY_ID, question: 3, label: "Budget" }],
    }));

    expect(negotiation.park.question).toBe(3);
    expect(negotiation.park.label).toContain("open question 3");
  });

  test("the incident: `negotiating` cannot be rendered without the park", async () => {
    const negotiation = await listOne(incidentDeps());

    // The opportunity status is still reported truthfully...
    expect(negotiation.lifecycle.opportunityStatus).toBe("negotiating");
    // ...but it may no longer supply the sentence the persona narrates from.
    expect(negotiation.lifecycle.connectionState).toBe("parked_awaiting_your_answer");
    expect(negotiation.lifecycle.lifecycleLabel).not.toContain("still negotiating");
    expect(negotiation.lifecycle.lifecycleLabel).toContain("PARKED");
    expect(negotiation.lifecycle.lifecycleLabel).toContain("Timing: This week");
    expect(negotiation.lifecycle.park).toMatchObject({ waitingOn: "you", question: 1 });
  });

  test("still says the park when no host is wired, just without the number", async () => {
    const negotiation = await listOne(incidentDeps({ withHost: false }));

    expect(negotiation.park).toEqual({
      waitingOn: "you",
      kind: "mid_flight",
      label: negotiation.park.label,
    });
    expect(negotiation.park.question).toBeUndefined();
    expect(negotiation.park.label).toContain("PARKED");
    expect(negotiation.lifecycle.connectionState).toBe("parked_awaiting_your_answer");
  });

  test("a post-stall park on the viewer is a park too", async () => {
    const task = { ...parkedTask(VIEWER), state: "completed" };
    const negotiation = await listOne({
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getNegotiationMessages: async () => [askUserMessage(VIEWER)],
        getMessagesForConversation: async () => [askUserMessage(VIEWER)],
        getIntentIdsForOpportunities: async () => ({ [OPPORTUNITY_ID]: INTENT_ID }),
        getOpportunityLifecyclesForNegotiations: async () => ({
          [OPPORTUNITY_ID]: { status: "stalled", acceptedByOwner: false },
        }),
      },
      negotiationListingPark: {
        readOpenQuestions: async () => [{ opportunityId: OPPORTUNITY_ID, question: 2, label: "Rate" }],
      },
    });

    expect(negotiation.park).toMatchObject({ waitingOn: "you", kind: "post_stall", question: 2, questionLabel: "Rate" });
  });
});

describe("list_negotiations — a park on the counterparty", () => {
  test("is named, and its content is not", async () => {
    const negotiation = await listOne(incidentDeps({
      recipientUserId: COUNTERPARTY,
      // Even if the host somehow offered a question for this negotiation, the
      // park is not on this client and its content is not theirs to read.
      openQuestions: [{ opportunityId: OPPORTUNITY_ID, question: 1, label: "Their private ask" }],
    }));

    expect(negotiation.park).toEqual({
      waitingOn: "counterparty",
      kind: "mid_flight",
      label: negotiation.park.label,
    });
    expect(negotiation.park.question).toBeUndefined();
    expect(negotiation.park.questionLabel).toBeUndefined();
    expect(JSON.stringify(negotiation)).not.toContain("Their private ask");
    expect(negotiation.lifecycle.connectionState).toBe("parked_awaiting_counterparty");
    expect(negotiation.lifecycle.lifecycleLabel).toContain("counterparty");
  });
});

describe("list_negotiations — no park", () => {
  test("renders exactly as it did before the park annotations existed", async () => {
    const task = {
      id: TASK_ID,
      conversationId: "conv-1",
      state: "working",
      metadata: {
        type: "negotiation",
        sourceUserId: VIEWER,
        candidateUserId: COUNTERPARTY,
        maxTurns: 6,
        opportunityId: OPPORTUNITY_ID,
      },
      createdAt: new Date("2026-08-20T18:00:00Z"),
      updatedAt: new Date("2026-08-20T20:04:00Z"),
    };
    const message = {
      senderId: `agent:${VIEWER}`,
      taskId: TASK_ID,
      parts: [{ kind: "data", data: { action: "outreach", assessment: { reasoning: "why" }, message: "hello" } }],
    };
    const negotiation = await listOne({
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getNegotiationMessages: async () => [message],
        getMessagesForConversation: async () => [message],
        getIntentIdsForOpportunities: async () => ({ [OPPORTUNITY_ID]: INTENT_ID }),
        getOpportunityLifecyclesForNegotiations: async () => ({
          [OPPORTUNITY_ID]: { status: "negotiating", acceptedByOwner: false },
        }),
      },
      negotiationListingPark: { readOpenQuestions: async () => [] },
    });

    // The fixture pin: field-for-field what this tool returned before #1472.
    expect(negotiation).toEqual({
      id: TASK_ID,
      counterpartyId: COUNTERPARTY,
      role: "source",
      turnCount: 1,
      status: "active",
      isUsersTurn: false,
      isContinuation: false,
      priorTurnCount: 0,
      latestAction: "outreach",
      latestActionActor: "agent",
      latestMessagePreview: "hello",
      lifecycle: {
        agentNegotiation: "in_progress",
        opportunityStatus: "negotiating",
        connectionState: "agents_negotiating",
        ownerAction: "not_recorded",
        directConversationEvidence: "not_provided",
        lifecycleLabel: "The agents are still negotiating; no owner decision is recorded.",
      },
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    });
    expect("park" in negotiation).toBe(false);
  });
});
