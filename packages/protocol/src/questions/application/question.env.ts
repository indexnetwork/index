/**
 * questions/application/question.env — centralized question-generation env accessors.
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
 *
 * All reads go through this module — do not read these variables via
 * `process.env` elsewhere. Values are read on every call (no caching) so tests
 * and long-lived processes observe changes.
 *
 * IND-547: canonical home — previously questioner/questioner.env.ts.
 * Legacy path is a thin compatibility shim pointing here.
 */

export const CHAT_QUESTION_WAIT_TIMEOUT_MS_DEFAULT = 240_000;
export const UPTAKE_AUTHORITY_THRESHOLD_DEFAULT = 70;

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
