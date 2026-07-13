/**
 * Centralized accessors for all question-generation environment variables.
 *
 * Naming scheme (one prefix, hierarchical):
 *
 *   QUESTIONER_ENABLED                  master switch — QuestionerQueue worker +
 *                                       enqueue closures at every composition site.
 *   QUESTIONER_DISCOVERY_ENABLED        per-surface switch — decision questions during
 *                                       chat/MCP opportunity discovery. Only effective
 *                                       when the master switch is on (the discovery
 *                                       question step adds inline summarizer latency,
 *                                       so operators can turn it off independently).
 *   QUESTIONER_DISCOVERY_INPUT_MODE     'transcripts' | 'insights' generator input.
 *   QUESTIONER_DISCOVERY_TIMEOUT_MS     per-call deadline for the discovery-questions
 *                                       LLM step (default 12s).
 *   QUESTIONER_CHAT_WAIT_TIMEOUT_MS     how long the blocking ask_user_question chat
 *                                       tool waits for an inline answer (default 4 min).
 *
 * All reads go through this module — do not read these variables via
 * `process.env` elsewhere. Values are read on every call (no caching) so tests
 * and long-lived processes observe changes.
 */

/**
 * Question-generator budget. Sized against Railway's ~60 s edge timeout:
 * the discovery + evaluation + negotiate phases consume ~50 s on the slow
 * path, leaving ~10 s of headroom for the tail. 12 s is the larger end of
 * "fits"; the question step usually completes in 4-8 s, so most legitimate
 * calls finish well inside. Aborted calls return `null` (no questions);
 * the rest of the discovery payload still ships.
 */
export const DISCOVERY_QUESTIONS_TIMEOUT_MS_DEFAULT = 12_000;
export const CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT = 240_000;

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

/**
 * Per-surface switch: should chat/MCP opportunity discovery produce decision
 * questions? Hierarchical — always false when the master switch is off.
 */
export function isDiscoveryQuestionsEnabled(): boolean {
  return isQuestionerEnabled() && process.env.QUESTIONER_DISCOVERY_ENABLED === "true";
}

/**
 * Input mode for the discovery question generator. Only `transcripts` is
 * implemented; any other value falls back to `transcripts` (startup.env.ts
 * warns on invalid values).
 */
export function discoveryQuestionsInputMode(): "transcripts" | "insights" {
  return process.env.QUESTIONER_DISCOVERY_INPUT_MODE?.trim() === "insights"
    ? "insights"
    : "transcripts";
}

/** Per-call deadline for the discovery-questions LLM step. */
export function discoveryQuestionsTimeoutMs(): number {
  return positiveIntEnv("QUESTIONER_DISCOVERY_TIMEOUT_MS", DISCOVERY_QUESTIONS_TIMEOUT_MS_DEFAULT);
}

/** Wait budget for the blocking ask_user_question chat tool. */
export function chatQuestionWaitTimeoutMs(): number {
  return positiveIntEnv("QUESTIONER_CHAT_WAIT_TIMEOUT_MS", CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT);
}
