/**
 * QuestionerAgent input types. The `QuestionerInput` envelope carries a `mode`
 * field that selects a preset, plus a polymorphic `context` that varies per mode.
 *
 * Slice 1 defines all four context shapes but only `DiscoveryContext` has a
 * working preset implementation. The others are type stubs for future slices.
 */
import type { DiscoveryQuestionInput } from "../opportunity/question.prompt.js";
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
  userProfile: { name?: string; bio?: string; skills?: string[]; interests?: string[] };
}

/** Profile context — data needed to generate questions to fill profile gaps. */
export interface ProfileContext {
  userProfile: { name?: string; bio?: string; location?: string; skills?: string[]; interests?: string[] };
  gaps: string[];
}

/** Negotiation context — data from a stalled or capped negotiation. */
export interface NegotiationContext {
  negotiationId: string;
  counterpartyHint: string;
  indexContext: string;
  outcomeReason: "turn_cap" | "timeout" | "stalled";
  keyTake: string;
  userProfile: { name?: string; bio?: string; skills?: string[]; interests?: string[] };
}

/** Discriminated union: mode selects the context shape. */
export type QuestionerContext =
  | DiscoveryContext
  | IntentContext
  | ProfileContext
  | NegotiationContext;

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
}
