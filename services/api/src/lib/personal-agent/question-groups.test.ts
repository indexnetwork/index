import { describe, expect, it } from 'bun:test';

import { groupsToShow, isOpen, joinableGroups, MAX_SHOWN_GROUPS, type GroupState, type OpenQuestion } from './question-groups';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 8, minute));

const question = (overrides: Partial<OpenQuestion> = {}): OpenQuestion => ({
  questionId: 'q-new', intentId: 'intent-b', scope: 'intent', text: 'Are you open to remote?', createdAt: at(30), ...overrides,
});

const group = (id: string, overrides: Partial<GroupState> = {}): GroupState => ({
  id,
  state: 'shown',
  leadQuestionId: `${id}-lead`,
  answerText: null,
  createdAt: at(0),
  shownAt: at(0),
  emailedAt: null,
  members: [{ questionId: `${id}-lead`, intentId: 'intent-a', scope: 'intent', open: true }],
  ...overrides,
});

describe('isOpen', () => {
  it('is open while a member is open and nothing answered it', () => {
    expect(isOpen(group('g'))).toBe(true);
    expect(isOpen(group('g', { answerText: 'yes' }))).toBe(false);
    expect(isOpen(group('g', { members: [{ questionId: 'x', intentId: 'intent-a', scope: 'intent', open: false }] }))).toBe(false);
  });
});

describe('joinableGroups', () => {
  it('never groups an opportunity-scoped question', () => {
    expect(joinableGroups(question({ scope: 'match' }), [group('g')])).toEqual([]);
  });

  it('never joins a group that holds an opportunity-scoped question', () => {
    const solo = group('g', { members: [{ questionId: 'm', intentId: 'intent-a', scope: 'match', open: true }] });
    expect(joinableGroups(question(), [solo])).toEqual([]);
  });

  it('never joins a group with a question from the same intent', () => {
    expect(joinableGroups(question({ intentId: 'intent-a' }), [group('g')])).toEqual([]);
  });

  it('offers open groups and answered ones', () => {
    const answered = group('answered', { answerText: 'yes', members: [{ questionId: 'a', intentId: 'intent-c', scope: 'intent', open: false }] });
    const closed = group('closed', { members: [{ questionId: 'c', intentId: 'intent-d', scope: 'intent', open: false }] });
    expect(joinableGroups(question(), [group('open'), answered, closed]).map((g) => g.id)).toEqual(['open', 'answered']);
  });
});

describe('groupsToShow', () => {
  const held = (id: string, minute: number) => group(id, { state: 'held', shownAt: null, createdAt: at(minute) });
  const shown = (count: number) => Array.from({ length: count }, (_, index) => group(`s${index}`));

  it('fills the free slots with the oldest held groups', () => {
    expect(groupsToShow([...shown(MAX_SHOWN_GROUPS - 1), held('late', 9), held('early', 1), held('mid', 5)])).toEqual(['early']);
  });

  it('shows nothing when every slot is taken', () => {
    expect(groupsToShow([...shown(MAX_SHOWN_GROUPS), held('h', 1)])).toEqual([]);
  });

  it('frees the slot of a shown group that is no longer open', () => {
    const done = group('done', { answerText: 'no' });
    expect(groupsToShow([...shown(MAX_SHOWN_GROUPS - 1), done, held('h', 1)])).toEqual(['h']);
  });

  it('never shows a held group with nothing left open', () => {
    const empty = group('empty', { state: 'held', shownAt: null, members: [{ questionId: 'e', intentId: 'intent-a', scope: 'intent', open: false }] });
    expect(groupsToShow([empty])).toEqual([]);
  });
});
