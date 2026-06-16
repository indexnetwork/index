/**
 * Pure statistical helpers shared by every eval harness.
 *
 * No I/O, no domain knowledge — just the binomial / beta-binomial math behind
 * confidence intervals and regression significance. Unit-tested in
 * `eval/shared/tests/stats.spec.ts`.
 */

/** Wilson score interval without continuity correction. Returns [lo, hi]. */
export function binomialCI(passes: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 1];
  const p = passes / total;
  const denom = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/** ln(n!) computed exactly enough for the small-n exact binomial CDF path. */
function lnFactorial(n: number): number {
  let out = 0;
  for (let i = 2; i <= n; i++) out += Math.log(i);
  return out;
}

/** Natural log of binomial coefficient C(n, k). */
function lnChoose(n: number, k: number): number {
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k);
}

/** Natural log of the Beta function for integer args, B(a, b) = (a-1)!(b-1)!/(a+b-1)!. */
function lnBetaInt(a: number, b: number): number {
  return lnFactorial(a - 1) + lnFactorial(b - 1) - lnFactorial(a + b - 1);
}

/**
 * One-sided binomial point-null p-value.
 * H₀: true pass-rate = nullRate; Ha: true pass-rate < nullRate (regression).
 */
export function binomialPValue(observedPasses: number, total: number, nullRate: number): number {
  if (total === 0) return 1;
  if (nullRate <= 0) return 1;
  if (nullRate >= 1) return observedPasses < total ? 0 : 1;
  let cumulative = 0;
  for (let k = 0; k <= observedPasses; k++) {
    const logP = lnChoose(total, k) + k * Math.log(nullRate) + (total - k) * Math.log1p(-nullRate);
    cumulative += Math.exp(logP);
  }
  return Math.min(1, Math.max(0, cumulative));
}

/**
 * One-sided beta-binomial posterior-predictive p-value.
 *
 * This treats the committed baseline as observed evidence rather than a perfect
 * point estimate. With a uniform Beta(1,1) prior, baseline x/n gives posterior
 * Beta(x+1, n-x+1), and we ask how likely the current pass count or lower is
 * under that posterior predictive distribution. This prevents 7/7 baselines
 * from making a single future miss mathematically impossible.
 */
export function predictivePValue(
  observedPasses: number,
  observedRuns: number,
  baselinePasses: number,
  baselineRuns: number,
): number {
  if (observedRuns === 0 || baselineRuns === 0) return 1;
  const a = baselinePasses + 1;
  const b = baselineRuns - baselinePasses + 1;
  const base = lnBetaInt(a, b);
  let cumulative = 0;
  for (let k = 0; k <= observedPasses; k++) {
    const logP = lnChoose(observedRuns, k) + lnBetaInt(k + a, observedRuns - k + b) - base;
    cumulative += Math.exp(logP);
  }
  return Math.min(1, Math.max(0, cumulative));
}

/** True when the one-sided binomial point-null p-value is at or below alpha. */
export function binomialSignificance(observedPasses: number, total: number, nullRate: number, alpha = 0.05): boolean {
  return binomialPValue(observedPasses, total, nullRate) <= alpha;
}

/** Arithmetic mean of a number list (0 for empty). */
export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Rate string with 95% confidence, e.g. `92% (CI₉₅ 78%–98%)`. */
export function rateWithCI(passes: number, total: number): string {
  if (total === 0) return "n/a";
  const [lo, hi] = binomialCI(passes, total);
  return `${Math.round((passes / total) * 100)}% (CI₉₅ ${Math.round(lo * 100)}%–${Math.round(hi * 100)}%)`;
}
