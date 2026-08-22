/**
 * Lens B outcome join + threshold — pure functions, no LLM, no I/O (IND-434).
 *
 * Given discriminators whose candidate → side assignments were produced BLIND
 * to outcome (the miner never saw which side the user chose), this module joins
 * the explicit owner-outcome labels and produces aggregate-only telemetry:
 *
 *   - Independence: capture admits only one unique counterpart per opportunity;
 *     the caller then deduplicates by that recipient-scoped counterpart hash.
 *     Every retained entry therefore represents one distinct counterpart.
 *   - Threshold: a discriminator side is "qualified" only when it holds at
 *     least `minIndependentSupport` (k) independent examples. A hypothesis is
 *     eligible only when at least `minComparedSides` sides qualify.
 *   - Small-cell suppression: only qualified sides (≥ k) are ever emitted, so
 *     no aggregate row can be traced to a small handful of individuals.
 *
 * The outcome label is joined here and ONLY here — the miner and the side
 * assignments upstream are independent of it, so association can never leak
 * into classification.
 */

import { OUTCOME_MIN_COMPARED_SIDES, OUTCOME_MIN_INDEPENDENT_SUPPORT } from "./outcome.env.js";
import type { JoinOutcomeHypothesesInput, OutcomeHypothesis, OutcomeShadowResult, OutcomeSideSupport } from "./outcome.types.js";

/** Round a rate to 0.01 for telemetry (never a raw count). */
function roundRate(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Join outcome labels onto blind side assignments and keep only hypotheses that
 * clear the independent-support threshold on at least `minComparedSides` sides.
 *
 * @returns Aggregate telemetry: eligible hypotheses sorted by (min support desc,
 *   label asc) for deterministic ordering, each carrying only qualified sides.
 */
export function joinOutcomeHypotheses(input: JoinOutcomeHypothesesInput): OutcomeShadowResult {
  const minSupport = input.minIndependentSupport ?? OUTCOME_MIN_INDEPENDENT_SUPPORT;
  const minSides = input.minComparedSides ?? OUTCOME_MIN_COMPARED_SIDES;

  // Distinct independent examples with a joinable outcome label.
  const poolSize = input.examples.size;

  const hypotheses: OutcomeHypothesis[] = [];

  for (const discriminator of input.discriminators) {
    // Normalize sides by trimming, then reject the ENTIRE discriminator if any
    // side is empty or if labels are not unique after normalization. Silently
    // deduplicating malformed model output would turn an ambiguous comparison
    // into apparently valid evidence.
    const normalizedSides = discriminator.sides.map((side) => side.trim());
    if (normalizedSides.some((side) => side.length === 0)) continue;
    if (new Set(normalizedSides).size !== normalizedSides.length) continue;
    if (normalizedSides.length < minSides) continue;
    const validSides = new Set(normalizedSides);

    // First normalize VERIFIED, labelled assignments by candidate id. If the
    // same independent example is assigned to different sides, mark it
    // ambiguous and exclude it from every side; it must never support two cells.
    const sideById = new Map<string, string>();
    const ambiguousIds = new Set<string>();
    for (const assignment of discriminator.assignments) {
      if (assignment.side === null || !assignment.verified) continue;
      const side = assignment.side.trim();
      if (!validSides.has(side) || !input.examples.has(assignment.id)) continue;
      const previous = sideById.get(assignment.id);
      if (previous !== undefined && previous !== side) ambiguousIds.add(assignment.id);
      else if (previous === undefined) sideById.set(assignment.id, side);
    }

    // Tally DISTINCT independent example ids per unambiguous side. Repeating
    // the same assignment never increases support.
    const idsBySide = new Map<string, Set<string>>();
    const acceptedIdsBySide = new Map<string, Set<string>>();
    for (const [id, side] of sideById) {
      if (ambiguousIds.has(id)) continue;
      const label = input.examples.get(id);
      if (label === undefined) continue;
      if (!idsBySide.has(side)) idsBySide.set(side, new Set());
      idsBySide.get(side)!.add(id);
      if (label === "accepted") {
        if (!acceptedIdsBySide.has(side)) acceptedIdsBySide.set(side, new Set());
        acceptedIdsBySide.get(side)!.add(id);
      }
    }

    // Keep only sides that clear the independent-support threshold (>= k
    // genuinely distinct independent examples).
    const qualifiedSides: OutcomeSideSupport[] = [];
    for (const side of normalizedSides) {
      const support = idsBySide.get(side)?.size ?? 0;
      if (support < minSupport) continue; // small-cell: never emitted
      const accepted = acceptedIdsBySide.get(side)?.size ?? 0;
      qualifiedSides.push({
        side,
        independentSupport: support,
        acceptRate: roundRate(accepted / support),
      });
    }

    if (qualifiedSides.length < minSides) continue; // not enough to compare

    // Deterministic side ordering: support desc, then label asc.
    qualifiedSides.sort(
      (a, b) => b.independentSupport - a.independentSupport || a.side.localeCompare(b.side),
    );

    hypotheses.push({
      label: discriminator.label,
      questionSeed: discriminator.questionSeed,
      sides: qualifiedSides,
      evidenceRate: discriminator.evidenceRate,
      minIndependentSupport: Math.min(...qualifiedSides.map((s) => s.independentSupport)),
    });
  }

  // Deterministic hypothesis ordering: strongest support first, then label.
  hypotheses.sort(
    (a, b) => b.minIndependentSupport - a.minIndependentSupport || a.label.localeCompare(b.label),
  );

  return { poolSize, eligibleCount: hypotheses.length, hypotheses };
}
