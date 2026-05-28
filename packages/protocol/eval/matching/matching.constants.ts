/** Operational surfacing threshold used by the matching eval harness. */
export const MATCHING_MIN_SCORE = 30;

/** Retry budget for transient LLM/API failures during live eval runs. */
export const MATCHING_EVAL_MAX_ATTEMPTS = 3;

/** Initial retry delay for live eval LLM/API failures. Doubles per attempt. */
export const MATCHING_EVAL_RETRY_DELAY_MS = 1_000;
