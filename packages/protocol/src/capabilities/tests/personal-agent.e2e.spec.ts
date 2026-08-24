import { describe, expect, test } from "bun:test";

import { CANDIDATE_USER_ID, FakeNegotiationHost, INTENT_ID, OPPORTUNITY_ID, SOURCE_USER_ID } from "./fixtures/negotiation-host.fixture.js";
import { PersonalAgentGraphFactory, PERSONAL_AGENT_NOTHING_TO_OPEN, PERSONAL_AGENT_STRATEGY_FALLBACK, type PersonalAgentGraphLike } from "../../internal/agents/personal-agent/agent.graph.js";
import type { PersonalAgentDecidedAct, PersonalAgentDeps, PersonalAgentExecutedAct, PersonalAgentJudgment, PersonalAgentMatch, PersonalAgentSeatBriefInput, PersonalAgentTurnContext } from "../../internal/agents/personal-agent/agent.types.js";
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

  readonly seatBriefCalls: PersonalAgentSeatBriefInput[] = [];

  /**
   * The counterparty's own brief, authored at its first turn. It is written
   * from what THIS side can see — here, whatever the opening turn said — and
   * never from the initiator's, which is the whole point of D18.
   */
  async seatBrief(input: PersonalAgentSeatBriefInput): Promise<string> {
    this.seatBriefCalls.push(input);
    const opening = input.thread.find((entry) => (entry.turn as { verb?: string }).verb === "outreach");
    const heard = opening ? (opening.turn as { message?: string }).message ?? "" : (input.matchReasoning ?? "");
    return `Seat brief from what we were told: ${heard}`;
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
      expect(task.briefs[SOURCE_USER_ID]).toBe(`Brief for ${task.metadata.opportunityId}: ${judgment.briefCalls[0]!.strategy}`);
      // The counterparty seat wrote its OWN, and never read the initiator's.
      expect(task.briefs[task.metadata.candidateUserId]).toMatch(/^Seat brief from what we were told:/);
    }
    // The round is stamped only after every open settled, and the all-paused
    // check then fires exactly once for it.
    const round = negotiationHost.round;
    expect(negotiationHost.roundSize).toBe(3);
    expect(negotiationHost.reflectJobs).toEqual([{ userId: SOURCE_USER_ID, intentId: INTENT_ID, round }]);
    // Every act is on the ledger. The appends are guarded so a failure cannot
    // duplicate a real effect — which also means a broken one records nothing
    // and says nothing, so it is asserted rather than assumed.
    expect(principal.ledgerRows.map((row) => row.act.tool))
      .toEqual(["ask", "note_dossier", "message_user", "kickoff", "message_user"]);
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
    // A background turn has no reply stage, so a kickoff with nothing to open
    // must still SAY so — silence there ends the cycle with the principal
    // never told (the reflect job is retained and nothing is active).
    expect(result.acts.map((act) => act.tool)).toEqual(["message_user", "kickoff"]);
    expect(result.acts.at(-1)).toEqual({ tool: "kickoff", round: negotiationHost.round, opened: 0, reasoning: "Nothing to open." });
    expect(result.messages).toHaveLength(1);
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
        if (input.isOpening) return { verb: "outreach", message: `Opening on ${input.brief}`, reasoning: "Kickoff." };
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
    expect(taskFor(SECOND_OPPORTUNITY_ID).metadata.seats[INTENT_ID]!.round).toBe(firstRound + 1);
    expect(taskFor(OPPORTUNITY_ID).metadata.seats[INTENT_ID]!.round).toBe(firstRound); // left behind, capped
    expect(taskFor(SECOND_OPPORTUNITY_ID).metadata.pause?.reason).toBe("turn_cap");

    // ── round 3 reflect: A is invisible to this round, and must STILL be
    //    ineligible. Nothing opens, nothing stamps, nothing re-triggers. ──
    const strategyMessagesBefore = principal.dmMessages.length;
    const reflectJobsBefore = negotiationHost.reflectJobs.length;
    const briefCallsBefore = judgment.briefCalls.length;
    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: firstRound + 1 });

    expect(acted.acts.map((act) => act.tool)).toEqual(["message_user", "kickoff"]);
    expect(acted.acts.at(-1)).toEqual({ tool: "kickoff", round: firstRound + 1, opened: 0, reasoning: "Send them out." });
    expect(negotiationHost.round).toBe(firstRound + 1); // no further bump
    expect(negotiationHost.tasks.size).toBe(2); // nothing re-opened
    // No second STRATEGY and no model spend — the only thing added to the DM
    // is the honest "nothing to open" line.
    expect(principal.dmMessages).toHaveLength(strategyMessagesBefore + 1);
    expect(principal.dmMessages.at(-1)!.content).toBe(PERSONAL_AGENT_NOTHING_TO_OPEN);
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

    // Every attempt: the post-bump policy retries this write three times and
    // then gives up loudly rather than throwing out of the turn (D54).
    const stamp = negotiationHost.database.stampIntentNegotiationRoundSize;
    let failStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failStamp) throw new Error("stamp write failed");
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    // ── the interrupted attempt ───────────────────────────────────────────
    // The turn does NOT fail: after the bump nothing throws (D54), so the
    // strategy message and the round it already produced are never repeated.
    const crashed = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    expect(crashed.error).toBeUndefined();
    const round = negotiationHost.round;
    expect(negotiationHost.tasks.size).toBe(1);
    expect(negotiationHost.roundSize).toBeNull();   // begun, not settled
    expect(negotiationHost.kickoffStartedAt).not.toBeNull();
    failStamp = false;
    negotiationHost.ageKickoff();  // past the staleness bound: abandoned, not in flight

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
    expect(negotiationHost.taskFor([...negotiationHost.tasks.keys()][0]!).metadata.seats[INTENT_ID]!.round).toBe(round + 1);
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
        seats: { [INTENT_ID]: { userId: SOURCE_USER_ID, round: 4 } },
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
    let failStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failStamp) throw new Error("stamp write failed");
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const stranded = negotiationHost.round;
    expect(negotiationHost.roundSize).toBeNull();
    failStamp = false;
    negotiationHost.ageKickoff();
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
    negotiationHost.database.getPausedNegotiationTasksForIntent = async () => {
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
    let failStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failStamp) throw new Error("stamp write failed");
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const stranded = negotiationHost.round;
    negotiationHost.reflectJobs.length = 0;
    failStamp = false;
    negotiationHost.ageKickoff();

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    // Only the round that actually holds the negotiations is reflected on.
    expect(negotiationHost.reflectJobs.map((job) => job.round)).toEqual([stranded + 1]);
    expect([...negotiationHost.tasks.values()][0]!.metadata.seats[INTENT_ID]!.round).toBe(stranded + 1);
  });

  test("an interrupted round that nothing supersedes still gets its reflect", async () => {
    const judgment = new ScriptedJudgment([
      () => [{ tool: "kickoff", reasoning: "Reaching out." }],
      () => [{ tool: "kickoff", reasoning: "Nothing left to open." }],
    ]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const stamp = negotiationHost.database.stampIntentNegotiationRoundSize;
    let failStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failStamp) throw new Error("stamp write failed");
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const stranded = negotiationHost.round;
    negotiationHost.reflectJobs.length = 0;
    failStamp = false;
    negotiationHost.ageKickoff();
    // The match is decided in the meantime, so the next turn opens nothing.
    negotiationHost.opportunities.get(OPPORTUNITY_ID)!.status = "rejected";

    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(acted.acts.map((act) => act.tool)).toEqual(["message_user", "kickoff"]);
    expect(acted.acts.at(-1)).toEqual({ tool: "kickoff", round: stranded, opened: 0, reasoning: "Nothing left to open." });
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

describe("PersonalAgent — round-5 regressions", () => {
  test("a capped negotiation a later round left behind is still listed, and still rejectable", async () => {
    // Being spent makes a negotiation ineligible for RE-KICK. It must not also
    // make it invisible: conflating the two meant a table a later round left
    // behind could never be promoted or rejected, so its opportunity sat
    // `negotiating` forever and its principal never heard an outcome.
    const kickoff = (): PersonalAgentDecidedAct[] => [{ tool: "kickoff", reasoning: "Send them out." }];
    const judgment = new ScriptedJudgment(
      [kickoff, kickoff, (context) => {
        const capped = context.paused.find((paused) => paused.opportunityId === OPPORTUNITY_ID);
        expect(capped).toBeDefined();
        return [{ tool: "reject", negotiationId: capped!.negotiationId, reasoning: "Went nowhere." }];
      }],
      (input) => {
        if (input.isOpening) return { verb: "outreach", message: `Opening on ${input.brief}`, reasoning: "Kickoff." };
        if (input.brief.includes(SECOND_OPPORTUNITY_ID) && input.thread.length === 1) {
          return { verb: "pause", reason: "needs_principal", payload: { question: "How soon?" } };
        }
        return { verb: "counter", message: "Pushing back.", reasoning: "Still talking." };
      },
    );
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID, "carol"]);

    // Round 2 caps opportunity-1; opportunity-2 only stalls on a question.
    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const capped = [...negotiationHost.tasks.values()].find((task) => task.metadata.opportunityId === OPPORTUNITY_ID)!;
    expect(capped.metadata.pause?.reason).toBe("turn_cap");
    const cappedRound = capped.metadata.seats[INTENT_ID]!.round;

    // Round 3 re-kicks only opportunity-2, leaving the capped one behind.
    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: cappedRound });
    expect(negotiationHost.taskFor(capped.id).metadata.seats[INTENT_ID]!.round).toBe(cappedRound);
    expect(negotiationHost.round).toBe(cappedRound + 1);

    // Reflecting on the LATER round must still see the one left behind.
    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: cappedRound + 1 });

    expect(acted.acts).toEqual([{
      tool: "reject",
      negotiationId: capped.id,
      opportunityId: OPPORTUNITY_ID,
      reasoning: "Went nowhere.",
      outcome: "resolved",
    }]);
    expect(negotiationHost.opportunities.get(OPPORTUNITY_ID)!.status).toBe("rejected");
  });

  test("a negotiation that pauses between the count and the stamp still gets its reflect", async () => {
    // The stamp opens a window: a pause landing inside it sees a null stamp
    // and bails, while kickoff's own check has already counted. Checked on one
    // side only, that round is waited on forever.
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const count = negotiationHost.database.countActiveNegotiationsForRound;
    let pretendStillWorking = true;
    negotiationHost.database.countActiveNegotiationsForRound = async (intentId, round) => {
      // The pre-stamp check sees the negotiation as still going; it pauses in
      // the window, so only the post-stamp check can catch it.
      if (pretendStillWorking) { pretendStillWorking = false; return 1; }
      return count.call(negotiationHost.database, intentId, round);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(negotiationHost.roundSize).toBe(1);
    expect(negotiationHost.reflectJobs).toEqual([
      { userId: SOURCE_USER_ID, intentId: INTENT_ID, round: negotiationHost.round },
    ]);
  });

  test("a verdict naming a negotiation this turn cannot see is ledgered, not thrown", async () => {
    // `judgment` is a documented swap seam, so the id is only as bounded as
    // whatever produced it. Throwing here would abandon the acts already
    // executed above and retry every one of them.
    const judgment = new ScriptedJudgment([() => [
      { tool: "note_dossier", text: "Prefers remote." },
      { tool: "reject", negotiationId: "task-that-does-not-exist", reasoning: "No." },
    ]]);
    const { agent, principal } = buildCycle(judgment, [CANDIDATE_USER_ID]);

    const result = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: 1 });

    expect(result.error).toBeUndefined();
    expect(result.acts.map((act) => act.tool)).toEqual(["note_dossier", "reject"]);
    expect(result.acts.at(-1)).toMatchObject({ outcome: "error" });
    expect(principal.dossierEntries).toHaveLength(1); // the earlier act stands
  });
});

describe("PersonalAgent — the three decided design questions", () => {
  test("D18: each seat negotiates from its OWN brief, authored by its own agent", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    const task = [...negotiationHost.tasks.values()][0]!;
    const ours = task.briefs[SOURCE_USER_ID];
    const theirs = task.briefs[CANDIDATE_USER_ID];
    // Two briefs, and the counterparty's is NOT the initiator's — before this
    // it read one column written from the initiator's DM and dossier, so it
    // argued the initiator's constraints as its own client's.
    expect(ours).toBeDefined();
    expect(theirs).toBeDefined();
    expect(theirs).not.toBe(ours);
    expect(judgment.seatBriefCalls).toHaveLength(1);
    // It was authored from what THAT side could see, not handed the other's.
    expect(judgment.seatBriefCalls[0]!.thread.length).toBeGreaterThan(0);
    // And a re-kick rewrites only the initiator's half.
    await negotiationHost.database.setNegotiationBrief(task.id, SOURCE_USER_ID, "a fresh brief");
    expect(negotiationHost.taskFor(task.id).briefs[CANDIDATE_USER_ID]).toBe(theirs);
  });

  test("D18: a seat authors its brief once, then reuses it", async () => {
    const judgment = new ScriptedJudgment(
      [() => [{ tool: "kickoff", reasoning: "Reaching out." }], () => [{ tool: "kickoff", reasoning: "Again." }]],
      (input) => (input.isOpening
        ? { verb: "outreach", message: `Opening on ${input.brief}`, reasoning: "Kickoff." }
        : { verb: "pause", reason: "needs_principal", payload: { question: "How soon?" } }),
    );
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    expect(judgment.seatBriefCalls).toHaveLength(1);
    const authored = [...negotiationHost.tasks.values()][0]!.briefs[CANDIDATE_USER_ID];

    // A later round re-kicks it; the counterparty's seat already has one.
    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: negotiationHost.round });

    expect(judgment.seatBriefCalls).toHaveLength(1);
    expect([...negotiationHost.tasks.values()][0]!.briefs[CANDIDATE_USER_ID]).toBe(authored);
  });

  test("D19: kickoff opens exactly the matches the agent decided from, and the rest wait", async () => {
    // Fifteen matches; the prompt showed twelve, so twelve are opened. The
    // other three are not lost and — crucially — do not trigger another wake,
    // or a large signal would kick off over and over inside one round.
    const counterparties = Array.from({ length: 15 }, (_, index) => `counterparty-${index}`);
    const judgment = new ScriptedJudgment([(context) => {
      expect(context.matches).toHaveLength(12);
      return [{ tool: "kickoff", reasoning: "Reaching out." }];
    }]);
    const { agent, negotiationHost, wakes } = buildCycle(judgment, counterparties);

    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(acted.acts.find((act) => act.tool === "kickoff")).toMatchObject({ opened: 12 });
    expect(negotiationHost.tasks.size).toBe(12);
    expect(judgment.briefCalls).toHaveLength(12);
    expect(wakes).toEqual([]);
  });

  test("D20: a kickoff still in flight is left alone; only a stale one is repaired", async () => {
    // Begun-and-unsettled says a kickoff STARTED, not that it died. Under the
    // staleness bound a concurrent turn — the inbox serializes per worker, and
    // the queue's own code contemplates several — must not settle a round
    // whose opens could still be landing.
    const judgment = new ScriptedJudgment([
      () => [{ tool: "kickoff", reasoning: "Reaching out." }],
      () => [{ tool: "kickoff", reasoning: "Concurrent turn." }],
      () => [{ tool: "kickoff", reasoning: "Much later." }],
    ]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const stamp = negotiationHost.database.stampIntentNegotiationRoundSize;
    let failStamp = true;
    negotiationHost.database.stampIntentNegotiationRoundSize = async (intentId, round, size) => {
      if (failStamp) throw new Error("stamp write failed");
      return stamp.call(negotiationHost.database, intentId, round, size);
    };

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    const stranded = negotiationHost.round;
    expect(negotiationHost.roundSize).toBeNull();
    // Decided in the meantime, so the later turns open nothing of their own
    // and the only thing that could move the round is the repair itself.
    negotiationHost.opportunities.get(OPPORTUNITY_ID)!.status = "rejected";

    const concurrent = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });
    expect(concurrent.error).toBeUndefined();
    expect(negotiationHost.round).toBe(stranded);      // no bump
    expect(negotiationHost.roundSize).toBeNull();      // and NOT settled out from under it
    expect(concurrent.acts.at(-1)).toEqual({ tool: "kickoff", round: stranded, opened: 0, reasoning: "Concurrent turn." });

    // Past the bound the same round reads as abandoned, and is repaired.
    failStamp = false;
    negotiationHost.ageKickoff();
    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(negotiationHost.roundSize).toBe(1);
    expect(negotiationHost.reflectJobs).toEqual([{ userId: SOURCE_USER_ID, intentId: INTENT_ID, round: stranded }]);
  });
});

describe("PersonalAgent — round-6: per-seat binding and the kickoff region", () => {
  const BOB_INTENT = "intent-bob-1";

  /**
   * The pair-dedup case. Opportunities appear in BOTH actors' match lists, so
   * whichever side kicks off second arrives at an existing task. Before
   * per-seat binding that second kickoff wrote its brief into the FIRST
   * seat's slot and stamped its own round over the first seat's — so one side
   * argued the other's constraints and the task belonged to neither round.
   */
  test("D18/D21: a second seat's kickoff binds its own signal and never touches the first's", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Alice reaching out." }]]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    // Bob's agent opened this negotiation first, for Bob's own signal.
    await negotiationHost.database.createNegotiationTask({
      conversationId: "conversation-bob",
      briefs: { [CANDIDATE_USER_ID]: "Bob's own brief, written by Bob's agent." },
      metadata: {
        type: "negotiation",
        opportunityId: OPPORTUNITY_ID,
        sourceUserId: CANDIDATE_USER_ID,
        candidateUserId: SOURCE_USER_ID,
        initiatorUserId: CANDIDATE_USER_ID,
        networkId: "network-1",
        seats: { [BOB_INTENT]: { userId: CANDIDATE_USER_ID, round: 7 } },
      },
    });

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    const task = [...negotiationHost.tasks.values()][0]!;
    // Alice's brief went to ALICE's slot; Bob's is untouched.
    expect(task.briefs[SOURCE_USER_ID]).toContain("Brief for");
    expect(task.briefs[CANDIDATE_USER_ID]).toBe("Bob's own brief, written by Bob's agent.");
    // Two bindings, side by side. Neither round overwrote the other, so the
    // task is in BOTH rounds rather than in neither.
    expect(task.metadata.seats[BOB_INTENT]).toEqual({ userId: CANDIDATE_USER_ID, round: 7 });
    expect(task.metadata.seats[INTENT_ID]).toEqual({ userId: SOURCE_USER_ID, round: negotiationHost.round });
    expect(await negotiationHost.database.getNegotiationTasksForIntentRound(BOB_INTENT, 7)).toHaveLength(1);
    expect(await negotiationHost.database.getNegotiationTasksForIntentRound(INTENT_ID, negotiationHost.round)).toHaveLength(1);
  });

  test("D21: a negotiation the counterparty opened is still decidable by BOTH agents", async () => {
    // The design doc's terminator rule — a side that wants out pauses
    // ready_for_verdict(reject) and ITS OWN IS-A rejects — needs the seat's
    // agent to be able to SEE the negotiation. Single ownership hid it.
    const judgment = new ScriptedJudgment([() => []]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    const task = await negotiationHost.database.createNegotiationTask({
      conversationId: "conversation-bob",
      briefs: {},
      metadata: {
        type: "negotiation",
        opportunityId: OPPORTUNITY_ID,
        sourceUserId: CANDIDATE_USER_ID,
        candidateUserId: SOURCE_USER_ID,
        initiatorUserId: CANDIDATE_USER_ID,
        networkId: "network-1",
        // Both seats have kicked this off for their own signals.
        seats: {
          [BOB_INTENT]: { userId: CANDIDATE_USER_ID, round: 7 },
          [INTENT_ID]: { userId: SOURCE_USER_ID, round: 1 },
        },
      },
    });
    await negotiationHost.database.updateNegotiationTaskState(task.id, "paused", {
      reason: "ready_for_verdict",
      pausedBy: CANDIDATE_USER_ID,
      payload: { recommendation: "reject", reasoning: "Not a fit." },
    });

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "all_paused", round: 1 });

    // Alice's agent sees it, so it can promote or reject it.
    expect(judgment.decideCalls.at(-1)!.paused.map((paused) => paused.negotiationId)).toEqual([task.id]);
  });

  test("D19: the agent is shown exactly what a kickoff would open", async () => {
    // Shown one list and opening another meant the agent was offered matches
    // a kickoff would skip and opened matches it had never been shown.
    const judgment = new ScriptedJudgment([(context) => {
      // The pending one is listed for the principal to accept, and is NOT a
      // kickoff target; the plain one is both.
      expect(context.matches.map((match) => match.opportunityId).sort()).toEqual([OPPORTUNITY_ID, SECOND_OPPORTUNITY_ID]);
      expect(context.kickoffTargets.map((match) => match.opportunityId)).toEqual([OPPORTUNITY_ID]);
      return [{ tool: "kickoff", reasoning: "Reaching out." }];
    }]);
    const { agent, negotiationHost } = buildCycle(judgment, [CANDIDATE_USER_ID, "carol"]);
    negotiationHost.opportunities.get(SECOND_OPPORTUNITY_ID)!.status = "pending";

    await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(judgment.briefCalls.map((call) => call.opportunityId)).toEqual([OPPORTUNITY_ID]);
    expect(negotiationHost.tasks.size).toBe(1);
  });

  test("D22: a failed open is recorded and never leaves the round unsettleable", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID, "carol"]);
    // The brief for the second match never generates: no invoke ran, so there
    // is no task for the compensation to find and the match would otherwise
    // vanish from the turn entirely.
    const brief = judgment.brief.bind(judgment);
    judgment.brief = async (context, input) => {
      if (input.match.opportunityId === SECOND_OPPORTUNITY_ID) throw new Error("brief model down");
      return brief(context, input);
    };

    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(acted.error).toBeUndefined();
    expect(negotiationHost.tasks.size).toBe(1);
    // The round still settles on what DID open, so it can still reflect.
    expect(negotiationHost.roundSize).toBe(1);
    expect(negotiationHost.reflectJobs).toHaveLength(1);
    // And the loss is on the record, not silent.
    expect(principal.ledgerRows.some((row) => typeof row.act.reasoning === "string"
      && row.act.reasoning.includes("Could not open 1 of 2"))).toBe(true);
  });

  test("D22: after the round bump nothing throws — the strategy is never re-sent", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    // Every post-bump write fails: the compensation lookup, the round tasks
    // read, the stamp and the reflect enqueue.
    negotiationHost.database.stampIntentNegotiationRoundSize = async () => { throw new Error("stamp down"); };
    negotiationHost.database.getNegotiationTasksForIntentRound = async () => { throw new Error("read down"); };

    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(acted.error).toBeUndefined();
    expect(acted.acts.map((act) => act.tool)).toEqual(["message_user", "kickoff"]);
    expect(negotiationHost.tasks.size).toBe(1);
    expect(principal.dmMessages).toHaveLength(1); // one strategy, never two
  });

  test("F3: a strategy the prose gate keeps refusing falls back instead of losing the wake", async () => {
    const judgment = new ScriptedJudgment([() => [{ tool: "kickoff", reasoning: "Reaching out." }]]);
    const { agent, negotiationHost, principal } = buildCycle(judgment, [CANDIDATE_USER_ID]);
    let strategyAttempts = 0;
    judgment.strategy = async () => { strategyAttempts += 1; throw new Error("prose refused"); };

    const acted = await agent.invoke({ userId: SOURCE_USER_ID, intentId: INTENT_ID, event: "matches_ready" });

    expect(strategyAttempts).toBe(2);            // retried, like every other stage
    expect(acted.error).toBeUndefined();          // and never lost the wake
    expect(principal.dmMessages.at(0)!.content).toBe(PERSONAL_AGENT_STRATEGY_FALLBACK);
    expect(negotiationHost.tasks.size).toBe(1);   // the round still opened
  });
});
