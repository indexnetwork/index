/**
 * Centralized accessors for pool-question environment variables (IND-416).
 *
 *   POOL_QUESTIONS_MINING   off | shadow — P1 shadow axis mining on
 *                           discovery-run completion. `shadow` mines and
 *                           scores axes and logs them; no questions are
 *                           generated and no user-facing behavior changes.
 *                           Any value other than "shadow" (including unset)
 *                           means off.
 *
 * All reads go through this module — do not read these variables via
 * `process.env` elsewhere. Values are read on every call (no caching) so
 * tests and long-lived processes observe changes.
 */

/** Mining mode for pool discriminator axes. */
export type PoolQuestionsMiningMode = "off" | "shadow";

/** Current POOL_QUESTIONS_MINING mode (default off). */
export function poolQuestionsMiningMode(): PoolQuestionsMiningMode {
  return process.env.POOL_QUESTIONS_MINING?.trim() === "shadow" ? "shadow" : "off";
}

/** Question mode for pool discriminators (IND-418). */
export type PoolQuestionsMode = "off" | "on";

/**
 * Current POOL_QUESTIONS_MODE (default off). When "on", the mining hook also
 * enqueues a pool_discovery question for the top eligible discriminator
 * (still subject to the QUESTIONER_ENABLED master gate and per-intent budget).
 * "on" implies mining runs even when POOL_QUESTIONS_MINING is off.
 */
export function poolQuestionsMode(): PoolQuestionsMode {
  return process.env.POOL_QUESTIONS_MODE?.trim() === "on" ? "on" : "off";
}

/** Push delivery mode for high-VoI pool questions (IND-421). */
export type PoolQuestionsPushMode = "off" | "on";

/**
 * Current POOL_QUESTIONS_PUSH mode (default off). Callers must additionally
 * require pool-question mode and negotiator availability before delivery.
 */
export function poolQuestionsPushMode(): PoolQuestionsPushMode {
  return process.env.POOL_QUESTIONS_PUSH?.trim() === "on" ? "on" : "off";
}

/** Newborn-opportunity stamping mode (IND-420 P4b). */
export type PoolQuestionsStampNewbornMode = "off" | "on";

/**
 * Current POOL_QUESTIONS_STAMP_NEWBORN mode (default off). Effective callers
 * additionally require {@link poolQuestionsMode} to be on.
 */
export function poolQuestionsStampNewborn(): PoolQuestionsStampNewbornMode {
  return process.env.POOL_QUESTIONS_STAMP_NEWBORN?.trim() === "on" ? "on" : "off";
}

/** Minimum VoI for a discriminator to become (or chain) a question. */
export const POOL_QUESTION_MIN_VOI = 0.2;

/** Minimum evidence-verification rate for a discriminator to become a question. */
export const POOL_QUESTION_MIN_EVIDENCE_RATE = 0.6;

/** Max eligible discriminators carried per mining pass (asked + alternates). */
export const POOL_QUESTION_MAX_DISCRIMINATORS = 3;

/** Unattended budget: max pending questions of ANY mode per intent. */
export const POOL_QUESTION_MAX_PENDING_PER_INTENT = 3;

/** Initial internal VoI threshold for proactive push delivery. */
export const POOL_QUESTION_PUSH_BASE_VOI = 0.6;

/** Multiplicative VoI threshold increase per consecutive dismissal. */
export const POOL_QUESTION_PUSH_DISMISSAL_DECAY = 1.15;

/** Minimum pool size for proactive delivery (stricter than mining). */
export const POOL_QUESTION_PUSH_MIN_POOL_SIZE = 8;

/** Maximum claimed proactive pool pushes per recipient per UTC day. */
export const POOL_QUESTION_PUSH_DAILY_CAP = 2;

/** Ranking mode for pool adjustments (IND-419). */
export type PoolQuestionsRankingMode = "off" | "on";

/**
 * Current POOL_QUESTIONS_RANKING (default off). When "on", the home feed
 * orders by adjusted confidence (confidence × Π poolAdjustments.factor,
 * floor {@link POOL_ADJUSTMENT_FLOOR}). Adjustments are WRITTEN regardless of
 * this flag — it only gates whether ordering reads them, so the apply path
 * can ship first.
 */
export function poolQuestionsRanking(): PoolQuestionsRankingMode {
  return process.env.POOL_QUESTIONS_RANKING?.trim() === "on" ? "on" : "off";
}

/** Adjustment factor for candidates on the side the user did NOT choose. */
export const POOL_ADJUSTMENT_FACTOR_OTHER = 0.6;

/** Adjustment factor for candidates the miner could not assign (unknown). */
export const POOL_ADJUSTMENT_FACTOR_UNKNOWN = 0.9;

/** Floor for the cumulative adjustment multiplier — demoted, never hidden. */
export const POOL_ADJUSTMENT_FLOOR = 0.3;

/**
 * Staleness guard (IND-419): when more than this fraction of a question's
 * stored assignments point at opportunities that left the pool (expired /
 * rejected / accepted / archived), skip the re-rank — the snapshot no longer
 * describes the live pool.
 */
export const POOL_STALENESS_THRESHOLD = 0.3;

/** Debounce window for answer-triggered re-discovery (Tier 1), per intent. */
export const POOL_RERUN_DEBOUNCE_MS = 60_000;

/**
 * k-anonymity floor: axes are only mined when the pool has at least this many
 * candidates, so no axis (or later, question option) can be traced back to a
 * specific individual.
 */
export const POOL_DISCRIMINATOR_MIN_POOL_SIZE = 5;

/** Max candidates sent to the miner LLM (top-N by score). */
export const POOL_DISCRIMINATOR_MAX_CANDIDATES = 24;

/** Max chars of public context per candidate in the miner prompt. */
export const POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS = 400;
