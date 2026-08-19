/**
 * negotiations/domain — the checklist: a pre-registered conjunctive screen.
 *
 * A negotiation between two agents is not bargaining. There is no price and no
 * surplus to divide; the question is only "should these two people meet?" —
 * a deliberation dialogue with information-seeking sub-dialogues (a park)
 * spliced in when it hits a privately-held unknown. The checklist is the
 * schema-level form of that deliberation, and this module owns it
 * (docs/plans/2026-08-19-checklist-negotiations.md §2–§4, §6).
 *
 * What the shape encodes:
 *
 * - **Satisficing, not optimizing.** Every dimension must be satisfactory;
 *   there are no scores, no weights, and no compensation between dimensions.
 *   A great answer on one cannot buy out a conflict on another.
 * - **Pre-registration.** The dimensions are authored ONCE, on turn 1, from
 *   the two intents alone, and frozen: {@link reconcileChecklist} is the only
 *   way a later turn touches them, and it can change nothing but `result` and
 *   `basis`. That is what stops an agent talking itself into a match by
 *   dropping a hard dimension, or out of one by inventing a new requirement
 *   after the counterparty answered the original ones.
 * - **Mutuality is not one dimension among many.** `mutual_want` is the
 *   two-sided-matching condition itself, so a checklist without one is not a
 *   checklist — {@link authorChecklist} rejects it.
 * - **Basis is provenance, machine-checked.** A dimension may be scored from
 *   the commitment store only — what the principals themselves stated
 *   (intents, profile, premises, answers). `ok`/`conflict` with an empty
 *   `basis` is invalid by construction, and `unknown` must carry none. This is
 *   where the #1448 provenance rule now lives: an agent's own prior
 *   conclusions are decisions, not commitments, so they cannot score anything.
 *
 * **Failure direction is deliberate.** Every repair in this module degrades
 * toward `unknown`, never toward `ok`: an unbacked `ok` becomes `unknown`
 * (which is askable), a malformed authoring produces no checklist at all
 * (which is today's behaviour), and no repair ever invents a dimension. A
 * checklist that cannot be trusted must not be able to conclude a match.
 */

import { z } from "zod";

import { configuredNegotiatorStance, stanceUsesChecklist } from "./negotiation.stance.contracts.js";
import { AnswerhoodSchema, CHECKLIST_KINDS, CHECKLIST_RESULTS, ChecklistDraftItemSchema, ChecklistDraftSchema, MAX_CHECKLIST_DIMENSIONS, MIN_CHECKLIST_DIMENSIONS, type Answerhood, type ChecklistDraft, type ChecklistDraftItem, type ChecklistKind, type ChecklistResult } from "../shared/schemas/negotiation-checklist.schema.js";

export {
  AnswerhoodSchema,
  CHECKLIST_KINDS,
  CHECKLIST_RESULTS,
  ChecklistDraftItemSchema,
  ChecklistDraftSchema,
  MAX_CHECKLIST_DIMENSIONS,
  MIN_CHECKLIST_DIMENSIONS,
};
export type { Answerhood, ChecklistDraft, ChecklistDraftItem, ChecklistKind, ChecklistResult };

/**
 * Questions one principal may be asked in one negotiation (bounded
 * rationality, made explicit). The turn-0 pre-contact consult is this budget's
 * first draw rather than a separate mechanism; the per-signal open-park bound
 * (`MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT`) stays as the CROSS-negotiation
 * guard, which this does not replace.
 */
export const QUESTION_BUDGET_PER_PRINCIPAL = 3;

/**
 * One scored dimension with the basis discipline enforced — the invariant a
 * persisted, reconciled checklist holds, and what specs assert against.
 */
export const ChecklistItemSchema = ChecklistDraftItemSchema.superRefine((item, ctx) => {
  const basis = item.basis.trim();
  if (item.result === "unknown" && basis.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["basis"],
      message: "an unknown dimension carries no basis — nothing was read from the commitment store",
    });
  }
  if (item.result !== "unknown" && basis.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["basis"],
      message: `a dimension scored ${item.result} must cite the commitment it was scored from`,
    });
  }
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/** A frozen, scored checklist: the negotiation's pre-registered screen. */
export const NegotiationChecklistSchema = z
  .array(ChecklistItemSchema)
  .min(MIN_CHECKLIST_DIMENSIONS)
  .max(MAX_CHECKLIST_DIMENSIONS)
  .superRefine((items, ctx) => {
    if (!items.some((item) => item.kind === "mutual_want")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a checklist must carry a mutual_want dimension — mutuality is the matching condition itself",
      });
    }
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const key = dimensionKey(item.name);
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "name"],
          message: `dimension ${item.name} appears more than once`,
        });
      }
      seen.add(key);
    });
  });
export type NegotiationChecklist = z.infer<typeof NegotiationChecklistSchema>;

/**
 * The question budget in force for this deployment: the checklist protocol's
 * per-principal budget under the assessing stances, and the legacy
 * one-consultation ration under `advocate`.
 *
 * One resolver rather than the same conditional at each callsite, because the
 * budget binds in four places that must agree — the turn node's grant, the
 * consultation policy's admission, the post-stall park, and the external-seat
 * eligibility shadow. A ration of one is the same rule with a budget of one,
 * which is what lets those callsites stop branching on the stance at all.
 */
export function configuredQuestionBudgetPerPrincipal(): number {
  return stanceUsesChecklist(configuredNegotiatorStance()) ? QUESTION_BUDGET_PER_PRINCIPAL : 1;
}

// ─── Identity and repair ─────────────────────────────────────────────────────

/** Dimension identity: the name, case- and whitespace-insensitive. */
export function dimensionKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Enforce the basis discipline on a drafted item, repairing toward `unknown`.
 *
 * An `ok`/`conflict` with no basis is not a score — it is an assertion, which
 * is exactly what the provenance rule forbids — so it degrades to `unknown`
 * and becomes askable. An `unknown` carrying a basis has its basis dropped:
 * a dimension nothing settles cannot cite a commitment.
 */
export function normalizeChecklistItem(item: ChecklistDraftItem): ChecklistItem {
  const basis = item.basis.trim();
  const name = item.name.trim();
  if (item.result === "unknown") return { ...item, name, basis: "" };
  if (basis.length === 0) return { ...item, name, result: "unknown", basis: "" };
  return { ...item, name, basis };
}

/** Repair a whole draft: per-item basis discipline, then de-duplication. */
export function normalizeChecklistDraft(draft: readonly ChecklistDraftItem[]): ChecklistItem[] {
  const seen = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const raw of draft) {
    const item = normalizeChecklistItem(raw);
    const key = dimensionKey(item.name);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

// ─── Authoring (turn 1) and freezing (every turn after) ──────────────────────

/**
 * Author the checklist from a turn-1 draft, or return null when the draft
 * cannot make one.
 *
 * Null is the fail-open answer, not an error: the negotiation proceeds exactly
 * as it does today and the next turn drafts again. What this must never do is
 * manufacture a checklist — an invented dimension would be pre-registration in
 * name only.
 *
 * Trimming past {@link MAX_CHECKLIST_DIMENSIONS} preserves the authored order
 * but never drops the mutual-want dimension: it is the matching condition, so
 * it is not the item allowed to fall off the end.
 */
export function authorChecklist(draft: readonly ChecklistDraftItem[]): NegotiationChecklist | null {
  const items = normalizeChecklistDraft(draft);
  const mutual = items.find((item) => item.kind === "mutual_want");
  if (!mutual) return null;
  let trimmed = items.slice(0, MAX_CHECKLIST_DIMENSIONS);
  if (!trimmed.some((item) => item.kind === "mutual_want")) {
    trimmed = [mutual, ...trimmed.slice(0, MAX_CHECKLIST_DIMENSIONS - 1)];
  }
  if (trimmed.length < MIN_CHECKLIST_DIMENSIONS) return null;
  const parsed = NegotiationChecklistSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

/**
 * Re-score a frozen checklist from a later turn's draft.
 *
 * The frozen dimensions are the authority: their `name` and `kind` are copied
 * through untouched, a drafted dimension the checklist does not carry is
 * ignored (no dimension is ever added), and a frozen dimension the draft
 * omitted keeps the score it already had (no dimension is ever dropped).
 * Only `result` and `basis` move — under the same basis discipline, so a
 * re-score to `ok` with nothing behind it lands on `unknown`.
 */
export function reconcileChecklist(
  frozen: readonly ChecklistItem[],
  draft: readonly ChecklistDraftItem[] | null | undefined,
): NegotiationChecklist {
  const scores = new Map<string, ChecklistItem>();
  for (const raw of draft ?? []) {
    const item = normalizeChecklistItem(raw);
    const key = dimensionKey(item.name);
    if (key.length > 0 && !scores.has(key)) scores.set(key, item);
  }
  return frozen.map((item) => {
    const scored = scores.get(dimensionKey(item.name));
    return scored ? { ...item, result: scored.result, basis: scored.basis } : item;
  }) as NegotiationChecklist;
}

/**
 * The checklist a negotiation currently holds, read off its own turns.
 *
 * The turn record is the durable substrate — every turn persists the checklist
 * it acted on, so there is no second store to keep in step and a continuation
 * recovers the frozen dimensions from the same messages it recovers the
 * dialogue from. The LAST turn carrying one wins: turns are re-scorings of the
 * same frozen dimensions, so the latest is the current state.
 */
export function checklistFromTurns(
  turns: readonly { checklist?: readonly ChecklistDraftItem[] | null }[],
): ChecklistItem[] {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const candidate = turns[index]?.checklist;
    if (candidate && candidate.length > 0) return normalizeChecklistDraft(candidate);
  }
  return [];
}

/** Whether a list is a usable frozen checklist (authored, not a stub). */
export function isChecklistAuthored(items: readonly ChecklistItem[]): boolean {
  return items.length >= MIN_CHECKLIST_DIMENSIONS && items.some((item) => item.kind === "mutual_want");
}

// ─── Verdict state ───────────────────────────────────────────────────────────

export interface ChecklistVerdictState {
  /** Every dimension scored `ok`. */
  allOk: boolean;
  conflicts: ChecklistItem[];
  unknowns: ChecklistItem[];
}

/**
 * The verdict-relevant read of a checklist (plan §6). Elimination by Aspects:
 * one conflicting dimension is decisive on its own, and no number of `ok`s
 * compensates for it. Unknowns are never decisive — they are asked about, or
 * deferred to the meeting once the budget is spent.
 */
export function checklistVerdictState(items: readonly ChecklistItem[]): ChecklistVerdictState {
  const conflicts = items.filter((item) => item.result === "conflict");
  const unknowns = items.filter((item) => item.result === "unknown");
  return {
    allOk: items.length > 0 && conflicts.length === 0 && unknowns.length === 0,
    conflicts,
    unknowns,
  };
}

// ─── Ask admissibility (plan §3) ─────────────────────────────────────────────

/**
 * Why an ask was refused. Names the condition of the admissibility rule that
 * failed, so the telemetry says which one bound.
 */
export type AskInadmissibility =
  /** The ask named no dimension, or one the frozen checklist does not carry. */
  | "no_such_dimension"
  /** The commitment store already scored it — answer from stated facts instead. */
  | "already_scored"
  /** No answerhood map, or one whose branches cannot flip anything. */
  | "not_pivotal"
  /** This topic has already been asked in this negotiation. */
  | "repeat_topic"
  /** The principal's question budget for this negotiation is spent. */
  | "budget_spent";

export type AskAdmissibility =
  | { admissible: true; dimension: ChecklistItem }
  | { admissible: false; reason: AskInadmissibility };

export interface AskAdmissibilityInput {
  /** The frozen checklist this negotiation is running. */
  checklist: readonly ChecklistItem[];
  /** The dimension the ask names. */
  dimension: string | undefined;
  /** The declared answerhood map — the pivotality proof. */
  answerhood: Answerhood | undefined;
  /** Dimensions this principal has already been asked about in this negotiation. */
  askedDimensions: readonly string[];
  /** Questions this principal has already been asked in this negotiation. */
  questionsSpent: number;
  /** Budget override; defaults to {@link QUESTION_BUDGET_PER_PRINCIPAL}. */
  budget?: number;
}

/**
 * The five-part admissibility rule, in the part that is machine-checkable.
 *
 * 1. **Unknown** and 3. **principal-authoritative** collapse into one check
 *    here, and that is the point rather than a shortcut: a dimension is
 *    `unknown` exactly when no commitment in the store settles it, because the
 *    basis discipline is what allows any other score. So "the commitment store
 *    can answer it" is observable as "it is not unknown" — reported as
 *    `already_scored`, the reason that says *answer from stated facts instead
 *    of spending the principal's attention*. Whether the missing fact is one
 *    the PRINCIPAL rather than the counterparty holds stays prompt law: no
 *    enum can see it.
 * 2. **Pivotal** — the answerhood map must exist and its two branches must
 *    differ. A map whose `ok_when` and `conflict_when` say the same thing
 *    proves nothing would flip, which is zero value of information.
 * 4. **Unasked** — topic identity is the dimension, not the phrasing, so a
 *    re-ask reads as a repeat however it is worded.
 * 5. **Budget** — at most {@link QUESTION_BUDGET_PER_PRINCIPAL} per principal
 *    per negotiation, the turn-0 pre-contact consult included.
 *
 * Order matters for the telemetry only; the conditions are conjunctive.
 */
export function assessAskAdmissibility(input: AskAdmissibilityInput): AskAdmissibility {
  const budget = input.budget ?? QUESTION_BUDGET_PER_PRINCIPAL;
  if (input.questionsSpent >= budget) return { admissible: false, reason: "budget_spent" };

  const key = input.dimension ? dimensionKey(input.dimension) : "";
  const item = key.length > 0
    ? input.checklist.find((candidate) => dimensionKey(candidate.name) === key)
    : undefined;
  if (!item) return { admissible: false, reason: "no_such_dimension" };
  if (item.result !== "unknown") return { admissible: false, reason: "already_scored" };

  if (input.askedDimensions.some((asked) => dimensionKey(asked) === key)) {
    return { admissible: false, reason: "repeat_topic" };
  }

  const answerhood = input.answerhood;
  const okWhen = answerhood?.ok_when.trim() ?? "";
  const conflictWhen = answerhood?.conflict_when.trim() ?? "";
  if (okWhen.length === 0 || conflictWhen.length === 0 || okWhen.toLowerCase() === conflictWhen.toLowerCase()) {
    return { admissible: false, reason: "not_pivotal" };
  }

  return { admissible: true, dimension: item };
}

// ─── Prompt rendering ────────────────────────────────────────────────────────

const KIND_LABEL: Record<ChecklistKind, string> = {
  mutual_want: "mutual want",
  hard_constraint: "hard constraint",
  fit: "fit",
};

export interface ChecklistSectionInput {
  checklist: readonly ChecklistItem[];
  /** Questions this principal has already been asked in this negotiation. */
  questionsSpent: number;
  /**
   * Topics already asked, with the answerhood each ask declared. Two jobs, and
   * the second is why the map travels rather than just the name: "a topic is
   * asked once" needs the names, and scoring an arriving answer against the
   * map the ask DECLARED — instead of re-reading the answer freely — needs the
   * map, which nothing else in the prompt carries.
   */
  askedTopics?: ReadonlyArray<{ dimension: string; answerhood?: Answerhood }>;
  budget?: number;
}

/**
 * The checklist block rendered into the turn prompt — the state half of the
 * protocol, beside the rules half in `negotiation.stance.contracts.ts`.
 *
 * Rendered every turn once a checklist exists, and rendered as the authoring
 * instruction before that, so the agent always sees which of the two moves it
 * is making. The budget line is here rather than in the rules because it is
 * state: how much of this principal's attention is already spent.
 */
export function renderChecklistSection(input: ChecklistSectionInput): string {
  const budget = input.budget ?? QUESTION_BUDGET_PER_PRINCIPAL;
  const spent = Math.max(0, Math.min(input.questionsSpent, budget));
  const askedTopics = (input.askedTopics ?? []).filter((topic) => topic.dimension.trim().length > 0);
  const asked = askedTopics.map((topic) => topic.dimension.trim());
  const declared = askedTopics.filter((topic) => topic.answerhood);
  const budgetLine = `Questions your client has already been asked in THIS negotiation: ${spent} of ${budget}.`
    + (asked.length > 0 ? ` Topics already asked: ${asked.join("; ")} — never ask any of them again.` : "")
    + (declared.length > 0
      ? `\nAnswerhood you declared when you asked, and must score against now rather than re-reading the answer freely:\n`
        + declared
          .map((topic) => `- ${topic.dimension.trim()}: ok when ${topic.answerhood!.ok_when}; conflict when ${topic.answerhood!.conflict_when}`)
          .join("\n")
      : "");

  if (!isChecklistAuthored(input.checklist)) {
    return `\n\n--- CHECKLIST (none yet — you write it on this turn) ---\n`
      + `No checklist exists for this negotiation. Write it now from the two intents alone: `
      + `${MIN_CHECKLIST_DIMENSIONS} to ${MAX_CHECKLIST_DIMENSIONS} dimensions, one of them the mutual want, `
      + `then score each. Fewer than ${MIN_CHECKLIST_DIMENSIONS} is not a checklist and will be discarded.\n`
      + budgetLine;
  }

  const rows = input.checklist
    .map((item) => {
      const basis = item.basis.trim();
      return `- ${item.name} [${KIND_LABEL[item.kind]}]: ${item.result}${basis ? ` — basis: ${basis}` : ""}`;
    })
    .join("\n");

  return `\n\n--- CHECKLIST (fixed for this negotiation — re-score it, never rewrite it) ---\n`
    + `${rows}\n`
    + budgetLine;
}
