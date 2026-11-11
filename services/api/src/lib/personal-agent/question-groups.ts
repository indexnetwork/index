/**
 * How the personal agent groups the questions intent agents raise. A group is
 * the open questions, from different intents, that ask the person for the same
 * fact. Everything here is plain data in, plain data out.
 */
import type { MatchReference, PrincipalMessage } from '../../adapters/agent-session.database.adapter';

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
  /** The opportunities an opportunity-scoped question is about. */
  matches: readonly MatchReference[];
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

/**
 * Every question still waiting on the person, across all their intents. A
 * question leaves when an answer or an expiry names it, the same rule each
 * intent's queue follows.
 *
 * @param entries - The agent DM's entries with the intent each belongs to, oldest first.
 * @returns The open questions, oldest first.
 */
export function openQuestions(entries: { intentId: string; message: PrincipalMessage }[]): OpenQuestion[] {
  const open = new Map<string, OpenQuestion>();
  for (const { intentId, message } of entries) {
    if (!intentId) continue;
    if (message.kind === 'question') {
      const questionId = message.questionId ?? message.id;
      open.set(questionId, {
        questionId,
        intentId,
        scope: message.scope === 'match' ? 'match' : 'intent',
        text: message.text,
        ...(message.options ? { options: message.options } : {}),
        matches: message.matches,
        createdAt: new Date(message.createdAt),
      });
    } else if ((message.kind === 'answer' || message.kind === 'expire') && message.questionId) {
      open.delete(message.questionId);
    }
  }
  return [...open.values()];
}

/** One group as Home draws it: the question to answer, and every intent and question it stands for. */
export interface GroupCard {
  groupId: string;
  /** The question the card speaks through, and answers go to. */
  id: string;
  intentId: string;
  question: string;
  options?: string[];
  scope: QuestionScope;
  matches: readonly MatchReference[];
  intentIds: string[];
  questionIds: string[];
}

/**
 * The cards Home shows: one per shown, open group, oldest shown first. A card
 * speaks through the group's lead, or its first open member once the lead is
 * closed, and lists only the members still waiting.
 */
export function shownCards(groups: GroupState[], open: OpenQuestion[]): GroupCard[] {
  const byId = new Map(open.map((question) => [question.questionId, question]));
  return groups
    .filter((group) => group.state === 'shown' && isOpen(group))
    .sort((a, b) => (a.shownAt?.getTime() ?? 0) - (b.shownAt?.getTime() ?? 0))
    .flatMap((group) => {
      const waiting = group.members.filter((member) => member.open && byId.has(member.questionId));
      const voice = byId.get(waiting.some((member) => member.questionId === group.leadQuestionId) ? group.leadQuestionId : waiting[0]?.questionId ?? '');
      if (!voice) return [];
      return [{
        groupId: group.id,
        id: voice.questionId,
        intentId: voice.intentId,
        question: voice.text,
        ...(voice.options ? { options: voice.options } : {}),
        scope: voice.scope,
        matches: voice.matches,
        intentIds: [...new Set(waiting.map((member) => member.intentId))],
        questionIds: waiting.map((member) => member.questionId),
      }];
    });
}

/**
 * The questions an outside agent may put to the person now. A question in a
 * held group waits for Home; one in no group yet is shown, as Home would show it.
 *
 * @param questionIds - The questions to filter.
 */
export function visibleQuestionIds(groups: GroupState[], questionIds: readonly string[]): Set<string> {
  const groupOf = new Map(groups.flatMap((group) => group.members.map((member) => [member.questionId, group] as const)));
  return new Set(questionIds.filter((questionId) => {
    const group = groupOf.get(questionId);
    return !group || (group.state === 'shown' && isOpen(group));
  }));
}
