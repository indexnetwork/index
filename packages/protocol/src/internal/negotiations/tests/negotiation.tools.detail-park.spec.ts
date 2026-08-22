/**
 * `get_negotiation` and the park (#1472, one level down).
 *
 * The listing learned to say the park in 23.5.1; the DETAIL — the tool the
 * poller prompt says to call FIRST — still narrated a lifecycle built without
 * it: "input_required" status beside "the agents are still negotiating". These
 * specs pin four things:
 *
 * - a park on the caller is named, with the number the shared question record
 *   assigned;
 * - a park on the counterparty is named without its content;
 * - the persisted `askUser`/`checklist` payloads are projected on the turns
 *   that carry them (an external seat cannot see dimensions or `settles`
 *   without them), while plain turns keep their prior shape;
 * - a non-parked negotiation renders byte-for-byte as before.
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

function makeContext(userId = VIEWER): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" },
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureDetail(deps: Record<string, unknown>) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string>; querySchema?: z.ZodType } | undefined;
  const defineTool = (def: { name: string; handler: unknown; querySchema?: z.ZodType }) => {
    if (def.name === "get_negotiation") captured = def as typeof captured;
    return def;
  };
  createNegotiationTools(defineTool as never, deps as unknown as ToolDeps);
  return captured!;
}

const ASK_USER_PAYLOAD = {
  reason: "missing_fact",
  dimension: "Timing",
  answerhood: { ok_when: "a week is named", conflict_when: "no availability this quarter" },
  question: {
    title: "Timing",
    prompt: "When does this need to happen?",
    options: [
      { label: "This week", description: "" },
      { label: "This month", description: "" },
    ],
  },
};

const CHECKLIST = [
  { name: "Timing", kind: "hard_constraint", status: "unknown", settles: "a concrete week both sides can commit to" },
];

function parkedTask(recipientUserId: string, overrides: { state?: string; turnContextExtra?: Record<string, unknown> } = {}) {
  return {
    id: TASK_ID,
    conversationId: "conv-1",
    state: overrides.state ?? "input_required",
    metadata: {
      type: "negotiation",
      sourceUserId: VIEWER,
      candidateUserId: COUNTERPARTY,
      protocolVersion: "v2",
      maxTurns: 6,
      opportunityId: OPPORTUNITY_ID,
      turnContext: {
        sourceUser: { id: VIEWER, intents: [], profile: {} },
        candidateUser: { id: COUNTERPARTY, intents: [], profile: {} },
        indexContext: { networkId: "network-1" },
        seedAssessment: { reasoning: "seed", valencyRole: "peer" },
        askUserBinding: {
          settlementId: negotiationQuestionSettlementId(TASK_ID),
          recipientUserId,
          recipientIntentId: INTENT_ID,
          networkId: "network-1",
          opportunityId: OPPORTUNITY_ID,
        },
        ...(overrides.turnContextExtra ?? {}),
      },
    },
    createdAt: new Date("2026-08-20T18:00:00Z"),
    updatedAt: new Date("2026-08-20T20:04:00Z"),
  };
}

function askUserMessage(senderUserId: string) {
  return {
    id: "msg-2",
    senderId: `agent:${senderUserId}`,
    role: "agent" as const,
    taskId: TASK_ID,
    parts: [{
      kind: "data",
      data: {
        action: "ask_user",
        assessment: { reasoning: NEGOTIATION_PARK_REASONING, suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
        message: null,
        askUser: ASK_USER_PAYLOAD,
        checklist: CHECKLIST,
      },
    }],
    createdAt: new Date("2026-08-20T20:04:00Z"),
  };
}

function plainMessage(senderUserId: string) {
  return {
    id: "msg-1",
    senderId: `agent:${senderUserId}`,
    role: "agent" as const,
    taskId: TASK_ID,
    parts: [{ kind: "data", data: { action: "outreach", assessment: { reasoning: "why", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "hello" } }],
    createdAt: new Date("2026-08-20T19:00:00Z"),
  };
}

function incidentDeps(overrides: {
  recipientUserId?: string;
  task?: Record<string, unknown>;
  messages?: Array<Record<string, unknown>>;
  openQuestions?: Array<{ opportunityId: string; question: number; label: string }>;
  withHost?: boolean;
  lifecycleStatus?: string;
} = {}) {
  const recipientUserId = overrides.recipientUserId ?? VIEWER;
  const task = overrides.task ?? parkedTask(recipientUserId);
  const messages = overrides.messages ?? [plainMessage(VIEWER), askUserMessage(recipientUserId)];
  return {
    negotiationDatabase: {
      getTask: async () => task,
      getNegotiationMessages: async () => messages,
      getMessagesForConversation: async () => messages,
      getArtifactsForTask: async () => [],
      getIntentIdsForOpportunities: async () => ({ [OPPORTUNITY_ID]: INTENT_ID }),
      getOpportunityLifecyclesForNegotiations: async () => ({
        [OPPORTUNITY_ID]: { status: overrides.lifecycleStatus ?? "negotiating", acceptedByOwner: false },
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

async function getDetail(deps: Record<string, unknown>, context = makeContext(VIEWER)) {
  const tool = captureDetail(deps);
  const result = JSON.parse(await tool.handler({ context, query: { negotiationId: TASK_ID } }));
  expect(result.success).toBe(true);
  return result.data;
}

describe("get_negotiation — a park on the caller", () => {
  test("names the open question with the number the shared record assigned", async () => {
    const detail = await getDetail(incidentDeps());

    expect(detail.status).toBe("input_required");
    expect(detail.park).toMatchObject({
      waitingOn: "you",
      kind: "mid_flight",
      question: 1,
      questionLabel: "Timing: This week",
    });
    expect(detail.park.label).toContain("open question 1");
    // The narration is built WITH the park: the sentence the incident produced
    // ("still negotiating") can no longer be the lifecycle label.
    expect(detail.lifecycle.connectionState).toBe("parked_awaiting_your_answer");
    expect(detail.lifecycle.lifecycleLabel).toContain("PARKED");
    expect(detail.lifecycle.lifecycleLabel).not.toContain("still negotiating");
    expect(detail.lifecycle.opportunityStatus).toBe("negotiating");
  });

  test("carries whatever number the record assigned, never a fresh one", async () => {
    const detail = await getDetail(incidentDeps({
      openQuestions: [{ opportunityId: OPPORTUNITY_ID, question: 3, label: "Budget" }],
    }));
    expect(detail.park.question).toBe(3);
    expect(detail.park.label).toContain("open question 3");
  });

  test("still says the park without the host, just without the number", async () => {
    const detail = await getDetail(incidentDeps({ withHost: false }));
    expect(detail.park).toMatchObject({ waitingOn: "you", kind: "mid_flight" });
    expect(detail.park.question).toBeUndefined();
    expect(detail.lifecycle.connectionState).toBe("parked_awaiting_your_answer");
  });

  test("a post-stall park on the caller is a park too", async () => {
    const detail = await getDetail(incidentDeps({
      task: parkedTask(VIEWER, { state: "completed" }),
      lifecycleStatus: "stalled",
      openQuestions: [{ opportunityId: OPPORTUNITY_ID, question: 2, label: "Rate" }],
    }));
    expect(detail.status).toBe("completed");
    expect(detail.park).toMatchObject({ waitingOn: "you", kind: "post_stall", question: 2, questionLabel: "Rate" });
    expect(detail.lifecycle.connectionState).toBe("parked_awaiting_your_answer");
  });

  test("projects the persisted askUser and checklist on the turns that carry them", async () => {
    const detail = await getDetail(incidentDeps());

    const [plain, ask] = detail.turns;
    expect("askUser" in plain).toBe(false);
    expect("checklist" in plain).toBe(false);
    // The persisted shape, minus nothing: dimension, answerhood, question and
    // the checklist's `settles` are all visible to the external seat.
    expect(ask.askUser).toEqual(ASK_USER_PAYLOAD);
    expect(ask.checklist).toEqual(CHECKLIST);
    expect(ask.checklist[0].settles).toBe("a concrete week both sides can commit to");
  });
});

describe("get_negotiation — a park on the counterparty", () => {
  test("is named, and its content is not", async () => {
    const detail = await getDetail(incidentDeps({
      recipientUserId: COUNTERPARTY,
      openQuestions: [{ opportunityId: OPPORTUNITY_ID, question: 1, label: "Their private ask" }],
    }));

    expect(detail.park).toMatchObject({ waitingOn: "counterparty", kind: "mid_flight" });
    expect(detail.park.question).toBeUndefined();
    expect(detail.park.questionLabel).toBeUndefined();
    expect(detail.park.label).toContain("counterparty");
    expect(detail.lifecycle.connectionState).toBe("parked_awaiting_counterparty");
  });
});

describe("get_negotiation — no park", () => {
  test("renders exactly as it did before the park projection existed", async () => {
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
      id: "msg-1",
      senderId: `agent:${VIEWER}`,
      role: "agent" as const,
      taskId: TASK_ID,
      parts: [{ kind: "data", data: { action: "outreach", assessment: { reasoning: "why", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "hello" } }],
      createdAt: new Date("2026-08-20T19:00:00Z"),
    };
    const detail = await getDetail(incidentDeps({ task, messages: [message], openQuestions: [] }));

    // The fixture pin: field-for-field what this tool returned before the
    // park projection. `park` is absent, turns carry no askUser/checklist
    // keys, and the lifecycle narrates from opportunity status alone.
    expect(detail).toEqual({
      id: TASK_ID,
      conversationId: "conv-1",
      conversationType: "agent_negotiation",
      status: "active",
      role: "source",
      seat: "initiator",
      allowedActions: ["outreach", "counter", "question", "withdraw"],
      counterpartyId: COUNTERPARTY,
      turnCount: 1,
      isUsersTurn: false,
      isContinuation: false,
      priorTurnCount: 0,
      turnsAdded: 1,
      turns: [{
        turnNumber: 1,
        speaker: "source",
        senderId: `agent:${VIEWER}`,
        action: "outreach",
        actionActor: "agent",
        reasoning: "why",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        message: "hello",
        createdAt: message.createdAt.toISOString(),
      }],
      outcome: null,
      lifecycle: {
        agentNegotiation: "in_progress",
        opportunityStatus: "negotiating",
        connectionState: "agents_negotiating",
        ownerAction: "not_recorded",
        directConversationEvidence: "not_provided",
        lifecycleLabel: "The agents are still negotiating; no owner decision is recorded.",
      },
      context: null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    });
    expect("park" in detail).toBe(false);
  });
});
