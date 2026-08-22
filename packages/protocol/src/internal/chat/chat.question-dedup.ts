/**
 * Pure deduplication logic for decision questions.
 * Filters out questions whose `id` is already in the surfaced set.
 * Questions without an `id` (inline-generated) are always passed through.
 */

interface QuestionLike {
  id?: string;
  [key: string]: unknown;
}

export function deduplicateQuestions<T extends QuestionLike>(
  questions: T[],
  surfacedIds: Set<string>,
): { fresh: T[]; newIds: string[] } {
  const fresh: T[] = [];
  const newIds: string[] = [];

  for (const q of questions) {
    if (q.id && surfacedIds.has(q.id)) continue;
    fresh.push(q);
    if (q.id) newIds.push(q.id);
  }

  return { fresh, newIds };
}
