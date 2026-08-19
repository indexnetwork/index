/**
 * Checklist DTOs — the shape half of the checklist negotiation protocol
 * (docs/plans/2026-08-19-checklist-negotiations.md §2, §4).
 *
 * Extracted here, beside the negotiation-turn DTOs, for the same reason those
 * were: the turn and ask-payload schemas in `negotiation-state.schema.ts` need
 * them, and shared modules may not import the negotiations domain. The domain
 * layer (`negotiations/negotiation.checklist.contracts.ts`) re-exports every
 * shape below and owns everything else — authoring, freezing, re-scoring, ask
 * admissibility, prompt rendering. Nothing here knows what a checklist MEANS;
 * that module is where the discipline lives.
 *
 * Zod-only, like its neighbours.
 */
import { z } from "zod";

export const CHECKLIST_KINDS = ["mutual_want", "hard_constraint", "fit"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export const CHECKLIST_RESULTS = ["ok", "conflict", "unknown"] as const;
export type ChecklistResult = (typeof CHECKLIST_RESULTS)[number];

/** Keeney & Raiffa in miniature: few enough that each stays decision-relevant. */
export const MIN_CHECKLIST_DIMENSIONS = 3;
export const MAX_CHECKLIST_DIMENSIONS = 5;

export const MAX_CHECKLIST_NAME_CHARS = 60;
export const MAX_CHECKLIST_BASIS_CHARS = 400;
export const MAX_ANSWERHOOD_CHARS = 240;

/**
 * One checklist dimension as a model drafts it and a turn persists it.
 *
 * Deliberately permissive about the CONTENT rules (3–5 dimensions, basis
 * discipline, mutual-want presence): a draft that breaks them is repaired by
 * `normalizeChecklistDraft`, not rejected. Rejecting it would fail the whole
 * turn — seat-schema retry, then a conservative fallback action — which is a
 * worse outcome than an under-scored checklist. `ChecklistItemSchema` in the
 * domain module is where the invariants bite.
 */
export const ChecklistDraftItemSchema = z.object({
  name: z.string().min(1).max(MAX_CHECKLIST_NAME_CHARS),
  kind: z.enum(CHECKLIST_KINDS),
  result: z.enum(CHECKLIST_RESULTS),
  /**
   * The commitment(s) this score was read from: empty exactly when the result
   * is `unknown`. Required by the shape so a model cannot quietly omit the
   * audit trail; a wrongly-filled one is repaired rather than rejected.
   */
  basis: z.string().max(MAX_CHECKLIST_BASIS_CHARS),
}).strict();
export type ChecklistDraftItem = z.infer<typeof ChecklistDraftItemSchema>;

/**
 * A drafted checklist as it arrives on a turn payload. `max(8)` rather than
 * `max(5)` for the same fail-soft reason: an over-long draft is trimmed at
 * authoring, not bounced.
 */
export const ChecklistDraftSchema = z.array(ChecklistDraftItemSchema).max(8);
export type ChecklistDraft = z.infer<typeof ChecklistDraftSchema>;

/**
 * How an ask declares, in advance, what answers would settle its dimension.
 * Writing this map IS the pivotality proof: an author who cannot say what
 * answer would flip the verdict has no question worth the principal's
 * attention.
 */
export const AnswerhoodSchema = z.object({
  ok_when: z.string().min(1).max(MAX_ANSWERHOOD_CHARS),
  conflict_when: z.string().min(1).max(MAX_ANSWERHOOD_CHARS),
}).strict();
export type Answerhood = z.infer<typeof AnswerhoodSchema>;
