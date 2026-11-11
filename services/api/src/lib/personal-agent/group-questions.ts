import type { Decide } from '@indexnetwork/agent';

import { groupsToShow, joinableGroups, type GroupState, type OpenQuestion } from './question-groups';

/** The store operations grouping needs; `QuestionGroupsDatabaseAdapter` has them all. */
export interface GroupingStore {
  listOpenQuestions(userId: string): Promise<OpenQuestion[]>;
  listGroups(userId: string, open: OpenQuestion[]): Promise<GroupState[]>;
  groupedQuestionIds(questionIds: string[]): Promise<Set<string>>;
  createGroup(userId: string, question: OpenQuestion): Promise<string>;
  addMember(groupId: string, question: OpenQuestion): Promise<void>;
  show(groupIds: string[], at: Date): Promise<void>;
}

export interface GroupingDeps {
  store: GroupingStore;
  /** Answer one question as the person, with no fan-out. Used when a question joins an answered group. */
  answer: (question: OpenQuestion, text: string) => Promise<void>;
  /** Without it, every new question gets a group of its own: no model call. */
  decide?: Decide;
  now?: () => Date;
}

/** A group this pass put on Home, with the question that leads it. */
export interface ShownGroup {
  group: GroupState;
  lead: OpenQuestion;
}

const SAME_FACT = 'Does the new question ask the person for the same fact as one of these? Wording may differ; the fact must be the same.';

/**
 * Ask the decision model which group, if any, asks the same fact. A failure
 * is no match: the question is then shown alone, which is always safe.
 */
async function sameFact(decide: Decide, question: OpenQuestion, candidates: GroupState[], leads: Map<string, OpenQuestion>): Promise<GroupState | null> {
  const options: Record<string, string> = { none: 'A different fact' };
  for (const group of candidates) options[group.id] = leads.get(group.leadQuestionId)?.text ?? group.answerText ?? 'an earlier question';
  try {
    const { choice } = await decide({ state: { question: question.text, options: question.options ?? [] }, question: SAME_FACT, options });
    return candidates.find((group) => group.id === choice) ?? null;
  } catch {
    return null;
  }
}

/**
 * Put every open question that has no group yet into one, oldest first. A
 * question that joins an answered group is answered at once with that answer.
 * Then held groups are shown while there is room.
 *
 * @returns The groups this pass put on Home.
 */
export async function groupQuestions(userId: string, deps: GroupingDeps): Promise<ShownGroup[]> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const open = await store.listOpenQuestions(userId);
  if (!open.length) return [];
  const grouped = await store.groupedQuestionIds(open.map((question) => question.questionId));
  const groups = await store.listGroups(userId, open);
  const byId = new Map(open.map((question) => [question.questionId, question]));

  for (const question of open) {
    if (grouped.has(question.questionId)) continue;
    const candidates = joinableGroups(question, groups);
    const chosen = deps.decide && candidates.length ? await sameFact(deps.decide, question, candidates, byId) : null;
    if (chosen) {
      await store.addMember(chosen.id, question);
      const member = { questionId: question.questionId, intentId: question.intentId, scope: question.scope, open: true };
      chosen.members.push(member);
      if (chosen.answerText !== null) {
        await deps.answer(question, chosen.answerText);
        member.open = false;
      }
      continue;
    }
    const id = await store.createGroup(userId, question);
    groups.push({
      id, state: 'held', leadQuestionId: question.questionId, answerText: null,
      createdAt: question.createdAt, shownAt: null, emailedAt: null,
      members: [{ questionId: question.questionId, intentId: question.intentId, scope: question.scope, open: true }],
    });
  }

  const ids = groupsToShow(groups);
  if (!ids.length) return [];
  const at = now();
  await store.show(ids, at);
  return groups
    .filter((group) => ids.includes(group.id))
    .flatMap((group) => {
      const lead = byId.get(group.leadQuestionId);
      return lead ? [{ group: { ...group, state: 'shown' as const, shownAt: at }, lead }] : [];
    });
}
