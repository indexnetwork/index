/**
 * Centralized accessors for Lens B outcome-question environment variables
 * (IND-434).
 *
 *   OUTCOME_QUESTIONS_MODE   off | shadow | on — Lens B "explicit opportunity
 *                            outcomes → grounded questions" pipeline.
 *
 *                            off (default): no outcome feedback events are
 *                              captured and no hypothesis mining runs. Zero
 *                              behavior change.
 *                            shadow: capture one idempotent append-only
 *                              feedback event per explicit owner action, mine
 *                              neutral trade-off hypotheses for the exact
 *                              recipient + intent + fingerprint, and emit
 *                              aggregate telemetry only. No question, ranking,
 *                              intent, premise, memory, newborn-stamp, or push
 *                              writes.
 *                            on: reserved for a later phase (IND-438) that
 *                              turns a grounded hypothesis into a user-facing
 *                              question. This slice treats "on" exactly like
 *                              "shadow" for capture + mining; it never emits
 *                              questions.
 *
 * All reads go through this module — do not read this variable via
 * `process.env` elsewhere. Values are read on every call (no caching) so tests
 * and long-lived processes observe changes.
 */

/** Lens B outcome-question mode. */
export type OutcomeQuestionsMode = "off" | "shadow" | "on";

/**
 * Current OUTCOME_QUESTIONS_MODE (default off). Only the exact trimmed literals
 * "shadow" and "on" activate; every other value (including unset/empty) is off.
 */
export function outcomeQuestionsMode(): OutcomeQuestionsMode {
  const value = process.env.OUTCOME_QUESTIONS_MODE?.trim();
  return value === "shadow" || value === "on" ? value : "off";
}

/**
 * True when Lens B capture + mining should run at all. Both "shadow" and "on"
 * activate the shadow pipeline; only the future question-emitting behavior is
 * gated on "on" (not part of this slice).
 */
export function isOutcomeQuestionsActivated(): boolean {
  return outcomeQuestionsMode() !== "off";
}

/**
 * Independent-support threshold (k). Every compared group (discriminator side)
 * must have at least this many INDEPENDENT (related-opportunity-deduplicated)
 * examples before the hypothesis is eligible. Enforced per side, so no side
 * can be traced back to a small handful of individuals.
 */
export const OUTCOME_MIN_INDEPENDENT_SUPPORT = 5;

/** Minimum number of qualified sides (each ≥ k) for a hypothesis to compare. */
export const OUTCOME_MIN_COMPARED_SIDES = 2;

/**
 * k-anonymity floor for attempting a mining pass at all: the number of
 * distinct independent examples (after related-opportunity dedup) required
 * before the miner is invoked. Set to k × minimum compared sides so a pass can
 * never produce an eligible hypothesis below the aggregate floor.
 */
export const OUTCOME_MIN_INDEPENDENT_EXAMPLES =
  OUTCOME_MIN_INDEPENDENT_SUPPORT * OUTCOME_MIN_COMPARED_SIDES;

/** Max independent examples sent to the miner LLM (most recent first). */
export const OUTCOME_MAX_CANDIDATES = 48;

/** Max chars of presentation-safe candidate snapshot stored/sent per example. */
export const OUTCOME_MAX_PUBLIC_CONTEXT_CHARS = 400;
