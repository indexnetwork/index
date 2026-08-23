import { describe, expect, test } from "bun:test";

import type { NegotiationTaskRow, NegotiationGraphDatabase } from "../../platform/database/negotiation.js";
import type { AgentDispatcher, AgentDispatchResult } from "../../internal/shared/interfaces/agent-dispatcher.interface.js";
import type { NegotiationAuthorInput } from "../../internal/negotiations/negotiation.author.js";
import { NegotiationAuthor } from "../../internal/negotiations/negotiation.author.js";
import { NegotiationAuthoredTurnSchema, NegotiationOpeningTurnSchema } from "../../internal/negotiations/negotiation.turn.js";
import type { NegotiationAuthoredTurn, NegotiationTurn } from "../../internal/negotiations/negotiation.turn.js";
import { Negotiations } from "../negotiations.js";

/**
 * NegotiationGraph end-to-end coverage (#1494), modeled on
 * `capabilities/tests/intents.spec.ts`: a fake host implementing the real
 * `NegotiationGraphDatabase`/`AgentDispatcher` ports, driving the real
 * `graph.invoke`. Unlike `intents.spec.ts` this is deliberately
 * provider-free — no API key, no network call, no `createModel`/
 * `createStructuredModel` construction anywhere in this file — which is what
 * lets this file run in the credential-free Hermes-security CI gate instead
 * of the excluded LIVE_MODEL_SPECS set. `ScriptedNegotiationAuthor` overrides
 * `NegotiationAuthor.invoke` itself, not just its `callModel` seam: `invoke`
 * constructs its model before ever calling `callModel`, and that
 * construction throws synchronously with no API key configured, so
 * overriding `callModel` alone still isn't provider-free. Every scripted
 * turn is still validated through the graph's own zod schemas
 * (`NegotiationAuthoredTurnSchema`/`NegotiationOpeningTurnSchema`).
 *
 * A `turn` node that produces a *continuing* verb loops the graph straight
 * back into itself — the graph keeps authoring/dispatching until someone
 * pauses, a system turn is applied, or a dispatch yields `waiting` (an
 * external agent will answer later, via a separate `{ negotiationId, turn }`
 * invoke). Every scenario below keeps the source seat's turns internally
 * authored (deterministic script) and has the candidate seat's dispatcher
 * always yield `waiting`, so the loop always stops after exactly one
 * authored turn and the test drives the rest explicitly — which is also
 * exactly the external-submission path `respond_to_negotiation` uses.
 */

/** Overrides only the live-model call; `invoke` itself is the real author. */
class ScriptedNegotiationAuthor extends NegotiationAuthor {
  private readonly script: NegotiationAuthoredTurn[];
  private cursor = 0;
  readonly calls: NegotiationAuthorInput[] = [];

  constructor(script: NegotiationAuthoredTurn[]) {
    super();
    this.script = script;
  }

  /**
   * Overrides `invoke` itself, not just `callModel` — `NegotiationAuthor.invoke`
   * constructs its model via `createModel`/`createStructuredModel` before ever
   * calling `callModel`, and that construction throws synchronously when no
   * API key is configured. Genuinely provider-free means never reaching that
   * construction at all, not just skipping the network call.
   */
  override async invoke(input: NegotiationAuthorInput): Promise<NegotiationAuthoredTurn> {
    this.calls.push(input);
    const next = this.script[this.cursor];
    if (!next) throw new Error(`ScriptedNegotiationAuthor: no scripted turn left (call ${this.cursor + 1})`);
    this.cursor += 1;
    return input.isOpening ? NegotiationOpeningTurnSchema.parse(next) : NegotiationAuthoredTurnSchema.parse(next);
  }
}

const NETWORK_ID = "network-1";
const SOURCE_USER_ID = "alice";
const CANDIDATE_USER_ID = "bob";
const INTENT_ID = "intent-alice-1";
const OPPORTUNITY_ID = "opportunity-1";

type FakeOpportunity = {
  id: string;
  status: string;
  actors: Array<{ userId: string; intent: string; networkId: string }>;
};

/** In-memory host implementing the exact ports `NegotiationGraph` depends on. */
class FakeNegotiationHost {
  round = 0;
  readonly opportunity: FakeOpportunity = {
    id: OPPORTUNITY_ID,
    status: "negotiating",
    actors: [
      { userId: SOURCE_USER_ID, intent: INTENT_ID, networkId: NETWORK_ID },
      { userId: CANDIDATE_USER_ID, intent: "intent-bob-1", networkId: NETWORK_ID },
    ],
  };
  readonly tasks = new Map<string, NegotiationTaskRow>();
  readonly messages = new Map<string, Array<{ id: string; senderId: string; parts: unknown[]; createdAt: Date }>>();
  readonly opportunityStatusUpdates: Array<{ id: string; status: string }> = [];
  readonly reflectJobs: Array<{ intentId: string; round: number }> = [];
  private taskCounter = 0;
  private messageCounter = 0;

  readonly database: NegotiationGraphDatabase = {
    getOpportunity: async (id: string) => (id === this.opportunity.id ? (this.opportunity as never) : null),
    getIntent: async () => null,
    getUserContext: async () => null as never,
    createNegotiationConversation: async () => ({ id: "conversation-1" }),
    createNegotiationTask: async (input) => {
      const task: NegotiationTaskRow = {
        id: `task-${++this.taskCounter}`,
        conversationId: input.conversationId,
        state: "working",
        brief: input.brief,
        metadata: input.metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.tasks.set(task.id, task);
      this.messages.set(task.id, []);
      return task;
    },
    getNegotiationTaskForOpportunity: async (opportunityId) =>
      [...this.tasks.values()].find((t) => t.metadata.opportunityId === opportunityId && t.state !== "completed") ?? null,
    getNegotiationTask: async (taskId) => this.tasks.get(taskId) ?? null,
    getNegotiationTasksForUser: async (userId) =>
      [...this.tasks.values()].filter((t) => t.metadata.sourceUserId === userId || t.metadata.candidateUserId === userId),
    updateNegotiationTaskState: async (taskId, state, pause) => {
      const task = this.tasks.get(taskId);
      if (!task) throw new Error(`No such task ${taskId}`);
      const updated: NegotiationTaskRow = {
        ...task,
        state,
        metadata: { ...task.metadata, pause: pause ?? null },
        updatedAt: new Date(),
      };
      this.tasks.set(taskId, updated);
      return updated;
    },
    setNegotiationBrief: async (taskId, brief) => {
      const task = this.tasks.get(taskId);
      if (!task) throw new Error(`No such task ${taskId}`);
      this.tasks.set(taskId, { ...task, brief, updatedAt: new Date() });
    },
    createNegotiationMessage: async (input) => {
      const list = this.messages.get(input.taskId) ?? [];
      if (list.length !== input.expectedMessageCount) return null; // fenced: a concurrent turn already landed
      const message = { id: `message-${++this.messageCounter}`, senderId: input.senderId, parts: input.parts, createdAt: new Date() };
      list.push(message);
      this.messages.set(input.taskId, list);
      return message;
    },
    // A snapshot, not the live array — a real DB read would never see a later write reflected back.
    getNegotiationMessages: async (taskId) => [...(this.messages.get(taskId) ?? [])],
    createNegotiationOutcomeArtifact: async () => {},
    getArtifactsForTask: async () => [],
    updateOpportunityStatus: async (id, status) => {
      this.opportunityStatusUpdates.push({ id, status });
      this.opportunity.status = status;
      return { id, status };
    },
    bumpIntentNegotiationRound: async () => (this.round += 1),
    countActiveNegotiationsForRound: async () =>
      [...this.tasks.values()].filter((t) => t.state === "working").length,
  };

  /** The candidate seat always yields `waiting` — its answer arrives later via an explicit `{ negotiationId, turn }` invoke. */
  waitingDispatcher(): AgentDispatcher {
    return {
      hasExternalAgent: async (userId) => userId === CANDIDATE_USER_ID,
      dispatch: async (): Promise<AgentDispatchResult> => ({ handled: false, reason: "waiting", resumeToken: "resume-token" }),
    };
  }

  /** Both seats yield `waiting` — every turn, including the opening one, is driven by an explicit test invoke. */
  bothWaitingDispatcher(): AgentDispatcher {
    return {
      hasExternalAgent: async () => true,
      dispatch: async (): Promise<AgentDispatchResult> => ({ handled: false, reason: "waiting", resumeToken: "resume-token" }),
    };
  }

  taskFor(negotiationId: string): NegotiationTaskRow {
    const task = this.tasks.get(negotiationId);
    if (!task) throw new Error(`No such task ${negotiationId}`);
    return task;
  }
}

describe("NegotiationGraph — open, turns, pause, resume, verdict", () => {
  test("open → turns → pause(needs_principal) → resume with brief → pause(ready_for_verdict) → verdict pending", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedNegotiationAuthor([
      { verb: "outreach", message: "Hi Bob, I'm reaching out on Alice's behalf about a co-founder match.", reasoning: "Opening the negotiation." },
      { verb: "pause", reason: "needs_principal", payload: { question: "What equity split are you open to?" } },
      { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "pending", reasoning: "Both sides converged on terms." } },
    ]);
    const graph = new Negotiations({
      database: host.database,
      dispatcher: host.waitingDispatcher(),
      author,
      reflectEnqueue: async (job) => { host.reflectJobs.push(job); },
    }).createGraph();

    // open: source's opening turn is authored live (via the scripted seam); the candidate
    // seat immediately yields `waiting`, so the graph returns after exactly one turn.
    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "Alice wants a technical co-founder.", round: 1 });
    expect(opened.status).toBe("active");
    expect(opened.turns).toHaveLength(1);
    expect(opened.turns[0]).toMatchObject({ verb: "outreach" });
    const negotiationId = opened.negotiationId;
    expect(host.opportunityStatusUpdates.at(0)).toEqual({ id: OPPORTUNITY_ID, status: "negotiating" });

    // turns: the candidate's answer arrives later, submitted externally — exactly the
    // respond_to_negotiation shape, going through the same apply guards as an authored turn.
    // A continuing verb loops the graph straight back into `turn`, so this one call also
    // carries the source's next move — here, its scripted pause(needs_principal).
    const paused = await graph.invoke({
      negotiationId,
      turn: { verb: "counter", message: "Bob's agent: interested, but what equity split is Alice thinking?", reasoning: "Countering with a real question." },
      byUserId: CANDIDATE_USER_ID,
    });
    expect(paused.status).toBe("paused");
    expect(paused.turns).toHaveLength(3);
    expect(paused.turns[1]).toMatchObject({ verb: "counter" });
    // The graph's own result never carries the payload — it's private to whoever paused,
    // and this exact call could (via self-play) be returning someone else's pause.
    expect(paused.pause).toEqual({ reason: "needs_principal" });
    expect(paused.turns[2]).toEqual({ verb: "pause", reason: "needs_principal" }); // redacted in the shared thread too
    // The real payload lives only on the task, scoped to whoever paused.
    expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({
      reason: "needs_principal",
      pausedBy: SOURCE_USER_ID,
      payload: { question: "What equity split are you open to?" },
    });
    expect(host.taskFor(negotiationId).state).toBe("paused");
    // Only one negotiation this round, and it just paused: the all-paused trigger fires.
    expect(host.reflectJobs).toEqual([{ intentId: INTENT_ID, round: 1 }]);

    // resume with brief: IS-A answered the equity question (read from the task directly,
    // the same privileged path IS-A will use — never from the graph's own public result)
    const resumed = await graph.invoke({ negotiationId, brief: "Alice wants a technical co-founder; she is open to 15-20% equity." });
    expect(resumed.status).toBe("paused");
    expect(resumed.pause).toEqual({ reason: "ready_for_verdict" });
    expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({
      reason: "ready_for_verdict",
      pausedBy: SOURCE_USER_ID,
      payload: { recommendation: "pending" },
    });
    expect(host.reflectJobs).toHaveLength(2);

    // verdict: IS-A promotes to pending — the only terminal write
    const resolved = await graph.invoke({ negotiationId, verdict: "pending", reasoning: "Both sides converged on terms." });
    expect(resolved.status).toBe("resolved");
    expect(resolved.verdict).toBe("pending");
    expect(resolved.reasoning).toBe("Both sides converged on terms.");
    expect(host.taskFor(negotiationId).state).toBe("completed");
    expect(host.opportunityStatusUpdates.at(-1)).toEqual({ id: OPPORTUNITY_ID, status: "pending" });

    // The author only ever authored the source seat's turns (three continuing/pausing moves);
    // the candidate's counter came through the external submission path instead.
    expect(author.calls).toHaveLength(3);
    expect(author.calls[0].isOpening).toBe(true);
    expect(author.calls.slice(1).every((call) => call.isOpening === false)).toBe(true);
  });

  test("verdict reject writes the opportunity as rejected, not pending", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedNegotiationAuthor([
      { verb: "outreach", message: "Opening.", reasoning: "r" },
      { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "reject", reasoning: "Not a fit." } },
    ]);
    const graph = new Negotiations({ database: host.database, dispatcher: host.waitingDispatcher(), author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("active");

    // The candidate's reply, submitted externally, hands the turn straight back to the
    // source's scripted pause(ready_for_verdict) within this same call.
    const paused = await graph.invoke({
      negotiationId: opened.negotiationId,
      turn: { verb: "counter", message: "Not interested.", reasoning: "r" },
      byUserId: CANDIDATE_USER_ID,
    });
    expect(paused.pause).toEqual({ reason: "ready_for_verdict" });
    expect(host.taskFor(opened.negotiationId).metadata.pause).toMatchObject({
      reason: "ready_for_verdict",
      payload: { recommendation: "reject" },
    });

    const resolved = await graph.invoke({ negotiationId: opened.negotiationId, verdict: "reject", reasoning: "Not a fit." });
    expect(resolved.status).toBe("resolved");
    expect(resolved.verdict).toBe("reject");
    expect(host.opportunityStatusUpdates.at(-1)).toEqual({ id: OPPORTUNITY_ID, status: "rejected" });
  });

  test("a timeout pauses counterparty_silent without authoring a turn", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedNegotiationAuthor([{ verb: "outreach", message: "Opening.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, dispatcher: host.waitingDispatcher(), author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("active");
    const timedOut = await graph.invoke({ negotiationId: opened.negotiationId, pause: "counterparty_silent" });

    expect(timedOut.status).toBe("paused");
    expect(timedOut.pause).toMatchObject({ reason: "counterparty_silent" });
    expect(author.calls).toHaveLength(1); // only the opening turn — the pause is a system-emitted turn, never authored
  });
});

describe("NegotiationGraph — external turn submission (respond_to_negotiation shape)", () => {
  test("an externally submitted turn goes through the same apply guards as an internally authored one", async () => {
    const host = new FakeNegotiationHost();
    // Both seats yield `waiting` here: every turn, including the opening one, is driven
    // by an explicit `{ negotiationId, turn }` invoke — no internal author involved at all,
    // isolating the apply guards from the authoring path this block is not testing.
    const graph = new Negotiations({ database: host.database, dispatcher: host.bothWaitingDispatcher() }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("active");
    expect(opened.turns).toHaveLength(0); // the opening seat also yielded `waiting` — nobody has spoken yet
    const negotiationId = opened.negotiationId;

    // The opening turn itself, submitted externally: must be outreach since no messages exist yet.
    const rejectedNonOutreachOpen = await graph.invoke({
      negotiationId,
      turn: { verb: "counter", message: "Not the opening move.", reasoning: "r" },
      byUserId: SOURCE_USER_ID,
    });
    expect(rejectedNonOutreachOpen.status).toBe("error");

    const opening = await graph.invoke({
      negotiationId,
      turn: { verb: "outreach", message: "Hi Bob.", reasoning: "r" },
      byUserId: SOURCE_USER_ID,
    });
    expect(opening.status).toBe("active");
    expect(opening.turns).toHaveLength(1);

    // Same guard the internal author is bound by: a turn attributed to the wrong seat is rejected.
    const wrongSeat = await graph.invoke({
      negotiationId,
      turn: { verb: "question", message: "Impersonating the candidate.", reasoning: "r" },
      byUserId: SOURCE_USER_ID, // it's actually the candidate's turn next
    });
    expect(wrongSeat.status).toBe("error");

    const applied = await graph.invoke({
      negotiationId,
      turn: { verb: "question", message: "What timeline is Alice working with?", reasoning: "Need to know before committing." },
      byUserId: CANDIDATE_USER_ID,
    });
    expect(applied.status).toBe("active");
    expect(applied.turns).toHaveLength(2);
    expect(applied.turns[1]).toMatchObject({ verb: "question" });

    // Same guard every turn is bound by: outreach is only legal as the opening turn.
    const invalidReopen = await graph.invoke({
      negotiationId,
      turn: { verb: "outreach", message: "Trying to reopen.", reasoning: "r" },
      byUserId: SOURCE_USER_ID,
    });
    expect(invalidReopen.status).toBe("error");

    // Same guard: an external agent can pause ready_for_verdict exactly like the internal author can.
    const pausedByExternal = await graph.invoke({
      negotiationId,
      turn: { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "reject", reasoning: "Counterparty backed out." } },
      byUserId: SOURCE_USER_ID,
    });
    expect(pausedByExternal.status).toBe("paused");
    expect(pausedByExternal.pause).toEqual({ reason: "ready_for_verdict" });
    expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({
      reason: "ready_for_verdict",
      pausedBy: SOURCE_USER_ID,
      payload: { recommendation: "reject" },
    });
    expect(host.taskFor(negotiationId).state).toBe("paused");
  });

  test("resuming an opportunity that already has a negotiation is idempotent, not a second open", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedNegotiationAuthor([{ verb: "outreach", message: "Opening.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, dispatcher: host.waitingDispatcher(), author }).createGraph();

    const first = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    // A second `{ opportunityId, brief }` invoke (e.g. discovery re-running) finds the existing task and
    // updates its brief instead of creating a second negotiation for the same opportunity.
    const second = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "updated brief", round: 2 });

    expect(second.negotiationId).toBe(first.negotiationId);
    expect(host.taskFor(first.negotiationId).brief).toBe("updated brief");
    expect([...host.tasks.values()]).toHaveLength(1);
  });

  test("a concurrent duplicate submission is fenced, not silently double-applied", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedNegotiationAuthor([{ verb: "outreach", message: "Opening.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, dispatcher: host.waitingDispatcher(), author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    const negotiationId = opened.negotiationId;

    // Two processes race to submit the candidate's pause from the same read (a pause never
    // loops back into self-play, so the winner's own result stays predictable). Both compute
    // the same expectedMessageCount (1); only the first insert may win.
    const [first, second] = await Promise.all([
      graph.invoke({
        negotiationId,
        turn: { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "pending", reasoning: "First." } },
        byUserId: CANDIDATE_USER_ID,
      }),
      graph.invoke({
        negotiationId,
        turn: { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "reject", reasoning: "Second." } },
        byUserId: CANDIDATE_USER_ID,
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["error", "paused"]);
    // Exactly one candidate turn landed — not two, not a fabricated composite.
    const persisted = await host.database.getNegotiationMessages(negotiationId);
    expect(persisted).toHaveLength(2); // the opening outreach, plus exactly one of the two races
  });

  test("a system pause on a negotiation with no turns at all is not blocked by the outreach guard", async () => {
    // Covers a first-turn authoring failure: init created the task, but nothing was ever
    // persisted before a timeout fired on it. The outreach-only-first rule must not trap
    // this negotiation with no way to recover.
    const host = new FakeNegotiationHost();
    const graph = new Negotiations({ database: host.database, dispatcher: host.bothWaitingDispatcher() }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.turns).toHaveLength(0); // both seats yielded waiting — nothing was ever authored

    const timedOut = await graph.invoke({ negotiationId: opened.negotiationId, pause: "counterparty_silent" });
    expect(timedOut.status).toBe("paused");
    expect(timedOut.pause).toEqual({ reason: "counterparty_silent" });
  });
});
