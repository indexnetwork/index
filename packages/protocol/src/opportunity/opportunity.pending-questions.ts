/**
 * Helper for merging pending questions from the DB into tool results.
 * Extracted so it can be unit-tested independently of the tool handler.
 */
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { PendingQuestionSummary } from "../shared/schemas/pending-question.schema.js";

const logger = protocolLogger("PendingQuestions");

/** Maximum pending questions attached to a single tool result. */
export const MAX_PENDING_QUESTIONS = 3;

export interface MergePendingQuestionsInput {
  findPendingQuestions?: (
    userId: string,
    filters?: { sourceType?: string; sourceId?: string },
  ) => Promise<PendingQuestionSummary[]>;
  userId: string;
  sourceType?: string;
  sourceId?: string;
  /** IDs already shown in this chat session — skip them. */
  surfacedQuestionIds: Set<string>;
}

export interface MergePendingQuestionsResult {
  /** Questions to attach to the tool result (under the `questions` key). */
  questions: PendingQuestionSummary[];
  /** IDs of the questions that were included (caller should add to surfacedQuestionIds). */
  surfacedIds: string[];
}

/**
 * Query pending questions and filter out already-surfaced ones.
 * Returns at most MAX_PENDING_QUESTIONS entries.
 */
export async function mergePendingQuestions(
  input: MergePendingQuestionsInput,
): Promise<MergePendingQuestionsResult> {
  if (!input.findPendingQuestions) {
    return { questions: [], surfacedIds: [] };
  }

  const filters = input.sourceType
    ? { sourceType: input.sourceType, ...(input.sourceId ? { sourceId: input.sourceId } : {}) }
    : undefined;

  let pending: PendingQuestionSummary[];
  try {
    pending = await input.findPendingQuestions(input.userId, filters);
  } catch (err) {
    logger.warn('Failed to fetch pending questions, returning empty', { error: err });
    return { questions: [], surfacedIds: [] };
  }

  // Deduplicate against already-surfaced IDs in this session
  const fresh = pending.filter((q) => !input.surfacedQuestionIds.has(q.id));
  const capped = fresh.slice(0, MAX_PENDING_QUESTIONS);

  return {
    questions: capped,
    surfacedIds: capped.map((q) => q.id),
  };
}
