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
