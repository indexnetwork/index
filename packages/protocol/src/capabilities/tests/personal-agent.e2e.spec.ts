import { describe, expect, test } from "bun:test";

import { CANDIDATE_USER_ID, FakeNegotiationHost, INTENT_ID, OPPORTUNITY_ID, SOURCE_USER_ID } from "./fixtures/negotiation-host.fixture.js";
import { PersonalAgentGraphFactory, type PersonalAgentGraphLike } from "../../internal/agents/personal-agent/agent.graph.js";
import type { PersonalAgentDecidedAct, PersonalAgentDeps, PersonalAgentExecutedAct, PersonalAgentJudgment, PersonalAgentMatch, PersonalAgentTurnContext } from "../../internal/agents/personal-agent/agent.types.js";
import type { NegotiationAuthoredTurn } from "../../internal/negotiations/negotiation.turn.js";
import { Negotiations } from "../negotiations.js";

/**
 * The whole cycle, end to end: matches_ready → kickoff (strategy + a brief per
 * match, in parallel) → negotiator turns → all paused → reflect ASK → the
 * principal's answers → reflect ACT (promote / reject / re-kick).
 *
 * Both real graphs run: the PersonalAgent's negotiation scope IS the
 * NegotiationGraph's turn author, so a kickoff genuinely self-plays every
 * negotiation through `apply` until it pauses. Only the model seam
 * (`PersonalAgentJudgment`) is scripted, so this file constructs no model and
 * runs in the credential-free CI gate.
 */

const SECOND_OPPORTUNITY_ID = "opportunity-2";
const THIRD_OPPORTUNITY_ID = "opportunity-3";
const TERMINAL_STATUSES = new Set(["accepted", "rejected", "expired"]);

/** The DM, the dossier and the ledger, in memory. */
class FakePrincipalHost {
  readonly dmMessages: Array<{ role: string; content: string; options?: string[] }> = [];
  readonly dossierEntries: Array<{ id: string; text: string; source: string; createdAt: Date }> = [];
  readonly ledgerRows: Array<{ event: Record<string, unknown>; act: Record<string, unknown> }> = [];
  readonly publishedChunks: Array<{ messageId: string; seq: number; content: string }> = [];
  readonly accepted: Array<{ opportunityId: string; reason?: string }> = [];
  private messageCounter = 0;

  constructor(private readonly negotiations: FakeNegotiationHost) {}

  readonly conversation: PersonalAgentDeps["conversation"] = {
    findSession: async () => ({ id: "dm-1" }),
    resolveSession: async () => ({ session: { id: "dm-1" } }),
    getMessages: async () => this.dmMessages.map(({ role, content }) => ({ role, content })),
    addMessage: async ({ role, content, options }) => {
      this.dmMessages.push({ role, content, ...(options ? { options } : {}) });
      return `dm-message-${++this.messageCounter}`;
    },
  };

  readonly dossier: PersonalAgentDeps["dossier"] = {
    readActiveEntries: async () => [...this.dossierEntries],
    addEntry: async ({ text, source }) => {
      const id = `dossier-${this.dossierEntries.length + 1}`;
      this.dossierEntries.push({ id, text, source, createdAt: new Date() });
      return id;
    },
    retireEntry: async ({ entryId }) => {
      const index = this.dossierEntries.findIndex((entry) => entry.id === entryId);
      if (index < 0) return false;
      this.dossierEntries.splice(index, 1);
      return true;
    },
  };

  readonly ledger: PersonalAgentDeps["ledger"] = {
    append: async ({ event, act }) => {
      this.ledgerRows.push({ event, act });
      return `ledger-${this.ledgerRows.length}`;
    },
    readRecent: async () => this.ledgerRows.map((row) => ({ createdAt: new Date(), act: row.act })),
  };

  /** Undecided matches only — the same list a verdict could land on. */
  readonly opportunities: PersonalAgentDeps["opportunities"] = {
    readMatches: async () => [...this.negotiations.opportunities.values()]
      .filter((opportunity) => !TERMINAL_STATUSES.has(opportunity.status))
      .map((opportunity): PersonalAgentMatch => {
        const introducers = opportunity.actors.filter((actor) => actor.role === "introducer");
        return {
          opportunityId: opportunity.id,
          label: `Match on ${opportunity.id}`,
          status: opportunity.status,
          ...(introducers.length > 0 && !introducers.every((actor) => actor.approved === true)
            ? { awaitingIntroducerApproval: true }
            : {}),
        };
      }),
    accept: async (_userId, input) => {
      this.accepted.push({ opportunityId: input.opportunityId, ...(input.reason ? { reason: input.reason } : {}) });
      return { status: "executed", counterparty: "the match" };
    },
  };

  readonly identity: PersonalAgentDeps["identity"] = { readAgentName: async () => "Ada" };

  readonly replyStream: PersonalAgentDeps["replyStream"] = {
    publish: async (messageId, chunk) => { this.publishedChunks.push({ messageId, ...chunk }); },
  };
}

/** Scripted judgment: the ONE model seam, driven by the turn's own shape. */
class ScriptedJudgment implements PersonalAgentJudgment {
  readonly decideCalls: PersonalAgentTurnContext[] = [];
  readonly briefCalls: Array<{ opportunityId: string; strategy: string }> = [];
  private cursor = 0;

  constructor(
    private readonly plans: Array<(context: PersonalAgentTurnContext) => PersonalAgentDecidedAct[]>,
    /** Overrides the default negotiator script; used by the termination tests. */
    private readonly turnScript?: (input: { brief: string; thread: unknown[]; isOpening: boolean }) => NegotiationAuthoredTurn,
  ) {}

  async decide(context: PersonalAgentTurnContext): Promise<PersonalAgentDecidedAct[]> {
    this.decideCalls.push(context);
    const plan = this.plans[this.cursor];
    this.cursor += 1;
    return plan ? plan(context) : [];
  }

  async reply(_context: PersonalAgentTurnContext, executed: PersonalAgentExecutedAct[]): Promise<{ text: string }> {
    return { text: `Here is where things stand after ${executed.length} act(s).` };
  }

  async strategy(): Promise<string> {
    return "I will put your constraints to each of them and find out who can actually move.";
  }

  async brief(_context: PersonalAgentTurnContext, input: { match: PersonalAgentMatch; strategy: string }): Promise<string> {
    this.briefCalls.push({ opportunityId: input.match.opportunityId, strategy: input.strategy });
    return `Brief for ${input.match.opportunityId}: ${input.strategy}`;
  }

  /**
   * Deterministic by thread depth and brief, not by call order: a kickoff
   * opens every match in parallel, so a positional script would be a race.
   */
  async negotiationTurn(input: { brief: string; thread: unknown[]; isOpening: boolean }): Promise<NegotiationAuthoredTurn> {
    if (this.turnScript) return this.turnScript(input);
    if (input.isOpening) return { verb: "outreach", message: `Opening on ${input.brief}`, reasoning: "Kickoff." };
    const depth = input.thread.length;
    const which = input.brief.includes(THIRD_OPPORTUNITY_ID) ? 3 : input.brief.includes(SECOND_OPPORTUNITY_ID) ? 2 : 1;
    if (depth === 1) {
      // The counterparty's seat answering our outreach.
      return which === 3
        ? { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "reject", reasoning: "Not what they need." } }
        : { verb: "counter", message: "Interested — what are the constraints?", reasoning: "Probing." };
    }
    if (depth === 2) {
      // Our own seat, which is why these payloads are ours to read at reflect.
      return which === 2
        ? { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "pending", reasoning: "They can move now." } }
        : { verb: "pause", reason: "needs_principal", payload: { question: "What is the earliest you could start?" } };
    }
    return { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "pending", reasoning: "Converged after the answer." } };
  }
}

/**
 * Wires the two real graphs into each other exactly as the host does: the
 * negotiation graph's turn author is the PersonalAgent in negotiation scope.
 */
function buildCycle(judgment: ScriptedJudgment, counterparties: string[]) {
  const negotiationHost = new FakeNegotiationHost(counterparties);
  const principal = new FakePrincipalHost(negotiationHost);
  const wakes: Array<{ userId: string; intentId: string }> = [];
  let agent: PersonalAgentGraphLike;
  const negotiations = new Negotiations({
    database: negotiationHost.database,
    reflectEnqueue: async (job) => { negotiationHost.enqueueReflect(job); },
    author: {
      authorTurn: async ({ negotiationId, userId, intentId }) => {
        const result = await agent.invoke({ userId, intentId, negotiationId });
        if (!result.turn) throw new Error(result.error ?? "PersonalAgent produced no negotiation turn");
        return result.turn;
      },
    },
  }).createGraph();
  agent = new PersonalAgentGraphFactory({
    negotiations,
    negotiationDatabase: negotiationHost.database,
    conversation: principal.conversation,
    dossier: principal.dossier,
    ledger: principal.ledger,
    opportunities: principal.opportunities,
    identity: principal.identity,
    replyStream: principal.replyStream,
    reflectEnqueue: async (job) => { negotiationHost.enqueueReflect(job); },
    wakeForMatches: async (input) => { wakes.push(input); },
    judgment,
  }).createGraph();
  const judgmentMatches = () => judgment.decideCalls.at(-1)?.matches ?? [];
  return { agent, negotiationHost, principal, wakes, judgmentMatches };
}

const userMessage = (text: string) => ({
  userId: SOURCE_USER_ID,
  intentId: INTENT_ID,
  event: "user_message" as const,
  sessionId: "dm-1",
  messageId: `client-message-${text.length}`,
  text,
});

describe("PersonalAgent — the whole cycle", () => {
  test("matches_ready → ask → kickoff → all paused → reflect ASK → answers → ACT", async () => {
    const judgment = new ScriptedJudgment([
      // 1. matches_ready: ask before speaking on the principal's behalf.
      () => [{ tool: "ask", text: "Before I reach out — what is your timeline?" }],
      // 2. their answer: note it, then kick every match off.
      () => [
        { tool: "note_dossier", text: "Wants to start within a month." },
        { tool: "kickoff", reasoning: "Timeline is settled; reaching out to all three." },
      ],
      // 3. all_paused (reflect phase 1): merge what the tables need into one ask.
      (context) => {
        expect(context.paused).toHaveLength(3);
        return [{ tool: "ask", text: "One of them needs your earliest start date — what should I say?" }];
      },
      // 4. their answer (reflect phase 2 ACT): promote, reject, re-kick the rest.
      (context) => {
        const byOpportunity = new Map(context.paused.map((paused) => [paused.opportunityId, paused.negotiationId]));
        return [
          { tool: "promote", negotiationId: byOpportunity.get(SECOND_OPPORTUNITY_ID)!, reasoning: "They can move now." },
          { tool: "reject", negotiationId: byOpportunity.get(THIRD_OPPORTUNITY_ID)!, reasoning: "Not a fit." },
          { tool: "kickoff", reasoning: "Sending the rest back out with the start date." },
        ];
      },
    ]);
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID, "carol", "dave"]);

    // ── 1. matches_ready: it asks, and reaches out to no one ──────────────
    const asked = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    expect(asked.acts.map((act) => act.tool)).toEqual(["ask"]);
    expect(negotiationHost.tasks.size).toBe(0);
    expect(principal.dmMessages.at(-1)?.content).toContain("what is your timeline");

    // ── 2. the answer kicks the round off ─────────────────────────────────
    const kicked = await agent.invoke(userMessage("Within a month, ideally sooner."));
    expect(kicked.acts.map((act) => act.tool)).toEqual([
      "note_dossier",
      "message_user", // the strategy, written into the DM before anyone is contacted
      "kickoff",
      "message_user", // the reply stage
    ]);
    // One brief per match, all derived from the same strategy.
    expect(judgment.briefCalls.map((call) => call.opportunityId).sort())
      .toEqual([OPPORTUNITY_ID, SECOND_OPPORTUNITY_ID, THIRD_OPPORTUNITY_ID]);
    expect(new Set(judgment.briefCalls.map((call) => call.strategy)).size).toBe(1);
    expect(negotiationHost.tasks.size).toBe(3);
    for (const task of negotiationHost.tasks.values()) {
      expect(task.state).toBe("paused");
      expect(task.brief).toBe(`Brief for ${task.metadata.opportunityId}: ${judgment.briefCalls[0]!.strategy}`);
    }
    // The round is stamped only after every open settled, and the all-paused
    // check then fires exactly once for it.
    const round = negotiationHost.round;
    expect(negotiationHost.roundSize).toBe(3);
    expect(negotiationHost.reflectJobs).toEqual([{ userId: SOURCE_USER_ID, intentId: INTENT_ID, round }]);
    // The principal's reply streamed back as ordered chunks.
    expect(principal.publishedChunks.map((chunk) => chunk.seq)).toEqual([1, 2, 3]);

    // ── 3. reflect phase 1: it asks, and decides nothing ──────────────────
    const reflectAsk = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round });
    expect(reflectAsk.acts.map((act) => act.tool)).toEqual(["ask"]);
    expect(negotiationHost.opportunityStatusUpdates.filter((update) => update.status === "pending")).toHaveLength(0);
    expect(negotiationHost.opportunityStatusUpdates.filter((update) => update.status === "rejected")).toHaveLength(0);

    // ── 4. reflect phase 2: promote, reject, re-kick ──────────────────────
    const acted = await agent.invoke(userMessage("I could start in three weeks."));
    expect(acted.acts.map((act) => act.tool)).toEqual([
      "promote",
      "reject",
      "message_user", // the new round's strategy
      "kickoff",
      "message_user", // the reply stage
    ]);
    expect(negotiationHost.opportunities.get(SECOND_OPPORTUNITY_ID)!.status).toBe("pending");
    expect(negotiationHost.opportunities.get(THIRD_OPPORTUNITY_ID)!.status).toBe("rejected");
    // Only the undecided one was sent back out, with a brief of its own.
    const rekick = acted.acts.find((act) => act.tool === "kickoff")!;
    expect(rekick).toMatchObject({ tool: "kickoff", opened: 1 });
    expect(judgment.briefCalls.at(-1)!.opportunityId).toBe(OPPORTUNITY_ID);
    expect(negotiationHost.tasks.size).toBe(3); // re-kick resumed, never duplicated
    expect(negotiationHost.round).toBe(round + 1);
    expect(negotiationHost.reflectJobs.at(-1)).toEqual({ userId: SOURCE_USER_ID, intentId: INTENT_ID, round: round + 1 });
  });

  test("a pause payload is readable only by the seat that paused", async () => {
    const judgment = new ScriptedJudgment([
      () => [{ tool: "kickoff", reasoning: "Straight out." }],
      (context) => {
        const ours = context.paused.find((paused) => paused.opportunityId === OPPORTUNITY_ID)!;
        const theirs = context.paused.find((paused) => paused.opportunityId === THIRD_OPPORTUNITY_ID)!;
        // Our own seat's needs_principal question is exactly what reflect
        // merges into its ASK.
        expect(ours.pausedByUs).toBe(true);
        expect(ours.payload).toEqual({ question: "What is the earliest you could start?" });
        // Their agent's recommendation is theirs to hand to their principal.
        expect(theirs.pausedByUs).toBe(false);
        expect(theirs.payload).toBeUndefined();
        expect(theirs.reason).toBe("ready_for_verdict");
        return [];
      },
    ]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID, "carol", "dave"]);

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const round = negotiationHost.round;
    const reflected = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round });
    expect(reflected.error).toBeUndefined();
    expect(judgment.decideCalls).toHaveLength(2);
  });

  test("a kickoff that opens nothing leaves the round unstamped, so reflect cannot loop", async () => {
    const judgment = new ScriptedJudgment([
      () => [{ tool: "kickoff", reasoning: "Nothing to open." }],
    ]);
    const { agent, negotiationHost } = buildCycle(judgment, []);

    const result = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    // The act names the round it actually looked at, not a placeholder.
    expect(result.acts).toEqual([{ tool: "kickoff", round: negotiationHost.round, opened: 0, reasoning: "Nothing to open." }]);
    expect(negotiationHost.roundSize).toBeNull();
    expect(negotiationHost.kickoffStartedAt).toBeNull(); // no round was ever begun
    expect(negotiationHost.reflectJobs).toEqual([]);
  });

  test("global scope is a graph-level input error", async () => {
    const { agent } = buildCycle(new ScriptedJudgment([]), []);
    const result = await agent.invoke({ userId: SOURCE_USER_ID });
    expect(result.scope).toBe("global");
    expect(result.error).toContain("global scope is not implemented");
  });
});

describe("PersonalAgent — termination and retry safety", () => {
  /**
   * The exact shape D21 exists to stop: A spends its turn budget in round R,
   * B pauses on a question, so the next kickoff re-opens only B — which puts B
   * in round R+1 and leaves A behind in R. A is then absent from R+1's paused
   * set, and an eligibility rule that reads THAT set would call A eligible
   * again and re-open it, forever. Eligibility must read the negotiation's own
   * state instead.
   */
  test("a negotiation that capped in an earlier round is never re-kicked — the cycle terminates", async () => {
    const kickoffPlan = (): PersonalAgentDecidedAct[] => [{ tool: "kickoff", reasoning: "Send them out." }];
    const judgment = new ScriptedJudgment(
      [kickoffPlan, kickoffPlan, kickoffPlan],
      (input) => {
        if (input.isOpening) return { verb: "outreach", message: "Opening.", reasoning: "Kickoff." };
        // Opportunity 2 stalls on its principal at the first reply, then plays
        // on when re-kicked — so it, too, eventually spends its budget.
        if (input.brief.includes(SECOND_OPPORTUNITY_ID) && input.thread.length === 1) {
          return { verb: "pause", reason: "needs_principal", payload: { question: "How soon?" } };
        }
        return { verb: "counter", message: "Pushing back.", reasoning: "Still talking." };
      },
    );
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID, "carol"]);

    // ── round 2: both open; A self-plays to its turn cap, B stalls ────────
    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const firstRound = negotiationHost.round;
    const taskFor = (opportunityId: string) =>
      [...negotiationHost.tasks.values()].find((task) => task.metadata.opportunityId === opportunityId)!;
    expect(taskFor(OPPORTUNITY_ID).metadata.pause?.reason).toBe("turn_cap");
    expect(taskFor(SECOND_OPPORTUNITY_ID).metadata.pause?.reason).toBe("needs_principal");

    // ── round 3: only B is re-kicked, so A stays behind in round 2 ────────
    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: firstRound });
    expect(negotiationHost.round).toBe(firstRound + 1);
    expect(taskFor(SECOND_OPPORTUNITY_ID).metadata.round).toBe(firstRound + 1);
    expect(taskFor(OPPORTUNITY_ID).metadata.round).toBe(firstRound); // left behind, capped
    expect(taskFor(SECOND_OPPORTUNITY_ID).metadata.pause?.reason).toBe("turn_cap");

    // ── round 3 reflect: A is invisible to this round, and must STILL be
    //    ineligible. Nothing opens, nothing stamps, nothing re-triggers. ──
    const strategyMessagesBefore = principal.dmMessages.length;
    const reflectJobsBefore = negotiationHost.reflectJobs.length;
    const briefCallsBefore = judgment.briefCalls.length;
    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: firstRound + 1 });

    expect(acted.acts).toEqual([{ tool: "kickoff", round: firstRound + 1, opened: 0, reasoning: "Send them out." }]);
    expect(negotiationHost.round).toBe(firstRound + 1); // no further bump
    expect(negotiationHost.tasks.size).toBe(2); // nothing re-opened
    expect(principal.dmMessages).toHaveLength(strategyMessagesBefore); // no second strategy
    expect(judgment.briefCalls).toHaveLength(briefCallsBefore); // no model spend
    expect(negotiationHost.reflectJobs).toHaveLength(reflectJobsBefore); // the loop ends here
  });

  /**
   * A turn runs on a queue that retries it whole. A crash after the opens —
   * here, the size stamp failing — must not re-post the strategy, re-bump the
   * round or re-open anything, and it must not leave the round unstamped.
   */
  test("a kickoff that crashed mid-round is repaired without claiming opens it never made", async () => {
    const kickoffPlan = (): PersonalAgentDecidedAct[] => [{ tool: "kickoff", reasoning: "Reaching out." }];
    const judgment = new ScriptedJudgment([kickoffPlan, kickoffPlan]);
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID]);

    const stamp = negotiationHost.database.stampIntentNegotiationRoundSize;
    let failNextStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failNextStamp) {
        failNextStamp = false;
        throw new Error("stamp write failed");
      }
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    // ── the interrupted attempt ───────────────────────────────────────────
    const crashed = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    expect(crashed.error).toBe("stamp write failed");
    const round = negotiationHost.round;
    expect(negotiationHost.tasks.size).toBe(1);
    expect(negotiationHost.roundSize).toBeNull();   // begun, not settled
    expect(negotiationHost.kickoffStartedAt).not.toBeNull();

    // ── the retry: repair the stranded round, then do this turn's own work ─
    const retried = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    expect(retried.error).toBeUndefined();
    // The repair opened nothing, so it claims nothing: the one act reported is
    // the round this turn actually opened.
    expect(retried.acts.filter((act) => act.tool === "kickoff")).toEqual([
      { tool: "kickoff", round: round + 1, opened: 1, reasoning: "Reaching out." },
    ]);
    expect(negotiationHost.roundSize).toBe(1);      // the stranded round is settled
    // The negotiation is RESUMED into the new round, never duplicated — the
    // only thing a retry repeats is the strategy message.
    expect(negotiationHost.tasks.size).toBe(1);
    expect(negotiationHost.taskFor([...negotiationHost.tasks.keys()][0]!).metadata.round).toBe(round + 1);
    expect(principal.dmMessages.filter((message) => message.content.includes("find out who can actually move"))).toHaveLength(2);
  });
});

describe("PersonalAgent — kickoff safety at the edges", () => {
  test("a signal that predates round stamping runs a NORMAL kickoff, not a resume", async () => {
    // Every intent alive when the migration lands has negotiation_round >= 1
    // and no size stamp. Inferring "an interrupted kickoff" from that NULL
    // would take the resume path on the first matches_ready per existing
    // signal — no strategy, no briefs, no opens — and silently drop the batch
    // that woke it. The marker, not the NULL-ness, is what says a kickoff began.
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "First real round." }]]);
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    // A signal that was mid-negotiation when the mechanism landed: a round
    // counter, negotiations already in that round, and no stamp of any kind.
    negotiationHost.round = 4;
    negotiationHost.roundSize = null;
    negotiationHost.kickoffStartedAt = null;
    await negotiationHost.database.createNegotiationTask({
      conversationId: "legacy-conversation",
      brief: "written before this PR",
      metadata: {
        type: "negotiation",
        opportunityId: OPPORTUNITY_ID,
        sourceUserId: SOURCE_USER_ID,
        candidateUserId: CANDIDATE_USER_ID,
        initiatorUserId: SOURCE_USER_ID,
        networkId: "network-1",
        intentId: INTENT_ID,
        round: 4,
      },
    });

    const result = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(result.acts.map((act) => act.tool)).toEqual(["message_user", "kickoff"]);
    expect(principal.dmMessages).toHaveLength(1);            // the strategy was written
    expect(judgment.briefCalls).toHaveLength(1);             // a brief was derived
    expect(negotiationHost.round).toBe(5);                   // a NEW round, not a stamp of the stale one
    expect(negotiationHost.roundSize).toBe(1);
    expect(negotiationHost.reflectJobs).toEqual([{ userId: SOURCE_USER_ID, intentId: INTENT_ID, round: 5 }]);
  });

  test("an open that fails leaves no live negotiation holding the round open", async () => {
    // `init` creates the task before a turn is ever authored, so a failure
    // after that point strands it in `working`: the round's active count never
    // reaches zero and its reflect never fires.
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const createMessage = negotiationHost.database.createNegotiationMessage;
    let failFirstTurn = true;
    negotiationHost.database.createNegotiationMessage = async (input) => {
      if (failFirstTurn) {
        failFirstTurn = false;
        return null; // the fence rejects it; the graph reports an error and stops
      }
      return createMessage.call(negotiationHost.database, input);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    const task = [...negotiationHost.tasks.values()][0]!;
    expect(task.state).toBe("paused");
    expect(task.metadata.pause?.reason).toBe("open_failed");
    expect(await negotiationHost.database.countActiveNegotiationsForRound(INTENT_ID, negotiationHost.round)).toBe(0);
    // The round still settles, so its reflect fires instead of hanging.
    expect(negotiationHost.roundSize).toBe(1);
    expect(negotiationHost.reflectJobs).toHaveLength(1);
  });

  test("a match that arrived during the turn wakes the agent again", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost, wakes } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    // Discovery persists a second match while the turn is mid-flight: the
    // match list this kickoff targeted was read before it existed.
    const original = negotiationHost.database.getNegotiationTaskForOpportunity;
    let landed = false;
    negotiationHost.database.getNegotiationTaskForOpportunity = async (opportunityId) => {
      if (!landed) {
        landed = true;
        negotiationHost.opportunities.set(SECOND_OPPORTUNITY_ID, {
          id: SECOND_OPPORTUNITY_ID,
          status: "latent",
          actors: [],
        });
      }
      return original.call(negotiationHost.database, opportunityId);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(wakes).toEqual([{ userId: SOURCE_USER_ID, intentId: INTENT_ID }]);
  });

  test("nothing new means no second wake — the re-check cannot loop", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, wakes } = buildCycle(judgment, [CANDIDATE_USER_ID]);

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(wakes).toEqual([]);
  });
});

describe("PersonalAgent — what a turn may open, and what it may claim", () => {
  test("an introduction its introducer has not approved is never opened, even when another match wakes the turn", async () => {
    // Discovery's gate only decides whom to WAKE. One plain match wakes this
    // turn; the kickoff then re-reads the whole match list, and without a gate
    // of its own it would open the unapproved introduction too — flipping it
    // to `negotiating` and sending outreach on the introducer's behalf.
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID, "carol"]);
    negotiationHost.opportunities.get(SECOND_OPPORTUNITY_ID)!.actors.push({
      userId: "dave-introducer", intent: INTENT_ID, networkId: "network-1", role: "introducer",
    });

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(negotiationHost.tasks.size).toBe(1);
    expect([...negotiationHost.tasks.values()][0]!.metadata.opportunityId).toBe(OPPORTUNITY_ID);
    expect(negotiationHost.opportunities.get(SECOND_OPPORTUNITY_ID)!.status).toBe("latent");
    expect(negotiationHost.opportunityStatusUpdates.map((update) => update.id)).toEqual([OPPORTUNITY_ID]);
    // No brief was spent on it either.
    expect(judgment.briefCalls.map((call) => call.opportunityId)).toEqual([OPPORTUNITY_ID]);
    expect(principal.dmMessages).toHaveLength(1); // strategy only
  });

  test("an open that failed AFTER outreach is not labelled 'nothing has been said'", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const createMessage = negotiationHost.database.createNegotiationMessage;
    let applied = 0;
    negotiationHost.database.createNegotiationMessage = async (input) => {
      applied += 1;
      // The opening outreach lands; the counterparty's reply cannot.
      if (applied === 2) return null;
      return createMessage.call(negotiationHost.database, input);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    const task = [...negotiationHost.tasks.values()][0]!;
    expect(negotiationHost.messages.get(task.id)).toHaveLength(2); // outreach + the pause marker
    expect(task.state).toBe("paused");
    // `open_failed` would tell the principal nothing had been said, with the
    // outreach sitting in the thread, and would record the pause against the
    // seat that merely owed the next turn.
    expect(task.metadata.pause?.reason).toBe("counterparty_silent");
    expect(await negotiationHost.database.countActiveNegotiationsForRound(INTENT_ID, negotiationHost.round)).toBe(0);
    expect(negotiationHost.roundSize).toBe(1);
  });

  test("a principal who asks for a kickoff during an interrupted round gets one", async () => {
    // The crashed turn left round R begun-but-unsettled. The principal then
    // says go ahead. Repairing R is not the kickoff they asked for, and
    // reporting one would be a confirmation of work nobody did.
    const judgment = new ScriptedJudgment([
      () => [{ tool: "kickoff", reasoning: "Reaching out." }],
      () => [{ tool: "kickoff", reasoning: "They said go ahead." }],
    ]);
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const stamp = negotiationHost.database.stampIntentNegotiationRoundSize;
    let failNextStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failNextStamp) { failNextStamp = false; throw new Error("stamp write failed"); }
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const stranded = negotiationHost.round;
    expect(negotiationHost.roundSize).toBeNull();
    const briefsBefore = judgment.briefCalls.length;
    const messagesBefore = principal.dmMessages.length;

    const acted = await agent.invoke(userMessage("Go ahead."));

    // A real kickoff happened: a new round, a fresh brief, a strategy the
    // principal can read — and the act names the round it actually opened.
    expect(negotiationHost.round).toBe(stranded + 1);
    expect(judgment.briefCalls.length).toBe(briefsBefore + 1);
    expect(principal.dmMessages.length).toBeGreaterThan(messagesBefore);
    expect(acted.acts.filter((act) => act.tool === "kickoff")).toEqual([
      { tool: "kickoff", round: stranded + 1, opened: 1, reasoning: "They said go ahead." },
    ]);
    expect(negotiationHost.roundSize).toBe(1);
  });

  test("a reflect turn whose reads fail does not report a successful empty turn", async () => {
    // With the reflect job id retained forever, a swallowed read here would
    // consume the round's one chance to reflect and stall the cycle for good.
    const judgment = new ScriptedJudgment([() => []]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    negotiationHost.database.getNegotiationTasksForIntentRound = async () => {
      throw new Error("connection reset");
    };

    const result = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: 1 });

    expect(result.error).toBe("connection reset");
    expect(judgment.decideCalls).toHaveLength(0);
  });
});

describe("PersonalAgent — round-4 regressions", () => {
  test("the interrupted-round repair does not queue a reflect for a round this turn supersedes", async () => {
    // Settling the old round and firing its reflect, then bumping past it and
    // carrying its negotiations into the new round, wakes the agent with
    // "every negotiation of this round has paused" and nothing listed — which
    // invites a kickoff that strands the round that actually holds the work.
    const judgment = new ScriptedJudgment([
      () => [{ tool: "kickoff", reasoning: "Reaching out." }],
      () => [{ tool: "kickoff", reasoning: "Again." }],
    ]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const stamp = negotiationHost.database.stampIntentNegotiationRoundSize;
    let failNextStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failNextStamp) { failNextStamp = false; throw new Error("stamp write failed"); }
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const stranded = negotiationHost.round;
    negotiationHost.reflectJobs.length = 0;

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    // Only the round that actually holds the negotiations is reflected on.
    expect(negotiationHost.reflectJobs.map((job) => job.round)).toEqual([stranded + 1]);
    expect([...negotiationHost.tasks.values()][0]!.metadata.round).toBe(stranded + 1);
  });

  test("an interrupted round that nothing supersedes still gets its reflect", async () => {
    const judgment = new ScriptedJudgment([
      () => [{ tool: "kickoff", reasoning: "Reaching out." }],
      () => [{ tool: "kickoff", reasoning: "Nothing left to open." }],
    ]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const stamp = negotiationHost.database.stampIntentNegotiationRoundSize;
    let failNextStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failNextStamp) { failNextStamp = false; throw new Error("stamp write failed"); }
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const stranded = negotiationHost.round;
    negotiationHost.reflectJobs.length = 0;
    // The match is decided in the meantime, so the next turn opens nothing.
    negotiationHost.opportunities.get(OPPORTUNITY_ID)!.status = "rejected";

    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(acted.acts).toEqual([{ tool: "kickoff", round: stranded, opened: 0, reasoning: "Nothing left to open." }]);
    expect(negotiationHost.round).toBe(stranded);              // no bump
    expect(negotiationHost.roundSize).toBe(1);                 // settled all the same
    expect(negotiationHost.reflectJobs.map((job) => job.round)).toEqual([stranded]);
  });

  test("a reply-stage failure never retries the turn's already-executed acts", async () => {
    // The acts are durable and the reply may already be on the principal's
    // screen; a thrown error here fails the job, and the retry re-decides and
    // re-executes every verdict and kickoff on top of it.
    const judgment = new ScriptedJudgment([() => [{ tool: "note_dossier", text: "Can start in a week." }]]);
    const { agent, principal } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    principal.conversation.addMessage = async () => { throw new Error("write failed"); };

    const result = await agent.invoke(userMessage("I can start in a week."));

    expect(result.error).toBeUndefined();
    expect(result.acts.map((act) => act.tool)).toEqual(["note_dossier"]);
    expect(principal.dossierEntries).toHaveLength(1);
  });

  test("an unapproved introduction is filtered before a brief is spent on it", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost, judgmentMatches } = buildCycle(judgment, [CANDIDATE_USER_ID, "carol"]);
    negotiationHost.opportunities.get(SECOND_OPPORTUNITY_ID)!.actors.push({
      userId: "dave-introducer", intent: INTENT_ID, networkId: "network-1", role: "introducer",
    });

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    // The host reader flags it, so the kickoff never reaches the open at all.
    expect(judgmentMatches().some((match) => match.opportunityId === SECOND_OPPORTUNITY_ID
      && match.awaitingIntroducerApproval === true)).toBe(true);
    expect(judgment.briefCalls.map((call) => call.opportunityId)).toEqual([OPPORTUNITY_ID]);
    expect(negotiationHost.tasks.size).toBe(1);
  });
});
