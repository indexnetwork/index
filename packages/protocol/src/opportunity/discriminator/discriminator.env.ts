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

/** Minimum VoI for a discriminator to become (or chain) a question. */
export const POOL_QUESTION_MIN_VOI = 0.2;

/** Minimum evidence-verification rate for a discriminator to become a question. */
export const POOL_QUESTION_MIN_EVIDENCE_RATE = 0.6;

/** Max eligible discriminators carried per mining pass (asked + alternates). */
export const POOL_QUESTION_MAX_DISCRIMINATORS = 3;

/** Unattended budget: max pending questions of ANY mode per intent. */
export const POOL_QUESTION_MAX_PENDING_PER_INTENT = 3;

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
