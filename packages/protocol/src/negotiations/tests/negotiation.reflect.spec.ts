import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { IndexNegotiator } from "../negotiation.agent.js";
import { NegotiationReflector, MAX_DISTILLED_MEMORIES } from "../negotiation.reflect.js";
import type { NegotiationReflectJobData, ReflectionResult } from "../negotiation.reflect.js";

/**
 * IND-406 — reflection jobs (memory write path).
 *
 * Pins:
 * - the finalize node enqueues a reflect job with full payload when
 *   `reflectEnqueue` is injected and turns were exchanged,
 * - a rejecting `reflectEnqueue` never affects the negotiation outcome
 *   (fire-and-forget), and an absent one leaves behavior unchanged,
 * - `NegotiationReflector` validates LLM output against the schema (throws on
 *   invalid, caps at MAX_DISTILLED_MEMORIES) and projects transcripts into
 *   the prompt from the client's perspective.
 */

// ─── Reflector (distiller) ───────────────────────────────────────────────────

class StubReflector extends NegotiationReflector {
  public capturedMessages: Array<{ role: string; content: string }> = [];
  constructor(private result: unknown) {
    super();
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.capturedMessages = chatMessages;
    return this.result;
  }
}

const validResult: ReflectionResult = {
  memories: [
    {
      kind: "playbook",
      content: "Opening with the shared-conference angle got immediate engagement.",
      confidence: 0.6,
      aboutCounterparty: false,
      turnIndexes: [0, 1],
    },
    {
      kind: "counterparty_dossier",
      content: "Bob prefers async collaboration and is timezone-constrained to CET.",
      confidence: 0.8,
      aboutCounterparty: true,
      turnIndexes: [2],
    },
  ],
};

const reflectionInput = {
  clientUser: { id: "u-alice", name: "Alice", bio: "founder" },
  counterpartyUser: { id: "u-bob", name: "Bob" },
  seat: "initiator" as const,
  outcome: { hasOpportunity: true, reasoning: "aligned on scope", turnCount: 3 },
  transcript: [
    { index: 0, speaker: "client" as const, action: "outreach", message: "hello from the conference" },
    { index: 1, speaker: "counterparty" as const, action: "question", message: "which track?" },
    { index: 2, speaker: "counterparty" as const, action: "accept", reasoning: "async works, CET" },
  ],
};

describe("NegotiationReflector", () => {
  it("parses valid distillation output", async () => {
    const reflector = new StubReflector(validResult);
    const memories = await reflector.reflectNegotiation(reflectionInput);

    expect(memories.length).toBe(2);
    expect(memories[0].kind).toBe("playbook");
    expect(memories[1].aboutCounterparty).toBe(true);
    expect(memories[1].turnIndexes).toEqual([2]);
  });

  it("projects the transcript into the prompt from the client's perspective", async () => {
    const reflector = new StubReflector(validResult);
    await reflector.reflectNegotiation(reflectionInput);

    const userMessage = reflector.capturedMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("Alice's negotiator → outreach");
    expect(userMessage).toContain("Bob's negotiator → question");
    expect(userMessage).toContain("SEAT: initiator");
    expect(userMessage).toContain("accepted after 3 turn(s)");

    const systemMessage = reflector.capturedMessages.find((m) => m.role === "system")?.content ?? "";
    expect(systemMessage).toContain("Alice");
    expect(systemMessage).toContain(`AT MOST ${MAX_DISTILLED_MEMORIES}`);
  });

  it("throws on schema-invalid output (confidence out of range)", async () => {
    const reflector = new StubReflector({
      memories: [{ kind: "playbook", content: "x", confidence: 3, aboutCounterparty: false, turnIndexes: [] }],
    });
    await expect(reflector.reflectNegotiation(reflectionInput)).rejects.toThrow(/validation/i);
  });

  it("throws when more than the max entries are returned", async () => {
    const entry = validResult.memories[0];
    const reflector = new StubReflector({ memories: [entry, entry, entry, entry] });
    await expect(reflector.reflectNegotiation(reflectionInput)).rejects.toThrow();
  });

  it("accepts an empty memories array (nothing durable learned)", async () => {
    const reflector = new StubReflector({ memories: [] });
    const memories = await reflector.reflectNegotiation(reflectionInput);
    expect(memories).toEqual([]);
  });

  it("reflectChat distills from the client-negotiator DM", async () => {
    const reflector = new StubReflector({
      memories: [{
        kind: "disclosure_rule",
        content: "Never share the client's day rate before a scope call.",
        confidence: 0.9,
        aboutCounterparty: false,
        turnIndexes: [0],
      }],
    });
    const memories = await reflector.reflectChat({
      clientUser: { id: "u-alice", name: "Alice" },
      messages: [
        { role: "user", content: "never share my day rate before a scope call" },
        { role: "assistant", content: "understood" },
      ],
    });

    expect(memories.length).toBe(1);
    expect(memories[0].kind).toBe("disclosure_rule");
    const userMessage = reflector.capturedMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("[0] Alice: never share my day rate");
    const systemMessage = reflector.capturedMessages.find((m) => m.role === "system")?.content ?? "";
    expect(systemMessage).toContain("counterparty_dossier");
  });
});

// ─── Graph finalize → reflectEnqueue ─────────────────────────────────────────

function mkStubs() {
  const database = {
    createConversation: async () => ({ id: "conv-1" }),
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string, metadata: Record<string, unknown>) =>
      ({ id: "task-1", conversationId, state: "submitted", metadata }),
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { senderId: string; parts: unknown[] }) => ({
      id: "msg-1", senderId: p.senderId, parts: p.parts, createdAt: new Date(),
    }),
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
    getMessagesForConversation: async () => [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher };
}

const graphInput = {
  sourceUser: { id: "u-src", intents: [], profile: { name: "Alice", bio: "founder" } },
  candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
  indexContext: { networkId: "net-1", prompt: "" },
  seedAssessment: { reasoning: "x", valencyRole: "peer" },
  opportunityId: "opp-1",
  maxTurns: 2,
};

describe("negotiation graph — finalize reflect enqueue (IND-406)", () => {
  let origInvoke: typeof IndexNegotiator.prototype.invoke;

  beforeAll(() => {
    origInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function () {
      return {
        action: "accept" as const,
        assessment: {
          reasoning: "stub",
          suggestedRoles: { ownUser: "agent" as const, otherUser: "patient" as const },
        },
        message: "deal",
      };
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origInvoke;
  });

  it("enqueues a reflect job with the full payload after finalize", async () => {
    const stubs = mkStubs();
    const jobs: NegotiationReflectJobData[] = [];
    const graph = new NegotiationGraphFactory(
      stubs.database,
      stubs.dispatcher,
      undefined,
      undefined,
      async (job) => { jobs.push(job); },
    ).createGraph();

    const result = await graph.invoke(graphInput);

    expect(result.outcome?.hasOpportunity).toBe(true);
    expect(jobs.length).toBe(1);
    expect(jobs[0]).toMatchObject({
      negotiationId: "task-1",
      conversationId: "conv-1",
      opportunityId: "opp-1",
      sourceUser: { id: "u-src", name: "Alice", bio: "founder" },
      candidateUser: { id: "u-cand", name: "Bob" },
      initiatorUserId: "u-src",
      outcome: { hasOpportunity: true, turnCount: 2 },
    });
  });

  it("a rejecting reflectEnqueue never affects the negotiation outcome", async () => {
    const stubs = mkStubs();
    const graph = new NegotiationGraphFactory(
      stubs.database,
      stubs.dispatcher,
      undefined,
      undefined,
      async () => { throw new Error("redis down"); },
    ).createGraph();

    const result = await graph.invoke(graphInput);

    expect(result.error).toBeFalsy();
    expect(result.outcome?.hasOpportunity).toBe(true);
    expect(result.outcome?.turnCount).toBe(2);
  });

  it("graph without reflectEnqueue behaves as today (optional dep)", async () => {
    const stubs = mkStubs();
    const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();

    const result = await graph.invoke(graphInput);

    expect(result.error).toBeFalsy();
    expect(result.outcome?.hasOpportunity).toBe(true);
  });
});
