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
 *
 * Every cap here REPAIRS rather than refuses. This is the schema an LLM drafts
 * a question INTO, so a refusal is not a validation result some caller gets to
 * act on: it throws inside the structured-output call and takes the whole turn
 * with it — a failed turn, a retry, and a negotiation that never delivers the
 * question. That is the protocol's own philosophy applied to the renderer's
 * constraints. `normalizeChecklistItem` repairs toward `unknown`; the anti-echo
 * guard repairs toward honesty; a title that ran four characters long repairs
 * toward being DELIVERABLE. A question the client can read is worth more than
 * a turn that died over a noun.
 */

/**
 * Repair an over-long field back under the renderer's cap.
 *
 * Cuts on a word boundary when one falls in the back half of the budget (so
 * "Studio operations experience" becomes "Studio", not "Studio opera"), and
 * marks a truncated sentence with an ellipsis so a reader can see the text was
 * cut rather than written that way. Titles take no ellipsis: at twelve
 * characters the mark costs a word.
 *
 * Runs as a `preprocess` so it repairs BEFORE the cap is checked — a
 * `.transform()` runs after the length refinement has already rejected the
 * draft, which is the failure this exists to remove. Non-strings pass through
 * untouched: the type error below is the schema's to report, not this
 * function's to guess at. The emitted JSON schema is unchanged (zod renders a
 * preprocess as its inner type), so the model is still TOLD the cap; this is
 * only what happens when it ignores it.
 */
function repairToCap(max: number, opts?: { ellipsis?: boolean }) {
  const ellipsis = opts?.ellipsis === true;
  return (value: unknown): unknown => {
    if (typeof value !== "string" || value.length <= max) return value;
    const budget = ellipsis ? max - 1 : max;
    const head = value.slice(0, budget);
    const boundary = head.lastIndexOf(" ");
    const cut = boundary >= Math.ceil(budget / 2) ? head.slice(0, boundary) : head;
    const body = cut.trimEnd() || value.trim().slice(0, budget).trimEnd();
    return ellipsis ? `${body}…` : body;
  };
}

/**
 * Drop options beyond the fourth rather than refusing the question.
 *
 * The upper bound is a renderer limit, and a fifth option is surplus, not
 * corruption — the first four are still the author's own options in the
 * author's own order. The LOWER bound stays a refusal because there is nothing
 * honest to repair toward: a second option cannot be invented, and a one-option
 * "choice" is not a question. Callers that must not fail over that hold the
 * whole question optional (see `AskUserGenerationSchema`).
 */
function repairOptionCount(max: number) {
  return (value: unknown): unknown => (Array.isArray(value) && value.length > max ? value.slice(0, max) : value);
}

export const QuestionOptionSchema = z.object({
  /** Display text. Suffix " (Recommended)" on the safest path; list it first. */
  label: z.preprocess(repairToCap(120, { ellipsis: true }), z.string().min(1).max(120)),
  /** Explains the consequence of choosing this option, not just its definition. */
  description: z.preprocess(repairToCap(280, { ellipsis: true }), z.string().min(1).max(280)),
});

export const StructuredQuestionSchema = z.object({
  /** ≤12 chars. Noun of the decision domain — e.g. "Stage", "Timing", "Role". */
  title: z.preprocess(repairToCap(12), z.string().min(1).max(12)),
  /** ≤2 sentences, ≤400 chars. Ends in a question mark. */
  prompt: z.preprocess(repairToCap(400, { ellipsis: true }), z.string().min(1).max(400)),
  /** 2–4 options. No explicit "Other" — clients provide that automatically. */
  options: z.preprocess(repairOptionCount(4), z.array(QuestionOptionSchema).min(2).max(4)),
  /** True when options are not mutually exclusive (priorities, bundles). */
  multiSelect: z.boolean(),
});

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type StructuredQuestion = z.infer<typeof StructuredQuestionSchema>;
