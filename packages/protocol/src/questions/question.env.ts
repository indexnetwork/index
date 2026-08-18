/**
 * questions/question.env — centralized question-generation env accessors.
 *
 * Naming scheme (one prefix, hierarchical):
 *
 *   QUESTIONER_ENABLED                  master switch — QuestionerQueue worker +
 *                                       enqueue closures at every composition site.
 *   QUESTIONER_CHAT_WAIT_TIMEOUT_MS     how long the blocking ask_user_question chat
 *                                       tool waits for an inline answer (default 4 min).
 *
 * All reads go through this module — do not read these variables via
 * `process.env` elsewhere. Values are read on every call (no caching) so tests
 * and long-lived processes observe changes.
 */

export const CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT = 240_000;

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



/** Wait budget for the blocking ask_user_question chat tool. */
export function chatQuestionWaitTimeoutMs(): number {
  return positiveIntEnv("QUESTIONER_CHAT_WAIT_TIMEOUT_MS", CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT);
}
