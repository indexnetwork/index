/**
 * questions/question.input — park-path question payloads.
 *
 * The QuestionerAgent and its per-mode generation envelope are retired
 * (conversational-questions plan, "Retirements"). What survives is the
 * payload the negotiation graph hands the composition root when a
 * negotiation parks needing its client's input: the two park families
 * (`negotiation_inflight`/`inflight_consultation` mid-flight consults and
 * `negotiation`/`stalled_followup` post-stall parks). The composition root
 * routes them to the question-message regeneration queue keyed on the parked
 * side's `(recipientUserId, recipientIntentId)`; the parked negotiation is
 * the durable record and the DM message is its rendering.
 */
import type { ToolScopeType } from "../shared/agent/tool.scope.js";
import type { NegotiationQuestionCandidate } from "./question.schema.js";
import type { NegotiationConsultationReason } from "../negotiations/negotiation.module.js";

// ─── Park-payload context types ─────────────────────────────────────────────

/** Shared context fields for negotiation park payloads. */
interface NegotiationContextBase {
  negotiationId: string;
  /** Privacy-reviewed generic description; never raw counterparty identity/profile. */
  counterpartyHint: string;
  /** Source-safe network label, never an internal prompt or identifier. */
  indexContext: string;
  /** The user's global user_context paragraph (profile-replacing identity text). */
  userContext?: string;
}

/** Post-stall negotiation context. Preserves the existing source shape. */
export interface PostStallNegotiationContext extends NegotiationContextBase {
  purpose?: undefined;
  outcomeReason: "turn_cap" | "timeout" | "stalled";
  /** The recipient's own exact opportunity-bound signal, never evaluator reasoning. */
  recipientIntent: string;
}

/**
 * Negotiation-inflight context — a negotiator mid-negotiation wants to ask its
 * OWN client a question before continuing (the `ask_user` action, P3.2).
 * The negotiator supplies only a closed category.
 */
export interface NegotiationInflightContext {
  negotiationId: string;
  /** Anonymized counterparty description (attributes, never identity). */
  counterpartyHint: string;
  /** Community / index context the negotiation runs in. */
  indexContext: string;
  /** Closed server-owned category selecting the consultation reason. */
  consultationPolicyReason: NegotiationConsultationReason;
  /** The user's global user_context paragraph (profile-replacing identity text). */
  userContext?: string;
}

/**
 * Payload shape accepted by the questionerEnqueue callback: exactly the two
 * park families. The composition root bridges this to the question-message
 * regeneration queue.
 */
export type QuestionerEnqueuePayload = QuestionerInput;

/**
 * Callback signature for the park-path enqueue.
 *
 * Ambient adapter port: the negotiation graph and the external-consultation
 * pause path inject this callback from the composition root; they never
 * import the queue implementation directly.
 */
export type QuestionerEnqueueFn = (input: QuestionerEnqueuePayload) => Promise<void>;

/** Shared envelope fields for both park families. */
interface QuestionerInputBase {
  /** User whose input is required (the parked side). */
  userId: string;
  /** Entity type that triggered this (always "opportunity" for park payloads). */
  sourceType: string;
  /** ID of the triggering entity. */
  sourceId: string;
  /** Scoped context carried through from the triggering surface. */
  scopeType?: ToolScopeType;
  /** Scoped id. When scopeType is `network`, this is the network id. */
  scopeId?: string;
  /** Intent that triggered the run, when the producer knows it. */
  triggeredByIntentId?: string;
  /**
   * Candidate exact binding. `recipientUserId`/`recipientIntentId` name the
   * parked side — the user whose input is required and the signal whose DM
   * carries the question-message.
   */
  negotiation: NegotiationQuestionCandidate;
}

/** Post-stall park payload, task-backed. */
export interface PostStallQuestionerInput extends QuestionerInputBase {
  mode: "negotiation";
  purpose: "stalled_followup";
  negotiation: NegotiationQuestionCandidate & { purpose: "stalled_followup"; taskId: string };
  context: PostStallNegotiationContext;
}

/** Mid-negotiation consultation park payload, task-backed. */
export interface InflightQuestionerInput extends QuestionerInputBase {
  mode: "negotiation_inflight";
  purpose: "inflight_consultation";
  negotiation: NegotiationQuestionCandidate & { purpose: "inflight_consultation"; taskId: string };
  context: NegotiationInflightContext;
}

/** Park-path payload union, discriminated by mode + internal purpose. */
export type QuestionerInput =
  | PostStallQuestionerInput
  | InflightQuestionerInput;
