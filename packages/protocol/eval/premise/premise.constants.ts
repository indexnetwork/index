/** Retry budget for transient live-model failures during a premise eval run. */
export const PREMISE_EVAL_MAX_ATTEMPTS = 3;
/** Base backoff between premise eval retries (doubles each attempt). */
export const PREMISE_EVAL_RETRY_DELAY_MS = 1000;
