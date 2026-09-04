/**
 * Retrieval score calibration.
 *
 * A candidate's `similarity` must stay an honest, cosine-derived value. Retrieval
 * awards a bonus when more than one signal (HyDE lens, or discovery strategy)
 * surfaced the same candidate, and that bonus used to be *added* to the raw score
 * and then clamped: `Math.min(raw + bonus, 1)`. Any candidate with enough
 * overlapping signals landed on exactly 1.0, so dozens of unrelated candidates tied
 * at the top of the ranking and monopolised the by-rank evaluation batch.
 *
 * The bonus is applied to the headroom above the raw score instead. That keeps it
 * strictly monotone in the raw score and strictly below 1.0 unless the vector itself
 * scored 1.0 — a flat ceiling of identical maxima across different documents is
 * impossible by construction.
 */

/** Default bonus per additional distinct signal that surfaced the same candidate. */
export const MULTI_SIGNAL_BONUS_PER_SIGNAL = 0.1;

/** Default ceiling on the total multi-signal bonus fraction. */
export const MULTI_SIGNAL_BONUS_MAX = 0.3;

/**
 * Clamp a raw vector score into [0, 1].
 * pgvector's `1 - (a <=> b)` can return values a float epsilon outside the range,
 * and a non-finite score (bad parse, missing column) must not poison the ranking.
 */
export function normalizeSimilarity(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw <= 0) return 0;
  return raw >= 1 ? 1 : raw;
}

/**
 * Combine a raw similarity with a bounded bonus for multi-signal agreement.
 *
 * `distinctSignals` is the number of *distinct* signals (lenses, strategies) that
 * surfaced this candidate — not the number of matched rows. The same lens hitting
 * three of a user's intents is one signal, not three.
 */
export function withMultiSignalBonus(
  raw: number,
  distinctSignals: number,
  options: { perSignal?: number; maxBonus?: number } = {},
): number {
  const base = normalizeSimilarity(raw);
  const extraSignals = Math.max(0, Math.floor(distinctSignals) - 1);
  if (extraSignals === 0 || base >= 1) return base;
  const perSignal = options.perSignal ?? MULTI_SIGNAL_BONUS_PER_SIGNAL;
  const maxBonus = options.maxBonus ?? MULTI_SIGNAL_BONUS_MAX;
  const bonus = Math.min(extraSignals * perSignal, maxBonus);
  return base + (1 - base) * bonus;
}
