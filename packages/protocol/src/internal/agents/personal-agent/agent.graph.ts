/**
 * AgentGraph — one PersonalAgent, three scopes, routed on the shape of its
 * input (docs/plans/2026-08-23-personal-agent-and-negotiation-graphs.md).
 *
 * The cycle this graph runs:
 *
 *   discovery persists matches ──► matches_ready ──► kickoff
 *     (may ask first) → strategy into the DM → one brief per match in
 *     parallel → open ALL of them. No selection at kickoff: the negotiator
 *     filters by negotiating, IS-A judges at reflect where it has turns to
 *     judge on.
 *
 *   every negotiation of the round paused ──► all_paused ──► reflect
 *     phase 1 ASK: the questions the principal must answer, merged across
 *     negotiations. If there are none, phase 2 ACT: reject / promote /
 *     re-kick the rest with fresh briefs. Verdicts NEVER execute in phase 1.
 *
 *   the principal wrote ──► user_message ──► a DM turn that can also ACT,
 *     because answers to the reflect questions arrive as ordinary messages.
 *
 * `matches_ready` and `all_paused` are ONE node — "look at the state, maybe
 * ask, else act" — differing only in what ACT does. Judgment lives in the
 * prompt; this file is effects, and every effect leaves a ledger row.
 */
import { END, StateGraph, Annotation } from "@langchain/langgraph";

import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { turnsWithSenders, type NegotiationAuthoredTurn } from "../../negotiations/negotiation.turn.js";
import type { NegotiationTaskRow } from "../../../platform/database/negotiation.js";
import { PersonalAgentModel } from "./agent.judgment.js";
import type { PersonalAgentDecidedAct, PersonalAgentDeps, PersonalAgentExecutedAct, PersonalAgentInput, PersonalAgentIntentEventKind, PersonalAgentMatch, PersonalAgentPausedNegotiation, PersonalAgentReply, PersonalAgentReplyFallbackReason, PersonalAgentResult, PersonalAgentScope, PersonalAgentThreadEntry, PersonalAgentTurnContext } from "./agent.types.js";

const logger = protocolLogger("PersonalAgentGraph");

/** How much conversation memory a turn reads. */
const MAX_DM_MESSAGES = 20;
const MAX_LEDGER_ACTS = 20;
/**
 * How many matches a turn sees, newest kept — a prolific signal must not
 * flood the prompt, and kickoff opens exactly the set the agent decided from
 * (D19). What is over the cap waits for the next round, which is what rounds
 * are for.
 */
const MAX_MATCHES = 12;

/**
 * How many opens run at once. A negotiation self-plays several model turns
 * inside its own invoke, so twelve at once is twelve concurrent conversations
 * plus twelve briefs — past the chat controller's wait and into provider rate
 * limits, whose failures then land in `compensateFailedOpen`.
 */
const KICKOFF_CONCURRENCY = 3;

/**
 * How long a round may be "begun" before a later turn treats it as abandoned
 * rather than in flight (D20). Comfortably longer than any real kickoff and
 * far shorter than a stuck one matters. Under it, a concurrent turn — the
 * inbox serializes per worker, but the queue's own code contemplates several
 * — leaves the round alone instead of settling it out from under the turn
 * still opening it.
 */
const KICKOFF_STALE_AFTER_MS = 10 * 60 * 1000;

/** Attempts for a post-bump write before it is given up on loudly (D54). */
const POST_BUMP_WRITE_ATTEMPTS = 3;
const POST_BUMP_WRITE_RETRY_MS = 100;

/** Runs `work` over `items` with at most `limit` in flight, settling every one. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const runner = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await Promise.allSettled([work(items[index]!, index)]).then(([settled]) => settled!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

/**
 * A match already promoted to the principal's decision queue is theirs to
 * decide, not a table to reopen; a negotiation that spent its turn budget
 * cannot produce another substantive turn, so re-opening it would only
 * re-pause and re-trigger reflect forever.
 */
const NOT_KICKOFF_ELIGIBLE_STATUSES = new Set(["pending"]);

/**
 * Fixed honest copy delivered when the reply stage could not produce prose
 * that passes the safety gate, or the reply model call itself failed.
 * Server-owned, never model text: the acts the turn executed are durable
 * either way, so the copy says that instead of pretending nothing happened.
 */
export const PERSONAL_AGENT_REPLY_FALLBACK =
  "I acted on your message and everything I did is recorded, but I could not compose a clean reply just now. "
  + "Ask me where things stand and I will lay it out.";

// ─── State ───────────────────────────────────────────────────────────────────

const PersonalAgentGraphState = Annotation.Root({
  input: Annotation<PersonalAgentInput>({ reducer: (c, n) => n ?? c, default: () => ({} as PersonalAgentInput) }),
  scope: Annotation<PersonalAgentScope>({ reducer: (c, n) => n ?? c, default: () => "global" }),
  phase: Annotation<"intent" | "negotiation" | "error" | "done">({ reducer: (c, n) => n ?? c, default: () => "error" }),
  result: Annotation<PersonalAgentResult | null>({ reducer: (c, n) => n ?? c, default: () => null }),
  error: Annotation<string | null>({ reducer: (c, n) => n ?? c, default: () => null }),
});

type PersonalAgentState = typeof PersonalAgentGraphState.State;

// ─── Routing ─────────────────────────────────────────────────────────────────

function routeNode(state: PersonalAgentState): Partial<PersonalAgentState> {
  const input = state.input;
  if ("negotiationId" in input) return { scope: "negotiation", phase: "negotiation" };
  if ("event" in input) return { scope: "intent", phase: "intent" };
  return {
    scope: "global",
    phase: "error",
    error: "PersonalAgent global scope is not implemented; invoke with an intentId",
  };
}

// ─── Context assembly ────────────────────────────────────────────────────────

/** One negotiation's messages, as a thread relative to the reading seat. */
function threadFromMessages(
  messages: Array<{ senderId: string; parts: unknown[] }>,
  seatUserId: string,
): PersonalAgentThreadEntry[] {
  return turnsWithSenders(messages).map(({ senderId, turn }) => ({
    speaker: (senderId === `agent:${seatUserId}` ? "own" : "counterparty") as "own" | "counterparty",
    turn,
  }));
}

/** Turn one negotiation task's messages into a speaker-relative thread. */
async function loadThread(
  deps: PersonalAgentDeps,
  taskId: string,
  seatUserId: string,
): Promise<PersonalAgentThreadEntry[]> {
  return threadFromMessages(await deps.negotiationDatabase.getNegotiationMessages(taskId), seatUserId);
}

/**
 * Every paused negotiation of this signal, as IS-A reads them.
 *
 * Signal-scoped, not round-scoped. Being spent (`turn_cap`) makes a
 * negotiation ineligible for RE-KICK; it must not also make it invisible.
 * Those are two different properties, and conflating them meant a table a
 * later round left behind could never be promoted or rejected — its
 * opportunity sat `negotiating` forever and its principal never heard an
 * outcome.
 *
 * The pause PAYLOAD is private to the seat that paused: a counterparty's
 * question or recommendation is theirs to hand to their own principal, not
 * ours to read. Only the reason crosses.
 */
async function loadPaused(
  deps: PersonalAgentDeps,
  userId: string,
  intentId: string,
): Promise<PersonalAgentPausedNegotiation[]> {
  const paused = await deps.negotiationDatabase.getPausedNegotiationTasksForIntent(intentId);
  return Promise.all(paused.map(async (task: NegotiationTaskRow) => {
    const pausedByUs = task.metadata.pause?.pausedBy === userId;
    return {
      negotiationId: task.id,
      opportunityId: task.metadata.opportunityId,
      reason: task.metadata.pause?.reason ?? "unknown",
      ...(pausedByUs && task.metadata.pause?.payload !== undefined ? { payload: task.metadata.pause.payload } : {}),
      pausedByUs,
      thread: await loadThread(deps, task.id, userId),
    };
  }));
}

async function assembleContext(
  deps: PersonalAgentDeps,
  input: Extract<PersonalAgentInput, { event: PersonalAgentIntentEventKind }>,
): Promise<PersonalAgentTurnContext> {
  const { userId, intentId } = input;

  // Only ONE read here degrades, and only because a display name is not what
  // any of these turns is about. Every other read IS the subject of the turn:
  // a matches_ready that cannot see its matches, or an all_paused that cannot
  // see its paused negotiations, must FAIL and be retried — swallowed, it
  // becomes a successful turn that saw nothing, decided nothing, and (for
  // reflect) permanently consumed its once-per-round job id.
  const [agentName, intent, allMatches, paused, dossier, recentActs] = await Promise.all([
    deps.identity.readAgentName(userId).catch(() => null),
    deps.negotiationDatabase.getIntent(intentId),
    deps.opportunities.readMatches(userId, intentId),
    loadPaused(deps, userId, intentId),
    deps.dossier.readActiveEntries(userId, intentId),
    deps.ledger.readRecent(userId, intentId, MAX_LEDGER_ACTS),
  ]);

  // The DM may legitimately not exist yet — a background event can fire before
  // the principal ever opened this signal's conversation — and THAT reads as
  // an empty transcript. A read that fails does not: the conversation is the
  // agent's memory, and a turn that silently forgot everything would answer
  // from nothing.
  const sessionId = input.event === "user_message"
    ? input.sessionId
    : (await deps.conversation.findSession(userId, intentId))?.id;
  const recentDm = sessionId
    ? (await deps.conversation.getMessages(sessionId))
      .slice(-MAX_DM_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content }))
    : [];

  // Bounded, keeping the newest: the agent's numbers are context-relative and
  // its validator resolves them to ids, so truncation renumbers nothing.
  const matches = allMatches.slice(-MAX_MATCHES);
  // The kickoff targets are computed HERE, once, from that same bounded list —
  // never re-derived later from a second read. Shown one set and opening
  // another meant the agent was offered matches a kickoff would skip and
  // opened matches it had never been shown, and the divergence was invisible
  // to the end-of-turn re-check, which believed everything was accounted for.
  // The full `matches` list stays for what the PRINCIPAL may act on: a match
  // waiting on their decision is not kickoff-able, but it is exactly what
  // `accept_opportunity` is for.
  const eligibility = await Promise.all(matches.map(async (match) => ({
    match,
    eligible: !match.awaitingIntroducerApproval
      && !NOT_KICKOFF_ELIGIBLE_STATUSES.has(match.status)
      && !(await spentItsTurnBudget(deps, match)),
  })));
  const kickoffTargets = eligibility.filter((entry) => entry.eligible).map((entry) => entry.match);
  const name = agentName?.trim();
  return {
    userId,
    intentId,
    event: input.event,
    ...(input.event === "user_message"
      ? { message: { text: input.text, sessionId: input.sessionId, messageId: input.messageId } }
      : {}),
    ...(input.event === "all_paused" ? { round: input.round } : {}),
    ...(name ? { agentName: name } : {}),
    signalText: intent ? (intent.summary ?? intent.payload ?? null) : null,
    matches,
    kickoffTargets,
    // Every undecided match as this turn read it — including the ones the
    // display cap held back. The re-check compares against THIS, or a signal
    // with more matches than a round opens would read its own remainder as
    // new arrivals and wake itself for them, round after round.
    knownMatchIds: allMatches.map((match) => match.opportunityId),
    paused,
    dossier,
    recentDm,
    recentActs,
  };
}

// ─── Effects ─────────────────────────────────────────────────────────────────

async function appendLedger(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  act: PersonalAgentExecutedAct,
): Promise<void> {
  await deps.ledger.append({
    userId: context.userId,
    intentId: context.intentId,
    event: { kind: context.event, ...(context.round !== undefined ? { round: context.round } : {}) },
    act: act as unknown as Record<string, unknown>,
  });
}

async function deliverMessage(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  text: string,
  options?: string[],
): Promise<{ sessionId: string; messageId: string } | null> {
  const resolved = await deps.conversation.resolveSession(context.userId, context.intentId);
  if ("error" in resolved) {
    // 4xx is permanent for this scope (archived or foreign signal): there is
    // no conversation to speak into and never will be. 5xx retries.
    if (resolved.status >= 500) throw new Error(`Signal conversation resolution failed: ${resolved.error}`);
    logger.warn("PersonalAgent message undeliverable", {
      userId: context.userId,
      intentId: context.intentId,
      status: resolved.status,
      error: resolved.error,
    });
    return null;
  }
  const messageId = await deps.conversation.addMessage({
    sessionId: resolved.session.id,
    role: "assistant",
    content: text,
    ...(options ? { options } : {}),
  });
  return { sessionId: resolved.session.id, messageId };
}

interface TurnAccumulator {
  acts: PersonalAgentExecutedAct[];
  messages: string[];
}

async function say(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  tool: "message_user" | "ask",
  text: string,
  options?: string[],
): Promise<void> {
  const delivered = await deliverMessage(deps, context, text, options);
  if (!delivered) return;
  const executed: PersonalAgentExecutedAct = {
    tool,
    text,
    ...(options ? { options } : {}),
    ...delivered,
  };
  // Guarded, like every other post-delivery ledger write: the message is on
  // the principal's screen, and failing the turn over the accountability row
  // would retry it into a second copy of the same message.
  await ledgerOrLog(deps, context, executed);
  accumulator.acts.push(executed);
  accumulator.messages.push(text);
}

/**
 * Append a ledger row for work that is already done. NEVER throws: an
 * unrecorded act is bad, a duplicated one is worse, and everything that calls
 * this has already had its effect.
 */
async function ledgerOrLog(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  executed: PersonalAgentExecutedAct,
): Promise<void> {
  try {
    await appendLedger(deps, context, executed);
  } catch (err) {
    logger.error("Failed to ledger an executed act", { intentId: context.intentId, tool: executed.tool, error: err });
  }
}

/**
 * Fixed, server-owned copy for a kickoff that has no one to reach out to.
 * A background turn has no reply stage behind it, so without this the
 * principal is told nothing at all and — with no negotiation left active and
 * the round's reflect job retained forever — nothing can wake the agent for
 * this signal again.
 */
export const PERSONAL_AGENT_NOTHING_TO_OPEN =
  "There is nothing new for me to put to anyone on this signal right now — what I have is either "
  + "waiting on your decision or has run as far as it can. Tell me if you want me to change tack.";

/**
 * Fixed, server-owned copy for a background turn that decided nothing at all.
 *
 * The doc's node is "look at the state, maybe ask, else act" — deciding
 * NEITHER is not a state that contract has. It is reachable anyway (the model
 * can return an empty act list), and on a background event there is no reply
 * stage behind it, so the turn would end in silence: for reflect that also
 * consumes the round's one retained job, and the signal is never heard from
 * again. Saying this keeps the loop reachable — the principal's next message
 * is an ordinary `user_message` turn that can ask or act.
 */
export const PERSONAL_AGENT_NO_NEXT_STEP =
  "I looked at where this signal stands and I do not have a next step for it right now. "
  + "Tell me how you would like to proceed and I will pick it up.";

export const PERSONAL_AGENT_NO_MATCHES_YET =
  "Nothing has come up for this signal yet. I will pick it up as soon as it does.";

/**
 * Fixed, server-owned strategy copy. Used only when the model could not write
 * one the prose gate would pass, twice — the principal still learns that the
 * agent is about to reach out, and the round still opens.
 */
export const PERSONAL_AGENT_STRATEGY_FALLBACK =
  "I am reaching out to this signal's matches now. I could not write up my plan cleanly just "
  + "this once — ask me what I am putting to them and I will lay it out.";

/**
 * Kickoff / re-kick: the ACT both event turns can reach.
 *
 * Strategy into the DM first (the principal sees and can correct the plan),
 * then ONE BRIEF PER MATCH IN PARALLEL, then every match opened together.
 * A round is opened by the bump — which stamps `kickoffStartedAt` in the same
 * write — and SETTLED once its opens are done: the all-paused check runs on
 * both sides of the size stamp. Until it settles, a pause-driven check is a
 * no-op, so an early pause cannot dedupe away the round's genuine reflect.
 *
 * ONE POST-BUMP POLICY (D54): once the round is bumped, this turn has done
 * irreversible, principal-visible work — a strategy message and a new round —
 * so NOTHING below it throws. Every failure is logged, ledgered and carried
 * past; a retry would only produce a second strategy message and a second
 * round. A round left unsettled by such a failure is recovered by the
 * interrupted-round repair (D53), which exists for exactly that.
 *
 * Before the bump the opposite holds: those failures are safe to retry, so
 * they propagate.
 */
async function runKickoff(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  reasoning: string,
): Promise<void> {
  const judgment = deps.judgment ?? defaultJudgment();

  const lifecycle = await deps.negotiationDatabase.getIntentNegotiationRound(context.intentId);
  const interruptedRound = lifecycle.kickoffStartedAt
    && lifecycle.roundSize === null
    && Date.now() - lifecycle.kickoffStartedAt.getTime() >= KICKOFF_STALE_AFTER_MS
    ? lifecycle.round
    : null;

  // Exactly the set the agent was shown, minus anything THIS turn resolved a
  // moment ago — a promote or reject completed that negotiation, and opening
  // it again would create a second one. No re-read: a second, separately
  // filtered list is how the shown set and the opened set drifted apart.
  const resolvedHere = new Set(accumulator.acts
    .filter((act): act is Extract<PersonalAgentExecutedAct, { tool: "promote" | "reject" }> =>
      (act.tool === "promote" || act.tool === "reject") && act.outcome === "resolved")
    .map((act) => act.opportunityId));
  const matches = context.kickoffTargets.filter((match) => !resolvedHere.has(match.opportunityId));

  // A round a kickoff began and never finished has to be settled, and BEFORE
  // this turn bumps: the size stamp is guarded on the intent's current round,
  // so once the counter moves that round can never be stamped again.
  let repairedRound: number | null = null;
  if (interruptedRound !== null) {
    logger.warn("Repairing a kickoff that did not finish its round", { intentId: context.intentId, round: interruptedRound });
    const settled = await settleRound(deps, context, interruptedRound, { triggerReflect: matches.length === 0 });
    if (settled > 0 && matches.length > 0) repairedRound = interruptedRound;
  }

  if (matches.length === 0) {
    // Say so. A background turn has no reply stage, and with nothing active
    // and the reflect job retained forever, silence here ends the cycle for
    // this signal with the principal never told.
    if (context.event !== "user_message") {
      await say(deps, context, accumulator, "message_user",
        context.matches.length === 0 ? PERSONAL_AGENT_NO_MATCHES_YET : PERSONAL_AGENT_NOTHING_TO_OPEN);
    }
    await recordKickoff(deps, context, accumulator, { tool: "kickoff", round: lifecycle.round, opened: 0, reasoning });
    // Runs on this path too: it is the authoritative recovery for a batch the
    // inbox could not coalesce, and a turn with nothing to open is exactly
    // when a batch that landed mid-turn would otherwise be waited on forever.
    await wakeForNewMatches(deps, context);
    return;
  }

  // Pre-bump: nothing irreversible has happened, so a failure here is safe to
  // retry and propagates. The strategy itself falls back rather than throwing
  // — losing a whole wake because the prose gate disliked one sentence, three
  // times over an identical prompt, is not a trade worth making.
  const strategy = await strategyOrFallback(judgment, context);
  await say(deps, context, accumulator, "message_user", strategy);

  const round = await deps.negotiationDatabase.bumpIntentNegotiationRound(context.intentId);
  // ─── from here down, nothing throws (D54) ───────────────────────────────
  const threadByOpportunity = new Map(context.paused.map((paused) => [paused.opportunityId, paused.thread]));

  const opens = await mapWithConcurrency(matches, KICKOFF_CONCURRENCY, async (match) => {
    const brief = await judgment.brief(context, {
      match,
      strategy,
      thread: threadByOpportunity.get(match.opportunityId) ?? [],
    });
    const result = await deps.negotiations.invoke({
      opportunityId: match.opportunityId,
      brief,
      intentId: context.intentId,
      round,
    });
    if (result.status === "error") throw new Error(result.error ?? "Negotiation open failed");
    return result;
  });

  const failed: PersonalAgentMatch[] = [];
  for (const [index, open] of opens.entries()) {
    if (open.status !== "rejected") continue;
    const match = matches[index]!;
    failed.push(match);
    await compensateFailedOpen(deps, context, match, round, open.reason);
  }
  if (failed.length > 0) {
    // Recorded, not silent: a brief that never generated leaves no task for
    // the compensation to find, so without this the match would simply vanish
    // from the turn — and from the re-check, which believes every target is
    // accounted for.
    await ledgerOrLog(deps, context, {
      tool: "kickoff",
      round,
      opened: 0,
      reasoning: `Could not open ${failed.length} of ${matches.length} match(es) this round.`,
    });
  }

  const opened = await settleRound(deps, context, round, { triggerReflect: true });
  if (opened === 0 && repairedRound !== null) await triggerRoundReflect(deps, context, repairedRound);
  await recordKickoff(deps, context, accumulator, { tool: "kickoff", round, opened, reasoning });
  if (opened > 0) await wakeForNewMatches(deps, context);
}

/**
 * The strategy, or fixed copy. Retried like every other model stage, and it
 * does NOT throw: the prose gate rejects on claim families that ordinary
 * scheduling language ("approach all three at the same time") trips, and a
 * throw here loses the wake terminally after three attempts against an
 * identical prompt.
 */
async function strategyOrFallback(
  judgment: NonNullable<PersonalAgentDeps["judgment"]>,
  context: PersonalAgentTurnContext,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await judgment.strategy(context);
    } catch (err) {
      logger.warn("Strategy rejected or unavailable", { intentId: context.intentId, attempt: attempt + 1, error: err });
    }
  }
  return PERSONAL_AGENT_STRATEGY_FALLBACK;
}

/**
 * A failed open may still have left a live negotiation behind — `init`
 * creates (or re-rounds) the task before a turn is ever authored. Left
 * `working`, it holds the round's active count above zero forever and the
 * round never reflects. Pause it through the graph's own sink, with the
 * reason that is actually true:
 *
 * - nothing was ever said → `open_failed`. The next speaker is our own
 *   initiating seat, so the pause is recorded against us, which is right: we
 *   are the ones who failed to open it.
 * - the thread already has turns → `counterparty_silent`, the same reason the
 *   stale-negotiation watchdog would give this exact shape hours later. The
 *   negotiation really did stop mid-flight with someone owing a turn; calling
 *   that `open_failed` would tell the principal nothing had been said when
 *   outreach is sitting in the thread, and would blame the seat that owes the
 *   next turn for a failure that was not theirs.
 */
async function compensateFailedOpen(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  match: PersonalAgentMatch,
  round: number,
  failure: unknown,
): Promise<void> {
  logger.warn("PersonalAgent kickoff open failed", { intentId: context.intentId, round, error: failure });
  // Post-bump: a read that fails here must not fail the turn either.
  const task = await deps.negotiationDatabase.getNegotiationTaskForOpportunity(match.opportunityId).catch((err: unknown) => {
    logger.error("Could not look up a failed open's task", { opportunityId: match.opportunityId, error: err });
    return null;
  });
  if (!task || task.state !== "working" || task.metadata.seats[context.intentId]?.round !== round) return;
  const spoke = (await deps.negotiationDatabase.getNegotiationMessages(task.id).catch(() => [])).length > 0;
  const result = await deps.negotiations.invoke({
    negotiationId: task.id,
    pause: spoke ? "counterparty_silent" : "open_failed",
  });
  if (result.status !== "paused") {
    // Left live, this task holds its round open — but the round bump has
    // already happened, so throwing would retry the whole turn into a second
    // strategy message and a second round (D54). Recorded instead: the round
    // stays unsettled, and the interrupted-round repair picks it up.
    logger.error("Could not pause a stranded negotiation", {
      negotiationId: task.id,
      outcome: result.error ?? result.status,
    });
  }
}

/**
 * Settle a round: run its all-paused check and stamp its size. Returns how
 * many negotiations the round actually holds — zero means there is nothing to
 * settle, and the round is deliberately left unstamped, because a settled
 * empty round is instantly "all paused" and reflect would kick off again,
 * forever.
 *
 * The SIZE is read back from the database rather than counted from the opens:
 * a compensated task and a re-kicked task that `init` had already moved into
 * this round both belong to it, and only the database knows which survived.
 * The value is a record; what gates a pause-driven check is that it is no
 * longer null.
 *
 * The all-paused check runs on BOTH sides of the stamp, and the enqueue is
 * allowed to throw. Before, so that a failed enqueue leaves the round
 * unstamped and therefore still findable by the repair path above — retryable
 * rather than a settled round nothing will ever reflect on. After, because a
 * negotiation that pauses in between gets nothing otherwise: its own
 * pause-side check bailed on the still-null stamp, and this one had already
 * counted. The enqueue is keyed by (signal, round), so running it twice is
 * one job either way.
 */
async function settleRound(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  round: number,
  options: { triggerReflect: boolean },
): Promise<number> {
  const tasks = await deps.negotiationDatabase.getNegotiationTasksForIntentRound(context.intentId, round)
    .catch((err: unknown) => {
      logger.error("Could not read a round's tasks to settle it", { intentId: context.intentId, round, error: err });
      return [] as NegotiationTaskRow[];
    });
  if (tasks.length === 0) return 0;

  if (options.triggerReflect) await triggerRoundReflect(deps, context, round);
  // Retried, then given up on loudly: this is the one post-bump write whose
  // loss matters, and it must not throw (D54). An unstamped round is not
  // lost — the interrupted-round repair settles it once it goes stale.
  await retryWrite(
    () => deps.negotiationDatabase.stampIntentNegotiationRoundSize(context.intentId, round, tasks.length),
    "stamp a round's size",
    { intentId: context.intentId, round },
  );
  // The window the stamp opens: anything that paused since the count above saw
  // a null stamp and bailed, and would be waited on forever.
  if (options.triggerReflect) await triggerRoundReflect(deps, context, round);
  return tasks.length;
}

/** Three attempts, then an error log. Never throws — see D54. */
async function retryWrite(
  write: () => Promise<void>,
  what: string,
  detail: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < POST_BUMP_WRITE_ATTEMPTS; attempt++) {
    try {
      await write();
      return;
    } catch (err) {
      if (attempt === POST_BUMP_WRITE_ATTEMPTS - 1) {
        logger.error(`Failed to ${what}`, { ...detail, error: err });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POST_BUMP_WRITE_RETRY_MS * (attempt + 1)));
    }
  }
}

/** Enqueue this round's reflect if every negotiation in it has stopped. */
async function triggerRoundReflect(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  round: number,
): Promise<void> {
  const enqueue = deps.reflectEnqueue;
  if (!enqueue) return;
  await retryWrite(async () => {
    const active = await deps.negotiationDatabase.countActiveNegotiationsForRound(context.intentId, round);
    if (active !== 0) return;
    await enqueue({ userId: context.userId, intentId: context.intentId, round });
  }, "enqueue a round's reflect", { intentId: context.intentId, round });
}

/**
 * A discovery batch that lands WHILE this turn is running is read past: the
 * match list was assembled at the top of the turn. The inbox coalesces such a
 * batch onto a follow-up job, but that add races the turn going active, so
 * this is the authoritative recovery — a match that exists, is undecided and
 * has no negotiation at all, and was NOT in the set this turn read at its
 * start, wakes the agent again. Matches merely held back by the round's cap
 * were in that set, so they are not new — the next round picks them up.
 *
 * This is also the authoritative recovery for a batch the inbox's two-slot
 * coalescing could not take (its check-then-add is not atomic), which is why
 * it runs whatever the kickoff opened. It cannot loop: a target that failed to open is
 * compensated into a task, so it is never "unopened" on the next pass.
 *
 * Best-effort by design, and it runs last: the round is already settled, so a
 * failure here delays a batch rather than losing the turn's real work.
 */
async function wakeForNewMatches(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
): Promise<void> {
  if (!deps.wakeForMatches) return;
  try {
    const known = new Set(context.knownMatchIds);
    const arrivals = (await deps.opportunities.readMatches(context.userId, context.intentId))
      .filter((match) => !known.has(match.opportunityId))
      .filter((match) => !match.awaitingIntroducerApproval)
      .filter((match) => !NOT_KICKOFF_ELIGIBLE_STATUSES.has(match.status));
    const unopened = await Promise.all(arrivals.map(async (match) =>
      (await deps.negotiationDatabase.getNegotiationTaskForOpportunity(match.opportunityId)) ? null : match));
    if (!unopened.some((match) => match !== null)) return;
    logger.info("Waking again for matches that arrived during this turn", { intentId: context.intentId });
    await deps.wakeForMatches({ userId: context.userId, intentId: context.intentId });
  } catch (err) {
    logger.warn("Failed to re-check for newly arrived matches", { intentId: context.intentId, error: err });
  }
}

/**
 * Record a kickoff act. A ledger failure is logged, never thrown: the round
 * is already open, and failing the turn over an accountability row would
 * retry it into a second strategy message and a second round.
 */
async function recordKickoff(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  executed: Extract<PersonalAgentExecutedAct, { tool: "kickoff" }>,
): Promise<void> {
  await ledgerOrLog(deps, context, executed);
  accumulator.acts.push(executed);
}

/**
 * A table whose turn budget is spent cannot produce another substantive turn:
 * re-opening it only re-pauses on the cap, and that pause re-triggers reflect,
 * which kicks off again. This is the cycle's termination guarantee, so it
 * reads the negotiation's OWN state rather than this round's paused set — a
 * negotiation that capped in an earlier round and was excluded from the last
 * kickoff carries that earlier round in its metadata and is absent from the
 * current round entirely. An unreadable task is NOT treated as eligible: a
 * swallowed read here re-opens exactly what the guarantee exists to stop.
 */
async function spentItsTurnBudget(deps: PersonalAgentDeps, match: PersonalAgentMatch): Promise<boolean> {
  const task = await deps.negotiationDatabase.getNegotiationTaskForOpportunity(match.opportunityId);
  return task?.state === "paused" && task.metadata.pause?.reason === "turn_cap";
}

/**
 * Execute one decided act. Kickoff is not handled here — it runs last, after
 * every verdict, so it reads statuses the verdicts already moved.
 */
async function executeAct(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  act: Exclude<PersonalAgentDecidedAct, { tool: "kickoff" }>,
): Promise<void> {
  switch (act.tool) {
    case "message_user":
    case "ask":
      await say(deps, context, accumulator, act.tool, act.text, act.options);
      return;
    case "promote":
    case "reject": {
      // `judgment` is a documented swap seam, so this id is only as bounded as
      // whatever produced it. A ref that names nothing skips with a ledgered
      // failure rather than throwing mid-turn, which would abandon the acts
      // already executed above it and retry them all.
      const paused = context.paused.find((entry) => entry.negotiationId === act.negotiationId);
      if (!paused) {
        logger.warn("Decided a verdict on a negotiation this turn cannot see", {
          intentId: context.intentId,
          negotiationId: act.negotiationId,
        });
        const missing: PersonalAgentExecutedAct = {
          tool: act.tool,
          negotiationId: act.negotiationId,
          opportunityId: "",
          reasoning: act.reasoning,
          outcome: "error",
        };
        await ledgerOrLog(deps, context, missing);
        accumulator.acts.push(missing);
        return;
      }
      const result = await deps.negotiations.invoke({
        negotiationId: act.negotiationId,
        verdict: act.tool === "promote" ? "pending" : "reject",
        reasoning: act.reasoning,
      });
      const executed: PersonalAgentExecutedAct = {
        tool: act.tool,
        negotiationId: act.negotiationId,
        opportunityId: paused.opportunityId,
        reasoning: act.reasoning,
        outcome: result.status === "resolved" ? "resolved" : "error",
      };
      await ledgerOrLog(deps, context, executed);
      accumulator.acts.push(executed);
      return;
    }
    case "accept_opportunity": {
      // The principal's own explicit word, executing through the host's
      // untouched owner path. Nothing here re-decides explicitness: that law
      // is the prompt's.
      const outcome = await deps.opportunities.accept(context.userId, {
        intentId: context.intentId,
        opportunityId: act.opportunityId,
        ...(act.reason ? { reason: act.reason } : {}),
      });
      const executed: PersonalAgentExecutedAct = {
        tool: "accept_opportunity",
        opportunityId: act.opportunityId,
        outcome: outcome.status,
        ...(outcome.counterparty ? { counterparty: outcome.counterparty } : {}),
        ...(act.reason ? { reason: act.reason } : {}),
      };
      await ledgerOrLog(deps, context, executed);
      accumulator.acts.push(executed);
      return;
    }
    case "note_dossier": {
      const entryId = await deps.dossier.addEntry({
        userId: context.userId,
        intentId: context.intentId,
        text: act.text,
        source: "agent_note",
      });
      const executed: PersonalAgentExecutedAct = { tool: "note_dossier", text: act.text, entryId };
      await ledgerOrLog(deps, context, executed);
      accumulator.acts.push(executed);
      return;
    }
    case "retire_dossier": {
      const retired = await deps.dossier.retireEntry({ userId: context.userId, entryId: act.entryId });
      const executed: PersonalAgentExecutedAct = { tool: "retire_dossier", entryId: act.entryId, retired };
      await ledgerOrLog(deps, context, executed);
      accumulator.acts.push(executed);
      return;
    }
  }
}

/**
 * The reply stage: a principal-message turn always ends with the agent's
 * conversational reply — a second model call over the same context plus the
 * just-executed acts, checked BEFORE it is persisted or a chunk leaves the
 * host. A reply the model could not produce safely becomes the fixed
 * fallback copy, and the failure is ledgered on the act — never a thrown
 * error: the acts already executed, and re-running them to retry prose would
 * trade a wording problem for duplicate effects.
 */
async function runReplyStage(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
): Promise<void> {
  const judgment = deps.judgment ?? defaultJudgment();
  let composed: PersonalAgentReply | null = null;
  let fallback: PersonalAgentReplyFallbackReason | undefined;
  try {
    composed = await judgment.reply(context, accumulator.acts);
    if (composed === null) fallback = "safety_check_failed";
  } catch (err) {
    logger.error("PersonalAgent reply stage failed", {
      userId: context.userId,
      intentId: context.intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    fallback = "model_error";
  }

  const content = composed?.text ?? PERSONAL_AGENT_REPLY_FALLBACK;
  const options = composed?.options;
  // Everything below is guarded, because the file's contract for this stage —
  // "never a thrown error" — has to be true of the whole stage, not just the
  // model call. The turn's acts are already executed and durable; letting a
  // delivery or ledger blip out of here fails the job, and the retry
  // re-decides and re-executes every verdict and kickoff on top of a reply
  // the principal may already be reading.
  let delivered: { sessionId: string; messageId: string } | null = null;
  try {
    delivered = await deliverMessage(deps, context, content, options);
  } catch (err) {
    logger.error("Failed to deliver a turn's reply", {
      userId: context.userId,
      intentId: context.intentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!delivered) return;
  const executed: PersonalAgentExecutedAct = {
    tool: "message_user",
    text: content,
    ...(options ? { options } : {}),
    ...delivered,
    stage: "reply",
    ...(fallback ? { fallback } : {}),
  };
  await ledgerOrLog(deps, context, executed);
  accumulator.acts.push(executed);
  accumulator.messages.push(content);
}

/**
 * Split a checked reply into sentence-sized chunks for progressive
 * rendering. Purely presentational: the text is already complete, checked
 * and persisted when this runs, so the split can never change what the
 * principal ultimately reads.
 */
export function chunkReplyText(text: string): string[] {
  const chunks = text.match(/[^.!?\n]*[.!?\n]+[)"'”’]*\s*|[^.!?\n]+$/g);
  return chunks && chunks.length > 0 ? chunks : [text];
}

/**
 * Stream a completed turn's delivered messages to whichever controller is
 * waiting, as ordered chunks. Runs only AFTER everything is checked and
 * persisted; joining the chunks reproduces `messages.join('\n\n')` exactly,
 * so the controller's fallback and the stream can never disagree.
 */
async function publishTurnMessages(
  deps: PersonalAgentDeps,
  messageId: string,
  messages: string[],
): Promise<void> {
  if (!deps.replyStream || messages.length === 0) return;
  // Purely a latency optimisation: everything here is already checked and
  // persisted, and the controller falls back to the completed turn if the
  // channel yields nothing. Failing the turn over it would be the opposite
  // lie — reporting failure for work that is durably done, and retrying it
  // into a second reply.
  try {
    let seq = 0;
    for (const [index, message] of messages.entries()) {
      const prefixed = index > 0 ? `\n\n${message}` : message;
      for (const content of chunkReplyText(prefixed)) {
        seq += 1;
        await deps.replyStream.publish(messageId, { seq, content });
      }
    }
  } catch (err) {
    logger.warn("Failed to stream a turn's reply", { intentId: messageId, error: err });
  }
}

// ─── Nodes ───────────────────────────────────────────────────────────────────

async function intentNode(state: PersonalAgentState, deps: PersonalAgentDeps): Promise<Partial<PersonalAgentState>> {
  const input = state.input as Extract<PersonalAgentInput, { event: PersonalAgentIntentEventKind }>;
  try {
    const context = await assembleContext(deps, input);
    const judgment = deps.judgment ?? defaultJudgment();
    const decided = await judgment.decide(context);
    logger.info("PersonalAgent turn decided", {
      userId: context.userId,
      intentId: context.intentId,
      event: context.event,
      acts: decided.map((act) => act.tool),
    });

    const accumulator: TurnAccumulator = { acts: [], messages: [] };
    // Kickoff runs last, after every verdict — it re-reads the match list, and
    // a match this turn promoted or rejected must not be re-opened.
    const kickoff = decided.find((act): act is Extract<PersonalAgentDecidedAct, { tool: "kickoff" }> => act.tool === "kickoff");
    for (const act of decided) {
      if (act.tool === "kickoff") continue;
      await executeAct(deps, context, accumulator, act);
    }
    if (kickoff) await runKickoff(deps, context, accumulator, kickoff.reasoning);

    // A background event has no reply stage behind it, so a turn that decided
    // nothing would end in silence — and for reflect, silently consume the
    // round's one retained job. Never the empty end of a cycle.
    if (context.event !== "user_message" && accumulator.acts.length === 0) {
      logger.warn("A background turn decided nothing", { intentId: context.intentId, event: context.event });
      await say(deps, context, accumulator, "message_user", PERSONAL_AGENT_NO_NEXT_STEP);
    }

    if (context.event === "user_message") {
      await runReplyStage(deps, context, accumulator);
      await publishTurnMessages(deps, input.event === "user_message" ? input.messageId : "", accumulator.messages);
    }

    return {
      phase: "done",
      result: { scope: "intent", acts: accumulator.acts, messages: accumulator.messages },
    };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The negotiation scope: the same PersonalAgent at the A2A table. It reads
 * the thread and ITS OWN brief — the brief is the only thing from a DM that
 * reaches a negotiation — and answers with exactly one verb or one pause. It
 * never ends a negotiation; NegotiationGraph's `apply` is the sink.
 *
 * A seat with no brief yet — the counterparty, always, since only the
 * initiator's kickoff wrote one — authors its own here, from what THIS side
 * knows, and persists it. That is the whole of D18: the counterparty's agent
 * arrives with its own instructions rather than the initiator's.
 */
async function negotiationNode(state: PersonalAgentState, deps: PersonalAgentDeps): Promise<Partial<PersonalAgentState>> {
  const input = state.input as Extract<PersonalAgentInput, { negotiationId: string }>;
  try {
    const task = await deps.negotiationDatabase.getNegotiationTask(input.negotiationId);
    if (!task) return { phase: "error", error: "Negotiation not found" };
    const messages = await deps.negotiationDatabase.getNegotiationMessages(task.id);
    const judgment = deps.judgment ?? defaultJudgment();
    const thread = threadFromMessages(messages, input.userId);
    const brief = task.briefs[input.userId] ?? await authorSeatBrief(deps, judgment, task, input.userId, thread);
    const turn: NegotiationAuthoredTurn = await judgment.negotiationTurn({
      brief,
      thread,
      // Raw message count, not parsed-turn count: the negotiation graph's
      // opening rule keys off the same number, and the two must agree on
      // "is this the opening turn" or every turn is rejected.
      isOpening: messages.length === 0,
    });
    return { phase: "done", result: { scope: "negotiation", acts: [], messages: [], turn } };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Author and persist the brief for a seat that has none.
 *
 * The seat's own signal is used when it can be established BEYOND DOUBT: a
 * premise-matched actor's `intent` field names the intent it matched AGAINST,
 * not one it owns, so an actor carrying this negotiation's own `intentId` is
 * ambiguous and is treated as unknown rather than guessed at. Without it the
 * brief is written from what this side can see honestly — why the match
 * exists, and whatever has been said so far — which is still its own
 * instructions rather than the counterparty's.
 */
async function authorSeatBrief(
  deps: PersonalAgentDeps,
  judgment: NonNullable<PersonalAgentDeps["judgment"]>,
  task: NegotiationTaskRow,
  seatUserId: string,
  thread: PersonalAgentThreadEntry[],
): Promise<string> {
  const opportunity = await deps.negotiationDatabase.getOpportunity(task.metadata.opportunityId).catch(() => null);
  // The seat's OWN binding, recorded when its own kickoff opened or re-kicked
  // this negotiation. Never inferred from the opportunity's actor rows: a
  // premise-matched actor's `intent` names the intent it matched AGAINST, so
  // it cannot be trusted to name the seat's own signal. A seat that has not
  // kicked off here yet simply has no signal to show, and the brief says so.
  const seatIntentId = Object.entries(task.metadata.seats)
    .find(([, binding]) => binding.userId === seatUserId)?.[0] ?? null;
  const intent = seatIntentId ? await deps.negotiationDatabase.getIntent(seatIntentId).catch(() => null) : null;

  const brief = await judgment.seatBrief({
    signalText: intent ? (intent.summary ?? intent.payload ?? null) : null,
    matchReasoning: typeof (opportunity as { reasoning?: unknown } | null)?.reasoning === "string"
      ? (opportunity as unknown as { reasoning: string }).reasoning
      : null,
    thread,
  });
  await deps.negotiationDatabase.setNegotiationBrief(task.id, seatUserId, brief);
  logger.info("Authored a brief for a seat that had none", { negotiationId: task.id, seatUserId });
  return brief;
}

function errorNode(state: PersonalAgentState): Partial<PersonalAgentState> {
  return {
    result: {
      scope: state.scope,
      acts: [],
      messages: [],
      error: state.error ?? "Unknown error",
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let sharedJudgment: PersonalAgentModel | null = null;
/** Constructed lazily so a host that never takes a model turn needs no key. */
function defaultJudgment(): PersonalAgentModel {
  sharedJudgment ??= new PersonalAgentModel();
  return sharedJudgment;
}

/** Typed invoke signature, for host-side and caller typing. */
export interface PersonalAgentGraphLike {
  invoke(input: PersonalAgentInput): Promise<PersonalAgentResult>;
}

export class PersonalAgentGraphFactory {
  constructor(public readonly deps: PersonalAgentDeps) {}

  createGraph(): PersonalAgentGraphLike {
    const deps = this.deps;
    const compiled = new StateGraph(PersonalAgentGraphState)
      .addNode("route", routeNode)
      .addNode("intent", (s: PersonalAgentState) => intentNode(s, deps))
      .addNode("negotiation", (s: PersonalAgentState) => negotiationNode(s, deps))
      // Named "fail", not "error": LangGraph rejects a node name that
      // collides with a state channel name, and "error" is one.
      .addNode("fail", errorNode)
      .addEdge("__start__", "route")
      .addConditionalEdges("route", (s: PersonalAgentState) => s.phase, {
        intent: "intent",
        negotiation: "negotiation",
        error: "fail",
      })
      .addConditionalEdges("intent", (s: PersonalAgentState) => s.phase, { done: END, error: "fail" })
      .addConditionalEdges("negotiation", (s: PersonalAgentState) => s.phase, { done: END, error: "fail" })
      .addEdge("fail", END)
      .compile();

    return {
      async invoke(input: PersonalAgentInput): Promise<PersonalAgentResult> {
        const final = await compiled.invoke({ input });
        if (final.result) return final.result;
        return { scope: final.scope, acts: [], messages: [], error: final.error ?? "Unknown graph error" };
      },
    };
  }
}
