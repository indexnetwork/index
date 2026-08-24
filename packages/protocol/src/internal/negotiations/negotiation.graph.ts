/**
 * NegotiationGraph (rewrite, #1494).
 *
 * Single write path for negotiations. Routes on the shape of its invoke
 * input — no `operationMode`. `init` loads everything through the database
 * port (callers pass ids, never pre-built contexts); `turn` produces the
 * current seat's move, in-process or via an external agent; `apply` is the
 * one sink for every turn regardless of source and decides continue/pause;
 * `resolve` is the only terminal write.
 *
 * The negotiator never concludes a negotiation. It only ever continues or
 * pauses. `resolve` is invoked separately (by IS-A, in step 2; nothing calls
 * it yet in this PR) once a decision has actually been made.
 */
import { END, StateGraph, Annotation } from "@langchain/langgraph";

import type { NegotiationGraphDatabase, NegotiationTaskRow, NegotiationTaskMetadata } from "../../platform/database/negotiation.js";
import type { AgentDispatcher } from "../shared/interfaces/agent-dispatcher.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { NEGOTIATION_MAX_TURNS_AMBIENT } from "../../protocol/core.js";
import { NegotiationAuthor } from "./negotiation.author.js";
import { NegotiationTurnSchema, NegotiationOpeningTurnSchema, isPauseTurn, type NegotiationTurn, type NegotiationVerdict, type NegotiationPauseReason } from "./negotiation.turn.js";
import { negotiationRoundReflectJobId, type NegotiationRoundReflectEnqueueFn } from "./negotiation.round-reflect.js";

const logger = protocolLogger("NegotiationGraph");

// ─── Invoke contract ─────────────────────────────────────────────────────────

export type NegotiationGraphInput =
  /** `round` is the caller's own batch counter — one bump per kickoff batch, not per opportunity. */
  | { opportunityId: string; brief: string; intentId: string; round: number }
  | { negotiationId: string; brief: string }
  /** `byUserId` is the seat submitting this turn; apply rejects a turn whose byUserId isn't the computed next speaker. */
  | { negotiationId: string; turn: NegotiationTurn; byUserId: string }
  | { negotiationId: string; pause: "counterparty_silent" }
  | { negotiationId: string; verdict: NegotiationVerdict; reasoning: string }
  | { negotiationId: string };

export interface NegotiationGraphResult {
  negotiationId: string;
  status: "active" | "paused" | "resolved" | "error";
  pause?: { reason: NegotiationPauseReason; payload?: unknown };
  verdict?: NegotiationVerdict;
  /** Private to the resolving side — never appears in the A2A thread. */
  reasoning?: string;
  turns: NegotiationTurn[];
  error?: string;
}

export interface NegotiationGraphDeps {
  database: NegotiationGraphDatabase;
  dispatcher: AgentDispatcher;
  reflectEnqueue?: NegotiationRoundReflectEnqueueFn;
  /** Interim internal turn author, standing in for AgentGraph (step 2). */
  author?: NegotiationAuthor;
}

// ─── State ───────────────────────────────────────────────────────────────────

const NegotiationGraphState = Annotation.Root({
  input: Annotation<NegotiationGraphInput>({ reducer: (c, n) => n ?? c, default: () => ({} as NegotiationGraphInput) }),
  task: Annotation<NegotiationTaskRow | null>({ reducer: (c, n) => n ?? c, default: () => null }),
  turns: Annotation<NegotiationTurn[]>({ reducer: (c, n) => n ?? c, default: () => [] }),
  /** The turn to apply next — externally supplied, or produced by the turn node. */
  pendingTurn: Annotation<NegotiationTurn | null>({ reducer: (c, n) => n ?? c, default: () => null }),
  /**
   * Set only when pendingTurn was submitted externally via
   * `{ negotiationId, turn, byUserId }` — apply validates it against the
   * computed speaker. Every producer must explicitly pass `null` to clear
   * it for an internally authored turn: unlike the other channels here,
   * `null` is a real value this reducer keeps (`??` would treat it as "no
   * update" and leak a stale byUserId onto the next turn).
   */
  pendingTurnByUserId: Annotation<string | null>({ reducer: (c, n) => (n === undefined ? c : n), default: () => null }),
  /** True once this invoke's own author/dispatch has produced `pendingTurn` — vs. one supplied on input. */
  authored: Annotation<boolean>({ reducer: (c, n) => n ?? c, default: () => false }),
  phase: Annotation<"init" | "turn" | "apply" | "resolve" | "read" | "done" | "error">({
    reducer: (c, n) => n ?? c,
    default: () => "init",
  }),
  result: Annotation<NegotiationGraphResult | null>({ reducer: (c, n) => n ?? c, default: () => null }),
  error: Annotation<string | null>({ reducer: (c, n) => n ?? c, default: () => null }),
});

type NegotiationState = typeof NegotiationGraphState.State;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pairs each message with its parsed turn, dropping unparseable ones — never
 * separately, since `turnsFromMessages(messages).length` can be less than
 * `messages.length` and zipping the two by index afterward would shift every
 * later turn onto the wrong message (and therefore the wrong speaker).
 */
function turnsWithSenders(messages: Array<{ senderId: string; parts: unknown[] }>): Array<{ senderId: string; turn: NegotiationTurn }> {
  const paired: Array<{ senderId: string; turn: NegotiationTurn }> = [];
  for (const m of messages) {
    const part = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === "data");
    const parsed = part ? NegotiationTurnSchema.safeParse(part.data) : undefined;
    if (parsed?.success) paired.push({ senderId: m.senderId, turn: parsed.data });
  }
  return paired;
}

function turnsFromMessages(messages: Array<{ parts: unknown[] }>): NegotiationTurn[] {
  return turnsWithSenders(messages.map((m) => ({ senderId: "", ...m }))).map((p) => p.turn);
}

/** Whose turn is next: retry the last speaker after a pause, else the other seat; the initiator opens. */
function nextSpeaker(
  meta: NegotiationTaskMetadata,
  messages: Array<{ senderId: string; parts: unknown[] }>,
): string {
  const last = messages[messages.length - 1];
  if (!last) return meta.initiatorUserId;
  const lastTurn = turnsFromMessages([last])[0];
  const lastSpeakerId = last.senderId.replace(/^agent:/, "");
  if (lastTurn && isPauseTurn(lastTurn)) return lastSpeakerId;
  return lastSpeakerId === meta.sourceUserId ? meta.candidateUserId : meta.sourceUserId;
}

/**
 * `invoke()` has no notion of who's asking — its result can flow straight
 * back through an external agent's own tool call (e.g. a self-play loop that
 * the caller's own continuing turn set off). So the payload behind a pause
 * never appears here, only the reason: it lives in `task.metadata.pause`,
 * readable only by a caller that separately proves it's `pausedBy`.
 */
function toResult(task: NegotiationTaskRow, turns: NegotiationTurn[]): NegotiationGraphResult {
  const base = { negotiationId: task.id, turns };
  if (task.state === "paused") {
    return { ...base, status: "paused", ...(task.metadata.pause ? { pause: { reason: task.metadata.pause.reason } } : {}) };
  }
  if (task.state === "completed") return { ...base, status: "resolved" };
  return { ...base, status: "active" };
}

// ─── init ────────────────────────────────────────────────────────────────────

async function initNode(state: NegotiationState, deps: NegotiationGraphDeps): Promise<Partial<NegotiationState>> {
  const { input } = state;
  try {
    // ── verdict: resolve is a separate write, not part of the turn loop ──
    if ("verdict" in input) {
      const task = await deps.database.getNegotiationTask(input.negotiationId);
      if (!task) return { phase: "error", error: "Negotiation not found" };
      return { task, phase: "resolve" };
    }

    // ── read-only ──
    if (!("brief" in input) && !("turn" in input) && !("pause" in input)) {
      const task = await deps.database.getNegotiationTask(input.negotiationId);
      if (!task) return { phase: "error", error: "Negotiation not found" };
      const messages = await deps.database.getNegotiationMessages(task.id);
      return { task, turns: turnsFromMessages(messages), phase: "read" };
    }

    // ── open ──
    if ("opportunityId" in input) {
      const existing = await deps.database.getNegotiationTaskForOpportunity(input.opportunityId);
      if (existing) {
        await deps.database.setNegotiationBrief(existing.id, input.brief);
        // A fresh kickoff batch bumped `round` before invoking; stamp it onto
        // the existing task so checkAllPaused's round-scoped count and the
        // eventual pause both reflect the current round, not a stale one.
        if (existing.metadata.round !== input.round) {
          await deps.database.setNegotiationRound(existing.id, input.round);
        }
        const messages = await deps.database.getNegotiationMessages(existing.id);
        return {
          task: { ...existing, brief: input.brief, metadata: { ...existing.metadata, round: input.round } },
          turns: turnsFromMessages(messages),
          phase: existing.state === "completed" ? "read" : "turn",
        };
      }

      const opportunity = await deps.database.getOpportunity(input.opportunityId);
      if (!opportunity) return { phase: "error", error: "Opportunity not found" };
      // Actor selection cannot key off `actor.intent === input.intentId`: a
      // premise-matched actor's `intent` field names the intent it matched
      // AGAINST (the recipient's), not its own, so both actors can carry the
      // same value there. `input.intentId` uniquely identifies its OWNER
      // (intents are user-owned) — resolve the source seat from that owner
      // and exclude any introducer actor, the same selection the old
      // negotiateNode used.
      const intent = await deps.database.getIntent(input.intentId);
      if (!intent) return { phase: "error", error: "Intent not found" };
      const sourceActor = opportunity.actors.find((a) => a.userId === intent.userId && a.role !== "introducer");
      const candidateActor = opportunity.actors.find((a) => a.userId !== intent.userId && a.role !== "introducer");
      if (!sourceActor || !candidateActor) return { phase: "error", error: "Opportunity does not have two actors" };

      const conversation = await deps.database.createNegotiationConversation(sourceActor.userId, candidateActor.userId);
      const task = await deps.database.createNegotiationTask({
        conversationId: conversation.id,
        brief: input.brief,
        metadata: {
          type: "negotiation",
          opportunityId: input.opportunityId,
          sourceUserId: sourceActor.userId,
          candidateUserId: candidateActor.userId,
          initiatorUserId: sourceActor.userId,
          networkId: sourceActor.networkId,
          intentId: input.intentId,
          round: input.round,
        },
      });
      await deps.database.updateOpportunityStatus(input.opportunityId, "negotiating").catch((err) => {
        logger.warn("Failed to set opportunity status to negotiating", { opportunityId: input.opportunityId, error: err });
      });
      return { task, turns: [], phase: "turn" };
    }

    // ── resume with brief, or apply a submitted/system turn ──
    const task = await deps.database.getNegotiationTask(input.negotiationId);
    if (!task) return { phase: "error", error: "Negotiation not found" };
    if (task.state === "completed") return { task, turns: [], phase: "read" };

    // A pause is one-way at rest, not a dead end: any resume (new brief, a
    // submitted turn, or a timeout) reopens the negotiation — but only once
    // apply actually persists a turn (see applyNode). Flipping state here,
    // before validation, would strand a rejected turn's negotiation
    // "working" with no pause and no applied turn.

    if ("brief" in input) {
      await deps.database.setNegotiationBrief(task.id, input.brief);
      const messages = await deps.database.getNegotiationMessages(task.id);
      return { task: { ...task, brief: input.brief }, turns: turnsFromMessages(messages), phase: "turn" };
    }

    // An externally submitted turn crosses an untrusted boundary — the graph
    // is the single write path and cannot rely on every caller having
    // validated it upstream. Re-parse here rather than trusting the static
    // type, the same way `respond_to_negotiation` validates before invoking.
    let pendingTurn: NegotiationTurn;
    if ("turn" in input) {
      const parsedTurn = NegotiationTurnSchema.safeParse(input.turn);
      if (!parsedTurn.success) {
        return { phase: "error", error: `Invalid turn: ${parsedTurn.error.issues[0]?.message ?? "schema validation failed"}` };
      }
      pendingTurn = parsedTurn.data;
    } else {
      pendingTurn = { verb: "pause", reason: "counterparty_silent" };
    }

    const messages = await deps.database.getNegotiationMessages(task.id);
    const turns = turnsFromMessages(messages);
    return {
      task,
      turns,
      pendingTurn,
      pendingTurnByUserId: "turn" in input ? input.byUserId : null,
      authored: true,
      phase: "apply",
    };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── turn ────────────────────────────────────────────────────────────────────

async function turnNode(state: NegotiationState, deps: NegotiationGraphDeps): Promise<Partial<NegotiationState>> {
  const task = state.task;
  if (!task) return { phase: "error", error: "Missing task" };
  const meta = task.metadata;
  try {
    const messages = await deps.database.getNegotiationMessages(task.id);
    // Paired, not two separately-filtered arrays zipped by index: an
    // unparseable message must drop with its own turn, never shift every
    // later turn onto the wrong message's sender.
    const paired = turnsWithSenders(messages);
    const turns = paired.map((p) => p.turn);
    const speakerId = nextSpeaker(meta, messages);
    // Raw message count, not parsed-turn count: a legacy task with unparseable
    // (pre-rewrite) messages has turns.length === 0 but messages.length > 0.
    // applyNode's outreach guard keys off messages.length too — the two must
    // agree on "is this the opening turn" or a re-kick error forever (turnNode
    // authors 'outreach' for a legacy task's continuation, applyNode rejects
    // it because history is non-empty).
    const isOpening = messages.length === 0;

    const thread = paired.map(({ senderId, turn }) => ({
      speaker: (senderId === `agent:${speakerId}` ? "own" : "counterparty") as "own" | "counterparty",
      turn,
    }));
    const scope = { action: "manage:negotiations", scopeType: "network", scopeId: meta.networkId };
    const timeoutMs = 5 * 60 * 1000;

    const hasExternal = await deps.dispatcher.hasExternalAgent(speakerId, scope).catch(() => false);
    let turn: NegotiationTurn | null = null;
    if (hasExternal) {
      const dispatched = await deps.dispatcher.dispatch(
        speakerId,
        scope,
        { negotiationId: task.id, brief: task.brief, thread, isOpening },
        { timeoutMs },
      );
      if (dispatched.handled) {
        turn = dispatched.turn;
      } else if (dispatched.reason === "waiting") {
        // Yielded to an external agent; the answer arrives later via `{ negotiationId, turn }`.
        return { task, turns, phase: "done", result: toResult(task, turns) };
      }
      // 'no_agent' / 'timeout' fall through to the internal author below.
    }

    if (!turn) {
      const author = deps.author ?? new NegotiationAuthor();
      turn = isOpening
        ? NegotiationOpeningTurnSchema.parse(await author.invoke({ brief: task.brief, thread, isOpening: true }))
        : await author.invoke({ brief: task.brief, thread, isOpening: false });
    }

    return { task, turns, pendingTurn: turn, pendingTurnByUserId: null, authored: true, phase: "apply" };
  } catch (err) {
    logger.error("Turn authoring failed", { taskId: task.id, error: err });
    return {
      task,
      turns: [],
      pendingTurn: { verb: "pause", reason: "counterparty_silent" },
      pendingTurnByUserId: null,
      authored: true,
      phase: "apply",
    };
  }
}

// ─── apply ───────────────────────────────────────────────────────────────────

async function applyNode(state: NegotiationState, deps: NegotiationGraphDeps): Promise<Partial<NegotiationState>> {
  const task = state.task;
  const turn = state.pendingTurn;
  if (!task || !turn) return { phase: "error", error: "Missing task or turn" };
  const meta = task.metadata;
  try {
    const messages = await deps.database.getNegotiationMessages(task.id);
    const speakerId = nextSpeaker(meta, messages);

    // An externally submitted turn must come from the seat the graph itself
    // computed as next — the submitter cannot author a turn attributed to
    // the other side.
    if (state.pendingTurnByUserId && state.pendingTurnByUserId !== speakerId) {
      return { phase: "error", error: "Turn submitted by the wrong seat" };
    }

    // A pause is always legal, even opening an empty thread (a system
    // timeout or a first-turn authoring failure) — only a *continuing* verb
    // is bound by the outreach-only-first rule.
    if (messages.length === 0 && !isPauseTurn(turn) && turn.verb !== "outreach") {
      return { phase: "error", error: "The opening turn must be outreach" };
    }
    if (messages.length > 0 && !isPauseTurn(turn) && turn.verb === "outreach") {
      return { phase: "error", error: "outreach is only legal as the opening turn" };
    }

    const capped = !isPauseTurn(turn) && messages.length + 1 >= NEGOTIATION_MAX_TURNS_AMBIENT;
    const effectiveTurn: NegotiationTurn = capped ? { verb: "pause", reason: "counterparty_silent" } : turn;

    // The payload on needs_principal/ready_for_verdict is private to the
    // pausing side's own principal — it is never written into the shared
    // thread (read by the counterparty via get_negotiation, and rebuilt into
    // the dispatch `thread` for whoever is authoring next). The full payload
    // lives only in task.metadata.pause, scoped to `pausedBy`.
    const threadTurn: NegotiationTurn =
      isPauseTurn(effectiveTurn) && "payload" in effectiveTurn
        ? { verb: "pause", reason: effectiveTurn.reason }
        : effectiveTurn;

    const message = await deps.database.createNegotiationMessage({
      conversationId: task.conversationId,
      taskId: task.id,
      senderId: `agent:${speakerId}`,
      parts: [{ kind: "data", data: threadTurn }],
      expectedMessageCount: messages.length,
    });
    if (!message) {
      return { phase: "error", error: "Concurrent turn already applied to this negotiation" };
    }
    const allTurns = [...turnsFromMessages(messages), threadTurn];

    // Resume happens here, after every rejection path (wrong seat, outreach
    // rule, CAS conflict) has already returned — none of them should flip a
    // paused negotiation to working. A turn that reaches this point is
    // persisted, so the resume is real regardless of what happens next.
    let currentTask = task;
    if (currentTask.state === "paused") {
      // Explicit null, not omitted: updateNegotiationTaskState only merges a
      // new pause into metadata when the argument is passed at all — omitting
      // it here would leave the just-answered pause (question, recommendation)
      // sitting in metadata after the state flips to "working", so a reader
      // that doesn't gate on state (the API's lifecycle-summary projection)
      // would keep showing "needs your input" for a question already resolved.
      currentTask = await deps.database.updateNegotiationTaskState(currentTask.id, "working", null);
    }

    if (isPauseTurn(effectiveTurn)) {
      const updated = await deps.database.updateNegotiationTaskState(currentTask.id, "paused", {
        reason: effectiveTurn.reason,
        pausedBy: speakerId,
        ...("payload" in effectiveTurn ? { payload: effectiveTurn.payload } : {}),
      });
      await checkAllPaused(deps, meta);
      return { task: updated, turns: allTurns, phase: "done", result: toResult(updated, allTurns) };
    }

    // Continue: loop back for the other seat.
    return { task: currentTask, turns: allTurns, pendingTurn: null, pendingTurnByUserId: null, authored: false, phase: "turn" };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/** If no active negotiation remains for this round, enqueue exactly one reflect job. */
async function checkAllPaused(deps: NegotiationGraphDeps, meta: NegotiationTaskMetadata): Promise<void> {
  if (!deps.reflectEnqueue) return;
  try {
    const active = await deps.database.countActiveNegotiationsForRound(meta.intentId, meta.round);
    if (active === 0) {
      await deps.reflectEnqueue({ intentId: meta.intentId, round: meta.round });
    }
  } catch (err) {
    logger.warn("Failed to check all-paused / enqueue reflect", {
      intentId: meta.intentId,
      round: meta.round,
      jobId: negotiationRoundReflectJobId(meta.intentId, meta.round),
      error: err,
    });
  }
}

// ─── resolve ─────────────────────────────────────────────────────────────────

async function resolveNode(state: NegotiationState, deps: NegotiationGraphDeps): Promise<Partial<NegotiationState>> {
  const task = state.task;
  const input = state.input;
  if (!task || !("verdict" in input)) return { phase: "error", error: "Missing task or verdict" };
  try {
    // reasoning is private to the resolving side — recorded on the outcome
    // artifact only, never persisted into the A2A thread as a message; the
    // counterparty sees only that the negotiation closed.
    await deps.database.createNegotiationOutcomeArtifact(task.id, { verdict: input.verdict, reasoning: input.reasoning });
    const updated = await deps.database.updateNegotiationTaskState(task.id, "completed");
    await deps.database.updateOpportunityStatus(
      task.metadata.opportunityId,
      input.verdict === "pending" ? "pending" : "rejected",
    );
    // A round whose last active negotiation ends by direct verdict (not a
    // pause) must still trigger the all-paused check — apply isn't the only
    // way a round finishes.
    await checkAllPaused(deps, task.metadata);
    return { task: updated, phase: "done", result: { negotiationId: task.id, status: "resolved", verdict: input.verdict, reasoning: input.reasoning, turns: [] } };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── read ────────────────────────────────────────────────────────────────────

function readNode(state: NegotiationState): Partial<NegotiationState> {
  if (!state.task) return { phase: "error", error: "Missing task" };
  return { phase: "done", result: toResult(state.task, state.turns) };
}

function errorNode(state: NegotiationState): Partial<NegotiationState> {
  return {
    result: {
      negotiationId: "negotiationId" in state.input ? state.input.negotiationId : "",
      status: "error",
      turns: [],
      error: state.error ?? "Unknown error",
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Typed invoke signature, for host-side and caller typing. */
export interface NegotiationGraphLike {
  invoke(input: NegotiationGraphInput): Promise<NegotiationGraphResult>;
}

export class NegotiationGraphFactory {
  constructor(public readonly deps: NegotiationGraphDeps) {}

  createGraph(): NegotiationGraphLike {
    const deps = this.deps;
    const compiled = new StateGraph(NegotiationGraphState)
      .addNode("init", (s: NegotiationState) => initNode(s, deps))
      .addNode("turn", (s: NegotiationState) => turnNode(s, deps))
      .addNode("apply", (s: NegotiationState) => applyNode(s, deps))
      .addNode("resolve", (s: NegotiationState) => resolveNode(s, deps))
      .addNode("read", readNode)
      // Named "fail", not "error" — "error" is already the state's own
      // channel name, and LangGraph rejects a node name that collides with
      // one (throws at createGraph() time, not at invoke time).
      .addNode("fail", errorNode)
      .addEdge("__start__", "init")
      .addConditionalEdges("init", (s: NegotiationState) => s.phase, {
        turn: "turn",
        apply: "apply",
        resolve: "resolve",
        read: "read",
        error: "fail",
      })
      .addConditionalEdges("turn", (s: NegotiationState) => s.phase, { apply: "apply", done: END, error: "fail" })
      .addConditionalEdges("apply", (s: NegotiationState) => s.phase, { turn: "turn", done: END, error: "fail" })
      .addEdge("resolve", END)
      .addEdge("read", END)
      .addEdge("fail", END)
      .compile();

    return {
      async invoke(input: NegotiationGraphInput): Promise<NegotiationGraphResult> {
        const final = await compiled.invoke({ input });
        if (final.result) return final.result;
        return {
          negotiationId: "negotiationId" in input ? input.negotiationId : "",
          status: "error",
          turns: [],
          error: final.error ?? "Unknown graph error",
        };
      },
    };
  }
}
