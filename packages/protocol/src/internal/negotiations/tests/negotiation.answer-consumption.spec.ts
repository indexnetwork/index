import { describe, it, expect } from "bun:test";

import { classifyParkedNegotiation, consumeQuestionBlockAnswers, negotiationParkAnswerId, resumeParkedNegotiation, routeAnswerRef, type InflightAnswerSettlementInput, type InflightAnswerSettlementResult, type NegotiationAnswerConsumptionPorts } from "../negotiation.answer-consumption.js";
import { NEGOTIATION_PARK_REASONING } from "../negotiation.stall-gap.js";
import { negotiationQuestionSettlementId } from "../negotiation.question-safety.js";
import type { QuestionBlock } from "../../../protocol/question-block.schema.js";

/**
 * Answer consumption — the resume seam (conversational-questions plan).
 *
 * Pins:
 * - routing is a lookup: any ref (primary or alsoUnblocks) resolves to its
 *   question's full resume set; an unknown ref resolves to nothing and is
 *   reported for a clarifying follow-up, never resumed speculatively,
 * - classification is exact re-resolution: an `input_required` task with a
 *   coherent ask-user binding is a mid-flight park; a completed task whose
 *   trailing turn is the authored gap is a post-stall park; everything else —
 *   active sessions, settled consults, terminal tasks, stale parks — no-ops,
 * - a park awaiting the counterparty's client never resumes on this user's
 *   answer (misroute guard, both park kinds),
 * - mid-flight resume order: settle first, enqueue after; a lost settlement
 *   enqueues nothing; an already-settled one re-enqueues (crash recovery)
 *   without settling twice,
 * - post-stall resume order: record the answer (deterministic id) before the
 *   retry enqueue, so the retry's prompt can see it,
 * - one answer resumes the primary and every alsoUnblocks ref exactly once,
 *   and a repeated delivery is a no-op because re-resolution finds no park,
 * - per-negotiation failures never block the rest of the reply.
 */

const OPP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPP_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPP_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const block: QuestionBlock = {
  version: 1,
  questions: [
    { prompt: "When could you start?", opportunityId: OPP_A, alsoUnblocks: [OPP_B] },
    { prompt: "What budget range works?", opportunityId: OPP_C },
  ],
};

type FakeTask = {
  id: string;
  conversationId: string;
  state: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeMessage = { id: string; senderId: string; role: "user" | "agent"; parts: unknown[]; createdAt: Date; taskId?: string | null };

function inflightTask(taskId: string, opportunityId: string, recipientUserId: string, overrides?: Record<string, unknown>): FakeTask {
  return {
    id: taskId,
    conversationId: "conv-1",
    state: "input_required",
    metadata: {
      type: "negotiation",
      opportunityId,
      turnContext: {
        askUserBinding: {
          version: 2,
          settlementId: negotiationQuestionSettlementId(taskId),
          recipientUserId,
          recipientIntentId: "intent-1",
          networkId: "network-1",
          opportunityId,
          ...overrides,
        },
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function completedTask(taskId: string, opportunityId: string): FakeTask {
  return {
    id: taskId,
    conversationId: "conv-1",
    state: "completed",
    metadata: { type: "negotiation", opportunityId },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function parkMessage(senderUserId: string, taskId?: string | null): FakeMessage {
  return {
    id: "msg-park",
    senderId: `agent:${senderUserId}`,
    role: "agent",
    parts: [{
      kind: "data",
      data: {
        action: "ask_user",
        assessment: { reasoning: NEGOTIATION_PARK_REASONING, suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
        message: null,
        askUser: { reason: "unresolved_owner_constraint", question: { title: "Timing", prompt: "When?", options: [], multiSelect: false } },
      },
    }],
    createdAt: new Date(),
    ...(taskId !== undefined ? { taskId } : {}),
  };
}

function turnMessage(senderUserId: string, action: string): FakeMessage {
  return {
    id: `msg-${action}`,
    senderId: `agent:${senderUserId}`,
    role: "agent",
    parts: [{ kind: "data", data: { action, assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "m" } }],
    createdAt: new Date(),
  };
}

function makePorts(opts?: {
  tasks?: Record<string, FakeTask | null>;
  messages?: Record<string, FakeMessage[]>;
  settleResult?: InflightAnswerSettlementResult;
  failFor?: string;
}) {
  const calls = {
    settles: [] as InflightAnswerSettlementInput[],
    inflightResumes: [] as Array<Record<string, string>>,
    recorded: [] as Array<{ opportunityId: string; answer: { questionId: string; selectedOptions: string[]; freeText?: string; answeredAt: string } }>,
    retries: [] as Array<{ opportunityId: string; userId: string; parkTaskId: string }>,
    order: [] as string[],
  };
  const ports: NegotiationAnswerConsumptionPorts = {
    database: {
      getNegotiationTaskForOpportunity: async (opportunityId: string) => {
        if (opts?.failFor === opportunityId) throw new Error("db down");
        return opts?.tasks?.[opportunityId] ?? null;
      },
      getNegotiationMessages: async (opportunityId: string) => opts?.messages?.[opportunityId] ?? [],
    },
    settleInflightAnswer: async (input) => {
      calls.settles.push(input);
      calls.order.push(`settle:${input.opportunityId}`);
      return opts?.settleResult ?? "settled";
    },
    enqueueInflightResume: async (input) => {
      calls.inflightResumes.push(input as unknown as Record<string, string>);
      calls.order.push(`resume:${input.opportunityId}`);
    },
    recordOpportunityAnswer: async (input) => {
      calls.recorded.push(input);
      calls.order.push(`record:${input.opportunityId}`);
    },
    enqueueStalledRetry: async (input) => {
      calls.retries.push(input);
      calls.order.push(`retry:${input.opportunityId}`);
    },
  };
  return { ports, calls };
}

describe("routeAnswerRef", () => {
  it("resolves a primary ref to its question's full resume set, primary first", () => {
    const route = routeAnswerRef(block, OPP_A);
    expect(route?.question.prompt).toBe("When could you start?");
    expect(route?.opportunityIds).toEqual([OPP_A, OPP_B]);
  });

  it("resolves an alsoUnblocks ref to the same set", () => {
    const route = routeAnswerRef(block, OPP_B);
    expect(route?.question.opportunityId).toBe(OPP_A);
    expect(route?.opportunityIds).toEqual([OPP_A, OPP_B]);
  });

  it("resolves an unknown ref to null, never to a guess", () => {
    expect(routeAnswerRef(block, OPP_D)).toBeNull();
  });
});

describe("classifyParkedNegotiation", () => {
  it("classifies an input_required task with a coherent binding as inflight", async () => {
    const { ports } = makePorts({ tasks: { [OPP_A]: inflightTask("task-1", OPP_A, "user-1") } });
    const c = await classifyParkedNegotiation(ports.database, { opportunityId: OPP_A, userId: "user-1" });
    expect(c).toEqual({
      kind: "inflight",
      taskId: "task-1",
      binding: {
        settlementId: negotiationQuestionSettlementId("task-1"),
        recipientUserId: "user-1",
        recipientIntentId: "intent-1",
        networkId: "network-1",
        opportunityId: OPP_A,
      },
    });
  });

  it("refuses an inflight park awaiting the counterparty's client", async () => {
    const { ports } = makePorts({ tasks: { [OPP_A]: inflightTask("task-1", OPP_A, "user-2") } });
    const c = await classifyParkedNegotiation(ports.database, { opportunityId: OPP_A, userId: "user-1" });
    expect(c.kind).toBe("wrong_recipient");
  });

  it("treats an incoherent binding (settlement mismatch) as not parked", async () => {
    const task = inflightTask("task-1", OPP_A, "user-1", { settlementId: negotiationQuestionSettlementId("task-other") });
    const { ports } = makePorts({ tasks: { [OPP_A]: task } });
    const c = await classifyParkedNegotiation(ports.database, { opportunityId: OPP_A, userId: "user-1" });
    expect(c.kind).toBe("not_parked");
  });

  it("classifies a completed task with a trailing authored gap as post_stall", async () => {
    const { ports } = makePorts({
      tasks: { [OPP_A]: completedTask("task-9", OPP_A) },
      messages: { [OPP_A]: [turnMessage("user-1", "outreach"), turnMessage("user-2", "counter"), parkMessage("user-1", "task-9")] },
    });
    const c = await classifyParkedNegotiation(ports.database, { opportunityId: OPP_A, userId: "user-1" });
    expect(c).toEqual({ kind: "post_stall", taskId: "task-9" });
  });

  it("refuses a post-stall park authored toward the other side", async () => {
    const { ports } = makePorts({
      tasks: { [OPP_A]: completedTask("task-9", OPP_A) },
      messages: { [OPP_A]: [parkMessage("user-2", "task-9")] },
    });
    const c = await classifyParkedNegotiation(ports.database, { opportunityId: OPP_A, userId: "user-1" });
    expect(c.kind).toBe("wrong_recipient");
  });

  it("treats a completed task whose trailing turn is not the gap as not parked", async () => {
    const { ports } = makePorts({
      tasks: { [OPP_A]: completedTask("task-9", OPP_A) },
      messages: { [OPP_A]: [parkMessage("user-1", "task-8"), turnMessage("user-2", "decline")] },
    });
    const c = await classifyParkedNegotiation(ports.database, { opportunityId: OPP_A, userId: "user-1" });
    expect(c.kind).toBe("not_parked");
  });

  it("treats a trailing park written by an older task as not parked", async () => {
    const { ports } = makePorts({
      tasks: { [OPP_A]: completedTask("task-9", OPP_A) },
      messages: { [OPP_A]: [parkMessage("user-1", "task-8")] },
    });
    const c = await classifyParkedNegotiation(ports.database, { opportunityId: OPP_A, userId: "user-1" });
    expect(c.kind).toBe("not_parked");
  });

  it("classifies a missing negotiation and an active session as no-op kinds", async () => {
    const working = { ...completedTask("task-9", OPP_A), state: "working" };
    const { ports } = makePorts({ tasks: { [OPP_A]: null, [OPP_B]: working } });
    expect((await classifyParkedNegotiation(ports.database, { opportunityId: OPP_A, userId: "user-1" })).kind).toBe("no_negotiation");
    expect((await classifyParkedNegotiation(ports.database, { opportunityId: OPP_B, userId: "user-1" })).kind).toBe("not_parked");
  });
});

describe("resumeParkedNegotiation", () => {
  it("resumes a mid-flight park: settle with the exact binding, then enqueue the settlement-keyed continuation", async () => {
    const { ports, calls } = makePorts({ tasks: { [OPP_A]: inflightTask("task-1", OPP_A, "user-1") } });
    const outcome = await resumeParkedNegotiation(ports, {
      opportunityId: OPP_A,
      userId: "user-1",
      answerText: "This quarter works.",
      answeredAt: "2026-08-18T12:00:00.000Z",
    });
    expect(outcome).toBe("resumed_inflight");
    expect(calls.settles).toEqual([{
      taskId: "task-1",
      settlementId: negotiationQuestionSettlementId("task-1"),
      opportunityId: OPP_A,
      recipientUserId: "user-1",
      recipientIntentId: "intent-1",
      networkId: "network-1",
      answer: { selectedOptions: [], freeText: "This quarter works.", answeredAt: "2026-08-18T12:00:00.000Z" },
    }]);
    expect(calls.inflightResumes).toEqual([{
      opportunityId: OPP_A,
      userId: "user-1",
      taskId: "task-1",
      settlementId: negotiationQuestionSettlementId("task-1"),
      recipientIntentId: "intent-1",
      networkId: "network-1",
    }]);
    expect(calls.order).toEqual([`settle:${OPP_A}`, `resume:${OPP_A}`]);
  });

  it("re-enqueues an already-settled consult without settling twice", async () => {
    const { ports, calls } = makePorts({
      tasks: { [OPP_A]: inflightTask("task-1", OPP_A, "user-1") },
      settleResult: "already_settled",
    });
    const outcome = await resumeParkedNegotiation(ports, { opportunityId: OPP_A, userId: "user-1", answerText: "yes" });
    expect(outcome).toBe("resumed_inflight");
    expect(calls.inflightResumes).toHaveLength(1);
  });

  it("enqueues nothing when the settlement is lost to the answer-window expiry", async () => {
    const { ports, calls } = makePorts({
      tasks: { [OPP_A]: inflightTask("task-1", OPP_A, "user-1") },
      settleResult: "lost",
    });
    const outcome = await resumeParkedNegotiation(ports, { opportunityId: OPP_A, userId: "user-1", answerText: "yes" });
    expect(outcome).toBe("not_parked");
    expect(calls.inflightResumes).toHaveLength(0);
  });

  it("reports an unresumable park as recorded, and enqueues nothing — the proposal is the caller's, not a resume", async () => {
    const { ports, calls } = makePorts({
      tasks: { [OPP_A]: inflightTask("task-1", OPP_A, "user-1") },
      settleResult: "recorded_unresumable",
    });
    const outcome = await resumeParkedNegotiation(ports, { opportunityId: OPP_A, userId: "user-1", answerText: "yes" });
    expect(outcome).toBe("recorded_unresumable");
    expect(calls.settles).toHaveLength(1);
    expect(calls.inflightResumes).toHaveLength(0);
    expect(calls.retries).toHaveLength(0);
  });

  it("resumes a post-stall park: record the answer under its deterministic id, then enqueue the retry", async () => {
    const { ports, calls } = makePorts({
      tasks: { [OPP_A]: completedTask("task-9", OPP_A) },
      messages: { [OPP_A]: [parkMessage("user-1", "task-9")] },
    });
    const outcome = await resumeParkedNegotiation(ports, {
      opportunityId: OPP_A,
      userId: "user-1",
      answerText: "Budget is 10k.",
      answeredAt: "2026-08-18T12:00:00.000Z",
    });
    expect(outcome).toBe("resumed_retry");
    expect(calls.recorded).toEqual([{
      opportunityId: OPP_A,
      answer: {
        questionId: negotiationParkAnswerId("task-9"),
        selectedOptions: [],
        freeText: "Budget is 10k.",
        answeredAt: "2026-08-18T12:00:00.000Z",
      },
    }]);
    expect(calls.retries).toEqual([{ opportunityId: OPP_A, userId: "user-1", parkTaskId: "task-9" }]);
    expect(calls.order).toEqual([`record:${OPP_A}`, `retry:${OPP_A}`]);
  });

  it("no-ops a redelivery once the first resume's session is live", async () => {
    const { ports, calls } = makePorts({ tasks: { [OPP_A]: { ...completedTask("task-10", OPP_A), state: "working" } } });
    const outcome = await resumeParkedNegotiation(ports, { opportunityId: OPP_A, userId: "user-1", answerText: "again" });
    expect(outcome).toBe("not_parked");
    expect(calls.settles).toHaveLength(0);
    expect(calls.recorded).toHaveLength(0);
    expect(calls.retries).toHaveLength(0);
  });
});

describe("consumeQuestionBlockAnswers", () => {
  it("resumes the primary and every alsoUnblocks ref with the one answer, exactly once each", async () => {
    const { ports, calls } = makePorts({
      tasks: {
        [OPP_A]: inflightTask("task-1", OPP_A, "user-1"),
        [OPP_B]: completedTask("task-2", OPP_B),
      },
      messages: { [OPP_B]: [parkMessage("user-1", "task-2")] },
    });
    const result = await consumeQuestionBlockAnswers(ports, {
      block,
      userId: "user-1",
      answers: [{ ref: OPP_B, answerText: "This quarter." }],
    });
    expect(result.resumed).toEqual([
      { opportunityId: OPP_A, outcome: "resumed_inflight" },
      { opportunityId: OPP_B, outcome: "resumed_retry" },
    ]);
    expect(result.unmatched).toHaveLength(0);
    expect(result.needsClarification).toBe(false);
    expect(calls.settles).toHaveLength(1);
    expect(calls.retries).toHaveLength(1);
    expect(calls.settles[0]?.answer.freeText).toBe("This quarter.");
    expect(calls.recorded[0]?.answer.freeText).toBe("This quarter.");
  });

  it("reports an unmatched ref for clarification and resumes nothing for it", async () => {
    const { ports, calls } = makePorts({ tasks: { [OPP_A]: inflightTask("task-1", OPP_A, "user-1") } });
    const result = await consumeQuestionBlockAnswers(ports, {
      block,
      userId: "user-1",
      answers: [{ ref: OPP_D, answerText: "mystery" }],
    });
    expect(result.unmatched).toEqual([{ ref: OPP_D, answerText: "mystery" }]);
    expect(result.needsClarification).toBe(true);
    expect(result.resumed).toHaveLength(0);
    expect(calls.order).toHaveLength(0);
  });

  it("flags an empty routing (nothing matched) as needing clarification", async () => {
    const { ports } = makePorts();
    const result = await consumeQuestionBlockAnswers(ports, { block, userId: "user-1", answers: [] });
    expect(result.needsClarification).toBe(true);
    expect(result.resumed).toHaveLength(0);
  });

  it("takes the first of two answers routed to the same question and reports the duplicate", async () => {
    const { ports, calls } = makePorts({ tasks: { [OPP_A]: inflightTask("task-1", OPP_A, "user-1"), [OPP_B]: null } });
    const result = await consumeQuestionBlockAnswers(ports, {
      block,
      userId: "user-1",
      answers: [
        { ref: OPP_A, answerText: "first phrasing" },
        { ref: OPP_B, answerText: "second phrasing" },
      ],
    });
    expect(calls.settles).toHaveLength(1);
    expect(calls.settles[0]?.answer.freeText).toBe("first phrasing");
    expect(result.skipped).toContainEqual({ opportunityId: OPP_A, outcome: "duplicate_route" });
  });

  it("counts an unresumable answer in its own recorded array, never inside skipped", async () => {
    const { ports } = makePorts({
      tasks: { [OPP_C]: inflightTask("task-3", OPP_C, "user-1") },
      settleResult: "recorded_unresumable",
    });
    const result = await consumeQuestionBlockAnswers(ports, {
      block,
      userId: "user-1",
      answers: [{ ref: OPP_C, answerText: "Budget answer." }],
    });
    expect(result.recorded).toEqual([{ opportunityId: OPP_C, outcome: "recorded_unresumable" }]);
    expect(result.resumed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.needsClarification).toBe(false);
  });

  it("keeps consuming the rest of the reply when one negotiation fails", async () => {
    const { ports, calls } = makePorts({
      tasks: { [OPP_C]: inflightTask("task-3", OPP_C, "user-1") },
      failFor: OPP_A,
    });
    const result = await consumeQuestionBlockAnswers(ports, {
      block,
      userId: "user-1",
      answers: [
        { ref: OPP_A, answerText: "timing answer" },
        { ref: OPP_C, answerText: "budget answer" },
      ],
    });
    expect(result.skipped).toContainEqual({ opportunityId: OPP_A, outcome: "failed" });
    expect(result.resumed).toEqual([{ opportunityId: OPP_C, outcome: "resumed_inflight" }]);
    expect(calls.settles[0]?.answer.freeText).toBe("budget answer");
  });
});
