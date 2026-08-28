/**
 * NegotiationGraph (rewrite, #1494).
 *
 * Single write path for negotiations. Routes on the shape of its invoke
 * input — no `operationMode`. `init` loads everything through the database
 * port (callers pass ids, never pre-built contexts); `turn` produces the
 * current seat's move, in-process or via an external agent; `apply` is the
 * one sink for every turn regardless of source and decides continue/pause;
 * `resolve` records a pause owner's verdict, while `close` ends a task after
 * the host has already committed an opportunity-owner verdict.
 *
 * The negotiator never concludes a negotiation. It only ever continues or
 * pauses. `resolve` is invoked separately by the owning PersonalAgent once a
 * decision has actually been made.
 */
import { END, StateGraph, Annotation } from "@langchain/langgraph";

import type { NegotiationGraphDatabase, NegotiationRoundLogDatabase, NegotiationTaskRow, NegotiationTaskMetadata } from "../../platform/database/negotiation.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { NEGOTIATION_MAX_TURNS_AMBIENT } from "../../protocol/core.js";
import { NegotiationTurnSchema, NegotiationOpeningTurnSchema, isPauseTurn, turnsFromMessages, turnsWithSenders, type NegotiationTurn, type NegotiationVerdict, type NegotiationPauseReason, type NegotiationSystemPauseReason } from "./negotiation.turn.js";
import { maybeEnqueueRoundReflect, type NegotiationRoundReflectEnqueueFn } from "./negotiation.round-reflect.js";
import type { NegotiationTurnAuthor } from "./negotiation.turn-author.js";

const logger = protocolLogger("NegotiationGraph");

// ─── Invoke contract ─────────────────────────────────────────────────────────

export type NegotiationGraphInput =
  /**
   * `batchId` is the caller's own kickoff batch id — one bump per kickoff
   * batch, not per opportunity. `brief` is the INITIATING seat's own brief —
   * the seat that owns `intentId` — and never the counterparty's, which that
   * seat's own agent authors at its first turn.
   */
  | { opportunityId: string; brief: string; intentId: string; batchId: string }
  /**
   * Resume with a fresh brief for ONE seat, named explicitly. `byUserId` is
   * not optional and is not inferred: the same "assume it is `sourceUserId`"
   * shortcut on the open path wrote one seat's brief into the other's slot.
   */
  | { negotiationId: string; brief: string; byUserId: string }
  /** `byUserId` is the seat submitting this turn; apply rejects a turn whose byUserId isn't the computed next speaker. */
  | { negotiationId: string; turn: NegotiationTurn; byUserId: string }
  | { negotiationId: string; pause: NegotiationSystemPauseReason }
  | { negotiationId: string; expire: { expectedUpdatedAt: Date; reason: 'counterparty_silent' | 'needs_principal' } }
  /** A verdict is authored by one authenticated seat, never by an anonymous resolver. */
  | { negotiationId: string; verdict: NegotiationVerdict; reasoning: string; byUserId: string }
  /** Close a task after the host has already committed its owner's terminal opportunity action. */
  | { negotiationId: string; close: { reason: "owner_verdict"; verdict: NegotiationVerdict; reasoning: string }; byUserId: string }
  /** Close an active task after the host has expired its opportunity. */
  | { negotiationId: string; close: { reason: "opportunity_expired" } }
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
  /** The append-only round-log a batch's settlement is folded from (#1494). */
  roundLog: NegotiationRoundLogDatabase;
  reflectEnqueue?: NegotiationRoundReflectEnqueueFn;
  /** Delivers an owned needs-principal pause immediately; batch reflection remains separate. */
  needsPrincipalEnqueue?: (input: { userId: string; intentId: string; negotiationId: string; generation: number }) => Promise<void>;
  /** Delivers the other agent's terminal verdict to each opposing PersonalAgent. */
  resolutionEnqueue?: (input: { userId: string; intentId: string; negotiationId: string; verdict: "pending" | "reject" }) => Promise<void>;
  /**
   * Who plays a seat's turn. Production binds this to the PersonalAgent in
   * negotiation scope; the graph itself never knows a model exists.
   */
  author: NegotiationTurnAuthor;
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
  phase: Annotation<"init" | "turn" | "apply" | "resolve" | "close" | "expire" | "read" | "done" | "error">({
    reducer: (c, n) => n ?? c,
    default: () => "init",
  }),
  result: Annotation<NegotiationGraphResult | null>({ reducer: (c, n) => n ?? c, default: () => null }),
  error: Annotation<string | null>({ reducer: (c, n) => n ?? c, default: () => null }),
  /** A safe, private classification of a failed in-process turn author. */
  authorFailure: Annotation<string | null>({ reducer: (c, n) => n ?? c, default: () => null }),
  /** Bounded diagnostic detail, retained only with the task's private pause metadata. */
  authorFailureDetail: Annotation<string | null>({ reducer: (c, n) => n ?? c, default: () => null }),
});

type NegotiationState = typeof NegotiationGraphState.State;

function classifyAuthorFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (error instanceof DOMException && error.name === "TimeoutError") return "author_timeout";
  if (/\btimeout\b|\btimed out\b|\babort(?:ed)?\b/.test(message)) return "author_timeout";
  if (/\b429\b|rate.?limit|too many requests/.test(message)) return "provider_rate_limited";
  if (/\b5\d\d\b|provider unavailable|service unavailable|internal server error/.test(message)) return "provider_unavailable";
  if (/zod|schema|structured output|parse/.test(message)) return "invalid_author_output";
  return "author_failed";
}

function authorFailureDetail(error: unknown): string {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  // Provider errors can include request headers. Task metadata is private, but
  // credentials never belong in any persisted diagnostic.
  return detail.replace(/(?:sk|napi)_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

    if ("close" in input) {
      const task = await deps.database.getNegotiationTask(input.negotiationId);
      if (!task) return { phase: "error", error: "Negotiation not found" };
      return { task, phase: "close" };
    }

    // ── read-only ──
    if (!("brief" in input) && !("turn" in input) && !("pause" in input) && !("expire" in input)) {
      const task = await deps.database.getNegotiationTask(input.negotiationId);
      if (!task) return { phase: "error", error: "Negotiation not found" };
      const messages = await deps.database.getNegotiationMessages(task.id);
      return { task, turns: turnsFromMessages(messages), phase: "read" };
    }

    // ── open ──
    if ("opportunityId" in input) {
      const existing = await deps.database.getNegotiationTaskForOpportunity(input.opportunityId);
      const opportunity = await deps.database.getOpportunity(input.opportunityId);
      if (!opportunity) return { phase: "error", error: "Opportunity not found" };
      // Actor selection cannot key off `actor.intent === input.intentId`: a
      // premise-matched actor's `intent` field names the intent it matched
      // AGAINST (the recipient's), not its own, so both actors can carry the
      // same value there. `input.intentId` uniquely identifies its OWNER
      // (intents are user-owned) — resolve the source seat from that owner
      // and exclude any introducer actor, the same selection the old
      // negotiateNode used.
      // An introduction nobody vouched for is not a negotiation anyone may
      // open. Discovery's own gate decides whether to WAKE an agent; this one
      // decides whether a negotiation may EXIST, and it is the write, so it
      // binds every caller — a kickoff that re-read the match list and swept
      // this opportunity up with the others included.
      const introducers = opportunity.actors.filter((a) => a.role === "introducer");
      if (introducers.length > 0 && !introducers.every((a) => a.approved === true)) {
        return { phase: "error", error: "Opportunity is awaiting introducer approval" };
      }

      const intent = await deps.database.getIntent(input.intentId);
      if (!intent) return { phase: "error", error: "Intent not found" };
      const sourceActor = opportunity.actors.find((a) => a.userId === intent.userId && a.role !== "introducer");
      const candidateActor = opportunity.actors.find((a) => a.userId !== intent.userId && a.role !== "introducer");
      if (!sourceActor || !candidateActor) return { phase: "error", error: "Opportunity does not have two actors" };
      if (!candidateActor.intent) return { phase: "error", error: "Counterparty actor has no owning intent" };
      const candidateIntent = await deps.database.getIntent(candidateActor.intent);
      if (!candidateIntent || candidateIntent.userId !== candidateActor.userId) {
        return { phase: "error", error: "Counterparty actor intent is not owned by that seat" };
      }
      const candidateBatch = await deps.database.getIntentNegotiationBatch(candidateIntent.id);
      // A candidate seat that has never itself run a kickoff gets a batch
      // lazily, the first time any negotiation touches it — the same
      // "passive round" every never-kicked signal started on before this
      // rewrite. Marked opening_complete immediately: nothing will ever
      // stamp a size for a batch no kickoff opened, so this batch is never
      // gated on one — it settles as soon as whatever tasks land in it stop.
      let candidateBatchId = candidateBatch.batchId;
      if (candidateBatchId === null) {
        candidateBatchId = (await deps.database.bumpIntentNegotiationBatch(candidateIntent.id)).batchId;
        await deps.roundLog.appendNegotiationRoundLogEvent(candidateIntent.id, { kind: "opening_complete", batchId: candidateBatchId });
      }
      const seats = {
        [input.intentId]: { userId: sourceActor.userId, batchId: input.batchId },
        [candidateIntent.id]: { userId: candidateActor.userId, batchId: candidateBatchId },
      };

      const opened = await deps.database.openNegotiationTask({
        opportunityId: input.opportunityId,
        sourceUserId: sourceActor.userId,
        candidateUserId: candidateActor.userId,
        brief: input.brief,
        seats,
        networkId: sourceActor.networkId,
        ...(existing ? { knownTaskId: existing.id } : {}),
      });
      if (!opened) return { phase: "error", error: "Opportunity is not eligible to open" };

      if (opened.disposition === 'created') {
        // The candidate's own passive log must know this task belongs to its
        // current batch, or that batch's fold would see zero opened tasks and
        // settle trivially the instant opening_complete lands — ignoring a
        // real, still-active negotiation.
        await deps.roundLog.appendNegotiationRoundLogEvent(candidateIntent.id, {
          kind: "opened", taskId: opened.task.id, batchId: candidateBatchId,
        });
      }

      if (opened.disposition !== 'created') {
        // Bind only the kicking seat. A task seen before the transaction is a
        // genuine re-kick and continues through turn; one first observed by
        // the transaction raced another opener and must not author opening.
        await deps.database.setNegotiationBrief(opened.task.id, sourceActor.userId, input.brief);
        await deps.database.bindNegotiationSeat(opened.task.id, input.intentId, { userId: sourceActor.userId, batchId: input.batchId });
        const messages = await deps.database.getNegotiationMessages(opened.task.id);
        const task = {
          ...opened.task,
          briefs: { ...opened.task.briefs, [sourceActor.userId]: input.brief },
          metadata: {
            ...opened.task.metadata,
            seats: { ...opened.task.metadata.seats, [input.intentId]: seats[input.intentId]! },
          },
        };
        return {
          task,
          turns: turnsFromMessages(messages),
          phase: opened.disposition === 'raced' ? 'read' : 'turn',
        };
      }

      return { task: opened.task, turns: [], phase: "turn" };
    }

    // ── resume with brief, or apply a submitted/system turn ──
    const task = await deps.database.getNegotiationTask(input.negotiationId);
    if (!task) return { phase: "error", error: "Negotiation not found" };
    if (task.state === "completed") return { task, turns: [], phase: "read" };

    if ("expire" in input) return { task, phase: "expire" };

    // A pause is one-way at rest, not a dead end: any resume (new brief, a
    // submitted turn, or a timeout) reopens the negotiation — but only once
    // apply actually persists a turn (see applyNode). Flipping state here,
    // before validation, would strand a rejected turn's negotiation
    // "working" with no pause and no applied turn.

    if ("brief" in input) {
      if (input.byUserId !== task.metadata.sourceUserId && input.byUserId !== task.metadata.candidateUserId) {
        return { phase: "error", error: "Brief submitted for a user who is not a seat on this negotiation" };
      }
      await deps.database.setNegotiationBrief(task.id, input.byUserId, input.brief);
      const messages = await deps.database.getNegotiationMessages(task.id);
      return {
        task: { ...task, briefs: { ...task.briefs, [input.byUserId]: input.brief } },
        turns: turnsFromMessages(messages),
        phase: "turn",
      };
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
      pendingTurn = { verb: "pause", reason: input.pause };
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
    // authors 'outreach' for a legacy task after prior malformed history, applyNode rejects
    // it because history is non-empty).
    const isOpening = messages.length === 0;

    const intentId = Object.entries(meta.seats).find(([, seat]) => seat.userId === speakerId)?.[0];
    if (!intentId) return { task, turns, phase: "error", error: "Speaking seat has no bound intent" };

    // Every turn is authored in-process, synchronously, within this invoke:
    // the author is the speaking seat's own PersonalAgent in negotiation
    // scope, which reads the thread and the brief and answers with one verb.
    const authored = await deps.author.authorTurn({
      negotiationId: task.id,
      userId: speakerId,
      intentId,
    });
    const turn: NegotiationTurn = isOpening ? NegotiationOpeningTurnSchema.parse(authored) : authored;

    return { task, turns, pendingTurn: turn, pendingTurnByUserId: null, authored: true, phase: "apply" };
  } catch (err) {
    logger.error("Turn authoring failed", { taskId: task.id, error: err });
    return {
      task,
      turns: [],
      // This is an author/provider failure, not evidence that the other
      // agent went silent. Persist the recoverable system failure honestly.
      pendingTurn: { verb: "pause", reason: "open_failed" },
      pendingTurnByUserId: null,
      authorFailure: classifyAuthorFailure(err),
      authorFailureDetail: authorFailureDetail(err),
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

    // Substantive turns only — messages.length also counts persisted pause
    // markers (a negotiation with several pause/resume cycles accumulates
    // one message per pause), which would trip the cap far earlier than the
    // ambient turn budget actually intends.
    const substantiveTurnCount = turnsFromMessages(messages).filter((t) => !isPauseTurn(t)).length;
    const capped = !isPauseTurn(turn) && substantiveTurnCount + 1 >= NEGOTIATION_MAX_TURNS_AMBIENT;
    // An externally submitted turn that hits the cap is rejected outright —
    // silently swapping it for a fabricated pause would discard whatever the
    // caller actually said and report success for content that was never
    // applied. A self-play-authored turn has no caller to reject to; it
    // auto-pauses instead, with the honest 'turn_cap' reason rather than the
    // factually false 'counterparty_silent' (nobody went silent — the budget
    // ran out).
    if (capped && state.pendingTurnByUserId) {
      return { phase: "error", error: "Negotiation has reached its turn cap and cannot continue" };
    }
    const effectiveTurn: NegotiationTurn = capped ? { verb: "pause", reason: "turn_cap" } : turn;

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
      await appendRoundLogEventForEverySeat(deps, meta, currentTask.id, { kind: "resumed" });
    }

    if (isPauseTurn(effectiveTurn)) {
      const updated = await deps.database.updateNegotiationTaskState(currentTask.id, "paused", {
        reason: effectiveTurn.reason,
        pausedBy: speakerId,
        ...("payload" in effectiveTurn ? { payload: effectiveTurn.payload } : {}),
        ...(effectiveTurn.reason === "open_failed" && state.authorFailure ? { failure: state.authorFailure } : {}),
        ...(effectiveTurn.reason === "open_failed" && state.authorFailureDetail ? { failureDetail: state.authorFailureDetail } : {}),
      });
      if (effectiveTurn.reason === "needs_principal") {
        const intentId = Object.entries(meta.seats).find(([, seat]) => seat.userId === speakerId)?.[0];
        if (intentId && deps.needsPrincipalEnqueue) {
          try {
            await deps.needsPrincipalEnqueue({
              userId: speakerId,
              intentId,
              negotiationId: updated.id,
              // The persisted turn's own message-count position: unique and
              // monotonic per task, same property the deleted drainGeneration
              // counter gave this dedupe key.
              generation: messages.length,
            });
          } catch (error) {
            // The pause is already durable. A missed wake must not undo it or
            // misreport the turn as failed; the all-paused reflect still retries later.
            logger.error("Failed to enqueue needs-principal notification", {
              negotiationId: updated.id,
              intentId,
              error,
            });
          }
        }
      }
      // EVERY bound seat: a pause can complete either side's batch, and each
      // side's IS-A reflects on its own.
      await appendRoundLogEventForEverySeat(deps, meta, updated.id, {
        kind: "stopped",
        via: "paused",
        reason: effectiveTurn.reason,
      });
      await triggerReflectForEverySeat(deps, meta);
      return { task: updated, turns: allTurns, phase: "done", result: toResult(updated, allTurns) };
    }

    // Continue: loop back for the other seat.
    return { task: currentTask, turns: allTurns, pendingTurn: null, pendingTurnByUserId: null, authored: false, phase: "turn" };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Append one round-log event (stopped or resumed) for every seat bound to
 * this negotiation that has a batch to log against. Two cases skip: a seat
 * whose intent has never kicked off (`batchId` is `null`) — its own reflect
 * starts once its first kickoff bumps one — and a seat bound before this
 * mechanism existed, whose stored `{userId, round}` shape has no `batchId`
 * field at all (`undefined`, not `null`); `!binding.batchId` catches both,
 * where `=== null` alone would let a pre-cutover task try to log an
 * `undefined` batch id and fail the NOT NULL write.
 */
async function appendRoundLogEventForEverySeat(
  deps: NegotiationGraphDeps,
  meta: NegotiationTaskMetadata,
  taskId: string,
  event: { kind: "resumed" } | { kind: "stopped"; via: "paused" | "completed"; reason?: NegotiationPauseReason },
): Promise<void> {
  await Promise.all(Object.entries(meta.seats).map(async ([intentId, binding]) => {
    if (!binding.batchId) return;
    if (event.kind === "resumed") {
      await deps.roundLog.appendNegotiationRoundLogEvent(intentId, { kind: "resumed", taskId, batchId: binding.batchId });
      return;
    }
    await deps.roundLog.appendNegotiationRoundLogEvent(intentId, {
      kind: "stopped", taskId, batchId: binding.batchId, via: event.via, ...(event.reason ? { reason: event.reason } : {}),
    });
  }));
}

/**
 * Run the all-paused check for every seat bound to this negotiation.
 *
 * Both sides batch their own kickoffs, so one pause can be the last one of
 * either side's — checking only the opener's would leave the counterparty's
 * batch waiting on a negotiation that had already stopped. A seat with no
 * batch — never kicked off (`batchId` is `null`), or bound before this
 * mechanism existed (`batchId` is `undefined`) — has nothing to fold.
 */
async function triggerReflectForEverySeat(deps: NegotiationGraphDeps, meta: NegotiationTaskMetadata): Promise<boolean> {
  let succeeded = true;
  for (const [intentId, binding] of Object.entries(meta.seats)) {
    if (!binding.batchId) continue;
    const checked = await maybeEnqueueRoundReflect(deps.roundLog, deps.reflectEnqueue, {
      userId: binding.userId,
      intentId,
      batchId: binding.batchId,
    });
    succeeded &&= checked;
  }
  return succeeded;
}

async function clearReflectPendingBestEffort(deps: NegotiationGraphDeps, taskId: string): Promise<void> {
  try {
    await deps.database.clearNegotiationReflectPending(taskId);
  } catch (error) {
    logger.error("Failed to clear durable reflect marker; watchdog will retry", { taskId, error });
  }
}

async function notifyCounterparties(
  deps: NegotiationGraphDeps,
  meta: NegotiationTaskMetadata,
  negotiationId: string,
  resolvedByUserId: string,
  verdict: "pending" | "reject",
): Promise<void> {
  if (!deps.resolutionEnqueue) return;
  for (const [intentId, seat] of Object.entries(meta.seats)) {
    if (seat.userId === resolvedByUserId) continue;
    await deps.resolutionEnqueue({ userId: seat.userId, intentId, negotiationId, verdict });
  }
}

// ─── resolve ─────────────────────────────────────────────────────────────────

async function resolveNode(state: NegotiationState, deps: NegotiationGraphDeps): Promise<Partial<NegotiationState>> {
  const task = state.task;
  const input = state.input;
  if (!task || !("verdict" in input)) return { phase: "error", error: "Missing task or verdict" };
  try {
    const isSeat = Object.values(task.metadata.seats).some((seat) => seat.userId === input.byUserId)
      || task.metadata.sourceUserId === input.byUserId
      || task.metadata.candidateUserId === input.byUserId;
    if (!isSeat) return { phase: "error", error: "Only a negotiation seat may resolve it" };
    const ownsReadyPause = task.state === "paused"
      && task.metadata.pause?.reason === "ready_for_verdict"
      && task.metadata.pause.pausedBy === input.byUserId;
    if (!ownsReadyPause) {
      return { phase: "error", error: "Only the seat owning a ready_for_verdict pause may resolve it" };
    }
    // The database rechecks pause ownership and locks the task + opportunity
    // before writing. That makes completion, the private outcome, and the
    // non-terminal opportunity transition one transaction, so a concurrent
    // human verdict cannot be overwritten after an earlier status read.
    const updated = await deps.database.completeNegotiation({
      taskId: task.id,
      kind: "pause_verdict",
      verdict: input.verdict,
      reasoning: input.reasoning,
      resolvedByUserId: input.byUserId,
    });
    if (!updated) return { phase: "error", error: "Negotiation changed before its verdict committed" };
    await notifyCounterparties(deps, task.metadata, task.id, input.byUserId, input.verdict);
    // A batch whose last active negotiation ends by direct verdict (not a
    // pause) must still trigger the all-paused check — apply isn't the only
    // way a batch finishes.
    await appendRoundLogEventForEverySeat(deps, task.metadata, task.id, { kind: "stopped", via: "completed" });
    if (await triggerReflectForEverySeat(deps, task.metadata)) {
      await clearReflectPendingBestEffort(deps, task.id);
    }
    return { task: updated, phase: "done", result: { negotiationId: task.id, status: "resolved", verdict: input.verdict, reasoning: input.reasoning, turns: [] } };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Host-only closure after a terminal opportunity action. */
async function closeNode(state: NegotiationState, deps: NegotiationGraphDeps): Promise<Partial<NegotiationState>> {
  const task = state.task;
  const input = state.input;
  if (!task || !("close" in input)) return { phase: "error", error: "Missing task or close action" };
  try {
    if (input.close.reason === "opportunity_expired") {
      const updated = await deps.database.completeNegotiation({
        taskId: task.id,
        kind: "opportunity_expired",
      });
      if (!updated) return { phase: "error", error: "Expiry closure requires a live task and expired opportunity" };
      await appendRoundLogEventForEverySeat(deps, task.metadata, task.id, { kind: "stopped", via: "completed" });
      if (await triggerReflectForEverySeat(deps, task.metadata)) {
        await clearReflectPendingBestEffort(deps, task.id);
      }
      return { task: updated, phase: "done", result: { negotiationId: task.id, status: "resolved", turns: [] } };
    }
    if (!("byUserId" in input)) return { phase: "error", error: "Missing owner-verdict resolver" };
    const isSeat = Object.values(task.metadata.seats).some((seat) => seat.userId === input.byUserId)
      || task.metadata.sourceUserId === input.byUserId
      || task.metadata.candidateUserId === input.byUserId;
    if (!isSeat) return { phase: "error", error: "Only a negotiation seat may close it" };
    const updated = await deps.database.completeNegotiation({
      taskId: task.id,
      kind: "owner_verdict",
      verdict: input.close.verdict,
      reasoning: input.close.reasoning,
      resolvedByUserId: input.byUserId,
    });
    if (!updated) return { phase: "error", error: "Owner-verdict closure requires a live task and terminal opportunity" };
    await appendRoundLogEventForEverySeat(deps, task.metadata, task.id, { kind: "stopped", via: "completed" });
    if (await triggerReflectForEverySeat(deps, task.metadata)) {
      await clearReflectPendingBestEffort(deps, task.id);
    }
    return {
      task: updated,
      phase: "done",
      result: {
        negotiationId: task.id,
        status: "resolved",
        verdict: input.close.verdict,
        reasoning: input.close.reasoning,
        turns: [],
      },
    };
  } catch (err) {
    return { phase: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/** System expiry has no user verdict or outcome artifact. */
async function expireNode(state: NegotiationState, deps: NegotiationGraphDeps): Promise<Partial<NegotiationState>> {
  const task = state.task;
  const input = state.input;
  if (!task || !("expire" in input)) return { phase: "error", error: "Missing task or expiry" };
  try {
    const expired = await deps.database.expirePausedNegotiation({
      taskId: task.id,
      expectedUpdatedAt: input.expire.expectedUpdatedAt,
      reason: input.expire.reason,
    });
    if (!expired) return { task, phase: "done", result: toResult(task, []) };
    await appendRoundLogEventForEverySeat(deps, expired.metadata, task.id, { kind: "stopped", via: "completed" });
    await triggerReflectForEverySeat(deps, expired.metadata);
    return { task: expired, phase: "done", result: { negotiationId: task.id, status: "resolved", turns: [] } };
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
      .addNode("close", (s: NegotiationState) => closeNode(s, deps))
      .addNode("expire", (s: NegotiationState) => expireNode(s, deps))
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
        close: "close",
        expire: "expire",
        read: "read",
        error: "fail",
      })
      .addConditionalEdges("turn", (s: NegotiationState) => s.phase, { apply: "apply", done: END, error: "fail" })
      .addConditionalEdges("apply", (s: NegotiationState) => s.phase, { turn: "turn", done: END, error: "fail" })
      .addEdge("resolve", END)
      .addEdge("close", END)
      .addEdge("expire", END)
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
