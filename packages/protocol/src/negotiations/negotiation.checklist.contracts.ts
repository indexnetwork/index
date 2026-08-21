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

import { AnswerhoodSchema, CHECKLIST_KINDS, CHECKLIST_RESULTS, CHECKLIST_SETTLERS, ChecklistDraftGenerationSchema, ChecklistDraftItemGenerationSchema, ChecklistDraftItemSchema, ChecklistDraftSchema, DEFAULT_CHECKLIST_SETTLER, MAX_CHECKLIST_DIMENSIONS, MIN_CHECKLIST_DIMENSIONS, type Answerhood, type ChecklistDraft, type ChecklistDraftItem, type ChecklistKind, type ChecklistResult, type ChecklistSettler } from "../shared/schemas/negotiation-checklist.schema.js";

export {
  AnswerhoodSchema,
  CHECKLIST_KINDS,
  CHECKLIST_RESULTS,
  CHECKLIST_SETTLERS,
  ChecklistDraftGenerationSchema,
  ChecklistDraftItemGenerationSchema,
  ChecklistDraftItemSchema,
  ChecklistDraftSchema,
  DEFAULT_CHECKLIST_SETTLER,
  MAX_CHECKLIST_DIMENSIONS,
  MIN_CHECKLIST_DIMENSIONS,
};
export type { Answerhood, ChecklistDraft, ChecklistDraftItem, ChecklistKind, ChecklistResult, ChecklistSettler };

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
export const ChecklistItemSchema = ChecklistDraftItemSchema.extend({
  /**
   * Required on a persisted, reconciled dimension — the shape the floor and
   * the ask rule read. Absent on the way IN (a legacy turn, an authoring pass
   * that skipped it) it defaults to {@link DEFAULT_CHECKLIST_SETTLER}, which
   * is askable: the fail-open direction this whole field is defaulted in.
   */
  settles: z.enum(CHECKLIST_SETTLERS).default(DEFAULT_CHECKLIST_SETTLER),
}).superRefine((item, ctx) => {
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
  return QUESTION_BUDGET_PER_PRINCIPAL;
}

// ─── Identity and repair ─────────────────────────────────────────────────────

/** Dimension identity: the name, case- and whitespace-insensitive. */
export function dimensionKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Read a dimension's declared authority, repairing anything else to
 * {@link DEFAULT_CHECKLIST_SETTLER}.
 *
 * The one place the legacy contract is honoured: a checklist persisted before
 * `settles` existed carries none, and it reads back as `either` — askable,
 * therefore identical to how it behaved before this field. Same for a value
 * the generation schema somehow let through. Unlike every other repair in this
 * module, this one does not degrade toward the conservative answer, because
 * here the conservative answer is the DANGEROUS one: `counterparty` would take
 * a dimension out of the floor's reach, and an unfilled field must never be
 * able to do that.
 */
export function normalizeSettles(value: unknown): ChecklistSettler {
  return CHECKLIST_SETTLERS.includes(value as ChecklistSettler)
    ? (value as ChecklistSettler)
    : DEFAULT_CHECKLIST_SETTLER;
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
  const settles = normalizeSettles(item.settles);
  if (item.result === "unknown") return { ...item, name, settles, basis: "" };
  if (basis.length === 0) return { ...item, name, settles, result: "unknown", basis: "" };
  return { ...item, name, settles, basis };
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
 * The frozen dimensions are the authority: their `name`, `kind` and `settles`
 * are copied through untouched, a drafted dimension the checklist does not
 * carry is ignored (no dimension is ever added), and a frozen dimension the
 * draft omitted keeps the score it already had (no dimension is ever dropped).
 * Only `result` and `basis` move — under the same basis discipline, so a
 * re-score to `ok` with nothing behind it lands on `unknown`.
 *
 * `settles` freezing with the dimension is what makes it trustworthy. It is a
 * judgment about the WORLD — whose fact this is — not about the evidence, so
 * nothing a later turn learns can change it, and letting a re-score move it
 * would hand an agent the switch that turns the conclusion floor off for a
 * dimension it would rather not be asked about.
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
  /**
   * The dimension is the COUNTERPARTY's fact to state, so no answer from this
   * client could settle it. The mechanical half of rule 3 — see
   * {@link assessAskAdmissibility}.
   */
  | "counterparty_authoritative"
  /** No answerhood map, or one whose branches cannot flip anything. */
  | "not_pivotal"
  /** This topic has already been asked in this negotiation. */
  | "repeat_topic"
  /** The principal's question budget for this negotiation is spent. */
  | "budget_spent"
  /**
   * This principal cannot be consulted at all — no answer can ever arrive, so
   * no question may be put. Distinct from `budget_spent` on purpose: nothing
   * was spent, and a trace that said otherwise would be a lie.
   */
  | "principal_unreachable";

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
  /**
   * Whether THIS principal — the acting seat's, never the counterparty's — can
   * be consulted at all. Absent/undefined means reachable.
   */
  principalUnreachable?: boolean;
}

/**
 * The five-part admissibility rule, in the part that is machine-checkable.
 *
 * 1. **Unknown** — a dimension is `unknown` exactly when no commitment in the
 *    store settles it, because the basis discipline is what allows any other
 *    score. So "the commitment store can answer it" is observable as "it is
 *    not unknown" — reported as `already_scored`, the reason that says *answer
 *    from stated facts instead of spending the principal's attention*.
 * 3. **Principal-authoritative** — the missing fact must be one this client
 *    holds. This was prompt law until the floor asked a client, in her own DM,
 *    whether the counterparty works on generative story games: no enum could
 *    see whose fact it was, so nothing mechanical could refuse it. Now the
 *    authoring agent declares `settles` once and this reads it — a dimension
 *    marked `counterparty` is refused as `counterparty_authoritative`, in both
 *    directions at once, since the same marking is what keeps the conclusion
 *    floor from manufacturing the ask this refuses.
 * 2. **Pivotal** — the answerhood map must exist and its two branches must
 *    differ. A map whose `ok_when` and `conflict_when` say the same thing
 *    proves nothing would flip, which is zero value of information.
 * 4. **Unasked** — topic identity is the dimension, not the phrasing, so a
 *    re-ask reads as a repeat however it is worded.
 * 5. **Budget** — at most {@link QUESTION_BUDGET_PER_PRINCIPAL} per principal
 *    per negotiation, the turn-0 pre-contact consult included. A principal who
 *    cannot be consulted at all is mechanically a budget of zero, and is
 *    checked first so the refusal names that rather than a spent ration. It is
 *    per-seat, like the budget it stands in for: the other principal's is
 *    untouched.
 *
 * Order matters for the telemetry only; the conditions are conjunctive.
 */
export function assessAskAdmissibility(input: AskAdmissibilityInput): AskAdmissibility {
  if (input.principalUnreachable === true) {
    return { admissible: false, reason: "principal_unreachable" };
  }
  const budget = input.budget ?? QUESTION_BUDGET_PER_PRINCIPAL;
  if (input.questionsSpent >= budget) return { admissible: false, reason: "budget_spent" };

  const key = input.dimension ? dimensionKey(input.dimension) : "";
  const item = key.length > 0
    ? input.checklist.find((candidate) => dimensionKey(candidate.name) === key)
    : undefined;
  if (!item) return { admissible: false, reason: "no_such_dimension" };
  if (item.result !== "unknown") return { admissible: false, reason: "already_scored" };
  if (normalizeSettles(item.settles) === "counterparty") {
    return { admissible: false, reason: "counterparty_authoritative" };
  }

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

// ─── Decline admissibility: the verdict law, mechanically (plan §6) ──────────

/**
 * Why a drafted decline was refused. One condition today, named rather than
 * implied so the telemetry says which law bound — the same discipline
 * {@link AskInadmissibility} follows.
 */
export type DeclineInadmissibility =
  /** The checklist holds no `conflict` dimension: nothing was decided against. */
  | "no_conflict_dimension";

export type DeclineAdmissibility =
  | { admissible: true }
  | { admissible: false; reason: DeclineInadmissibility; unknowns: string[] };

export interface DeclineAdmissibilityInput {
  /** The reconciled checklist this turn is deciding on. */
  checklist: readonly ChecklistItem[];
}

/**
 * The verdict law, in the half a machine can check: **an unknown is not a
 * reason to end anything; a decline needs a conflict.**
 *
 * Elimination by Aspects (plan §6) makes one conflicting dimension decisive on
 * its own — and says nothing else is. A checklist carrying only `ok`s and
 * `unknown`s has therefore found nothing to decide against: the honest moves
 * there are to answer the unknown from the record, to carry it, or to let the
 * first conversation settle it. Ending the negotiation on it is the model
 * mistaking "I could not find out" for "this does not work", which is exactly
 * what was observed in dev — a decline citing "repeated lack of clarity"
 * against a counterparty whose agent had never been able to answer.
 *
 * The check is deliberately narrow. It reads the checklist and nothing else:
 * not the reasoning, not the message, not the transcript. Whether a conflict
 * is REAL stays the agent's judgment and the basis discipline's problem; all
 * this refuses is a terminal verdict with no conflict behind it at all.
 *
 * Fails OPEN on an unauthored checklist — see {@link isChecklistAuthored} —
 * for the same reason ask admissibility does: with no frozen dimensions there
 * is no law to have violated, and a failed authoring pass must not stand
 * between an agent and an honest verdict.
 */
export function assessDeclineAdmissibility(input: DeclineAdmissibilityInput): DeclineAdmissibility {
  if (!isChecklistAuthored(input.checklist)) return { admissible: true };
  const verdict = checklistVerdictState(input.checklist);
  if (verdict.conflicts.length > 0) return { admissible: true };
  return {
    admissible: false,
    reason: "no_conflict_dimension",
    unknowns: verdict.unknowns.map((item) => item.name),
  };
}

// ─── Conclude admissibility: the floor under a verdict (floor plan §1) ──────

/**
 * The unknowns this negotiation could still ASK about, in the checklist's own
 * authored order.
 *
 * "Askable" is a conjunction of two very different kinds of condition, and
 * they are split on purpose. What lives HERE is the part the checklist can
 * see: a dimension scored `unknown`, whose topic has not already been put to
 * this principal, AND which is not the counterparty's fact to state. What
 * lives at the callsite is whether the ask CHANNEL is up at all — v2, the
 * wiring, the budget, the ask-rounds cap, a reachable principal, a non-final
 * turn — which the turn node already computes once as `askUserAvailable` and
 * passes in as a single boolean. Recomputing any part of it here would be a
 * second answer to a question that already has one.
 *
 * The `settles` filter is the half that was missing, and its absence was
 * observed live: a seat whose first two unknowns were both about the
 * COUNTERPARTY's work drafted `question` to the counterparty's agent — the
 * protocol's own prescribed move — and the floor, seeing a non-ask turn with
 * an unknown standing, coerced it into asking the CLIENT whether the other
 * person works on generative story games. `unknown ∧ unasked` cannot tell a
 * Beatrice-style "what is your timing?" from that; only the authoring agent
 * ever knew, which is why it now says so once and this reads it forever.
 *
 * The direction is deliberate: `client` and `either` both qualify, and only an
 * explicit `counterparty` is excluded. A dimension nobody marked stays askable,
 * so no authoring failure — lazy, legacy, or repaired — can switch the floor
 * off wholesale. See {@link DEFAULT_CHECKLIST_SETTLER}.
 *
 * Order is the checklist's own. The dimensions were pre-registered on turn 1
 * by the agent that wrote them, so their order is that agent's own statement
 * of what decides this pairing; imposing a kind-based ranking here would
 * quietly re-prioritize a screen the protocol froze.
 */
export function askableUnknowns(
  checklist: readonly ChecklistItem[],
  askedDimensions: readonly string[],
): ChecklistItem[] {
  if (!isChecklistAuthored(checklist)) return [];
  const asked = new Set(askedDimensions.map((name) => dimensionKey(name)));
  return checklist.filter((item) => item.result === "unknown"
    && normalizeSettles(item.settles) !== "counterparty"
    && !asked.has(dimensionKey(item.name)));
}

/**
 * Why a drafted terminal verdict was refused. One condition, named rather than
 * implied — the same discipline {@link DeclineInadmissibility} follows.
 */
export type ConcludeInadmissibility =
  /** An unknown dimension is still askable: the question outranks the verdict. */
  | "unknowns_askable";

export type ConcludeAdmissibility =
  | { admissible: true }
  | { admissible: false; reason: ConcludeInadmissibility; unknowns: string[] };

export interface ConcludeAdmissibilityInput {
  /** The reconciled checklist this turn is deciding on. */
  checklist: readonly ChecklistItem[];
  /** Dimensions this principal has already been asked about in this negotiation. */
  askedDimensions: readonly string[];
  /**
   * Whether an ask could actually be put on this turn — the turn node's own
   * `askUserAvailable`, passed in rather than reconstructed. False means there
   * is no question to prefer over the verdict, so the verdict stands.
   */
  askUserAvailable: boolean;
}

/**
 * The floor under a verdict: **a terminal verdict is inadmissible while an
 * askable unknown stands.**
 *
 * {@link assessDeclineAdmissibility} closed one exit — a decline with no
 * conflict behind it. This closes the rest of them, and it is the same law
 * read forwards. The verdict rule says an unknown is not a reason to end
 * anything; a week of live traffic says the model ends things anyway, because
 * every alternative to asking is cheaper: assume the unknown away and accept,
 * interrogate the counterparty about a fact they do not hold, or conclude and
 * be done. Twenty-three policy-recognized consultation moments produced zero
 * questions. Not one agent chose the arrow.
 *
 * So the choice stops being the model's. While a dimension it scored `unknown`
 * is one this principal could still be asked about, concluding — in favour of
 * the match or against it — is not an available move, and the turn is
 * re-issued knowing that. "Could be asked about" is {@link askableUnknowns},
 * which now excludes the dimensions the author marked as the COUNTERPARTY's to
 * state: a verdict blocked only by those is admitted, because the move that
 * resolves them is dialogue with the other agent, and the verdict law already
 * says an unknown may be carried into the meeting. What makes this safe rather than a deadlock is that
 * `askUserAvailable` is FALSE the moment the budget is spent, the ask-rounds
 * cap is reached, the principal is unreachable, or the turn is the last one:
 * every one of those reopens the verdict immediately. The floor holds only
 * while there is a real question left to ask.
 *
 * The reference behaviour (`docs/plans/2026-08-19-negotiator-floor.reference.jsx`)
 * states the same shape from the other side: unknowns block a match until the
 * budget is spent, and only then does "unknowns people settle when they meet"
 * wave a verdict through. Production had that hatch open unconditionally.
 *
 * Fails OPEN on an unauthored checklist, exactly as ask and decline
 * admissibility do: with no frozen dimensions there is no unknown to be
 * askable, and a failed authoring pass must not stand between an agent and an
 * honest verdict.
 */
export function assessConcludeAdmissibility(input: ConcludeAdmissibilityInput): ConcludeAdmissibility {
  if (!isChecklistAuthored(input.checklist)) return { admissible: true };
  if (!input.askUserAvailable) return { admissible: true };
  const askable = askableUnknowns(input.checklist, input.askedDimensions);
  if (askable.length === 0) return { admissible: true };
  return {
    admissible: false,
    reason: "unknowns_askable",
    unknowns: askable.map((item) => item.name),
  };
}

// ─── Prompt rendering ────────────────────────────────────────────────────────

const KIND_LABEL: Record<ChecklistKind, string> = {
  mutual_want: "mutual want",
  hard_constraint: "hard constraint",
  fit: "fit",
};

/**
 * How a dimension's declared authority reads back to the agent that wrote it.
 *
 * Rendered on every row rather than only where it bites, because the agent
 * re-scoring a frozen checklist did not necessarily author it — a resumed run,
 * the other seat's reply, a continuation — and the marking is what tells it
 * which unknowns are its client's to resolve and which are the counterparty's
 * to be asked about in the dialogue.
 */
const SETTLES_LABEL: Record<ChecklistSettler, string> = {
  client: "your client's to settle",
  counterparty: "the counterparty's to state",
  either: "either side can settle",
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
  /**
   * Whether this turn's client can be consulted at all. When true the budget
   * line would be a fiction — there is no ration to spend — so an honest line
   * about the missing channel replaces it.
   */
  principalUnreachable?: boolean;
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
  const unreachable = input.principalUnreachable === true;
  const budgetLine = unreachable
    ? `Your client cannot be consulted in this negotiation: there is no channel to put a question to them and no answer can arrive. `
      + `Score every dimension from the record you already hold, and carry as unknown whatever it does not settle.`
    : `Questions your client has already been asked in THIS negotiation: ${spent} of ${budget}.`
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
      + `then score each. Fewer than ${MIN_CHECKLIST_DIMENSIONS} is not a checklist and will be discarded. `
      + `At least one dimension must be something the record does not settle — score it unknown`
      + (unreachable
        ? `.\n`
        : ` — and the best one is a thing only your client can answer.\n`)
      + `For EVERY dimension, also say whose fact it is, in "settles": "client" for a thing only your client can answer — their preference, their constraint, their willingness; `
      + `"counterparty" for something that is the other side's to state about themselves — their work, their stage, their availability; `
      + `"either" where either side could settle it. This is not a guess about who is easier to reach: a dimension about the COUNTERPARTY is never resolved by asking your client about them.\n`
      + budgetLine;
  }

  const rows = input.checklist
    .map((item) => {
      const basis = item.basis.trim();
      const settles = SETTLES_LABEL[normalizeSettles(item.settles)];
      return `- ${item.name} [${KIND_LABEL[item.kind]}, ${settles}]: ${item.result}${basis ? ` — basis: ${basis}` : ""}`;
    })
    .join("\n");

  return `\n\n--- CHECKLIST (fixed for this negotiation — re-score it, never rewrite it) ---\n`
    + `${rows}\n`
    + budgetLine;
}
