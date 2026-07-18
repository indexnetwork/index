/** Retry budget for transient live-model failures during a profile eval run. */
export const PROFILE_EVAL_MAX_ATTEMPTS = 3;
/** Base backoff between profile eval retries (doubles each attempt). */
export const PROFILE_EVAL_RETRY_DELAY_MS = 1000;
/** Outer deadline for each eval invocation attempt. */
export const PROFILE_EVAL_ATTEMPT_TIMEOUT_MS = 90_000;
