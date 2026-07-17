/**
 * Lens B outcome join + threshold — pure functions, no LLM, no I/O (IND-434).
 *
 * Given discriminators whose candidate → side assignments were produced BLIND
 * to outcome (the miner never saw which side the user chose), this module joins
 * the explicit owner-outcome labels and produces aggregate-only telemetry:
 *
 *   - Independence: the caller passes already-deduplicated examples (one entry
 *     per distinct counterpart). Every entry counts as one independent example.
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
    // Tally per side over VERIFIED assignments that have an outcome label.
    // Each opportunity id is one independent example (dedup done upstream).
    const totalBySide = new Map<string, number>();
    const acceptedBySide = new Map<string, number>();

    for (const assignment of discriminator.assignments) {
      if (assignment.side === null || !assignment.verified) continue;
      if (!discriminator.sides.includes(assignment.side)) continue;
      const label = input.examples.get(assignment.id);
      if (label === undefined) continue; // no owner outcome for this candidate
      totalBySide.set(assignment.side, (totalBySide.get(assignment.side) ?? 0) + 1);
      if (label === "accepted") {
        acceptedBySide.set(assignment.side, (acceptedBySide.get(assignment.side) ?? 0) + 1);
      }
    }

    // Keep only sides that clear the independent-support threshold.
    const qualifiedSides: OutcomeSideSupport[] = [];
    for (const side of discriminator.sides) {
      const support = totalBySide.get(side) ?? 0;
      if (support < minSupport) continue; // small-cell: never emitted
      const accepted = acceptedBySide.get(side) ?? 0;
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
