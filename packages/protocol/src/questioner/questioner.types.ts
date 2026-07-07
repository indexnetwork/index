/**
 * QuestionerAgent input types. The `QuestionerInput` envelope carries a `mode`
 * field that selects a preset, plus a polymorphic `context` that varies per mode.
 *
 * Slice 1 defines all four context shapes but only `DiscoveryContext` has a
 * working preset implementation. The others are type stubs for future slices.
 */
import type { DiscoveryQuestionInput } from "../opportunity/question.prompt.js";
import type { ToolScopeType } from "../shared/agent/tool.scope.js";
import type { QuestionMode } from "../shared/schemas/question.schema.js";

// ─── Per-mode context types ─────────────────────────────────────────────────

/**
 * Discovery context — wraps the existing DiscoveryQuestionInput wholesale.
 * The discovery preset's buildPrompt delegates to the migrated builder.
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

/** Profile context — data needed to generate questions to fill profile gaps. */
export interface ProfileContext {
  /** The user's global user_context paragraph (profile-replacing identity text). */
  userContext?: string;
  gaps: string[];
  /** Existing premise texts the user has already stated (e.g. "I live in Berlin"). */
  existingPremises?: string[];
}

/** Negotiation context — data from a stalled or capped negotiation. */
export interface NegotiationContext {
  negotiationId: string;
  counterpartyHint: string;
  indexContext: string;
  outcomeReason: "turn_cap" | "timeout" | "stalled";
  keyTake: string;
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

/** Discriminated union: mode selects the context shape. */
export type QuestionerContext =
  | DiscoveryContext
  | IntentContext
  | ProfileContext
  | NegotiationContext
  | ChatContext;

/**
 * Payload shape accepted by the questionerEnqueue callback. Covers all
 * question modes — the composition root bridges this to the concrete
 * QuestionerQueue.
 */
export type QuestionerEnqueuePayload = QuestionerInput;

/** Callback signature for async question generation enqueue. */
export type QuestionerEnqueueFn = (input: QuestionerEnqueuePayload) => Promise<void>;

/** Top-level input envelope for QuestionerAgent.invoke(). */
export interface QuestionerInput {
  /** Selects the preset (system prompt + builder). */
  mode: QuestionMode;
  /** User the questions are generated for. */
  userId: string;
  /** Entity type that triggered this (e.g. "opportunity", "intent", "profile"). */
  sourceType: string;
  /** ID of the triggering entity. */
  sourceId: string;
  /** Mode-specific context. Must align with the selected mode. */
  context: QuestionerContext;
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
