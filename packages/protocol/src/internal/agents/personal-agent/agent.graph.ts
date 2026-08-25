/**
 * AgentGraph — one PersonalAgent, three scopes, routed on the shape of its
 * input (docs/plans/2026-08-23-personal-agent-and-negotiation-graphs.md).
 *
 * The cycle this graph runs:
 *
 *   discovery persists matches ──► matches_ready ──► kickoff
 *     → strategy into the DM → one brief per match in
 *     parallel → open ALL of them. No selection at kickoff: the negotiator
 *     filters by negotiating, IS-A judges at reflect where it has turns to
 *     judge on.
 *
 *   every negotiation of the round paused ──► all_paused ──► reflect,
 *     where the agent can continue the conversation and take any supported
 *     action in the order the current context warrants.
 *
 *   the principal wrote ──► user_message ──► a conversational tool turn,
 *     because answers to the reflect questions arrive as ordinary messages.
 *
 * All intent events share one conversation loop. Judgment lives in the
 * prompt; this file is effects, and every effect leaves a ledger row.
 */
import { END, StateGraph, Annotation } from "@langchain/langgraph";

import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { requestContext } from "../../shared/observability/request-context.js";
import { turnsWithSenders, type NegotiationAuthoredTurn } from "../../negotiations/negotiation.turn.js";
import { maybeEnqueueRoundReflect } from "../../negotiations/negotiation.round-reflect.js";
import type { NegotiationTaskRow } from "../../../platform/database/negotiation.js";
import type { IntentRecord } from "../../../platform/database/entities.js";
import { canonicalCounterpartyStatusProse, isSupportedPersonalAgentStatusProse, normalizeMessageQuestions, PersonalAgentModel } from "./agent.judgment.js";
import type { Question } from "../../../protocol/question.js";
import type { PersonalAgentActivity, PersonalAgentDecidedAct, PersonalAgentDeps, PersonalAgentExecutedAct, PersonalAgentInput, PersonalAgentIntentEventKind, PersonalAgentMatch, PersonalAgentNonDurableObservation, PersonalAgentPausedNegotiation, PersonalAgentResult, PersonalAgentScope, PersonalAgentThreadEntry, PersonalAgentTurnContext } from "./agent.types.js";

const logger = protocolLogger("PersonalAgentGraph");

class UnresolvedOwnedPauseError extends Error {}

/** How much conversation memory a turn reads. */
const MAX_DM_MESSAGES = 20;
const MAX_LEDGER_ACTS = 20;
/**
 * How many matches a turn sees, newest kept — a prolific signal must not
 * flood the prompt, and kickoff opens exactly the set the agent decided from
 * (D52). What is over the cap waits for the next round, which is what rounds
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

/** Bounded tool steps keep a faulty model from holding a serialized inbox forever. */
const MAX_INTENT_TOOL_STEPS = 8;

function hasUnresolvedOwnedPause(context: PersonalAgentTurnContext): boolean {
  return context.paused.some((paused) => paused.pausedByUs && (
    paused.reason === "ready_for_verdict" || paused.reason === "needs_principal"
  ));
}

function isOwnedReadyPause(paused: PersonalAgentPausedNegotiation): boolean {
  return paused.pausedByUs && paused.reason === "ready_for_verdict";
}

// ─── State ───────────────────────────────────────────────────────────────────

const PersonalAgentGraphState = Annotation.Root({
  input: Annotation<PersonalAgentInput>({ reducer: (c, n) => n ?? c, default: () => ({} as PersonalAgentInput) }),
  scope: Annotation<PersonalAgentScope>({ reducer: (c, n) => n ?? c, default: () => "global" }),
  phase: Annotation<"intent" | "counterparty_resolved" | "negotiation" | "error" | "done">({ reducer: (c, n) => n ?? c, default: () => "error" }),
  result: Annotation<PersonalAgentResult | null>({ reducer: (c, n) => n ?? c, default: () => null }),
  error: Annotation<string | null>({ reducer: (c, n) => n ?? c, default: () => null }),
});

type PersonalAgentState = typeof PersonalAgentGraphState.State;

// ─── Routing ─────────────────────────────────────────────────────────────────

function routeNode(state: PersonalAgentState): Partial<PersonalAgentState> {
  const input = state.input;
  if ("event" in input && input.event === "counterparty_resolved") return { scope: "intent", phase: "counterparty_resolved" };
  // An intent event may name the negotiation that woke it. Events still
  // belong to the principal's signal inbox; only an event-less input enters
  // the negotiator seat.
  if ("event" in input) return { scope: "intent", phase: "intent" };
  if ("negotiationId" in input) return { scope: "negotiation", phase: "negotiation" };
  return {
    scope: "global",
    phase: "error",
    error: "PersonalAgent global scope is not implemented; invoke with an intentId",
  };
}

function counterpartyResolutionMessage(verdict: "pending" | "reject"): string {
  return verdict === "pending"
    ? "The other agent considers this a potential fit and has put it in their principal's decision queue. This is not an acceptance."
    : "The other agent declined this match for their principal. I have closed it on this signal.";
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

/** The task context a seat may show its model: never the other seat's brief. */
function taskForSeat(task: NegotiationTaskRow, seatUserId: string): NegotiationTaskRow {
  const brief = task.briefs[seatUserId];
  return { ...task, briefs: brief === undefined ? {} : { [seatUserId]: brief } };
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
  // reflect) permanently consumed that drain generation's job id.
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
      && !paused.some((entry) => entry.opportunityId === match.opportunityId && !entry.pausedByUs)
      && !(await spentItsTurnBudget(deps, match)),
  })));
  const kickoffTargets = eligibility.filter((entry) => entry.eligible).map((entry) => entry.match);
  if (input.event === "matches_ready") {
    logger.info("PersonalAgent matches_ready eligibility", {
      intentId,
      matches: matches.length,
      kickoffTargets: kickoffTargets.length,
      awaitingIntroducerApproval: eligibility.filter((entry) => entry.match.awaitingIntroducerApproval).length,
      pending: eligibility.filter((entry) => NOT_KICKOFF_ELIGIBLE_STATUSES.has(entry.match.status)).length,
      counterpartyPaused: eligibility.filter((entry) =>
        paused.some((pausedEntry) => pausedEntry.opportunityId === entry.match.opportunityId && !pausedEntry.pausedByUs),
      ).length,
    });
  }
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
    event: {
      kind: context.event,
      ...(context.traceId ? { traceId: context.traceId } : {}),
      ...(context.message ? { messageId: context.message.messageId } : {}),
      ...(context.round !== undefined ? { round: context.round } : {}),
    },
    act: act as unknown as Record<string, unknown>,
  });
}

async function deliverMessage(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  text: string,
  questions?: Question[],
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
    ...(questions ? { questions } : {}),
  });
  return { sessionId: resolved.session.id, messageId };
}

interface TurnAccumulator {
  acts: PersonalAgentExecutedAct[];
  nonDurable: PersonalAgentNonDurableObservation[];
  messages: string[];
  /** The model explicitly selected the natural terminal response. */
  finalMessageChosen: boolean;
}

/**
 * The model sees completed tool results, but context remains a snapshot for
 * one serialized turn. Do not let that snapshot turn one kickoff into several
 * rounds or call an irreversible target twice. Even an error outcome can be
 * uncertain, so it still consumes that target's one call for this snapshot.
 */
function isRepeatedIrreversibleAct(
  act: PersonalAgentDecidedAct,
  executed: PersonalAgentExecutedAct[],
): boolean {
  if (act.tool === "kickoff") return executed.some((entry) => entry.tool === "kickoff");
  if (act.tool === "promote" || act.tool === "reject") {
    return executed.some((entry) =>
      (entry.tool === "promote" || entry.tool === "reject")
      && entry.negotiationId === act.negotiationId);
  }
  if (act.tool === "accept_opportunity") {
    return executed.some((entry) => entry.tool === "accept_opportunity" && entry.opportunityId === act.opportunityId);
  }
  return false;
}

function refusedIrreversibleObservation(act: PersonalAgentDecidedAct): PersonalAgentNonDurableObservation {
  if (act.tool === "kickoff") {
    return {
      kind: "irreversible_tool_refused",
      tool: "kickoff",
      reason: "A kickoff already executed against this turn's snapshot. Choose a different next step.",
    };
  }
  if (act.tool === "promote" || act.tool === "reject") {
    return {
      kind: "irreversible_tool_refused",
      tool: act.tool,
      negotiationId: act.negotiationId,
      reason: "A terminal verdict already executed for this negotiation against this turn's snapshot. Choose a different next step.",
    };
  }
  if (act.tool === "accept_opportunity") {
    return {
      kind: "irreversible_tool_refused",
      tool: "accept_opportunity",
      opportunityId: act.opportunityId,
      reason: "An acceptance already executed for this match against this turn's snapshot. Choose a different next step.",
    };
  }
  throw new Error("Only repeated irreversible acts can be refused here");
}

function throwIfIntentAborted(): void {
  requestContext.getStore()?.abortSignal?.throwIfAborted();
}

async function say(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  tool: "message_user",
  text: string,
  questions?: Question[],
): Promise<void> {
  if (text.includes("?")) throw new Error("PersonalAgent questions must use the structured questions field");
  const safeQuestions = normalizeMessageQuestions(questions);
  if (questions && !safeQuestions) throw new Error("PersonalAgent produced no safe questions");
  const delivered = await deliverMessage(deps, context, text, safeQuestions);
  if (!delivered) return;
  const executed: PersonalAgentExecutedAct = {
    tool,
    text,
    ...(safeQuestions ? { questions: safeQuestions } : {}),
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

/** Record a terminal recovery even if its DM delivery itself is unavailable. */
async function ledgerTerminalFallback(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  text: string,
  cause: unknown,
): Promise<void> {
  try {
    await deps.ledger.append({
      userId: context.userId,
      intentId: context.intentId,
      event: { kind: context.event, ...(context.round !== undefined ? { round: context.round } : {}) },
      act: {
        tool: "terminal_fallback",
        text,
        cause: cause instanceof Error ? cause.message : String(cause),
      },
    });
  } catch (ledgerError) {
    logger.error("Failed to ledger terminal fallback", { intentId: context.intentId, error: ledgerError });
  }
}

/**
 * Fixed, server-owned copy for a kickoff that has no one to reach out to.
 * Without this, the principal is told nothing at all and — with no negotiation
 * left active and that drain generation's reflect job retained forever —
 * nothing can wake the agent for this signal again.
 */
export const PERSONAL_AGENT_NOTHING_TO_OPEN =
  "There is nothing new for me to put to anyone on this signal right now — what I have is either "
  + "waiting on your decision or has run as far as it can. Tell me if you want me to change tack.";

/** Honest terminal response when the bounded loop has already done work. */
export const PERSONAL_AGENT_TOOL_BUDGET_EXHAUSTED =
  "I reached my turn limit before I could safely choose another step. "
  + "I have recorded what happened; please tell me how you want to continue.";

/** Honest terminal response when a later model choice fails after durable work. */
export const PERSONAL_AGENT_POST_ACTION_FAILURE =
  "I completed some work, but I could not safely continue this turn after that. "
  + "I have recorded what happened; please tell me how you want to proceed.";

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
 * Kickoff / re-kick: one tool available in every intent event.
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
    throwIfIntentAborted();
    // Say so. With nothing active
    // and this drain's reflect job retained forever, silence here ends the cycle for
    // this signal with the principal never told.
    if (context.event !== "user_message") {
      await say(deps, context, accumulator, "message_user",
        context.matches.length === 0 ? PERSONAL_AGENT_NO_MATCHES_YET : PERSONAL_AGENT_NOTHING_TO_OPEN);
    }
    await recordKickoff(deps, context, accumulator, {
      tool: "kickoff", round: lifecycle.round, opened: 0, attempted: 0, failed: 0, reasoning,
    });
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
  const kickoffContext: PersonalAgentTurnContext = {
    ...context,
    dossier: await deps.dossier.readActiveEntries(context.userId, context.intentId),
  };
  const strategy = await strategyOrFallback(judgment, kickoffContext);
  throwIfIntentAborted();
  const publicStrategy = isSupportedPersonalAgentStatusProse(strategy, kickoffContext)
    ? strategy
    : canonicalCounterpartyStatusProse(kickoffContext) ?? PERSONAL_AGENT_STRATEGY_FALLBACK;
  await say(deps, context, accumulator, "message_user", publicStrategy);

  throwIfIntentAborted();
  const round = await deps.negotiationDatabase.bumpIntentNegotiationRound(context.intentId);
  // ─── from here down, nothing throws (D54) ───────────────────────────────
  // There are deliberately no cancellation gates below the bump. This
  // kickoff is already underway: abort-aware brief/open calls reject into the
  // settled results so compensation and round settlement can still finish.
  const threadByOpportunity = new Map(context.paused.map((paused) => [paused.opportunityId, paused.thread]));

  const opens = await mapWithConcurrency(matches, KICKOFF_CONCURRENCY, async (match) => {
    const brief = await judgment.brief(kickoffContext, {
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
      attempted: matches.length,
      failed: failed.length,
      reasoning: `Could not open ${failed.length} of ${matches.length} match(es) this round.`,
    });
  }

  const opened = await settleRound(deps, context, round, { triggerReflect: true });
  if (opened === 0 && repairedRound !== null) await triggerRoundReflect(deps, context, repairedRound);
  await recordKickoff(deps, context, accumulator, {
    tool: "kickoff", round, opened, attempted: matches.length, failed: failed.length, reasoning,
  });
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
  await maybeEnqueueRoundReflect(deps.negotiationDatabase, enqueue, {
    userId: context.userId,
    intentId: context.intentId,
    round,
  });
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
 * Execute one decided act. Kickoff uses its own multi-stage runner.
 */
async function executeAct(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  act: Exclude<PersonalAgentDecidedAct, { tool: "kickoff" }>,
): Promise<void> {
  switch (act.tool) {
    case "message_user":
      await say(deps, context, accumulator, act.tool, act.text, act.questions);
      return;
    case "promote":
    case "reject": {
      // `judgment` is a documented swap seam, so enforce both visibility and
      // pause ownership again at the effects boundary. A refused ref is
      // ledgered rather than thrown so earlier durable acts are not retried.
      const paused = context.paused.find((entry) => entry.negotiationId === act.negotiationId);
      if (!paused || !isOwnedReadyPause(paused)) {
        logger.warn("Decided a verdict without an owned ready_for_verdict pause", {
          intentId: context.intentId,
          negotiationId: act.negotiationId,
        });
        const missing: PersonalAgentExecutedAct = {
          tool: act.tool,
          negotiationId: act.negotiationId,
          opportunityId: paused?.opportunityId ?? "",
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
        byUserId: context.userId,
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
      // `judgment` is injectable, so production's numbered-reference
      // validator is not the effects boundary. The host may read the signal's
      // wider match set; never let an injected id reach a hidden match that
      // was outside this turn's bounded snapshot.
      if (!context.matches.some((match) => match.opportunityId === act.opportunityId)) {
        logger.warn("Decided acceptance on a match this turn cannot see", {
          intentId: context.intentId,
          opportunityId: act.opportunityId,
        });
        const missing: PersonalAgentExecutedAct = {
          tool: "accept_opportunity",
          opportunityId: act.opportunityId,
          outcome: "not_available",
          ...(act.reason ? { reason: act.reason } : {}),
        };
        await ledgerOrLog(deps, context, missing);
        accumulator.acts.push(missing);
        return;
      }
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
      // As with verdict and acceptance ids, the documented judgment seam can
      // bypass the numbered-reference validator. Retire only an entry in the
      // active dossier snapshot the model was given.
      if (!context.dossier.some((entry) => entry.id === act.entryId)) {
        logger.warn("Decided retirement of a dossier entry this turn cannot see", {
          intentId: context.intentId,
          entryId: act.entryId,
        });
        const missing: PersonalAgentExecutedAct = {
          tool: "retire_dossier",
          entryId: act.entryId,
          retired: false,
        };
        await ledgerOrLog(deps, context, missing);
        accumulator.acts.push(missing);
        return;
      }
      const retired = await deps.dossier.retireEntry({ userId: context.userId, entryId: act.entryId });
      const executed: PersonalAgentExecutedAct = { tool: "retire_dossier", entryId: act.entryId, retired };
      await ledgerOrLog(deps, context, executed);
      accumulator.acts.push(executed);
      return;
    }
  }
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

const TOOL_ACTIVITY_LABELS: Record<Exclude<PersonalAgentDecidedAct["tool"], "message_user">, { before: string; after: string }> = {
  kickoff: { before: "Preparing outreach", after: "Outreach prepared" },
  promote: { before: "Updating a match", after: "Match updated" },
  reject: { before: "Updating a match", after: "Match updated" },
  note_dossier: { before: "Saving what you shared", after: "Saved what you shared" },
  retire_dossier: { before: "Updating what I remember", after: "Updated what I remember" },
  accept_opportunity: { before: "Recording your decision", after: "Decision recorded" },
};

/** Activity is best-effort UI feedback and must never decide turn success. */
async function publishActivity(
  deps: PersonalAgentDeps,
  input: Extract<PersonalAgentInput, { event: PersonalAgentIntentEventKind }>,
  activity: PersonalAgentActivity,
): Promise<void> {
  if (!deps.activity || input.event !== "user_message") return;
  try {
    await deps.activity.publish(input.messageId, activity);
  } catch (err) {
    logger.warn("Failed to publish PersonalAgent activity", { phase: activity.phase, error: err });
  }
}

// ─── Nodes ───────────────────────────────────────────────────────────────────

async function intentNode(state: PersonalAgentState, deps: PersonalAgentDeps): Promise<Partial<PersonalAgentState>> {
  const input = state.input as Extract<PersonalAgentInput, { event: PersonalAgentIntentEventKind }>;
  const traceId = crypto.randomUUID();
  let context: PersonalAgentTurnContext | null = null;
  let accumulator: TurnAccumulator | null = null;
  try {
    await publishActivity(deps, input, { phase: "reviewing", label: "Reviewing the conversation" });
    const contextStartedAt = Date.now();
    context = { ...(await assembleContext(deps, input)), traceId };
    logger.info("PersonalAgent context assembled", {
      intentId: context.intentId,
      event: context.event,
      durationMs: Date.now() - contextStartedAt,
      matchCount: context.matches.length,
      kickoffTargetCount: context.kickoffTargets.length,
      pausedCount: context.paused.length,
    });
    const judgment = deps.judgment ?? defaultJudgment();
    accumulator = { acts: [], nonDurable: [], messages: [], finalMessageChosen: false };
    for (let step = 0; step < MAX_INTENT_TOOL_STEPS; step++) {
      const judgmentStartedAt = Date.now();
      let act: PersonalAgentDecidedAct;
      try {
        act = await judgment.next(context, accumulator.acts, accumulator.nonDurable);
      } catch (err) {
        logger.error("PersonalAgent judgment failed", {
          intentId: context.intentId,
          event: context.event,
          step,
          durationMs: Date.now() - judgmentStartedAt,
          error: err,
        });
        throw err;
      }
      throwIfIntentAborted();
      logger.info("PersonalAgent chose tool", {
        intentId: context.intentId,
        event: context.event,
        step,
        tool: act.tool,
        judgmentDurationMs: Date.now() - judgmentStartedAt,
      });
      if (context.event === "matches_ready") {
        logger.info("PersonalAgent matches_ready decision", {
          intentId: context.intentId,
          traceId,
          step,
          tool: act.tool,
          matchCount: context.matches.length,
          kickoffTargetCount: context.kickoffTargets.length,
        });
      }
      if (act.tool === "message_user") {
        const ownReady = context.paused.some((paused) =>
          paused.pausedByUs && paused.reason === "ready_for_verdict");
        const ownNeedsPrincipal = context.paused.some((paused) =>
          paused.pausedByUs && paused.reason === "needs_principal");
        const refusal = !isSupportedPersonalAgentStatusProse(act.text, context)
          ? "Counterparty status prose must match the canonical public response exactly."
          : ownReady
          ? "Resolve every own ready_for_verdict pause with promote or reject before replying."
          : ownNeedsPrincipal && !act.questions?.length
            ? "An own needs_principal pause must be delivered as structured questions before replying."
            : null;
        if (refusal) {
          logger.warn("PersonalAgent refused a terminal message while owning unresolved work", {
            intentId: context.intentId,
            event: context.event,
            reason: refusal,
          });
          accumulator.nonDurable.push({ kind: "terminal_message_refused", reason: refusal });
          continue;
        }
      }
      if (act.tool === "accept_opportunity" && context.event !== "user_message") {
        logger.warn("PersonalAgent refused acceptance without a client message", {
          intentId: context.intentId,
          event: context.event,
        });
        accumulator.nonDurable.push({
          kind: "irreversible_tool_refused",
          tool: "accept_opportunity",
          opportunityId: act.opportunityId,
          reason: "Acceptance requires an explicit verdict in a client message. Choose a different next step.",
        });
        continue;
      }
      if (isRepeatedIrreversibleAct(act, accumulator.acts)) {
        logger.warn("PersonalAgent repeated an irreversible tool in one turn", {
          intentId: context.intentId,
          event: context.event,
          tool: act.tool,
        });
        accumulator.nonDurable.push(refusedIrreversibleObservation(act));
        continue;
      }
      const toolStartedAt = Date.now();
      try {
        if (act.tool === "message_user") {
          await publishActivity(deps, input, { phase: "preparing_response", label: "Preparing a response" });
          accumulator.finalMessageChosen = true;
          await executeAct(deps, context, accumulator, act);
        } else if (act.tool === "kickoff") {
          await publishActivity(deps, input, { phase: "working", label: TOOL_ACTIVITY_LABELS.kickoff.before });
          await runKickoff(deps, context, accumulator, act.reasoning);
          await publishActivity(deps, input, { phase: "working", label: TOOL_ACTIVITY_LABELS.kickoff.after });
        } else {
          await publishActivity(deps, input, { phase: "working", label: TOOL_ACTIVITY_LABELS[act.tool].before });
          await executeAct(deps, context, accumulator, act);
          await publishActivity(deps, input, { phase: "working", label: TOOL_ACTIVITY_LABELS[act.tool].after });
        }
      } catch (err) {
        logger.error("PersonalAgent tool failed", {
          intentId: context.intentId,
          event: context.event,
          step,
          tool: act.tool,
          durationMs: Date.now() - toolStartedAt,
          error: err,
        });
        throw err;
      }
      logger.info("PersonalAgent tool completed", {
        intentId: context.intentId,
        event: context.event,
        step,
        tool: act.tool,
        durationMs: Date.now() - toolStartedAt,
      });
      if (act.tool === "message_user") break;
      // Every next choice — especially the final narration — reads the state
      // the action actually persisted, not the turn's opening snapshot.
      context = { ...(await assembleContext(deps, input)), traceId };
    }
    if (!accumulator.finalMessageChosen) {
      if (accumulator.acts.length === 0) throwIfIntentAborted();
      if (hasUnresolvedOwnedPause(context)) {
        throw new UnresolvedOwnedPauseError("PersonalAgent exhausted its tool budget with an unresolved owned pause");
      }
      logger.warn("PersonalAgent exhausted its intent tool budget", { intentId: context.intentId, event: context.event });
      await publishActivity(deps, input, { phase: "preparing_response", label: "Preparing a response" });
      await say(deps, context, accumulator, "message_user", PERSONAL_AGENT_TOOL_BUDGET_EXHAUSTED);
    }
    if (input.event === "user_message") await publishTurnMessages(deps, input.messageId, accumulator.messages);

    return {
      phase: "done",
      result: { scope: "intent", acts: accumulator.acts, messages: accumulator.messages },
    };
  } catch (err) {
    if (err instanceof UnresolvedOwnedPauseError) {
      return { phase: "error", error: err.message };
    }
    // A generic terminal fallback would silently consume this drain without
    // deciding the owned verdict or delivering its structured question.
    if (context && hasUnresolvedOwnedPause(context)) {
      return { phase: "error", error: err instanceof Error ? err.message : String(err) };
    }
    // An outer queue retry repeats the entire turn. Once a durable tool has
    // completed, a later invalid model choice must therefore terminate this
    // turn rather than replaying its earlier effects.
    const durableEffectExecuted = (accumulator?.acts.length ?? 0) > 0;
    if (context && accumulator && durableEffectExecuted) {
      logger.error("PersonalAgent failed after a durable effect; ending turn without retry", {
        intentId: context.intentId,
        event: context.event,
        error: err,
      });
      try {
        await publishActivity(deps, input, { phase: "preparing_response", label: "Preparing a response" });
        await say(deps, context, accumulator, "message_user", PERSONAL_AGENT_POST_ACTION_FAILURE);
      } catch (fallbackError) {
        logger.error("PersonalAgent terminal fallback could not be delivered", {
          intentId: context.intentId,
          error: fallbackError,
        });
        await ledgerTerminalFallback(deps, context, PERSONAL_AGENT_POST_ACTION_FAILURE, err);
      }
      if (input.event === "user_message") await publishTurnMessages(deps, input.messageId, accumulator.messages);
      return {
        phase: "done",
        result: { scope: "intent", acts: accumulator.acts, messages: accumulator.messages },
      };
    }
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * A completed counterpart verdict is a durable fact, not another judgment.
 * Deliver fixed copy without a model call so the principal hears it promptly
 * and the private reasoning behind the other seat's verdict stays private.
 */
async function counterpartyResolvedNode(state: PersonalAgentState, deps: PersonalAgentDeps): Promise<Partial<PersonalAgentState>> {
  const input = state.input as Extract<PersonalAgentInput, { event: "counterparty_resolved" }>;
  try {
    const resolved = await deps.conversation.resolveSession(input.userId, input.intentId);
    if ("error" in resolved) return { phase: "error", error: `Signal conversation resolution failed: ${resolved.error}` };
    const text = counterpartyResolutionMessage(input.verdict);
    const messageId = await deps.conversation.addMessage({
      sessionId: resolved.session.id,
      role: "assistant",
      content: text,
    });
    const act: PersonalAgentExecutedAct = {
      tool: "message_user",
      text,
      sessionId: resolved.session.id,
      messageId,
    };
    await deps.ledger.append({
      userId: input.userId,
      intentId: input.intentId,
      event: { kind: input.event, negotiationId: input.negotiationId, verdict: input.verdict },
      act: act as unknown as Record<string, unknown>,
    });
    return { phase: "done", result: { scope: "intent", acts: [act], messages: [text] } };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The negotiation scope: the same PersonalAgent at the A2A table. It reads
 * the resolved intent of its own seat, task context, thread, and ITS OWN
 * brief — a compact derived stance, not the source of truth — and answers
 * with exactly one verb or one pause. It never ends a negotiation;
 * NegotiationGraph's `apply` is the sink.
 *
 * A seat with no brief yet — the counterparty, always, since only the
 * initiator's kickoff wrote one — authors its own here, from what THIS side
 * knows, and persists it. That is the whole of D51: the counterparty's agent
 * arrives with its own instructions rather than the initiator's.
 */
async function negotiationNode(state: PersonalAgentState, deps: PersonalAgentDeps): Promise<Partial<PersonalAgentState>> {
  const input = state.input as Extract<PersonalAgentInput, { negotiationId: string }>;
  try {
    const task = await deps.negotiationDatabase.getNegotiationTask(input.negotiationId);
    if (!task) return { phase: "error", error: "Negotiation not found" };
    const intent = await deps.negotiationDatabase.getIntent(input.intentId);
    if (!intent) return { phase: "error", error: "Intent not found" };
    const messages = await deps.negotiationDatabase.getNegotiationMessages(task.id);
    const judgment = deps.judgment ?? defaultJudgment();
    const thread = threadFromMessages(messages, input.userId);
    const negotiation = taskForSeat(task, input.userId);
    const brief = task.briefs[input.userId] ?? await authorSeatBrief(deps, judgment, negotiation, input.userId, intent, thread);
    const turn: NegotiationAuthoredTurn = await judgment.negotiationTurn({
      intent,
      negotiation,
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
 * The negotiation node resolves this seat's own intent once from the
 * persisted opportunity actor and provides the same intent plus the actual
 * task history to both brief authoring and the negotiation turn.
 */
async function authorSeatBrief(
  deps: PersonalAgentDeps,
  judgment: NonNullable<PersonalAgentDeps["judgment"]>,
  task: NegotiationTaskRow,
  seatUserId: string,
  intent: IntentRecord,
  thread: PersonalAgentThreadEntry[],
): Promise<string> {
  const brief = await judgment.seatBrief({
    intent,
    negotiation: task,
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
      .addNode("counterparty_resolved", (s: PersonalAgentState) => counterpartyResolvedNode(s, deps))
      .addNode("negotiation", (s: PersonalAgentState) => negotiationNode(s, deps))
      // Named "fail", not "error": LangGraph rejects a node name that
      // collides with a state channel name, and "error" is one.
      .addNode("fail", errorNode)
      .addEdge("__start__", "route")
      .addConditionalEdges("route", (s: PersonalAgentState) => s.phase, {
        intent: "intent",
        counterparty_resolved: "counterparty_resolved",
        negotiation: "negotiation",
        error: "fail",
      })
      .addConditionalEdges("intent", (s: PersonalAgentState) => s.phase, { done: END, error: "fail" })
      .addConditionalEdges("counterparty_resolved", (s: PersonalAgentState) => s.phase, { done: END, error: "fail" })
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
