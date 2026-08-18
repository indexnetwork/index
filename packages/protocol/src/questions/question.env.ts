/**
 * questions/question.env — leftover question env constants.
 *
 * The QUESTIONER_* runtime flags are retired with the card generators
 * (conversational-questions plan); park-path routing is always on. What
 * remains are the historical budget constants still referenced by the
 * questions-table adapter until its surface drops.
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



