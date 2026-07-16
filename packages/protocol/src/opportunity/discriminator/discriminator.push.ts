import type { QuestionPoolSnapshot } from "../../shared/schemas/question.schema.js";

import { POOL_QUESTION_PUSH_BASE_VOI, POOL_QUESTION_PUSH_DISMISSAL_DECAY } from "./discriminator.env.js";

/** Maximum raw intent-title characters included in a proactive DM line. */
export const POOL_QUESTION_PUSH_TITLE_MAX_CHARS = 80;

/** Stable identity for one pool refresh cycle. Chained alternates retain it. */
export function poolQuestionCycleKey(
  pool: Pick<QuestionPoolSnapshot, "runId" | "minedAt">,
): string {
  const runId = pool.runId?.trim();
  return runId ? `run:${runId}` : `mined:${pool.minedAt}`;
}

/** Strict VoI threshold after the recipient's consecutive dismissal streak. */
export function poolQuestionPushThreshold(consecutiveDismissals: number): number {
  const streak = Math.max(0, Math.floor(consecutiveDismissals));
  return POOL_QUESTION_PUSH_BASE_VOI * POOL_QUESTION_PUSH_DISMISSAL_DECAY ** streak;
}

/** Escape plain text so it cannot alter the deterministic Markdown template. */
export function escapePoolPushMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]{}()<>#+\-.!|])/g, "\\$1");
}

/** Build the sole proactive user-facing DM line for a pushed pool question. */
export function buildPoolQuestionPushMessage(input: {
  intentId: string;
  intentTitle: string;
  questionPrompt: string;
}): string {
  const normalizedTitle = input.intentTitle.replace(/\s+/g, " ").trim() || "your intent";
  const boundedTitle = normalizedTitle.length > POOL_QUESTION_PUSH_TITLE_MAX_CHARS
    ? `${normalizedTitle.slice(0, POOL_QUESTION_PUSH_TITLE_MAX_CHARS - 1)}…`
    : normalizedTitle;
  return `Quick one about [${escapePoolPushMarkdown(boundedTitle)}](/i/${input.intentId}): ${escapePoolPushMarkdown(input.questionPrompt)}`;
}
