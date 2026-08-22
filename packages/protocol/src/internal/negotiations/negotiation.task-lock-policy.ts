import { ASK_USER_LOCK_SLACK_MS, ASK_USER_WINDOW_MS } from "./negotiation.protocol.js";

const ACTIVE_NEGOTIATION_TASK_STATES = [
  "submitted",
  "working",
  "input_required",
  "waiting_for_agent",
  "claimed",
];

/**
 * Whether a persisted negotiation task still admits an exclusive conversation
 * lock. A paused `ask_user` consultation holds the lock for its complete
 * answer window plus expiry-worker slack; ordinary active turns use the
 * existing five-minute freshness window.
 */
export function holdsNegotiationConversationLock(
  task: { state: string; updatedAt: Date },
  now = Date.now(),
): boolean {
  if (!ACTIVE_NEGOTIATION_TASK_STATES.includes(task.state)) return false;
  const freshnessMs = task.state === "input_required"
    ? ASK_USER_WINDOW_MS + ASK_USER_LOCK_SLACK_MS
    : 5 * 60 * 1000;
  return now - new Date(task.updatedAt).getTime() < freshnessMs;
}
