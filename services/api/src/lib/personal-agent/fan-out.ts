import type { GroupState, OpenQuestion } from './question-groups';

export interface FanOutDeps {
  listOpenQuestions(userId: string): Promise<OpenQuestion[]>;
  listGroups(userId: string, open: OpenQuestion[]): Promise<GroupState[]>;
  /** @returns False when the group already had an answer: the first answer wins. */
  recordAnswer(groupId: string, text: string, at: Date): Promise<boolean>;
  isIntentActive(intentId: string): Promise<boolean>;
  /** Answer one question as the person, without fanning out again. */
  answerOne(question: OpenQuestion, text: string): Promise<void>;
  now?: () => Date;
}

/**
 * Carry one answer to every other question in its group, so each intent agent
 * reads its own answer and resumes. Runs after the answered question is
 * written, so that question is already closed when the group is read.
 *
 * Only questions still open get an answer, and only on intents still active.
 * When another surface answered the group first, nothing is written: its
 * fan-out already reached the members.
 *
 * @returns The question ids this call answered.
 */
export async function fanOutAnswer(userId: string, questionId: string, text: string, deps: FanOutDeps): Promise<string[]> {
  const open = await deps.listOpenQuestions(userId);
  const groups = await deps.listGroups(userId, open);
  const group = groups.find((candidate) => candidate.members.some((member) => member.questionId === questionId));
  if (!group) return [];
  if (!await deps.recordAnswer(group.id, text, (deps.now ?? (() => new Date()))())) return [];

  const answered: string[] = [];
  for (const member of group.members) {
    if (member.questionId === questionId || !member.open) continue;
    const question = open.find((candidate) => candidate.questionId === member.questionId);
    if (!question || !await deps.isIntentActive(member.intentId)) continue;
    await deps.answerOne(question, text);
    answered.push(member.questionId);
  }
  return answered;
}
