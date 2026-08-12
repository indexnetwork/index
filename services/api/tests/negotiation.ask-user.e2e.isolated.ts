import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { NegotiationGraphFactory, negotiateCandidates } from "@indexnetwork/protocol";
import type { NegotiationGraphDatabase, NegotiationTurn, QuestionerEnqueuePayload } from "@indexnetwork/protocol";
import { conversationDatabaseAdapter } from "../src/adapters/database.adapter";
import { resumeInflightNegotiationFactory } from "../src/events/handlers/question.answer.negotiation-inflight";

// IND-401 — ask_user pause/resume loop against the real database (no LLM: all
// turns come from a scripted dispatcher; the questioner + timers are
// collectors). Requires DATABASE_URL in .env.test.
//
// Covers the e2e ACs:
// - ask_user → task row input_required + question enqueued + timer armed,
// - answer → timer cancelled, paused task terminally transitioned,
//   continuation resumed with the ASKER holding the floor,
// - graph invoke resolves at the pause (chat-trigger deferral: the stream
//   never blocks on a question — the resume is always an async continuation).
//
// Run with: cd services/api && bun test tests/negotiation.ask-user.e2e.spec.ts

const ENV_KEYS = ["NEGOTIATION_PROTOCOL_VERSION", "NEGOTIATION_ASK_USER_ENABLED", "NEGOTIATION_CONSULTATION_POLICY_MODE", "NEGOTIATION_SCREEN_MODE"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
  process.env.NEGOTIATION_ASK_USER_ENABLED = "true";
  delete process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;
  delete process.env.NEGOTIATION_SCREEN_MODE;
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function turn(action: NegotiationTurn["action"], extra?: Partial<NegotiationTurn>): NegotiationTurn {
  return {
    action,
    assessment: { reasoning: `${action} reasoning`, suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: null,
    ...extra,
  };
}

/** Dispatcher that answers every turn from a per-user script. */
function scriptedDispatcher(scripts: Record<string, NegotiationTurn[]>) {
  const seen: Array<{ userId: string; allowedActions: string[] }> = [];
  return {
    seen,
    hasExternalAgent: async () => false,
    dispatch: async (userId: string, _scope: unknown, payload: { allowedActions: string[] }) => {
      seen.push({ userId, allowedActions: payload.allowedActions });
      const next = scripts[userId]?.shift();
      if (!next) throw new Error(`no scripted turn for ${userId}`);
      return { handled: true as const, turn: next };
    },
  };
}

function mkUser(id: string, name: string) {
  return {
    id,
    intents: [{ id: `i-${id}`, title: "collaboration", description: "seeking collaborators", confidence: 0.9 }],
    profile: { name, bio: `${name} bio`, skills: ["engineering"] },
  };
}

describe("ask_user pause/resume E2E (IND-401)", () => {
  it("pauses on ask_user, resumes on answer with the asker holding the floor", async () => {
    const runId = Date.now();
    const sourceId = `e2e-au-src-${runId}`;
    const candidateId = `e2e-au-cand-${runId}`;
    const opportunityId = randomUUID();

    const timerArms: Array<{ negotiationId: string; payload: Record<string, unknown>; delayMs: number }> = [];
    const timerCancels: string[] = [];
    const timeoutQueue = {
      enqueueTimeout: async () => "job",
      cancelTimeout: async () => {},
      enqueueAskUserExpiry: async (negotiationId: string, payload: Record<string, unknown>, delayMs: number) => {
        timerArms.push({ negotiationId, payload, delayMs });
        return "askuser-job";
      },
      cancelAskUserExpiry: async (negotiationId: string) => {
        timerCancels.push(negotiationId);
      },
    };
    const questions: QuestionerEnqueuePayload[] = [];

    // ── Session 1: source opens, candidate pauses to consult its client ──
    const dispatcher1 = scriptedDispatcher({
      [sourceId]: [turn("outreach")],
      [candidateId]: [turn("ask_user", {
        askUser: { reason: "consequential_disclosure_permission" },
      })],
    });
    const graph1 = new NegotiationGraphFactory(
      conversationDatabaseAdapter as unknown as NegotiationGraphDatabase,
      dispatcher1 as never,
      timeoutQueue as never,
      async (input) => { questions.push(input); },
    ).createGraph();

    const invokeInput = {
      sourceUser: mkUser(sourceId, "Alice"),
      candidateUser: mkUser(candidateId, "Bob"),
      indexContext: { networkId: `e2e-net-${runId}`, prompt: "collaboration network" },
      seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
      opportunityId,
      sourceIntentId: `i-${sourceId}`,
      candidateIntentId: `i-${candidateId}`,
      maxTurns: 6,
      initiatorUserId: sourceId,
    };

    // The invoke resolves AT the pause — this is the chat-trigger deferral
    // guarantee: no in-stream question, the resume is an async continuation.
    const result1 = await graph1.invoke(invokeInput);
    expect(result1.outcome).toBeNull();

    // AC 1: task row is input_required; question + timer armed.
    const paused = await conversationDatabaseAdapter.getNegotiationTaskForOpportunity(opportunityId);
    expect(paused).not.toBeNull();
    expect(paused!.state).toBe("input_required");
    expect(timerArms).toHaveLength(1);
    expect(timerArms[0].negotiationId).toBe(paused!.id);
    expect(timerArms[0].payload.userId).toBe(candidateId);
    expect(questions).toHaveLength(1);
    expect(questions[0].mode).toBe("negotiation_inflight");
    expect(questions[0].userId).toBe(candidateId);
    expect(questions[0].sourceId).toBe(opportunityId);
    // The dispatcher was offered ask_user on the candidate turn (v2 + flag).
    expect(dispatcher1.seen[1].allowedActions).toContain("ask_user");

    // ── Answer arrives: resume path ──
    const resumes: Array<{ opportunityId: string; userId: string }> = [];
    const resume = resumeInflightNegotiationFactory({
      // Opportunity row does not exist in this harness — the store safely
      // no-ops on a missing row; answer-visibility is covered by the
      // negotiation-mode userAnswers unit path.
      storeNegotiationContext: async () => {},
      getNegotiationTaskForOpportunity: (oid) => conversationDatabaseAdapter.getNegotiationTaskForOpportunity(oid),
      cancelAskUserExpiry: (nid) => timeoutQueue.cancelAskUserExpiry(nid),
      closeTask: async (taskId, reason) => {
        await conversationDatabaseAdapter.updateTaskState(taskId, "canceled", { reason });
      },
      enqueueResume: async (oid, uid) => { resumes.push({ opportunityId: oid, userId: uid }); },
    });
    await resume({
      userId: candidateId,
      opportunityId,
      questionId: randomUUID(),
      selectedOptions: ["Yes, share it"],
      freeText: "mornings only",
    });

    // AC 2: timer cancelled, paused task terminally transitioned, resume enqueued.
    expect(timerCancels).toEqual([paused!.id]);
    const closed = await conversationDatabaseAdapter.getTask(paused!.id);
    expect(closed!.state).toBe("canceled");
    expect(resumes).toEqual([{ opportunityId, userId: candidateId }]);

    // ── Session 2 (the continuation the resume job runs): the ASKER speaks ──
    const dispatcher2 = scriptedDispatcher({
      [candidateId]: [turn("decline")],
    });
    const graph2 = new NegotiationGraphFactory(
      conversationDatabaseAdapter as unknown as NegotiationGraphDatabase,
      dispatcher2 as never,
      timeoutQueue as never,
      async (input) => { questions.push(input); },
    ).createGraph();
    const result2 = await graph2.invoke(invokeInput);

    // Resume floor: candidate (the asker) spoke, not the source.
    expect(dispatcher2.seen[0].userId).toBe(candidateId);
    // Rationing: the candidate's consultation is spent — not offered again.
    expect(dispatcher2.seen[0].allowedActions).not.toContain("ask_user");
    expect(result2.outcome).not.toBeNull();
    expect(result2.outcome!.hasOpportunity).toBe(false);
    expect((result2 as { isContinuation?: boolean }).isContinuation).toBe(true);

    const final = await conversationDatabaseAdapter.getNegotiationTaskForOpportunity(opportunityId);
    expect(final!.state).toBe("completed");
  }, 30_000);

  it("lock gate: a paused negotiation blocks a re-trigger on the same opportunity", async () => {
    const runId = Date.now() + 1;
    const sourceId = `e2e-au2-src-${runId}`;
    const candidateId = `e2e-au2-cand-${runId}`;
    const opportunityId = randomUUID();

    const timeoutQueue = {
      enqueueTimeout: async () => "job",
      cancelTimeout: async () => {},
      enqueueAskUserExpiry: async () => "askuser-job",
      cancelAskUserExpiry: async () => {},
    };
    const dispatcher = scriptedDispatcher({
      [sourceId]: [turn("outreach")],
      [candidateId]: [turn("ask_user", { askUser: { reason: "consequential_disclosure_permission" } })],
    });
    const graph = new NegotiationGraphFactory(
      conversationDatabaseAdapter as unknown as NegotiationGraphDatabase,
      dispatcher as never,
      timeoutQueue as never,
      async () => {},
    ).createGraph();

    const invokeInput = {
      sourceUser: mkUser(sourceId, "Ann"),
      candidateUser: mkUser(candidateId, "Ben"),
      indexContext: { networkId: `e2e-net2-${runId}`, prompt: "network" },
      seedAssessment: { reasoning: "fit", valencyRole: "peer" },
      opportunityId,
      sourceIntentId: `i-${sourceId}`,
      candidateIntentId: `i-${candidateId}`,
      maxTurns: 6,
      initiatorUserId: sourceId,
    };
    await graph.invoke(invokeInput);
    const paused = await conversationDatabaseAdapter.getNegotiationTaskForOpportunity(opportunityId);
    expect(paused!.state).toBe("input_required");

    // Re-trigger on the same opportunity while paused → busy, no new turn.
    const retrigger = await graph.invoke(invokeInput);
    expect((retrigger as { error?: string }).error).toBe("busy");

    // negotiateCandidates (the chat/ambient fan-out wrapper) also resolves
    // without blocking and yields no acceptance against the paused state.
    const results = await negotiateCandidates(
      graph as never,
      mkUser(sourceId, "Ann"),
      [{
        userId: candidateId,
        reasoning: "fit",
        valencyRole: "peer",
        opportunityId,
        candidateUser: mkUser(candidateId, "Ben"),
      }],
      { networkId: `e2e-net2-${runId}`, prompt: "network" },
      { maxTurns: 6, trigger: "orchestrator", initiatorUserId: sourceId },
    );
    expect(results).toEqual([]);

    // Cleanup so later dev runs don't inherit a 24h-locked task.
    await conversationDatabaseAdapter.updateTaskState(paused!.id, "canceled", { reason: "e2e-cleanup" });
  }, 30_000);
});
