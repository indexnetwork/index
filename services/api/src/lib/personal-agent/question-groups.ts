/**
 * How the personal agent groups the questions intent agents raise. A group is
 * the open questions, from different intents, that ask the person for the same
 * fact. Everything here is plain data in, plain data out.
 */

/** How many groups are on Home at once. The rest wait their turn, oldest first. */
export const MAX_SHOWN_GROUPS = 5;

export type QuestionScope = 'intent' | 'match';

/** One question an intent agent raised that nobody has answered or withdrawn. */
export interface OpenQuestion {
  questionId: string;
  intentId: string;
  scope: QuestionScope;
  text: string;
  options?: string[];
  createdAt: Date;
}

export interface GroupMember {
  questionId: string;
  intentId: string;
  scope: QuestionScope;
  /** Whether this question is still waiting: not answered and not withdrawn. */
  open: boolean;
}

export interface GroupState {
  id: string;
  state: 'held' | 'shown';
  leadQuestionId: string;
  answerText: string | null;
  createdAt: Date;
  shownAt: Date | null;
  emailedAt: Date | null;
  members: GroupMember[];
}

/** @returns Whether the group still needs the person: a member is open and nothing answered it. */
export function isOpen(group: GroupState): boolean {
  return group.answerText === null && group.members.some((member) => member.open);
}

/**
 * The groups a new question may join. Only intent-scoped questions group, never
 * with an opportunity-scoped one, and never with a question from the same
 * intent: one intent asking twice is its own business, not a shared fact.
 *
 * @returns Open groups, and answered ones whose answer the question can reuse.
 */
export function joinableGroups(question: OpenQuestion, groups: GroupState[]): GroupState[] {
  if (question.scope !== 'intent') return [];
  return groups.filter((group) =>
    group.members.every((member) => member.scope === 'intent' && member.intentId !== question.intentId)
    && (isOpen(group) || group.answerText !== null));
}

/** @returns The held groups to show now, oldest first, so no more than {@link MAX_SHOWN_GROUPS} open groups are shown. */
export function groupsToShow(groups: GroupState[]): string[] {
  const shown = groups.filter((group) => group.state === 'shown' && isOpen(group)).length;
  const free = Math.max(0, MAX_SHOWN_GROUPS - shown);
  return groups
    .filter((group) => group.state === 'held' && isOpen(group))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, free)
    .map((group) => group.id);
}
