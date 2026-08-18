import { z } from "zod";

/**
 * Canonical structured question shape: the title/prompt/options/multiSelect
 * quartet every question renderer (frontend cards, MCP elicitation) consumes.
 *
 * It lives in `shared/` rather than inside `questions/` for the same reason as
 * `underspecification.schema.ts`: more than one capability needs the shape.
 * The questions capability owns question *generation* and extends this with its
 * own provenance field; the negotiator only needs to hand over a question it
 * authored (`AskUserPayloadSchema` in `negotiation-state.schema.ts`), and
 * `shared/schemas` must not value-import a capability module to reach a shape.
 *
 * Field constraints are tuned for the renderer and are the single source of
 * truth — `questions/question.schema.ts` re-exports rather than redeclares.
 */

export const QuestionOptionSchema = z.object({
  /** Display text. Suffix " (Recommended)" on the safest path; list it first. */
  label: z.string().min(1).max(120),
  /** Explains the consequence of choosing this option, not just its definition. */
  description: z.string().min(1).max(280),
});

export const StructuredQuestionSchema = z.object({
  /** ≤12 chars. Noun of the decision domain — e.g. "Stage", "Timing", "Role". */
  title: z.string().min(1).max(12),
  /** ≤2 sentences, ≤400 chars. Ends in a question mark. */
  prompt: z.string().min(1).max(400),
  /** 2–4 options. No explicit "Other" — clients provide that automatically. */
  options: z.array(QuestionOptionSchema).min(2).max(4),
  /** True when options are not mutually exclusive (priorities, bundles). */
  multiSelect: z.boolean(),
});

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type StructuredQuestion = z.infer<typeof StructuredQuestionSchema>;
