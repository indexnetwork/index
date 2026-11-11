import { describe, expect, it } from 'bun:test';

import { groupsToShow, isOpen, joinableGroups, MAX_SHOWN_GROUPS, openQuestions, shownCards, visibleQuestionIds, type GroupState, type OpenQuestion } from './question-groups';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 8, minute));

const question = (overrides: Partial<OpenQuestion> = {}): OpenQuestion => ({
  questionId: 'q-new', intentId: 'intent-b', scope: 'intent', text: 'Are you open to remote?', matches: [], createdAt: at(30), ...overrides,
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

describe('openQuestions', () => {
  const entry = (intentId: string, kind: 'question' | 'answer' | 'expire' | 'message', questionId: string, minute: number) => ({
    intentId,
    message: { id: `${kind}-${questionId}-${minute}`, createdAt: at(minute).toISOString(), kind, questionId, text: `${kind} ${questionId}`, matches: [], scope: kind === 'question' ? ('intent' as const) : undefined, options: kind === 'question' ? ['yes', 'no'] : undefined },
  });

  it('keeps questions nobody answered or withdrew, per intent, oldest first', () => {
    const open = openQuestions([
      entry('a', 'question', 'q1', 1),
      entry('b', 'question', 'q2', 2),
      entry('a', 'answer', 'q1', 3),
      entry('a', 'question', 'q3', 4),
      entry('b', 'expire', 'q2', 5),
      entry('b', 'question', 'q4', 6),
      entry('b', 'message', 'q4', 7),
    ]);
    expect(open.map((q) => [q.questionId, q.intentId, q.scope])).toEqual([['q3', 'a', 'intent'], ['q4', 'b', 'intent']]);
    expect(open[0].options).toEqual(['yes', 'no']);
  });

  it('reads a stored match scope and skips entries with no intent', () => {
    const match = { intentId: 'a', message: { ...entry('a', 'question', 'm', 1).message, scope: 'match' as const } };
    expect(openQuestions([match, { ...entry('a', 'question', 'x', 2), intentId: '' }]).map((q) => [q.questionId, q.scope])).toEqual([['m', 'match']]);
  });
});

describe('shownCards', () => {
  const open = [
    question({ questionId: 'a1', intentId: 'a', text: 'remote?', options: ['yes', 'no'] }),
    question({ questionId: 'b1', intentId: 'b', text: 'remote ok?' }),
    question({ questionId: 'c1', intentId: 'c', text: 'held one' }),
  ];
  const members = (...ids: [string, string, boolean][]) => ids.map(([questionId, intentId, isOpenNow]) => ({ questionId, intentId, scope: 'intent' as const, open: isOpenNow }));

  it('draws one card per shown open group, oldest shown first, from its lead', () => {
    const cards = shownCards([
      group('late', { leadQuestionId: 'c1', shownAt: at(9), members: members(['c1', 'c', true]) }),
      group('early', { leadQuestionId: 'a1', shownAt: at(1), members: members(['a1', 'a', true], ['b1', 'b', true]) }),
      group('held', { state: 'held', shownAt: null, leadQuestionId: 'c1', members: members(['c1', 'c', true]) }),
    ], open);
    expect(cards.map((card) => card.groupId)).toEqual(['early', 'late']);
    expect(cards[0]).toMatchObject({ id: 'a1', intentId: 'a', question: 'remote?', options: ['yes', 'no'], intentIds: ['a', 'b'], questionIds: ['a1', 'b1'] });
  });

  it('speaks through the first open member when the lead is closed', () => {
    const [card] = shownCards([group('g', { leadQuestionId: 'a0', members: members(['a0', 'a', false], ['b1', 'b', true]) })], open);
    expect(card).toMatchObject({ id: 'b1', intentId: 'b', questionIds: ['b1'], intentIds: ['b'] });
  });
});

describe('visibleQuestionIds', () => {
  it('hides members of held groups and keeps shown ones and questions in no group', () => {
    const groups = [
      group('shown', { members: [{ questionId: 's', intentId: 'a', scope: 'intent', open: true }] }),
      group('held', { state: 'held', members: [{ questionId: 'h', intentId: 'b', scope: 'intent', open: true }] }),
    ];
    const visible = visibleQuestionIds(groups, ['s', 'h', 'loose']);
    expect([...visible].sort()).toEqual(['loose', 's']);
  });
});

describe('review fixes', () => {
  it('#1 reads only questions on intents still active', () => {
    const entries = [
      { intentId: 'live', message: { id: 'm1', createdAt: at(1).toISOString(), kind: 'question' as const, questionId: 'q1', text: 'a?', matches: [] } },
      { intentId: 'archived', message: { id: 'm2', createdAt: at(2).toISOString(), kind: 'question' as const, questionId: 'q2', text: 'b?', matches: [] } },
    ];
    expect(openQuestions(entries, new Set(['live'])).map((q) => q.questionId)).toEqual(['q1']);
  });

  it('#6 lets an outside agent ask a shown group once, through its card', () => {
    const shared = group('g', { leadQuestionId: 'a1', members: [
      { questionId: 'a1', intentId: 'a', scope: 'intent', open: true },
      { questionId: 'b1', intentId: 'b', scope: 'intent', open: true },
    ] });
    expect([...visibleQuestionIds([shared], ['a1', 'b1'])]).toEqual(['a1']);
    const leadClosed = group('g', { leadQuestionId: 'a1', members: [
      { questionId: 'a1', intentId: 'a', scope: 'intent', open: false },
      { questionId: 'b1', intentId: 'b', scope: 'intent', open: true },
    ] });
    expect([...visibleQuestionIds([leadClosed], ['b1'])]).toEqual(['b1']);
  });
});
