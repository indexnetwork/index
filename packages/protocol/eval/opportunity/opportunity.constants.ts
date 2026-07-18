/** Retry budget for transient live-model failures during an opportunity eval run. */
export const OPPORTUNITY_EVAL_MAX_ATTEMPTS = 3;
/** Base backoff between opportunity eval retries (doubles each attempt). */
export const OPPORTUNITY_EVAL_RETRY_DELAY_MS = 1000;
/** Outer deadline for each eval invocation attempt. */
export const OPPORTUNITY_EVAL_ATTEMPT_TIMEOUT_MS = 90_000;
/** Hard cap on the greeting length (mirrors the presenter's schema `.max(500)`). */
export const GREETING_MAX_LEN = 500;
