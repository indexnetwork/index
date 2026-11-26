/**
 * How the personal agent groups the questions intent agents raise. A group is
 * the open questions that ask the person for the same fact about themselves,
 * whichever intents raised them and whoever wanted to know. Everything here
 * is plain data in, plain data out.
 */
import type { MatchReference, PrincipalMessage } from '../../adapters/agent-session.database.adapter';

/** How many groups are on Home at once. The rest wait their turn, oldest first. */
export const MAX_SHOWN_GROUPS = 5;

/**
 * How many shown groups one intent fills while another intent's questions
 * wait. Fairness, not a limit: slots nobody else wants still go to it.
 */
export const SHOWN_PER_INTENT = 2;

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
  /** The opportunities it is about, when it is still open; empty otherwise. */
  opportunityIds: string[];
}

export interface GroupState {
  id: string;
  state: 'held' | 'shown';
  leadQuestionId: string;
  /** The lead question's words, kept so an answered group is still known by its question. */
  leadText: string | null;
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
 * The groups a new question may join. Questions group across intents and
 * across the people who wanted to know, since a fact about the person is the
 * same fact whoever asks. Two questions about the same opportunity never
 * group, and neither do two intent-wide questions from one intent: those are
 * one negotiation or one agent asking twice, not a shared fact.
 *
 * @returns Open groups, and answered ones whose answer the question can reuse.
 */
export function joinableGroups(question: OpenQuestion, groups: GroupState[]): GroupState[] {
  const about = new Set(question.matches.map((match) => match.opportunityId));
  return groups.filter((group) =>
    group.members.every((member) =>
      !member.opportunityIds.some((opportunityId) => about.has(opportunityId))
      && !(question.scope === 'intent' && member.scope === 'intent' && member.intentId === question.intentId))
    && (isOpen(group) || group.answerText !== null));
}

/** @returns The intents a group still waits on. */
function waitingIntents(group: GroupState): string[] {
  return [...new Set(group.members.filter((member) => member.open).map((member) => member.intentId))];
}

/**
 * The held groups to show now, so no more than {@link MAX_SHOWN_GROUPS} open
 * groups are shown. Oldest first, except that one intent fills at most
 * {@link SHOWN_PER_INTENT} slots while another intent's group waits: one busy
 * intent never crowds the rest off Home.
 *
 * @returns Group ids, in the order they were picked.
 */
export function groupsToShow(groups: GroupState[]): string[] {
  const shown = groups.filter((group) => group.state === 'shown' && isOpen(group));
  let free = Math.max(0, MAX_SHOWN_GROUPS - shown.length);
  const held = groups
    .filter((group) => group.state === 'held' && isOpen(group))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const load = new Map<string, number>();
  for (const group of shown) for (const intentId of waitingIntents(group)) load.set(intentId, (load.get(intentId) ?? 0) + 1);
  const picked: string[] = [];
  const pick = (group: GroupState) => {
    picked.push(group.id);
    free--;
    for (const intentId of waitingIntents(group)) load.set(intentId, (load.get(intentId) ?? 0) + 1);
  };
  // First pass: fair. A group goes up only if one of its intents has room.
  for (const group of held) {
    if (!free) break;
    if (waitingIntents(group).some((intentId) => (load.get(intentId) ?? 0) < SHOWN_PER_INTENT)) pick(group);
  }
  // Second pass: whatever room is left goes to whoever is waiting, oldest first.
  for (const group of held) {
    if (!free) break;
    if (!picked.includes(group.id)) pick(group);
  }
  return picked;
}

/**
 * Every question still waiting on the person, across their active intents. A
 * question leaves when an answer or an expiry names it, the same rule each
 * intent's queue follows.
 *
 * @param entries - The agent DM's entries with the intent each belongs to, oldest first.
 * @returns The open questions, oldest first.
 */
export function openQuestions(entries: { intentId: string; message: PrincipalMessage }[], activeIntentIds?: ReadonlySet<string>): OpenQuestion[] {
  const open = new Map<string, OpenQuestion>();
  for (const { intentId, message } of entries) {
    // A paused or archived intent's questions wait with it, off Home.
    if (!intentId || (activeIntentIds && !activeIntentIds.has(intentId))) continue;
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

/** @returns The open member a group speaks through: its lead while open, else the first open member. */
export function voiceOf(group: GroupState): string | null {
  const waiting = group.members.filter((member) => member.open);
  return waiting.find((member) => member.questionId === group.leadQuestionId)?.questionId ?? waiting[0]?.questionId ?? null;
}

/**
 * The cards Home shows: one per shown, open group, oldest shown first. A card
 * speaks through the group's lead, or its first open member once the lead is
 * closed, lists only the members still waiting, and names everyone they are
 * about, the voice's people first.
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
      const matches = new Map<string, MatchReference>();
      for (const member of [voice, ...waiting.map((entry) => byId.get(entry.questionId)!)]) {
        for (const match of member.matches) if (!matches.has(match.opportunityId)) matches.set(match.opportunityId, match);
      }
      return [{
        groupId: group.id,
        id: voice.questionId,
        intentId: voice.intentId,
        question: voice.text,
        ...(voice.options ? { options: voice.options } : {}),
        scope: voice.scope,
        matches: [...matches.values()],
        intentIds: [...new Set(waiting.map((member) => member.intentId))],
        questionIds: waiting.map((member) => member.questionId),
      }];
    });
}

/**
 * The questions an outside agent may put to the person now: each shown group
 * once, through the question its card speaks through, since one answer
 * reaches the whole group. A question in a held group waits for Home; one in
 * no group yet is shown, as Home would show it.
 *
 * @param questionIds - The questions to filter.
 */
export function visibleQuestionIds(groups: GroupState[], questionIds: readonly string[]): Set<string> {
  const groupOf = new Map(groups.flatMap((group) => group.members.map((member) => [member.questionId, group] as const)));
  return new Set(questionIds.filter((questionId) => {
    const group = groupOf.get(questionId);
    return !group || (group.state === 'shown' && isOpen(group) && voiceOf(group) === questionId);
  }));
}
