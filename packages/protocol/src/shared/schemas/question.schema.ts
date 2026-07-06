/**
 * Question — public structured shape consumed by frontend renderers and MCP
 * elicitation dispatch. Mirrors the brainstorming AskUserQuestion skill so a
 * Question can be rendered identically across surfaces.
 *
 * `QuestionWithStrategy` extends the public shape with an internal `strategy`
 * tag used by the generator's guardrails (dedup/diversity) and recorded in
 * `debugMeta`. The tag is stripped before the public payload leaves the
 * generator — users never see it.
 */
import { z } from "zod";

export const QuestionOptionSchema = z.object({
  /** Display text. Suffix " (Recommended)" on the safest path; list it first. */
  label: z.string().min(1).max(120),
  /** Explains the consequence of choosing this option, not just its definition. */
  description: z.string().min(1).max(280),
});

export const QuestionSchema = z.object({
  /** ≤12 chars. Noun of the decision domain — e.g. "Stage", "Timing", "Role". */
  title: z.string().min(1).max(12),
  /** ≤2 sentences, ≤400 chars. Ends in a question mark. */
  prompt: z.string().min(1).max(400),
  /** 2–4 options. No explicit "Other" — clients provide that automatically. */
  options: z.array(QuestionOptionSchema).min(2).max(4),
  /** True when options are not mutually exclusive (priorities, bundles). */
  multiSelect: z.boolean(),
});

export const QuestionStrategySchema = z.enum([
  "refine_intent",
  "surface_missing_detail",
  "open_adjacent_thread",
  "reflective_summary",
  "surface_emergent_knowledge",
]);

export const QuestionWithStrategySchema = QuestionSchema.extend({
  strategy: QuestionStrategySchema,
});

export const QuestionGeneratorResponseSchema = z.object({
  questions: z.array(QuestionWithStrategySchema).max(3),
});

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionStrategy = z.infer<typeof QuestionStrategySchema>;
export type QuestionWithStrategy = z.infer<typeof QuestionWithStrategySchema>;
export type QuestionGeneratorResponse = z.infer<typeof QuestionGeneratorResponseSchema>;

/**
 * Internal generator output: public questions plus a parallel strategies
 * array for debug-only consumption. The generator emits this; callers
 * forward `questions` to renderers and `strategies` to `debugMeta` only.
 */
export interface QuestionGenerationResult {
  questions: Question[];
  strategies: QuestionStrategy[];
}

// ─── Persistence types (opportunity-style composable jsonb) ──────────────────

export const QuestionModeSchema = z.enum([
  "discovery",
  "intent",
  "enrichment",
  "negotiation",
  // Orchestrator-initiated mid-conversation questions (ask_user_question tool).
  "chat",
]);

export const QuestionDetectionSchema = z.object({
  /** Which preset mode generated this question. */
  mode: QuestionModeSchema,
  /** Entity type that triggered generation (e.g. "opportunity", "intent", "profile"). */
  sourceType: z.string().min(1),
  /** ID of the triggering entity. */
  sourceId: z.string().min(1),
  /** Optional intent ID that was the root cause. */
  triggeredBy: z.string().optional(),
  /** ISO-8601 timestamp of generation. */
  timestamp: z.string().min(1),
  /** ID of the assistant message that triggered this question. Used by the frontend to anchor the question card inline. */
  messageId: z.string().optional(),
});

export const QuestionActorSchema = z.object({
  /** The user this question is for. */
  userId: z.string().min(1),
  /** Optional network context. */
  networkId: z.string().optional(),
  /** Actor's role in the question — currently always "subject". */
  role: z.literal("subject"),
});

export const QuestionAnswerSchema = z.object({
  /** Option labels the user selected. */
  selectedOptions: z.array(z.string()),
  /** Free-text input when the user chose "Other" or elaborated. */
  freeText: z.string().optional(),
  /** User ID of the answerer. */
  answeredBy: z.string().min(1),
  /** ISO-8601 timestamp of when the answer was submitted. */
  answeredAt: z.string().min(1),
});

export type QuestionMode = z.infer<typeof QuestionModeSchema>;
export type QuestionDetection = z.infer<typeof QuestionDetectionSchema>;
export type QuestionActor = z.infer<typeof QuestionActorSchema>;
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;
