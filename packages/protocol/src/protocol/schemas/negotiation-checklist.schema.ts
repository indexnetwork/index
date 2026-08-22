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

/**
 * Whose fact a dimension is — declared once, at authoring, read mechanically
 * forever.
 *
 * The same move answerhood made: a judgment only the authoring agent can make
 * becomes a field, so every mechanism downstream can act on it without having
 * to re-derive it from the dimension's wording. "Askable" was mechanically
 * `unknown ∧ unasked ∧ budget ∧ reachable ∧ wiring`, and nothing in that
 * conjunction knew whose fact was missing. Live, that put a question about the
 * COUNTERPARTY's work in the client's own DM: the agent had correctly drafted
 * `question` to the other agent, and the conclusion floor — seeing a non-ask
 * turn with an unknown standing — coerced it into an ask to the client about a
 * fact the client does not hold.
 *
 * - `client` — only this seat's own principal can answer it: their preference,
 *   their constraint, their willingness.
 * - `counterparty` — the other side's to state. Resolved by asking THEIR
 *   agent, never by spending this principal's attention.
 * - `either` — either side could settle it, or the author did not say.
 */
export const CHECKLIST_SETTLERS = ["client", "counterparty", "either"] as const;
export type ChecklistSettler = (typeof CHECKLIST_SETTLERS)[number];

/**
 * What a missing or unrecognised `settles` normalizes to.
 *
 * `either` and not `counterparty`, and the direction is the whole safety
 * argument. `either` stays ASKABLE, so a lazy authoring, a legacy checklist
 * written before this field existed, or a model that ignores the instruction
 * leaves the conclusion floor exactly where it was — degraded to the old
 * behaviour rather than switched off. Defaulting to `counterparty` would let
 * one unfilled field silently retire the floor for a whole negotiation, which
 * is the failure this protocol spent #1464 closing.
 */
export const DEFAULT_CHECKLIST_SETTLER: ChecklistSettler = "either";

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
  /**
   * Whose fact this dimension is ({@link CHECKLIST_SETTLERS}). Optional HERE
   * and only here: this is the shape a persisted turn is read back through,
   * and every turn written before the field existed carries none. Absent
   * normalizes to {@link DEFAULT_CHECKLIST_SETTLER} at
   * `normalizeChecklistItem`, so a legacy checklist round-trips as `either`
   * and behaves exactly as it did. What a MODEL may say is
   * {@link ChecklistDraftItemGenerationSchema}, where the field is stated and
   * repaired rather than omitted.
   *
   * An unrecognised value reads back as absent rather than failing the item.
   * This schema also parses the drafts of EXTERNALLY dispatched agents, which
   * never see the generation schema, and a whole re-scored checklist thrown
   * away over one misspelled marking is a far larger loss than a dimension
   * that falls back to `either` — the same fail-soft direction the rest of the
   * draft shape already takes.
   */
  settles: z.enum(CHECKLIST_SETTLERS).nullable().optional().catch(undefined)
    .transform((value) => value ?? undefined),
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
 * Fill in a dimension's missing or unrecognised `settles` before the enum sees
 * it.
 *
 * A `preprocess` and not a `.catch()`, for a reason that is entirely about the
 * schema the MODEL is shown: zod reports a `.catch()`-wrapped field as
 * optional, so it renders outside the JSON schema's `required` list — and a
 * field the model is not required to produce is one it will routinely skip,
 * which is the whole failure this field exists to end. Wrapping the OBJECT
 * instead leaves the inner shape untouched, so `settles` renders exactly as
 * required as `kind` and `result`, and the repair still runs before any of it
 * is checked. The same trick `repairToCap` plays for the renderer's caps in
 * `structured-question.schema.ts`.
 *
 * Non-objects pass through untouched: the type error is the schema's to
 * report, not this function's to guess at.
 */
function repairSettles(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const settles = (value as { settles?: unknown }).settles;
  if (CHECKLIST_SETTLERS.includes(settles as ChecklistSettler)) return value;
  return { ...value, settles: DEFAULT_CHECKLIST_SETTLER };
}

/**
 * One dimension as a MODEL may draft it — the generation half of the seam
 * #1466 split for the ask payload, for the same reason and with the same
 * asymmetry.
 *
 * `settles` is REQUIRED here, so the emitted JSON schema states the field and
 * the model is asked for it on every dimension, and the repair above runs
 * before the enum rather than a refusal landing after it. A refusal on this
 * seam is not a validation result anyone gets to act on: it throws inside the
 * structured-output call and takes the whole turn with it — the failure that
 * cost a delivered question in #1466. An authoring pass that loses one
 * dimension's authority marking degrades to `either`, which is askable; an
 * authoring pass that dies loses the checklist entirely.
 */
export const ChecklistDraftItemGenerationSchema = z.preprocess(
  repairSettles,
  ChecklistDraftItemSchema.extend({ settles: z.enum(CHECKLIST_SETTLERS) }),
);
export type ChecklistDraftItemGeneration = z.infer<typeof ChecklistDraftItemGenerationSchema>;

/** A drafted checklist as a model may write it. See the item schema above. */
export const ChecklistDraftGenerationSchema = z.array(ChecklistDraftItemGenerationSchema).max(8);
export type ChecklistDraftGeneration = z.infer<typeof ChecklistDraftGenerationSchema>;

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
