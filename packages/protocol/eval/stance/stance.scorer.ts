import type { NegotiatorStance } from "../../src/negotiation/domain/negotiation.stance.contracts.js";
import type { BucketScore, FixtureValue, StanceRunResult, StanceScore } from "./stance.types.js";

/**
 * Aggregate runs into one bucket score.
 *
 * Errored runs are counted but excluded from the decline-rate denominator: a
 * provider failure is not evidence about the stance either way, and folding it
 * into the rate would make a flaky run look like a behaviour change.
 */
export function scoreBucket(results: StanceRunResult[]): BucketScore {
  const errors = results.filter((r) => r.error).length;
  const scored = results.filter((r) => !r.error);
  const declined = scored.filter((r) => r.verdict === "declined").length;
  const accepted = scored.filter((r) => r.verdict === "accepted").length;
  const stalled = scored.filter((r) => r.verdict === "stalled").length;
  return {
    runs: scored.length,
    declined,
    accepted,
    stalled,
    errors,
    declineRate: scored.length === 0 ? 0 : declined / scored.length,
  };
}

function bucket(results: StanceRunResult[], value: FixtureValue): StanceRunResult[] {
  return results.filter((r) => r.value === value);
}

/**
 * Score one stance across every run.
 *
 * The headline number is `discrimination` — decline rate on low-value fixtures
 * MINUS decline rate on high-value ones. A stance that simply declines more of
 * everything scores zero: it has become pessimistic, not discerning. That is
 * the signal of interest, and it is what a null result must be reported
 * against.
 */
export function scoreStance(stance: NegotiatorStance, results: StanceRunResult[]): StanceScore {
  const own = results.filter((r) => r.stance === stance);
  const lowValue = scoreBucket(bucket(own, "low"));
  const highValue = scoreBucket(bucket(own, "high"));
  return {
    stance,
    lowValue,
    highValue,
    discrimination: lowValue.declineRate - highValue.declineRate,
    turnZeroRefusals: own.filter((r) => r.refusedAtTurnZero).length,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

/** Markdown table of the per-stance measurement — the PR body's reportable artifact. */
export function renderScoreTable(scores: StanceScore[]): string {
  const header =
    "| stance | decline rate (low value) | decline rate (high value) | discrimination | turn-0 refusals |\n" +
    "|---|---|---|---|---|";
  const rows = scores.map((s) => {
    const low = `${pct(s.lowValue.declineRate)} (${s.lowValue.declined}/${s.lowValue.runs})`;
    const high = `${pct(s.highValue.declineRate)} (${s.highValue.declined}/${s.highValue.runs})`;
    const disc = `${s.discrimination >= 0 ? "+" : ""}${(s.discrimination * 100).toFixed(0)}pp`;
    return `| \`${s.stance}\` | ${low} | ${high} | ${disc} | ${s.turnZeroRefusals} |`;
  });
  return [header, ...rows].join("\n");
}

/**
 * The interpretation the eval is allowed to assert, stated once so the runner
 * cannot quietly editorialize.
 *
 * `materialLowValueGain` is the honesty gate: it is true only when the stance
 * declines materially more low-value fixtures than `advocate` does. Nothing in
 * this module tunes toward that outcome — if it is false, the harness reports a
 * null result, which is a legitimate finding.
 */
export const MATERIAL_GAIN_THRESHOLD = 0.2;

export interface StanceComparison {
  stance: NegotiatorStance;
  lowValueDeclineDelta: number;
  highValueDeclineDelta: number;
  materialLowValueGain: boolean;
  /** True when the stance declined strictly more genuinely-good matches than advocate. */
  lostGoodMatches: boolean;
}

export function compareToBaseline(baseline: StanceScore, candidate: StanceScore): StanceComparison {
  const lowValueDeclineDelta = candidate.lowValue.declineRate - baseline.lowValue.declineRate;
  const highValueDeclineDelta = candidate.highValue.declineRate - baseline.highValue.declineRate;
  return {
    stance: candidate.stance,
    lowValueDeclineDelta,
    highValueDeclineDelta,
    materialLowValueGain: lowValueDeclineDelta >= MATERIAL_GAIN_THRESHOLD,
    lostGoodMatches: highValueDeclineDelta > 0,
  };
}
