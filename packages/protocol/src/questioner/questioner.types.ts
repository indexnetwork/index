/**
 * QuestionerAgent input types. The `QuestionerInput` envelope carries a `mode`
 * field that selects a preset, plus a polymorphic `context` that varies per mode.
 *
 * Slice 1 defines all four context shapes but only `DiscoveryContext` has a
 * working preset implementation. The others are type stubs for future slices.
 */
import type { DiscoveryQuestionInput } from "../shared/schemas/discovery-question.schema.js";
import type { ToolScopeType } from "../shared/agent/tool.scope.js";
import type { QuestionMode, QuestionPoolDiscriminator } from "../shared/schemas/question.schema.js";

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
  counterpartyHint: string;
  indexContext: string;
  /** The user's global user_context paragraph (profile-replacing identity text). */
  userContext?: string;
}

/** Post-stall negotiation context. Preserves the existing source shape. */
export interface PostStallNegotiationContext extends NegotiationContextBase {
  purpose?: undefined;
  outcomeReason: "turn_cap" | "timeout" | "stalled";
  keyTake: string;
}

/** Pre-accept uptake context targeting a counterparty's preparatory conditions. */
export interface UptakeNegotiationContext extends NegotiationContextBase {
  purpose: "uptake";
  /** Plain-language activity or commitment whose feasibility needs clarification. */
  proposedActivity: string;
  /** Public evidence already available about capability, resources, or authority. */
  preparatoryEvidence?: string;
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
}

/** Existing question inputs, including post-stall negotiation source compatibility. */
interface StandardQuestionerInput extends QuestionerInputBase {
  purpose?: undefined;
  /** Mode-specific context. Must align with the selected mode. */
  context: Exclude<QuestionerContext, UptakeNegotiationContext | RecoveryIntentContext>;
}

/** Negotiation-mode uptake generation input. */
export interface UptakeQuestionerInput extends QuestionerInputBase {
  mode: "negotiation";
  purpose: "uptake";
  context: UptakeNegotiationContext;
}

/** Intent-mode post-discovery recovery generation input. */
export interface RecoveryQuestionerInput extends QuestionerInputBase {
  mode: "intent";
  purpose: "recovery";
  sourceType: "intent";
  triggeredByIntentId: string;
  context: RecoveryIntentContext;
}

/** Top-level input discriminated by the internal purpose. */
export type QuestionerInput = StandardQuestionerInput | UptakeQuestionerInput | RecoveryQuestionerInput;
