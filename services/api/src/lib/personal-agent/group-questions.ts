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

/** What merging groups after the fact also needs. */
export interface MergeStore extends GroupingStore {
  moveMember(questionId: string, groupId: string): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
}

export interface GroupingDeps {
  store: GroupingStore;
  /** Answer one question as the person, with no fan-out. Used when a question joins an answered group. */
  answer: (question: OpenQuestion, text: string) => Promise<void>;
  /** Without it, every new question gets a group of its own: no model call. */
  decide?: Decide;
  /** When set, only these questions are put to the model; the rest get groups of their own. */
  decideFor?: ReadonlySet<string>;
  /**
   * Leave a question younger than this ungrouped: the pass that asks the model
   * is still on its way, and a group of its own now would keep it alone.
   */
  holdNewerThanMs?: number;
  now?: () => Date;
}

function opportunityIdsOf(question: OpenQuestion): string[] {
  return question.matches.map((match) => match.opportunityId);
}

/** A group this pass put on Home, with the question that leads it. */
export interface ShownGroup {
  group: GroupState;
  lead: OpenQuestion;
}

const SAME_FACT = [
  'Does the new question ask the person for exactly the same fact about themselves as one of these?',
  'Wording, and who wants to know, may differ. The person\'s answer to either must fully answer the other: a yes or no never answers an open question, and an answer to a broader question does not answer a narrower one unless it states that part.',
  'When a question asks two things, both must match. Dates, places, events and amounts must match. Two questions that ask whether the person\'s work touches a list of areas match only when the lists name the same areas.',
  'A question about someone else\'s offer, product, event or trip (testing their tool, attending their meetup, meeting during their visit) is about that one person, never the same fact as another.',
  'When unsure, it is a different fact.',
].join(' ');

/** How sure the model must be that two questions share a fact. A wrong merge sends the wrong answer, so unsure is no. */
const SAME_FACT_CONFIDENCE = 0.8;

/**
 * Ask the decision model which group, if any, asks the same fact. A failure
 * is no match: the question is then shown alone, which is always safe.
 */
async function sameFact(decide: Decide, question: OpenQuestion, candidates: GroupState[], leads: Map<string, OpenQuestion>): Promise<GroupState | null> {
  const options: Record<string, string> = { none: 'A different fact, or not sure' };
  // Always by its question: an answer alone ("Berlin", "yes") would match the wrong fact.
  for (const group of candidates) options[group.id] = group.leadText ?? leads.get(group.leadQuestionId)?.text ?? 'an earlier question';
  try {
    const { choice, probabilities } = await decide({ state: { question: question.text, options: question.options ?? [] }, question: SAME_FACT, options });
    if (probabilities && (probabilities[choice] ?? 0) < SAME_FACT_CONFIDENCE) return null;
    return candidates.find((group) => group.id === choice) ?? null;
  } catch {
    return null;
  }
}

/**
 * Put every open question that has no group yet into one, oldest first. A
 * question that joins an answered group is answered at once with that answer,
 * and so is any member an earlier fan-out missed (its intent was paused, or
 * a write failed). Then held groups are shown while there is room.
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
    if (deps.holdNewerThanMs && now().getTime() - question.createdAt.getTime() < deps.holdNewerThanMs) continue;
    const candidates = joinableGroups(question, groups);
    const asks = deps.decide && candidates.length && (!deps.decideFor || deps.decideFor.has(question.questionId));
    const chosen = asks ? await sameFact(deps.decide!, question, candidates, byId) : null;
    if (chosen) {
      await store.addMember(chosen.id, question);
      const member = { questionId: question.questionId, intentId: question.intentId, scope: question.scope, open: true, opportunityIds: opportunityIdsOf(question) };
      chosen.members.push(member);
      if (chosen.answerText !== null) {
        await deps.answer(question, chosen.answerText);
        member.open = false;
      }
      continue;
    }
    const id = await store.createGroup(userId, question);
    groups.push({
      id, state: 'held', leadQuestionId: question.questionId, leadText: question.text, answerText: null,
      createdAt: question.createdAt, shownAt: null, emailedAt: null,
      members: [{ questionId: question.questionId, intentId: question.intentId, scope: question.scope, open: true, opportunityIds: opportunityIdsOf(question) }],
    });
  }

  for (const group of groups) {
    if (group.answerText === null) continue;
    for (const member of group.members) {
      const question = member.open ? byId.get(member.questionId) : undefined;
      if (!question) continue;
      await deps.answer(question, group.answerText);
      member.open = false;
    }
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

/**
 * Ask the model once more about every group that still holds one open
 * question and no answer, oldest first: a question grouped without the model
 * (Home read it before the model saw it) may share its fact with another
 * group. A match moves the question there and drops its own group; the
 * merged group stays on Home if either was, and takes the answer at once if
 * it already has one. Freed slots then go to held groups.
 *
 * @returns How many questions moved.
 */
export async function mergeSoloGroups(userId: string, deps: Omit<GroupingDeps, 'store' | 'decideFor' | 'holdNewerThanMs'> & { store: MergeStore; decide: Decide }): Promise<number> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const open = await store.listOpenQuestions(userId);
  if (!open.length) return 0;
  let groups = await store.listGroups(userId, open);
  const byId = new Map(open.map((question) => [question.questionId, question]));
  const solos = groups
    .filter((group) => group.answerText === null && group.members.length === 1 && group.members[0]!.open)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let moved = 0;
  for (const solo of solos) {
    // A solo another question already joined is a group now: moving its lead
    // would delete it with that question inside.
    if (!groups.includes(solo) || solo.members.length !== 1) continue;
    const question = byId.get(solo.members[0]!.questionId);
    if (!question) continue;
    const candidates = joinableGroups(question, groups.filter((group) => group !== solo));
    if (!candidates.length) continue;
    const chosen = await sameFact(deps.decide, question, candidates, byId);
    if (!chosen) continue;
    await store.moveMember(question.questionId, chosen.id);
    await store.deleteGroup(solo.id);
    groups = groups.filter((group) => group !== solo);
    const member = solo.members[0]!;
    chosen.members.push(member);
    moved++;
    if (solo.state === 'shown' && chosen.state === 'held') {
      const at = solo.shownAt ?? now();
      await store.show([chosen.id], at);
      Object.assign(chosen, { state: 'shown', shownAt: at });
    }
    if (chosen.answerText !== null) {
      await deps.answer(question, chosen.answerText);
      member.open = false;
    }
  }

  const ids = groupsToShow(groups);
  if (ids.length) await store.show(ids, now());
  return moved;
}
