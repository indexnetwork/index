/**
 * questions/question.env — centralized question-generation env accessors.
 *
 * Naming scheme (one prefix, hierarchical):
 *
 *   QUESTIONER_ENABLED                  master switch — QuestionerQueue worker +
 *                                       enqueue closures at every composition site.
 *   QUESTIONER_UPTAKE_ENABLED           per-surface switch — advisory pre-accept uptake
 *                                       interlock. Requires the master switch.
 *   QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD
 *                                       authority threshold (0-100, default 70).
 *   QUESTIONER_CHAT_WAIT_TIMEOUT_MS     how long the blocking ask_user_question chat
 *                                       tool waits for an inline answer (default 4 min).
 *   QUESTIONER_INTENT_DAILY_CAP         refinement questions one intent may generate
 *                                       per rolling 24h, recovery + pool combined
 *                                       (default 2; 0 disables refinement).
 *
 * All reads go through this module — do not read these variables via
 * `process.env` elsewhere. Values are read on every call (no caching) so tests
 * and long-lived processes observe changes.
 */

export const CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT = 240_000;
export const UPTAKE_AUTHORITY_THRESHOLD_DEFAULT = 70;

/**
 * Refinement questions a single intent may generate per rolling window.
 *
 * Recovery and pool mining both re-arm when the intent text changes, and
 * answering a refinement question is itself what changes it — so each answer
 * buys another question and the loop ends only when the user stops replying.
 * Measured on a dev account: 27 questions against three intents in 9.5 hours,
 * one discriminator asked three times, while the best-scoring match had already
 * been found after the first question.
 */
export const INTENT_QUESTION_DAILY_CAP_DEFAULT = 2;

/**
 * Width of the budget window, in hours.
 *
 * Rolling rather than per-UTC-day deliberately: the observed bursts straddled
 * midnight UTC (20:22-21:18, then 05:48-05:55), and a calendar-day budget would
 * have granted the second burst a full fresh allowance.
 */
export const INTENT_QUESTION_DAILY_WINDOW_HOURS = 24;

/**
 * Parse a positive integer env var, clamped to the safe-integer range so a
 * malformed env value cannot crash `AbortSignal.timeout` (which throws on
 * values outside `[0, MAX_SAFE_INTEGER]`).
 */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > Number.MAX_SAFE_INTEGER) return fallback;
  return parsed;
}

/** Master switch: is any background question generation enabled? */
export function isQuestionerEnabled(): boolean {
  return process.env.QUESTIONER_ENABLED === "true";
}


/** Advisory uptake interlock. Flag-off by default and subordinate to the master switch. */
export function isUptakeGuardEnabled(): boolean {
  return isQuestionerEnabled() && process.env.QUESTIONER_UPTAKE_ENABLED === "true";
}

/** Authority threshold below which hosts may generate uptake questions. */
export function uptakeAuthorityThreshold(): number {
  const raw = process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD;
  if (!raw?.trim()) return UPTAKE_AUTHORITY_THRESHOLD_DEFAULT;
  if (!/^-?\d+$/.test(raw.trim())) return UPTAKE_AUTHORITY_THRESHOLD_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  return Math.min(100, Math.max(0, parsed));
}



/** Wait budget for the blocking ask_user_question chat tool. */
export function chatQuestionWaitTimeoutMs(): number {
  return positiveIntEnv("QUESTIONER_CHAT_WAIT_TIMEOUT_MS", CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT);
}

/**
 * Per-intent refinement budget over {@link INTENT_QUESTION_DAILY_WINDOW_HOURS}.
 *
 * Zero is a meaningful setting — it disables background refinement entirely
 * without touching the master switch — so this does not reuse `positiveIntEnv`.
 */
export function intentQuestionDailyCap(): number {
  const raw = process.env.QUESTIONER_INTENT_DAILY_CAP;
  if (!raw?.trim()) return INTENT_QUESTION_DAILY_CAP_DEFAULT;
  if (!/^\d+$/.test(raw.trim())) return INTENT_QUESTION_DAILY_CAP_DEFAULT;
  return Number.parseInt(raw, 10);
}
