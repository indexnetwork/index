/**
 * questions/question.env — centralized question-generation env accessors.
 *
 * Naming scheme (one prefix, hierarchical):
 *
 *   QUESTIONER_ENABLED                  master switch — QuestionerQueue worker +
 *                                       enqueue closures at every composition site.
 *
 * All reads go through this module — do not read these variables via
 * `process.env` elsewhere. Values are read on every call (no caching) so tests
 * and long-lived processes observe changes.
 */


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

/** Master switch: is any background question generation enabled? */
export function isQuestionerEnabled(): boolean {
  return process.env.QUESTIONER_ENABLED === "true";
}


