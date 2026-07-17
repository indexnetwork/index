/**
 * Pool-adjustment domain logic (IND-419) — pure functions, no I/O.
 *
 * When a user answers a pool_discovery question, every candidate the mining
 * pass assigned to a side gets a multiplicative adjustment written to
 * `opportunities.metadata.poolAdjustments`. The home feed (flag-gated) orders
 * by `confidence × Π factor`, floored so demoted candidates stay visible.
 *
 * Invariants:
 * - Deterministic and O(pool): no LLM at answer time — the applyPlan was
 *   computed (and evidence-verified) at mining time.
 * - Reversible: entries are keyed by questionId; re-answering replaces them,
 *   dismissal-driven reversal removes them.
 * - `detail` carries the template chip text built from the user's OWN answer
 *   ("Hands-on builders vs advisors: you chose Advisor") — never LLM
 *   reasoning (opportunity-presentation-safety).
 */
import { POOL_ADJUSTMENT_FACTOR_OTHER, POOL_ADJUSTMENT_FACTOR_UNKNOWN, POOL_ADJUSTMENT_FLOOR } from "./discriminator.env.js";
import type { QuestionPoolDiscriminator } from "../../shared/schemas/question.schema.js";

/** Recipient and intent provenance that scopes one pool preference. */
export interface PoolAdjustmentProvenance {
  recipientUserId: string;
  intentId: string;
}

/** One applied adjustment on an opportunity (stored in metadata.poolAdjustments). */
export interface PoolAdjustment extends PoolAdjustmentProvenance {
  /** The answered question that produced this adjustment (reversal key). */
  questionId: string;
  /** Discriminator label, e.g. "Hands-on builders vs advisors". */
  label: string;
  /** Side this candidate was assigned to (or "unknown"). */
  side: string;
  /** Multiplicative factor: chosen 1.0, other 0.6, unknown 0.9. */
  factor: number;
  /** Template chip text from the user's own answer. Set on demotions only. */
  detail?: string;
  /** ISO-8601 apply timestamp. */
  appliedAt: string;
  /** Full intent fingerprint authoritative when this adjustment was created. */
  intentFingerprint?: string;
  /** Audit-only marker: stale adjustments remain stored but have no ranking effect. */
  stale?: true;
}

/** Reads valid adjustments, optionally narrowed to one recipient + intent. */
export function readPoolAdjustments(
  metadata: Record<string, unknown> | null | undefined,
  provenance?: PoolAdjustmentProvenance,
): PoolAdjustment[] {
  const raw = metadata?.poolAdjustments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is PoolAdjustment => {
    if (
      typeof a !== "object" || a === null ||
      typeof (a as PoolAdjustment).questionId !== "string" ||
      typeof (a as PoolAdjustment).recipientUserId !== "string" ||
      typeof (a as PoolAdjustment).intentId !== "string" ||
      typeof (a as PoolAdjustment).factor !== "number" ||
      ((a as PoolAdjustment).stale !== undefined && (a as PoolAdjustment).stale !== true)
    ) return false;
    return provenance === undefined || (
      (a as PoolAdjustment).recipientUserId === provenance.recipientUserId &&
      (a as PoolAdjustment).intentId === provenance.intentId
    );
  });
}

/** Reads valid, non-stale adjustments for ranking and presentation behavior. */
export function readActivePoolAdjustments(
  metadata: Record<string, unknown> | null | undefined,
  provenance?: PoolAdjustmentProvenance,
): PoolAdjustment[] {
  return readPoolAdjustments(metadata, provenance).filter((adjustment) => adjustment.stale !== true);
}

/**
 * Cumulative adjustment multiplier for an opportunity, floored at
 * {@link POOL_ADJUSTMENT_FLOOR}. 1 when no scoped adjustments exist.
 */
export function poolAdjustmentMultiplier(
  metadata: Record<string, unknown> | null | undefined,
  provenance: PoolAdjustmentProvenance,
): number {
  const adjustments = readActivePoolAdjustments(metadata, provenance);
  if (adjustments.length === 0) return 1;
  const product = adjustments.reduce((acc, a) => acc * (Number.isFinite(a.factor) && a.factor > 0 ? a.factor : 1), 1);
  return Math.max(POOL_ADJUSTMENT_FLOOR, product);
}

/** Adjusted confidence: `confidence × Π factor`, floored. */
export function adjustedConfidence(
  confidence: number,
  metadata: Record<string, unknown> | null | undefined,
  provenance: PoolAdjustmentProvenance,
): number {
  return confidence * poolAdjustmentMultiplier(metadata, provenance);
}

/** Deterministic provenance signal stored alongside one adjustment. */
export interface PoolAdjustmentSignal extends PoolAdjustmentProvenance {
  type: "pool_discriminator";
  weight: 1 | -1 | 0;
  detail: string;
  questionId: string;
}

/** Pure helper input shared by Tier-0 answers and newborn stamping. */
export interface BuildPoolAdjustmentInput extends PoolAdjustmentProvenance {
  questionId: string;
  label: string;
  /** Verified side assignment, or null when the candidate is unassigned. */
  assignedSide: string | null;
  chosenSide: string;
  appliedAt: string;
  /** Full intent fingerprint authoritative when this adjustment was created. */
  intentFingerprint?: string;
}

/**
 * Build one P3-compatible adjustment and signal. This is the only place that
 * defines chosen/other/unknown factors, weights, and safe template details.
 */
export function buildPoolAdjustment(input: BuildPoolAdjustmentInput): {
  adjustment: PoolAdjustment;
  signal: PoolAdjustmentSignal;
} {
  const isUnknown = input.assignedSide === null;
  const isChosen = !isUnknown && input.assignedSide === input.chosenSide;
  const factor = isUnknown ? POOL_ADJUSTMENT_FACTOR_UNKNOWN : isChosen ? 1 : POOL_ADJUSTMENT_FACTOR_OTHER;
  const weight = isUnknown ? 0 : isChosen ? 1 : -1;
  const side = input.assignedSide ?? "unknown";
  return {
    adjustment: {
      questionId: input.questionId,
      recipientUserId: input.recipientUserId,
      intentId: input.intentId,
      label: input.label,
      side,
      factor,
      ...(!isChosen && !isUnknown ? { detail: `${input.label}: you chose ${input.chosenSide}` } : {}),
      appliedAt: input.appliedAt,
      ...(input.intentFingerprint !== undefined ? { intentFingerprint: input.intentFingerprint } : {}),
    },
    signal: {
      type: "pool_discriminator",
      weight,
      recipientUserId: input.recipientUserId,
      intentId: input.intentId,
      detail: isUnknown ? `${input.label}: unassigned` : `${input.label}: ${input.chosenSide}`,
      questionId: input.questionId,
    },
  };
}

/** Plan entry: what to write on one opportunity for one answer. */
export interface PoolAdjustmentPlanEntry {
  opportunityId: string;
  adjustment: PoolAdjustment;
  signal: PoolAdjustmentSignal;
}

/**
 * Computes the write plan for one answered discriminator. Pure: the caller
 * loads/patches rows. "Both matter" (or any label not in `sides`) yields an
 * empty plan — no preference, no adjustments.
 *
 * @param discriminator  The asked discriminator (from detection.pool).
 * @param chosenSide     The selected option label (chip label = side label).
 * @param questionId     Reversal key.
 * @param recipientUserId User whose answer produced the preference.
 * @param intentId       Intent whose candidate pool was ranked.
 * @param now            ISO-8601 timestamp.
 * @param intentFingerprint Full intent fingerprint authoritative at apply time.
 */
export function planPoolAdjustments(
  discriminator: QuestionPoolDiscriminator,
  chosenSide: string,
  questionId: string,
  recipientUserId: string,
  intentId: string,
  now: string,
  intentFingerprint?: string,
): PoolAdjustmentPlanEntry[] {
  // Chip labels are word-capped side labels; match on the capped prefix too.
  const matchesSide = (side: string): boolean =>
    side === chosenSide || side.startsWith(chosenSide) || chosenSide.startsWith(side);
  const chosen = discriminator.sides.find(matchesSide);
  if (!chosen) return []; // "Both matter" or unrecognized option → no adjustments.

  const plan: PoolAdjustmentPlanEntry[] = [];
  for (const a of discriminator.assignments) {
    plan.push({
      opportunityId: a.opportunityId,
      ...buildPoolAdjustment({
        questionId,
        recipientUserId,
        intentId,
        label: discriminator.label,
        assignedSide: a.side,
        chosenSide: chosen,
        appliedAt: now,
        ...(intentFingerprint !== undefined ? { intentFingerprint } : {}),
      }),
    });
  }
  return plan;
}

/**
 * Merges one adjustment into an opportunity's existing metadata, replacing
 * only the entry for the same question + recipient + intent provenance.
 * Returns the NEW metadata object (caller persists it wholesale).
 */
export function mergePoolAdjustment(
  metadata: Record<string, unknown> | null | undefined,
  adjustment: PoolAdjustment,
): Record<string, unknown> {
  const existing = readPoolAdjustments(metadata).filter((a) => !(
    a.questionId === adjustment.questionId &&
    a.recipientUserId === adjustment.recipientUserId &&
    a.intentId === adjustment.intentId
  ));
  return { ...(metadata ?? {}), poolAdjustments: [...existing, adjustment] };
}

/** Latest scoped user-explainable demotion detail for card presentation. */
export function latestPoolDemotionDetail(
  metadata: Record<string, unknown> | null | undefined,
  provenance: PoolAdjustmentProvenance,
): string | undefined {
  return [...readActivePoolAdjustments(metadata, provenance)]
    .reverse()
    .find((adjustment) => adjustment.factor < 1 && typeof adjustment.detail === 'string' && adjustment.detail.length > 0)
    ?.detail;
}

/** Removes one question adjustment for exact recipient + intent provenance. */
export function removePoolAdjustment(
  metadata: Record<string, unknown> | null | undefined,
  questionId: string,
  provenance: PoolAdjustmentProvenance,
): Record<string, unknown> {
  const remaining = readPoolAdjustments(metadata).filter((a) => !(
    a.questionId === questionId &&
    a.recipientUserId === provenance.recipientUserId &&
    a.intentId === provenance.intentId
  ));
  return { ...(metadata ?? {}), poolAdjustments: remaining };
}
