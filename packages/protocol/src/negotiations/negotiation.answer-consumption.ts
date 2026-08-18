/**
 * Answer consumption: route a client's DM reply to its parked negotiations and
 * resume them (conversational-questions plan, "Answers").
 *
 * The delivery surface decides that a chat reply answers a question-message
 * and maps the reply's content onto block refs; this module owns everything
 * after that decision — the RESUME SEAM. Given a routed answer and the block
 * it answers, it re-resolves each referenced negotiation to its current park
 * and resumes it exactly once:
 *
 * - A mid-flight consult park (`input_required` task with a captured ask-user
 *   binding) resumes through the same durable settlement → exact continuation
 *   path the card answer used: settle the exact task, then enqueue the
 *   settlement-keyed resume. The settle is a CAS on the parked task, so a
 *   second delivery finds it already settled and only re-enqueues the
 *   idempotent continuation — never a double resume.
 * - A post-stall park (completed task on a stalled opportunity whose trailing
 *   turn is the authored `ask_user` gap, `NEGOTIATION_PARK_REASONING`) resumes
 *   as a fresh negotiation attempt: the answer is recorded on the opportunity
 *   (where continuation prompts already read it via
 *   `getOpportunityUserAnswers`) and a retry is enqueued. Exactly-once is the
 *   attempt claim: concurrent retries race `createNegotiationTaskForAttempt`
 *   and all but one lose.
 *
 * Idempotency is a property of the negotiation, not of any settlement record
 * kept here: re-resolution + the `input_required` admission gate (mid-flight)
 * and the atomic attempt claim (post-stall) make a repeated delivery a no-op.
 * A ref that matches nothing in the block resumes NOTHING — misrouting resumes
 * the wrong negotiation with the wrong fact, which is worse than asking again —
 * and is reported back so the delivery surface can ask a clarifying follow-up.
 *
 * A resumed negotiation may park again; the ask-rounds cap (#1430) bounds that
 * loop at park time. This module deliberately adds no second counter.
 */

import { NEGOTIATION_PARK_REASONING } from "./negotiation.stall-gap.js";
import { negotiationQuestionSettlementId } from "./negotiation.question-safety.js";
import { turnsFromMessages } from "./negotiation.graph.shared.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { NegotiationGraphDatabase, NegotiationUserAnswer } from "../shared/interfaces/database.interface.js";
import type { QuestionBlock, QuestionBlockQuestion } from "../shared/schemas/question-block.schema.js";
import type { NegotiationTurn } from "./negotiation.state.js";

const answerLog = protocolLogger("NegotiationAnswerConsumption");

// ─── Routing: block ref → resume set ─────────────────────────────────────────

/** One answer the delivery agent routed onto a block ref. */
export interface RoutedAnswer {
  /** The block ref the reply was matched to — primary or alsoUnblocks alike. */
  ref: string;
  /** The client's answer for that question, as free text. */
  answerText: string;
}

/** A resolved route: the owning question and every negotiation its answer resumes. */
export interface AnswerRoute {
  question: QuestionBlockQuestion;
  /** Primary first, then `alsoUnblocks` — one answer resumes them all. */
  opportunityIds: string[];
}

/**
 * Resolve a matched ref to its question and full resume set. The block schema
 * guarantees every ref appears exactly once across the whole block, so this is
 * a lookup — ambiguity is a producer-side error that cannot reach here through
 * a parsed block. Returns null for a ref the block does not carry: the caller
 * must ask a clarifying follow-up, never resume speculatively.
 */
export function routeAnswerRef(block: QuestionBlock, ref: string): AnswerRoute | null {
  for (const question of block.questions) {
    const opportunityIds = [question.opportunityId, ...(question.alsoUnblocks ?? [])];
    if (opportunityIds.includes(ref)) return { question, opportunityIds };
  }
  return null;
}

// ─── Park classification: what the ref currently points at ──────────────────

/** The minimal ask-user binding a mid-flight resume needs, read off task metadata. */
interface AskUserResumeBinding {
  settlementId: string;
  recipientUserId: string;
  recipientIntentId: string;
  networkId: string;
  opportunityId: string;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function readAskUserResumeBinding(metadata: Record<string, unknown> | null): AskUserResumeBinding | null {
  const turnContext = metadata?.turnContext as Record<string, unknown> | undefined;
  const binding = turnContext?.askUserBinding as Record<string, unknown> | undefined;
  if (
    !binding
    || !nonEmptyString(binding.settlementId)
    || !nonEmptyString(binding.recipientUserId)
    || !nonEmptyString(binding.recipientIntentId)
    || !nonEmptyString(binding.networkId)
    || !nonEmptyString(binding.opportunityId)
  ) return null;
  return {
    settlementId: binding.settlementId,
    recipientUserId: binding.recipientUserId,
    recipientIntentId: binding.recipientIntentId,
    networkId: binding.networkId,
    opportunityId: binding.opportunityId,
  };
}

/**
 * The trailing canonical turn of a negotiation's own messages, when it is the
 * authored post-stall gap. Non-turn messages are skipped, mirroring
 * `turnsFromMessages`; any other trailing turn means the negotiation is not
 * parked post-stall.
 */
function trailingParkMessage(
  messages: Array<{ senderId: string; parts: unknown[]; taskId?: string | null }>,
): { senderId: string; taskId?: string | null; turn: NegotiationTurn } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const turn = turnsFromMessages([message])[0];
    if (!turn) continue;
    return turn.action === "ask_user" && turn.assessment?.reasoning === NEGOTIATION_PARK_REASONING
      ? { senderId: message.senderId, taskId: message.taskId, turn }
      : null;
  }
  return null;
}

/** What answering a given ref would resume, as re-resolved right now. */
export type ParkClassification =
  | { kind: "inflight"; taskId: string; binding: AskUserResumeBinding }
  | { kind: "post_stall"; taskId: string }
  /** No negotiation task exists for the ref at all. */
  | { kind: "no_negotiation" }
  /** A negotiation exists but holds no live park — already resumed, expired, or terminal. */
  | { kind: "not_parked" }
  /** Parked, but awaiting the OTHER side's client — this user's answer must not resume it. */
  | { kind: "wrong_recipient" };

/**
 * Re-resolve a negotiation ref to its current park. This is the exact task
 * re-resolution the graph itself uses (`getNegotiationTaskForOpportunity`),
 * never a snapshot: answer routing branches on what the negotiation is NOW,
 * so a park that was answered, expired, or superseded since the block was
 * authored classifies as `not_parked` and the answer no-ops.
 */
export async function classifyParkedNegotiation(
  database: Pick<NegotiationGraphDatabase, "getNegotiationTaskForOpportunity" | "getNegotiationMessages">,
  input: { opportunityId: string; userId: string },
): Promise<ParkClassification> {
  const task = await database.getNegotiationTaskForOpportunity(input.opportunityId);
  if (!task) return { kind: "no_negotiation" };

  if (task.state === "input_required") {
    const binding = readAskUserResumeBinding(task.metadata);
    if (
      !binding
      || binding.opportunityId !== input.opportunityId
      || binding.settlementId !== negotiationQuestionSettlementId(task.id)
    ) {
      answerLog.warn("input_required negotiation task carries no coherent ask-user binding; answer cannot resume it", {
        taskId: task.id,
        opportunityId: input.opportunityId,
      });
      return { kind: "not_parked" };
    }
    if (binding.recipientUserId !== input.userId) return { kind: "wrong_recipient" };
    return { kind: "inflight", taskId: task.id, binding };
  }

  if (task.state === "completed") {
    const messages = await database.getNegotiationMessages(input.opportunityId);
    const park = trailingParkMessage(messages);
    if (!park) return { kind: "not_parked" };
    // The gap was written by the finalizing session's task — the most recent
    // one. A trailing park from an older task means state has moved on.
    if (park.taskId != null && park.taskId !== task.id) return { kind: "not_parked" };
    if (park.senderId !== `agent:${input.userId}`) return { kind: "wrong_recipient" };
    return { kind: "post_stall", taskId: task.id };
  }

  // submitted/working/waiting_for_agent: a session is live (possibly the very
  // resume a first delivery triggered); canceled: a settled consult awaiting
  // its successor; failed/rejected: terminal. None hold an answerable park.
  return { kind: "not_parked" };
}

// ─── Ports ───────────────────────────────────────────────────────────────────

/** Everything a mid-flight settle needs; all fields come from the re-resolved binding. */
export interface InflightAnswerSettlementInput {
  taskId: string;
  settlementId: string;
  opportunityId: string;
  recipientUserId: string;
  recipientIntentId: string;
  networkId: string;
  answer: { selectedOptions: string[]; freeText?: string; answeredAt: string };
}

/**
 * - `settled`: this call closed the exact `input_required` task and durably
 *   stored the answer for the continuation claim to read.
 * - `already_settled`: an earlier delivery settled it; the stored settlement
 *   stands. Resuming is still correct — the continuation enqueue and claim are
 *   settlement-keyed and idempotent, so re-enqueueing recovers a lost job
 *   without a double resume.
 * - `lost`: the admission gate refused — the task is no longer
 *   `input_required` (answer-window expiry or another path won). No resume.
 */
export type InflightAnswerSettlementResult = "settled" | "already_settled" | "lost";

export interface NegotiationAnswerConsumptionPorts {
  /** The same reads the negotiation graph resolves parks with. */
  database: Pick<NegotiationGraphDatabase, "getNegotiationTaskForOpportunity" | "getNegotiationMessages">;
  /**
   * Settle the exact mid-flight consult: CAS the `input_required` task closed
   * under the deterministic settlement lock and durably store the answer where
   * the continuation claim reads its private consultation. Implementations
   * must be answer-vs-timeout safe (the expiry worker races this) and must
   * report a repeat delivery as `already_settled`, never settle twice.
   */
  settleInflightAnswer(input: InflightAnswerSettlementInput): Promise<InflightAnswerSettlementResult>;
  /**
   * Enqueue the exact durable continuation — the same settlement-keyed resume
   * the card answer path enqueues. Must be idempotent per settlementId.
   */
  enqueueInflightResume(input: {
    opportunityId: string;
    userId: string;
    taskId: string;
    settlementId: string;
    recipientIntentId: string;
    networkId: string;
  }): Promise<void>;
  /**
   * Append the routed answer to the opportunity's `userAnswers`, where
   * continuation prompts already read between-session context. Implementations
   * MUST ignore an append whose `questionId` is already present — that key is
   * deterministic per park, so a repeated delivery records nothing twice.
   */
  recordOpportunityAnswer(input: { opportunityId: string; answer: NegotiationUserAnswer }): Promise<void>;
  /**
   * Enqueue a fresh negotiate-existing retry of the stalled opportunity.
   * `parkTaskId` identifies the answered park; implementations should dedupe
   * on it. Over-enqueueing is safe regardless: every retry races the atomic
   * attempt claim and all but one lose.
   */
  enqueueStalledRetry(input: { opportunityId: string; userId: string; parkTaskId: string }): Promise<void>;
}

/** Deterministic identity of a post-stall park's recorded answer (dedup key, never rendered). */
export function negotiationParkAnswerId(parkTaskId: string): string {
  return `negotiation-park-answer-v1-${parkTaskId}`;
}

// ─── The resume seam ─────────────────────────────────────────────────────────

export type NegotiationAnswerResumeOutcome =
  | "resumed_inflight"
  | "resumed_retry"
  | "not_parked"
  | "no_negotiation"
  | "wrong_recipient";

export interface NegotiationAnswerInput {
  /** The negotiation to resume: one ref out of a routed answer's resume set. */
  opportunityId: string;
  /** The answering client — the park must be awaiting THIS user's side. */
  userId: string;
  answerText: string;
  /** ISO timestamp of the reply; defaults to now. */
  answeredAt?: string;
}

/**
 * Resume one parked negotiation with a routed answer, exactly once. Both
 * outcomes that resume enqueue asynchronously — the negotiation continues on
 * its queue, not inline. Every other outcome resumes nothing. Throws only on
 * port failure; every step is safe to repeat, so the caller may simply
 * redeliver.
 */
export async function resumeParkedNegotiation(
  ports: NegotiationAnswerConsumptionPorts,
  input: NegotiationAnswerInput,
): Promise<NegotiationAnswerResumeOutcome> {
  const classification = await classifyParkedNegotiation(ports.database, {
    opportunityId: input.opportunityId,
    userId: input.userId,
  });
  const answeredAt = input.answeredAt ?? new Date().toISOString();

  if (classification.kind === "inflight") {
    const settlement = await ports.settleInflightAnswer({
      taskId: classification.taskId,
      settlementId: classification.binding.settlementId,
      opportunityId: input.opportunityId,
      recipientUserId: classification.binding.recipientUserId,
      recipientIntentId: classification.binding.recipientIntentId,
      networkId: classification.binding.networkId,
      answer: { selectedOptions: [], freeText: input.answerText, answeredAt },
    });
    if (settlement === "lost") {
      answerLog.info("negotiation_answer_settlement_lost", {
        taskId: classification.taskId,
        opportunityId: input.opportunityId,
      });
      return "not_parked";
    }
    // Settlement is durable; enqueue after it, never before — a crash between
    // the two is recovered by redelivery (`already_settled` → enqueue again).
    await ports.enqueueInflightResume({
      opportunityId: input.opportunityId,
      userId: classification.binding.recipientUserId,
      taskId: classification.taskId,
      settlementId: classification.binding.settlementId,
      recipientIntentId: classification.binding.recipientIntentId,
      networkId: classification.binding.networkId,
    });
    answerLog.info("negotiation_answer_resumed_inflight", {
      taskId: classification.taskId,
      opportunityId: input.opportunityId,
      settlement,
    });
    return "resumed_inflight";
  }

  if (classification.kind === "post_stall") {
    // Record before enqueueing: the retry's continuation prompt must see the
    // answer. The deterministic id makes the append idempotent, so the
    // crash-recovery order (record, then enqueue, redeliver on failure) holds.
    await ports.recordOpportunityAnswer({
      opportunityId: input.opportunityId,
      answer: {
        questionId: negotiationParkAnswerId(classification.taskId),
        selectedOptions: [],
        freeText: input.answerText,
        answeredAt,
      },
    });
    await ports.enqueueStalledRetry({
      opportunityId: input.opportunityId,
      userId: input.userId,
      parkTaskId: classification.taskId,
    });
    answerLog.info("negotiation_answer_resumed_retry", {
      taskId: classification.taskId,
      opportunityId: input.opportunityId,
    });
    return "resumed_retry";
  }

  if (classification.kind === "wrong_recipient") {
    answerLog.warn("Answer routed to a negotiation parked on the counterparty's side; not resuming", {
      opportunityId: input.opportunityId,
    });
  }
  return classification.kind;
}

// ─── Block-level consumption ─────────────────────────────────────────────────

export interface QuestionBlockAnswerConsumptionInput {
  /** The parsed block the reply answers (see `parseQuestionMessage`). */
  block: QuestionBlock;
  /** The replying client — the DM's owner. */
  userId: string;
  /** The reply's content routed onto block refs; empty when nothing matched. */
  answers: RoutedAnswer[];
  /** ISO timestamp of the reply; defaults to now. */
  answeredAt?: string;
}

export interface QuestionBlockAnswerConsumptionResult {
  resumed: Array<{ opportunityId: string; outcome: "resumed_inflight" | "resumed_retry" }>;
  skipped: Array<{
    opportunityId: string;
    outcome: "not_parked" | "no_negotiation" | "wrong_recipient" | "duplicate_route" | "failed";
  }>;
  /** Routed answers whose ref the block does not carry — resume nothing, ask again. */
  unmatched: RoutedAnswer[];
  /**
   * True when the reply left something unresolved on the routing side: no
   * answer matched at all, or a ref matched nothing in the block. The caller
   * owns the clarifying follow-up; this seam only ever refuses to guess.
   */
  needsClarification: boolean;
}

/**
 * Consume a client reply against the block it answers: resolve each routed
 * answer to its question, then resume the primary negotiation and every
 * `alsoUnblocks` ref with that answer, exactly once each. Failures are
 * per-negotiation — one broken target never blocks the rest of the reply.
 */
export async function consumeQuestionBlockAnswers(
  ports: NegotiationAnswerConsumptionPorts,
  input: QuestionBlockAnswerConsumptionInput,
): Promise<QuestionBlockAnswerConsumptionResult> {
  const answeredAt = input.answeredAt ?? new Date().toISOString();
  const result: QuestionBlockAnswerConsumptionResult = {
    resumed: [],
    skipped: [],
    unmatched: [],
    needsClarification: false,
  };
  const consumedQuestions = new Set<string>();

  for (const answer of input.answers) {
    const route = routeAnswerRef(input.block, answer.ref);
    if (!route) {
      result.unmatched.push(answer);
      continue;
    }
    // Two routed answers can name refs of the same question; the first wins.
    // The later one is surfaced as a duplicate rather than silently merged —
    // choosing between conflicting phrasings is the delivery agent's job.
    if (consumedQuestions.has(route.question.opportunityId)) {
      result.skipped.push({ opportunityId: route.question.opportunityId, outcome: "duplicate_route" });
      continue;
    }
    consumedQuestions.add(route.question.opportunityId);

    for (const opportunityId of route.opportunityIds) {
      try {
        const outcome = await resumeParkedNegotiation(ports, {
          opportunityId,
          userId: input.userId,
          answerText: answer.answerText,
          answeredAt,
        });
        if (outcome === "resumed_inflight" || outcome === "resumed_retry") {
          result.resumed.push({ opportunityId, outcome });
        } else {
          result.skipped.push({ opportunityId, outcome });
        }
      } catch (err) {
        answerLog.error("Failed to resume an answered negotiation; continuing with the rest of the reply", {
          opportunityId,
          error: err instanceof Error ? err.message : String(err),
        });
        result.skipped.push({ opportunityId, outcome: "failed" });
      }
    }
  }

  result.needsClarification = input.answers.length === 0 || result.unmatched.length > 0;
  return result;
}
