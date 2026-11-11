/**
 * Match answers to the questions still waiting. The person's own words are
 * always kept: one naming a closed question is saved as a plain message. An
 * automatic answer (fan-out, or reuse of an earlier answer) is only ever an
 * answer: with `onlyWaiting`, one whose question has closed is dropped.
 */
export function prepareAnswers<Q extends { id: string }>(
  queue: readonly Q[],
  answers: readonly { questionId?: string | null; text: string }[],
  options: { onlyWaiting: boolean },
): { text: string; question: Q | null }[] {
  return answers
    .map((answer) => ({ text: answer.text, question: queue.find((question) => question.id === answer.questionId) ?? null }))
    .filter((answer) => !options.onlyWaiting || answer.question !== null);
}
