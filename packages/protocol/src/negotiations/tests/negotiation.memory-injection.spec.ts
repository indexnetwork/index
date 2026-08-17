import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import type { NegotiatorMemoryEntry, NegotiatorMemoryQuery } from "../negotiation.memory.js";
import type { NegotiationTurn } from "../negotiation.state.js";

/**
 * IND-407 (P5.3) — graph-level memory injection wiring.
 *
 * Pins:
 * - each side's turn receives its OWN memory (never the counterparty's),
 * - retrieval is cached per side (one call per side per session),
 * - a rejecting retrieval never affects the negotiation,
 * - a graph without `memoryRetrieve` behaves exactly as today,
 * - leak-guard: memory text never lands in counterparty-visible persisted
 *   payloads (turn messages, outcome artifact) — grep-style assertion over
 *   everything the fake database captured.
 */

const SENTINEL_SOURCE = "MEMSENTINEL-SOURCE-9f1";
const SENTINEL_CANDIDATE = "MEMSENTINEL-CAND-3c7";

const memoryFor = (userId: string): NegotiatorMemoryEntry[] => [{
  kind: "disclosure_rule",
  content: userId === "u-src" ? SENTINEL_SOURCE : SENTINEL_CANDIDATE,
  confidence: 0.9,
}];

function mkStubs() {
  const persisted: unknown[] = [];
  let msgSeq = 0;
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    getMessagesForConversation: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    createTask: async (conversationId: string, metadata: Record<string, unknown>) => {
      persisted.push({ op: "createTask", conversationId, metadata });
      return { id: "task-1", conversationId, state: "submitted" };
    },
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { senderId: string; parts: unknown[] }) => {
      persisted.push({ op: "createMessage", ...p });
      return { id: `msg-${++msgSeq}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async () => {},
    createArtifact: async (a: unknown) => { persisted.push({ op: "createArtifact", a }); },
    setTaskTurnContext: async (taskId: string, ctx: unknown) => { persisted.push({ op: "setTaskTurnContext", taskId, ctx }); },
    setTaskScreenDecision: async (taskId: string, d: unknown) => { persisted.push({ op: "setTaskScreenDecision", taskId, d }); },
    getOpportunityUserAnswers: async () => [],
    getUserContext: async () => null,
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, persisted };
}

const invokeInput = (extra?: Record<string, unknown>) => ({
  sourceUser: { id: "u-src", intents: [], profile: { name: "Alice" } },
  candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
  indexContext: { networkId: "net-1", prompt: "" },
  seedAssessment: { reasoning: "seed reasoning", valencyRole: "peer" },
  opportunityId: "3f5f0000-0000-4000-8000-000000000407",
  maxTurns: 2,
  ...extra,
});

describe("negotiation graph — memory injection (IND-407)", () => {
  let origInvoke: typeof IndexNegotiator.prototype.invoke;
  let capturedInputs: NegotiationAgentInput[] = [];

  beforeAll(() => {
    origInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput): Promise<NegotiationTurn> {
      capturedInputs.push(input);
      // Turn 0 (source): propose; turn 1 (candidate): accept.
      const action = input.history.length === 0 ? ("propose" as const) : ("accept" as const);
      return {
        action,
        assessment: { reasoning: "stub reasoning", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
        message: "public turn message",
      };
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origInvoke;
  });

  it("gives each side its own memory, caches per side, and never leaks memory into persisted payloads", async () => {
    capturedInputs = [];
    const stubs = mkStubs();
    const retrieveCalls: NegotiatorMemoryQuery[] = [];
    const memoryRetrieve = async (q: NegotiatorMemoryQuery) => {
      retrieveCalls.push(q);
      return memoryFor(q.userId);
    };

    const graph = new NegotiationGraphFactory(
      stubs.database, stubs.dispatcher, undefined, undefined, undefined, memoryRetrieve,
    ).createGraph();
    const result = await graph.invoke(invokeInput());

    expect(result.outcome?.hasOpportunity).toBe(true);

    // Both sides spoke; each got its OWN memory, never the counterparty's.
    expect(capturedInputs.length).toBe(2);
    const sourceTurn = capturedInputs[0];
    const candidateTurn = capturedInputs[1];
    expect(sourceTurn.ownUser.id).toBe("u-src");
    expect(sourceTurn.memory?.[0]?.content).toBe(SENTINEL_SOURCE);
    expect(candidateTurn.ownUser.id).toBe("u-cand");
    expect(candidateTurn.memory?.[0]?.content).toBe(SENTINEL_CANDIDATE);

    // One retrieval per side (cached in state across turns).
    expect(retrieveCalls.length).toBe(2);
    expect(new Set(retrieveCalls.map((c) => c.userId))).toEqual(new Set(["u-src", "u-cand"]));
    // The counterparty is passed as the dossier subject, never as the memory owner.
    expect(retrieveCalls.find((c) => c.userId === "u-src")?.counterpartyUserId).toBe("u-cand");
    expect(retrieveCalls.find((c) => c.userId === "u-cand")?.counterpartyUserId).toBe("u-src");

    // Leak guard: nothing persisted (turn messages, task metadata, outcome
    // artifact, turn context) contains the memory text.
    const persistedBlob = JSON.stringify(stubs.persisted);
    expect(persistedBlob).not.toContain(SENTINEL_SOURCE);
    expect(persistedBlob).not.toContain(SENTINEL_CANDIDATE);
    // Sanity: the public turn content IS persisted (the blob is non-trivial).
    expect(persistedBlob).toContain("public turn message");
  });

  it("injects the acting user's memory into externally-dispatched turn payloads", async () => {
    capturedInputs = [];
    const stubs = mkStubs();
    const capturedPayloads: Array<{ ownUser: { id: string }; negotiatorMemory?: NegotiatorMemoryEntry[] }> = [];
    const dispatcher = {
      hasExternalAgent: async () => false,
      dispatch: async (_userId: string, _scope: unknown, payload: (typeof capturedPayloads)[number]) => {
        capturedPayloads.push(payload);
        return {
          handled: true,
          turn: {
            action: payload.ownUser.id === "u-src" ? "propose" : "accept",
            assessment: { reasoning: "ext", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
            message: "ext message",
          },
        };
      },
    } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

    const graph = new NegotiationGraphFactory(
      stubs.database, dispatcher, undefined, undefined, undefined,
      async (q: NegotiatorMemoryQuery) => memoryFor(q.userId),
    ).createGraph();
    await graph.invoke(invokeInput());

    expect(capturedPayloads.length).toBe(2);
    expect(capturedPayloads[0].ownUser.id).toBe("u-src");
    expect(capturedPayloads[0].negotiatorMemory?.[0]?.content).toBe(SENTINEL_SOURCE);
    expect(capturedPayloads[1].ownUser.id).toBe("u-cand");
    expect(capturedPayloads[1].negotiatorMemory?.[0]?.content).toBe(SENTINEL_CANDIDATE);
  });

  it("proceeds without memory when retrieval rejects", async () => {
    capturedInputs = [];
    const stubs = mkStubs();
    const graph = new NegotiationGraphFactory(
      stubs.database, stubs.dispatcher, undefined, undefined, undefined,
      async () => { throw new Error("memory store down"); },
    ).createGraph();
    const result = await graph.invoke(invokeInput());

    expect(result.outcome?.hasOpportunity).toBe(true);
    expect(capturedInputs.length).toBe(2);
    expect(capturedInputs[0].memory).toBeUndefined();
    expect(capturedInputs[1].memory).toBeUndefined();
  });

  it("behaves exactly as today when no memoryRetrieve is injected", async () => {
    capturedInputs = [];
    const stubs = mkStubs();
    const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
    const result = await graph.invoke(invokeInput());

    expect(result.outcome?.hasOpportunity).toBe(true);
    expect(capturedInputs.length).toBe(2);
    expect(capturedInputs[0].memory).toBeUndefined();
    expect(capturedInputs[1].memory).toBeUndefined();
  });
});
