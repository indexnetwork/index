/**
 * QuestionerAgent input types. The `QuestionerInput` envelope carries a `mode`
 * field that selects a preset, plus a polymorphic `context` that varies per mode.
 *
 * Slice 1 defines all four context shapes but only `DiscoveryContext` has a
 * working preset implementation. The others are type stubs for future slices.
 */
import type { DiscoveryQuestionInput } from "../shared/schemas/discovery-question.schema.js";
import type { ToolScopeType } from "../shared/agent/tool.scope.js";
import type { NegotiationQuestionCandidate, QuestionMode, QuestionPoolDiscriminator } from "../shared/schemas/question.schema.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY, isSafeNegotiationQuestionText } from "../negotiation/negotiation.question-safety.js";
import type { NegotiationConsultationReason } from "../negotiation/negotiation.consultation-policy.js";

// ─── Per-mode context types ─────────────────────────────────────────────────

/**
 * Discovery context — wraps the existing DiscoveryQuestionInput wholesale.
 * The discovery preset's buildPrompt delegates to `questioner.discovery.prompt.ts`.
 */
export type DiscoveryContext = DiscoveryQuestionInput;

/** Intent context — data needed to generate questions about an intent. */
export interface IntentContext {
  intentId: string;
  payload: string;
  summary?: string;
  /** The user's global user_context paragraph (profile-replacing identity text). */
  userContext?: string;
}

/** Recovery-only intent context after a successful discovery completion. */
export interface RecoveryIntentContext extends IntentContext {
  purpose: "recovery";
  /** Privacy-safe aggregate signal; raw negotiation evidence is never provided. */
  rejectedNegotiationCount?: number;
}

/** Profile context — data needed to generate questions to fill profile gaps. */
export interface ProfileContext {
  /** The user's global user_context paragraph (profile-replacing identity text). */
  userContext?: string;
  gaps: string[];
  /** Existing premise texts the user has already stated (e.g. "I live in Berlin"). */
  existingPremises?: string[];
}

/** Shared context fields for negotiation-mode questions. */
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

/** Pre-accept uptake context targeting a counterparty's preparatory conditions. */
export interface UptakeNegotiationContext extends NegotiationContextBase {
  purpose: "uptake";
  /** Plain-language activity or commitment whose feasibility needs clarification. */
  proposedActivity: string;
}

/** Negotiation context discriminated by internal question purpose. */
export type NegotiationContext = PostStallNegotiationContext | UptakeNegotiationContext;

/**
 * Negotiation-inflight context — a negotiator mid-negotiation wants to ask its
 * OWN client a question before continuing (the `ask_user` action, P3.2). The
 * negotiator states the disclosure subject and optionally drafts the question;
 * the QuestionerAgent refines it into polished disclosure-gating questions.
 * Distinct from {@link NegotiationContext}, which covers post-stall questions.
 */
export interface NegotiationInflightContext {
  negotiationId: string;
  /** Anonymized counterparty description (attributes, never identity). */
  counterpartyHint: string;
  /** What the negotiator wants permission to share or needs to know (e.g. "budget range", "availability in Q3"). */
  disclosureSubject: string;
  /** Draft question authored by the negotiator. The agent refines it. */
  draftQuestion?: string;
  /** Community / index context the negotiation runs in. */
  indexContext: string;
  /** Server-only IND-508 reason; never copied into generated or persisted payloads. */
  consultationPolicyReason?: NegotiationConsultationReason;
  /** The user's global user_context paragraph (profile-replacing identity text). */
  userContext?: string;
}

/**
 * Chat context — data for orchestrator-initiated mid-conversation questions
 * (the `ask_user_question` tool). The orchestrator states what it needs to
 * learn; the QuestionerAgent turns that into polished structured questions,
 * grounded in the recent conversation and the user's identity context.
 */
export interface ChatContext {
  /** What the orchestrator needs to learn and why (authored by the chat model). */
  purpose: string;
  /** Draft questions proposed by the orchestrator. The agent refines these. */
  draftQuestions?: Array<{
    prompt: string;
    options?: string[];
    multiSelect?: boolean;
  }>;
  /** Recent conversation excerpt for grounding (most recent messages last). */
  conversationExcerpt?: string;
  /** The user's global user_context paragraph (profile-replacing identity text). */
  userContext?: string;
}

/**
 * Pool-discovery context — mined discriminators from a discovery-run pool
 * (IND-418). No generator LLM runs for this mode: the QuestionerQueue
 * synthesizes the question deterministically from the top discriminator and
 * stashes the rest as interview-mode alternates.
 */
export interface PoolDiscoveryContext {
  intentId: string;
  /** Truncated intent payload (+ summary) display snippet. */
  intentText: string;
  /** Stable hash of the full normalized payload + summary used for freshness. */
  intentFingerprint?: string;
  poolSize: number;
  /** Exact bounded candidate opportunity IDs supplied to synthesis. */
  opportunityIds: string[];
  /** Discovery run that produced the pool. */
  runId?: string;
  /** Eligible discriminators, VoI-descending (asked + chain alternates). */
  discriminators: QuestionPoolDiscriminator[];
  /** ISO-8601 timestamp of the mining pass. */
  minedAt: string;
}

/** Discriminated union: mode selects the context shape. */
export type QuestionerContext =
  | DiscoveryContext
  | IntentContext
  | RecoveryIntentContext
  | ProfileContext
  | NegotiationContext
  | NegotiationInflightContext
  | ChatContext
  | PoolDiscoveryContext;

/**
 * Payload shape accepted by the questionerEnqueue callback. Covers all
 * question modes — the composition root bridges this to the concrete
 * QuestionerQueue.
 */
export type QuestionerEnqueuePayload = QuestionerInput;

/** Callback signature for async question generation enqueue. */
export type QuestionerEnqueueFn = (input: QuestionerEnqueuePayload) => Promise<void>;

/** Top-level input envelope for QuestionerAgent.invoke(). */
interface QuestionerInputBase {
  /** Selects the preset (system prompt + builder). */
  mode: QuestionMode;
  /** User the questions are generated for. */
  userId: string;
  /** Entity type that triggered this (e.g. "opportunity", "intent", "profile"). */
  sourceType: string;
  /** ID of the triggering entity. */
  sourceId: string;
  /** Scoped question context. Network scopes persist as QuestionActor.networkId. */
  scopeType?: ToolScopeType;
  /** Scoped question id. When scopeType is `network`, this is the actor networkId. */
  scopeId?: string;
  /**
   * Intent that triggered the run that generated these questions. Persisted as
   * `detection.triggeredBy` so intent-scoped surfaces (e.g. the intent page)
   * can find them. Independent of `scopeType`/`scopeId`, which may carry a
   * network scope at the same time.
   */
  triggeredByIntentId?: string;
  /** Conversation ID — set when the question originates from a chat session. Persisted on the question row for frontend filtering. */
  conversationId?: string;
  /** Assistant message ID — set when we know which message triggered the question. Stored in detection.messageId for inline anchoring. */
  messageId?: string;
  /**
   * Candidate exact binding for negotiation-family jobs. The API/DB must
   * authoritatively re-resolve it before generation and again before insert.
   */
  negotiation?: NegotiationQuestionCandidate;
}

/** Non-negotiation modes cannot smuggle negotiation purpose/provenance. */
interface StandardQuestionerInput extends QuestionerInputBase {
  mode: Exclude<QuestionMode, "negotiation" | "negotiation_inflight">;
  purpose?: never;
  negotiation?: never;
  context: Exclude<QuestionerContext, NegotiationContext | NegotiationInflightContext | RecoveryIntentContext>;
}

/** Ordinary post-stall generation is task-backed and uses only the ordinary preset. */
export interface PostStallQuestionerInput extends QuestionerInputBase {
  mode: "negotiation";
  purpose: "stalled_followup";
  negotiation: NegotiationQuestionCandidate & { purpose: "stalled_followup"; taskId: string };
  context: PostStallNegotiationContext;
}

/** Mid-negotiation consultation is task-backed and uses only structured ask_user fields. */
export interface InflightQuestionerInput extends QuestionerInputBase {
  mode: "negotiation_inflight";
  purpose: "inflight_consultation";
  negotiation: NegotiationQuestionCandidate & { purpose: "inflight_consultation"; taskId: string };
  context: NegotiationInflightContext;
}

/** Negotiation-mode uptake generation input. */
export interface UptakeQuestionerInput extends QuestionerInputBase {
  mode: "negotiation";
  purpose: "uptake";
  negotiation: NegotiationQuestionCandidate & { purpose: "uptake"; taskId?: undefined };
  context: UptakeNegotiationContext;
}

/** Intent-mode post-discovery recovery generation input. */
export interface RecoveryQuestionerInput extends QuestionerInputBase {
  mode: "intent";
  purpose: "recovery";
  sourceType: "intent";
  triggeredByIntentId: string;
  negotiation?: never;
  context: RecoveryIntentContext;
}

/** Top-level input discriminated by both mode and internal purpose. */
export type QuestionerInput =
  | StandardQuestionerInput
  | PostStallQuestionerInput
  | InflightQuestionerInput
  | UptakeQuestionerInput
  | RecoveryQuestionerInput;

/** Runtime mirror of the mode/purpose/context discriminant used at queue boundaries. */
export function isValidQuestionerInputContract(input: QuestionerInput): boolean {
  if (input.purpose === 'recovery') {
    const context = input.context as RecoveryIntentContext;
    return input.mode === 'intent'
      && input.sourceType === 'intent'
      && input.triggeredByIntentId === input.sourceId
      && input.negotiation === undefined
      && context.purpose === 'recovery'
      && context.intentId === input.sourceId;
  }
  if (input.mode !== 'negotiation' && input.mode !== 'negotiation_inflight') {
    return input.purpose === undefined && input.negotiation === undefined;
  }
  if (
    input.sourceType !== 'opportunity'
    || !input.negotiation
    || input.negotiation.opportunityId !== input.sourceId
    || input.negotiation.recipientUserId !== input.userId
    || input.negotiation.purpose !== input.purpose
  ) return false;

  const context = input.context as unknown as Record<string, unknown>;
  if (
    context.counterpartyHint !== NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY
    || context.indexContext !== NEGOTIATION_QUESTION_GENERIC_NETWORK
  ) return false;

  if (input.mode === 'negotiation_inflight') {
    return input.purpose === 'inflight_consultation'
      && typeof input.negotiation.taskId === 'string'
      && input.negotiation.taskId.length > 0
      && context.negotiationId === input.negotiation.taskId
      && typeof context.disclosureSubject === 'string'
      && isSafeNegotiationQuestionText(context.disclosureSubject)
      && (context.consultationPolicyReason === undefined
        || context.consultationPolicyReason === 'unresolved_owner_constraint'
        || context.consultationPolicyReason === 'consequential_disclosure_permission'
        || context.consultationPolicyReason === 'repeated_non_convergence'
        || context.consultationPolicyReason === 'insufficient_commitment_authority')
      && (context.draftQuestion === undefined
        || (typeof context.draftQuestion === 'string' && isSafeNegotiationQuestionText(context.draftQuestion)));
  }
  if (input.purpose === 'uptake') {
    return input.negotiation.taskId === undefined
      && typeof input.negotiation.counterpartyUserId === 'string'
      && input.negotiation.counterpartyUserId.length > 0
      && typeof input.negotiation.counterpartyIntentId === 'string'
      && input.negotiation.counterpartyIntentId.length > 0
      && typeof input.negotiation.counterpartyFelicityAuthority === 'number'
      && Number.isFinite(input.negotiation.counterpartyFelicityAuthority)
      && context.negotiationId === input.sourceId
      && context.purpose === 'uptake'
      && context.proposedActivity === NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY;
  }
  return input.purpose === 'stalled_followup'
    && typeof input.negotiation.taskId === 'string'
    && input.negotiation.taskId.length > 0
    && context.negotiationId === input.negotiation.taskId
    && context.purpose === undefined
    && (context.outcomeReason === 'turn_cap' || context.outcomeReason === 'timeout' || context.outcomeReason === 'stalled')
    && typeof context.recipientIntent === 'string'
    && context.recipientIntent.trim().length > 0;
}
