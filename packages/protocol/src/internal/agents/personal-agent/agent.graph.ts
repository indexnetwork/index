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
import { maybeEnqueueRoundReflect } from "../../negotiations/negotiation.round-reflect.js";
import { turnsWithSenders, type NegotiationAuthoredTurn } from "../../negotiations/negotiation.turn.js";
import type { NegotiationTaskRow } from "../../../platform/database/negotiation.js";
import { PersonalAgentModel } from "./agent.judgment.js";
import type { PersonalAgentDecidedAct, PersonalAgentDeps, PersonalAgentExecutedAct, PersonalAgentInput, PersonalAgentIntentEventKind, PersonalAgentMatch, PersonalAgentPausedNegotiation, PersonalAgentReply, PersonalAgentReplyFallbackReason, PersonalAgentResult, PersonalAgentScope, PersonalAgentThreadEntry, PersonalAgentTurnContext } from "./agent.types.js";

const logger = protocolLogger("PersonalAgentGraph");

/** How much conversation memory a turn reads. */
const MAX_DM_MESSAGES = 20;
const MAX_LEDGER_ACTS = 20;
/** How many matches a turn sees, newest kept — a prolific signal must not flood the prompt. */
const MAX_MATCHES = 12;

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
 * The paused negotiations of one round, as IS-A reads them.
 *
 * The pause PAYLOAD is private to the seat that paused: a counterparty's
 * question or recommendation is theirs to hand to their own principal, not
 * ours to read. Only the reason crosses.
 */
async function loadPaused(
  deps: PersonalAgentDeps,
  userId: string,
  intentId: string,
  round: number,
): Promise<PersonalAgentPausedNegotiation[]> {
  const tasks = await deps.negotiationDatabase.getNegotiationTasksForIntentRound(intentId, round);
  const paused = tasks.filter((task: NegotiationTaskRow) => task.state === "paused");
  return Promise.all(paused.map(async (task) => {
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
  const round = input.event === "all_paused"
    ? input.round
    : (await deps.negotiationDatabase.getIntentNegotiationRound(intentId)).round;

  const [agentName, intent, allMatches, paused, dossier, recentActs] = await Promise.all([
    // Identity, read beside the rest of the turn's state. A missing row is
    // never fatal: this loop negotiates unattended and must not throw a turn
    // away over a display name.
    deps.identity.readAgentName(userId).catch(() => null),
    deps.negotiationDatabase.getIntent(intentId).catch(() => null),
    deps.opportunities.readMatches(userId, intentId).catch(() => [] as PersonalAgentMatch[]),
    loadPaused(deps, userId, intentId, round).catch(() => [] as PersonalAgentPausedNegotiation[]),
    deps.dossier.readActiveEntries(userId, intentId),
    deps.ledger.readRecent(userId, intentId, MAX_LEDGER_ACTS),
  ]);

  // The DM may not exist yet (a background event can fire before the
  // principal ever opened this signal's conversation). The transcript read
  // degrades to empty; the executor resolves-or-creates the session only when
  // the agent actually speaks.
  const recentDm = await (async () => {
    try {
      const sessionId = input.event === "user_message"
        ? input.sessionId
        : (await deps.conversation.findSession(userId, intentId))?.id;
      if (!sessionId) return [];
      const messages = await deps.conversation.getMessages(sessionId);
      return messages.slice(-MAX_DM_MESSAGES).map((message) => ({ role: message.role, content: message.content }));
    } catch {
      return [];
    }
  })();

  // Bounded, keeping the newest: the agent's numbers are context-relative and
  // its validator resolves them to ids, so truncation renumbers nothing.
  const matches = allMatches.slice(-MAX_MATCHES);
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
  await appendLedger(deps, context, executed);
  accumulator.acts.push(executed);
  accumulator.messages.push(text);
}

/**
 * Kickoff / re-kick: the ACT both event turns can reach.
 *
 * Strategy into the DM first (the principal sees and can correct the plan),
 * then ONE BRIEF PER MATCH IN PARALLEL, then every match opened together.
 * A round is opened by the bump — which stamps `kickoffStartedAt` in the same
 * write — and SETTLED by the size stamp once the opens are done. Until it
 * settles, the all-paused check is a no-op, so an early pause cannot dedupe
 * away the round's genuine reflect. Kickoff runs the final check itself.
 *
 * Retry-safe. A turn runs on a queue that retries it whole, and the durable
 * effects here — a strategy message, a round bump, N opened negotiations —
 * must never happen twice. A begun-but-unsettled round (`kickoffStartedAt`
 * set, `roundSize` still null) is the one signature of a kickoff that died
 * mid-round, so a retry SETTLES that round instead of starting another. An
 * intent that has never kicked off — every intent that predates this
 * mechanism included — has no marker at all and takes the normal path.
 */
async function runKickoff(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  reasoning: string,
): Promise<void> {
  const judgment = deps.judgment ?? defaultJudgment();

  // ── settle an interrupted kickoff ──────────────────────────────────────
  const lifecycle = await deps.negotiationDatabase.getIntentNegotiationRound(context.intentId);
  if (lifecycle.kickoffStartedAt && lifecycle.roundSize === null) {
    logger.warn("Settling a kickoff that did not finish its round", { intentId: context.intentId, round: lifecycle.round });
    // Falls through to a normal kickoff when that round never got a single
    // negotiation — the bump below clears the stale marker, and stranding the
    // signal on an empty round would be worse than one extra round number.
    if (await settleRound(deps, context, accumulator, lifecycle.round, reasoning, [])) return;
  }

  // Re-read: verdicts executed earlier this turn already moved statuses, and
  // a promoted or rejected match must not be re-opened.
  const candidates = (await deps.opportunities.readMatches(context.userId, context.intentId))
    .filter((match) => !NOT_KICKOFF_ELIGIBLE_STATUSES.has(match.status));
  const eligibility = await Promise.all(candidates.map(async (match) => ({
    match,
    eligible: !(await spentItsTurnBudget(deps, match)),
  })));
  const matches = eligibility.filter((entry) => entry.eligible).map((entry) => entry.match);
  if (matches.length === 0) {
    await recordKickoff(deps, context, accumulator, { tool: "kickoff", round: lifecycle.round, opened: 0, reasoning });
    return;
  }

  const strategy = await judgment.strategy(context);
  await say(deps, context, accumulator, "message_user", strategy);

  const round = await deps.negotiationDatabase.bumpIntentNegotiationRound(context.intentId);
  const threadByOpportunity = new Map(context.paused.map((paused) => [paused.opportunityId, paused.thread]));

  const opens = await Promise.allSettled(matches.map(async (match) => {
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
  }));

  // A failed open may still have left a live negotiation behind — `init`
  // creates (or re-rounds) the task before a turn is ever authored. Left
  // `working`, it holds the round's active count above zero forever and the
  // reflect never fires. Compensate it through the graph's own sink, with the
  // honest reason: the open failed, and unlike a spent budget it can be
  // re-kicked later.
  await Promise.all(opens.map(async (open, index) => {
    if (open.status === "fulfilled") return;
    logger.warn("PersonalAgent kickoff open failed", { intentId: context.intentId, round, error: open.reason });
    const match = matches[index]!;
    const task = await deps.negotiationDatabase.getNegotiationTaskForOpportunity(match.opportunityId).catch(() => null);
    if (!task || task.state !== "working" || task.metadata.round !== round) return;
    await deps.negotiations.invoke({ negotiationId: task.id, pause: "open_failed" }).catch((err: unknown) => {
      logger.error("Failed to compensate a stranded negotiation", { negotiationId: task.id, error: err });
    });
  }));

  if (!await settleRound(deps, context, accumulator, round, reasoning, matches)) {
    // Not one negotiation exists for this round. Nothing to wait for, so
    // nothing to reflect on, and the round stays unsettled on purpose: a
    // settled empty round is instantly "all paused", so reflect would fire and
    // ACT would kick off again, forever.
    await recordKickoff(deps, context, accumulator, { tool: "kickoff", round, opened: 0, reasoning });
  }
}

/**
 * Settle a round that has negotiations: record the act, stamp the size, run
 * the final all-paused check, and pick up anything that arrived meanwhile.
 * Returns false — settling nothing — when the round is empty.
 *
 * The SIZE is read back from the round itself rather than counted from the
 * opens: a compensated open and a re-kicked task that init had already moved
 * into this round both belong to it, and only the database knows which
 * survived. The value is a record; what gates the reflect check is that it is
 * no longer null.
 *
 * The ledger row is written FIRST and never throws — accountability must not
 * be able to duplicate a real effect — and the stamp is the last durable
 * write, so a failure there leaves exactly the resumable signature the top of
 * `runKickoff` looks for.
 */
async function settleRound(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  round: number,
  reasoning: string,
  targeted: PersonalAgentMatch[],
): Promise<boolean> {
  const tasks = await deps.negotiationDatabase.getNegotiationTasksForIntentRound(context.intentId, round);
  if (tasks.length === 0) return false;

  await recordKickoff(deps, context, accumulator, { tool: "kickoff", round, opened: tasks.length, reasoning });
  await deps.negotiationDatabase.stampIntentNegotiationRoundSize(context.intentId, round, tasks.length);
  await maybeEnqueueRoundReflect(deps.negotiationDatabase, deps.reflectEnqueue, {
    userId: context.userId,
    intentId: context.intentId,
    round,
  });
  await wakeForNewMatches(deps, context, targeted);
  return true;
}

/**
 * A discovery batch that lands WHILE this turn is running is read past: the
 * match list was assembled at the top of the turn. The inbox coalesces such a
 * batch onto a follow-up job, but that add races the turn going active, so
 * this is the authoritative recovery — a match that exists, is undecided and
 * has no negotiation at all, and was not one of this kickoff's own targets,
 * wakes the agent again. It cannot loop: a target that failed to open is
 * compensated into a task, so it is never "unopened" on the next pass.
 */
async function wakeForNewMatches(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  targeted: PersonalAgentMatch[],
): Promise<void> {
  if (!deps.wakeForMatches) return;
  try {
    const targetedIds = new Set(targeted.map((match) => match.opportunityId));
    const arrivals = (await deps.opportunities.readMatches(context.userId, context.intentId))
      .filter((match) => !targetedIds.has(match.opportunityId) && !NOT_KICKOFF_ELIGIBLE_STATUSES.has(match.status));
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
  try {
    await appendLedger(deps, context, executed);
  } catch (err) {
    logger.error("Failed to ledger a kickoff act", { intentId: context.intentId, round: executed.round, error: err });
  }
  accumulator.acts.push(executed);
}

/**
 * A table whose turn budget is spent cannot produce another substantive turn:
 * re-opening it only re-pauses on the cap, and that pause re-triggers reflect,
 * which kicks off again. This is the cycle's termination guarantee, so it
 * reads the negotiation's OWN state rather than this round's paused set — a
 * negotiation that capped in an earlier round and was excluded from the last
 * kickoff carries that earlier round in its metadata and is absent from the
 * current round entirely.
 */
async function spentItsTurnBudget(deps: PersonalAgentDeps, match: PersonalAgentMatch): Promise<boolean> {
  const task = await deps.negotiationDatabase.getNegotiationTaskForOpportunity(match.opportunityId).catch(() => null);
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
      const paused = context.paused.find((entry) => entry.negotiationId === act.negotiationId)!;
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
      await appendLedger(deps, context, executed);
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
      await appendLedger(deps, context, executed);
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
      await appendLedger(deps, context, executed);
      accumulator.acts.push(executed);
      return;
    }
    case "retire_dossier": {
      const retired = await deps.dossier.retireEntry({ userId: context.userId, entryId: act.entryId });
      const executed: PersonalAgentExecutedAct = { tool: "retire_dossier", entryId: act.entryId, retired };
      await appendLedger(deps, context, executed);
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
  const delivered = await deliverMessage(deps, context, content, options);
  if (!delivered) return;
  const executed: PersonalAgentExecutedAct = {
    tool: "message_user",
    text: content,
    ...(options ? { options } : {}),
    ...delivered,
    stage: "reply",
    ...(fallback ? { fallback } : {}),
  };
  await appendLedger(deps, context, executed);
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
  let seq = 0;
  for (const [index, message] of messages.entries()) {
    const prefixed = index > 0 ? `\n\n${message}` : message;
    for (const content of chunkReplyText(prefixed)) {
      seq += 1;
      await deps.replyStream.publish(messageId, { seq, content });
    }
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
 * the thread and its brief — the brief is the ONLY thing from the DM that
 * reaches a negotiation — and answers with exactly one verb or one pause.
 * It never ends a negotiation; NegotiationGraph's `apply` is the sink.
 */
async function negotiationNode(state: PersonalAgentState, deps: PersonalAgentDeps): Promise<Partial<PersonalAgentState>> {
  const input = state.input as Extract<PersonalAgentInput, { negotiationId: string }>;
  try {
    const task = await deps.negotiationDatabase.getNegotiationTask(input.negotiationId);
    if (!task) return { phase: "error", error: "Negotiation not found" };
    const messages = await deps.negotiationDatabase.getNegotiationMessages(task.id);
    const judgment = deps.judgment ?? defaultJudgment();
    const turn: NegotiationAuthoredTurn = await judgment.negotiationTurn({
      brief: task.brief,
      thread: threadFromMessages(messages, input.userId),
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
