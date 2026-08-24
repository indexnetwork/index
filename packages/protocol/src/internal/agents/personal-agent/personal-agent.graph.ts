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
import { PersonalAgentModel } from "./personal-agent.judgment.js";
import type { PersonalAgentDecidedAct, PersonalAgentDeps, PersonalAgentExecutedAct, PersonalAgentInput, PersonalAgentIntentEventKind, PersonalAgentMatch, PersonalAgentPausedNegotiation, PersonalAgentReply, PersonalAgentReplyFallbackReason, PersonalAgentResult, PersonalAgentScope, PersonalAgentThreadEntry, PersonalAgentTurnContext } from "./personal-agent.types.js";

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

/** Turn one negotiation task's messages into a speaker-relative thread. */
async function loadThread(
  deps: PersonalAgentDeps,
  taskId: string,
  seatUserId: string,
): Promise<PersonalAgentThreadEntry[]> {
  const messages = await deps.negotiationDatabase.getNegotiationMessages(taskId);
  return turnsWithSenders(messages).map(({ senderId, turn }) => ({
    speaker: (senderId === `agent:${seatUserId}` ? "own" : "counterparty") as "own" | "counterparty",
    turn,
  }));
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
 * The round is bumped before the opens and its SIZE is stamped only after
 * they all settle — until that stamp exists, the all-paused check is a no-op,
 * so an early pause cannot dedupe away the round's genuine reflect. Kickoff
 * then runs one final check itself, for the pauses that landed before it.
 */
async function runKickoff(
  deps: PersonalAgentDeps,
  context: PersonalAgentTurnContext,
  accumulator: TurnAccumulator,
  reasoning: string,
): Promise<void> {
  const judgment = deps.judgment ?? defaultJudgment();
  // Re-read: verdicts executed earlier this turn already moved statuses, and
  // a promoted or rejected match must not be re-opened.
  const matches = (await deps.opportunities.readMatches(context.userId, context.intentId))
    .filter((match) => !NOT_KICKOFF_ELIGIBLE_STATUSES.has(match.status))
    .filter((match) => !spentItsTurnBudget(context, match));
  if (matches.length === 0) {
    const executed: PersonalAgentExecutedAct = { tool: "kickoff", round: 0, opened: 0, reasoning };
    await appendLedger(deps, context, executed);
    accumulator.acts.push(executed);
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

  // Only opens that actually produced a negotiation count toward the round's
  // size: an open that failed before creating a task must not strand the
  // round below its stamp forever.
  const opened = opens.filter((open) => open.status === "fulfilled").length;
  for (const open of opens) {
    if (open.status === "rejected") {
      logger.warn("PersonalAgent kickoff open failed", { intentId: context.intentId, round, error: open.reason });
    }
  }

  const executed: PersonalAgentExecutedAct = { tool: "kickoff", round, opened, reasoning };
  await appendLedger(deps, context, executed);
  accumulator.acts.push(executed);

  if (opened === 0) {
    // Nothing to wait for, so nothing to reflect on. Leaving the round
    // unstamped is deliberate: a stamped empty round would immediately
    // re-trigger reflect, and reflect would kick off again — forever.
    return;
  }
  await deps.negotiationDatabase.stampIntentNegotiationRoundSize(context.intentId, round, opened);
  await maybeEnqueueRoundReflect(deps.negotiationDatabase, deps.reflectEnqueue, {
    userId: context.userId,
    intentId: context.intentId,
    round,
  });
}

/** A table whose budget is spent cannot produce another substantive turn. */
function spentItsTurnBudget(context: PersonalAgentTurnContext, match: PersonalAgentMatch): boolean {
  return context.paused.some((paused) => paused.opportunityId === match.opportunityId && paused.reason === "turn_cap");
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
    const thread = await loadThread(deps, task.id, input.userId);
    const judgment = deps.judgment ?? defaultJudgment();
    const turn: NegotiationAuthoredTurn = await judgment.negotiationTurn({
      brief: task.brief,
      thread,
      isOpening: thread.length === 0,
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
