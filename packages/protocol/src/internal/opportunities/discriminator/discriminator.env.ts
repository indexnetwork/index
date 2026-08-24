/**
 * Tuning constants for pool-question discriminators (IND-416).
 */

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

/** Adjustment factor for candidates on the side the user did NOT choose. */
export const POOL_ADJUSTMENT_FACTOR_OTHER = 0.6;

/** Adjustment factor for candidates the miner could not assign (unknown). */
export const POOL_ADJUSTMENT_FACTOR_UNKNOWN = 0.9;

/** Floor for the cumulative adjustment multiplier — demoted, never hidden. */
export const POOL_ADJUSTMENT_FLOOR = 0.3;

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
