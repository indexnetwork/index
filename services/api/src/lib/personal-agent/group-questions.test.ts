import { describe, expect, it } from 'bun:test';

import { groupQuestions, type GroupingStore } from './group-questions';
import type { GroupState, OpenQuestion } from './question-groups';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 8, minute));

const question = (questionId: string, intentId: string, minute: number, scope: 'intent' | 'match' = 'intent'): OpenQuestion => ({
  questionId, intentId, scope, text: `${questionId}?`, options: ['yes', 'no'], matches: [], createdAt: at(minute),
});

/** An in-memory store with the adapter's behaviour. */
function memoryStore(open: OpenQuestion[], seed: GroupState[] = []) {
  const groups = seed.map((group) => ({ ...group, members: group.members.map((member) => ({ ...member })) }));
  let next = 0;
  const store: GroupingStore = {
    listOpenQuestions: async () => open,
    listGroups: async (_userId, waiting) => groups.map((group) => ({
      ...group,
      members: group.members.map((member) => ({ ...member, open: waiting.some((q) => q.questionId === member.questionId) })),
    })),
    groupedQuestionIds: async (ids) => new Set(groups.flatMap((group) => group.members.map((member) => member.questionId)).filter((id) => ids.includes(id))),
    createGroup: async (_userId, q) => {
      const id = `g${++next}`;
      groups.push({ id, state: 'held', leadQuestionId: q.questionId, answerText: null, createdAt: q.createdAt, shownAt: null, emailedAt: null, members: [{ questionId: q.questionId, intentId: q.intentId, scope: q.scope, open: true }] });
      return id;
    },
    addMember: async (groupId, q) => {
      groups.find((group) => group.id === groupId)!.members.push({ questionId: q.questionId, intentId: q.intentId, scope: q.scope, open: true });
    },
    show: async (ids, when) => {
      for (const group of groups) if (ids.includes(group.id)) Object.assign(group, { state: 'shown', shownAt: when });
    },
  };
  return { store, groups };
}

const noAnswer = async () => { throw new Error('nothing should be answered'); };

describe('groupQuestions', () => {
  it('puts two intents asking the same fact in one shown group', async () => {
    const { store, groups } = memoryStore([question('q1', 'a', 1), question('q2', 'b', 2)]);
    const asked: string[] = [];
    const shown = await groupQuestions('u', {
      store, answer: noAnswer, now: () => at(10),
      decide: async ({ options }) => { asked.push(Object.keys(options).join(',')); return { choice: 'g1' }; },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.questionId)).toEqual(['q1', 'q2']);
    expect(asked).toEqual(['none,g1']);
    expect(shown.map((entry) => [entry.group.id, entry.lead.questionId])).toEqual([['g1', 'q1']]);
  });

  it('keeps each question alone when the decision model fails', async () => {
    const { store, groups } = memoryStore([question('q1', 'a', 1), question('q2', 'b', 2)]);
    const shown = await groupQuestions('u', { store, answer: noAnswer, decide: async () => { throw new Error('down'); } });
    expect(groups.map((g) => g.members.length)).toEqual([1, 1]);
    expect(shown).toHaveLength(2);
  });

  it('answers a question that joins an answered group, and shows nothing new', async () => {
    const answered: GroupState = { id: 'old', state: 'shown', leadQuestionId: 'q0', answerText: 'remote is fine', createdAt: at(0), shownAt: at(0), emailedAt: null, members: [{ questionId: 'q0', intentId: 'a', scope: 'intent', open: false }] };
    const { store, groups } = memoryStore([question('q2', 'b', 2)], [answered]);
    const answers: [string, string][] = [];
    const shown = await groupQuestions('u', { store, answer: async (q, text) => { answers.push([q.questionId, text]); }, decide: async () => ({ choice: 'old' }) });
    expect(answers).toEqual([['q2', 'remote is fine']]);
    expect(groups).toHaveLength(1);
    expect(shown).toEqual([]);
  });

  it('never asks the model without a decide function', async () => {
    const { store, groups } = memoryStore([question('q1', 'a', 1), question('q2', 'b', 2)]);
    await groupQuestions('u', { store, answer: noAnswer });
    expect(groups).toHaveLength(2);
  });

  it('never groups two questions from one intent', async () => {
    const { store, groups } = memoryStore([question('q1', 'a', 1), question('q2', 'a', 2)]);
    let calls = 0;
    await groupQuestions('u', { store, answer: noAnswer, decide: async () => { calls++; return { choice: 'g1' }; } });
    expect(calls).toBe(0);
    expect(groups).toHaveLength(2);
  });

  it('leaves questions already in a group alone', async () => {
    const existing: GroupState = { id: 'kept', state: 'shown', leadQuestionId: 'q1', answerText: null, createdAt: at(0), shownAt: at(0), emailedAt: null, members: [{ questionId: 'q1', intentId: 'a', scope: 'intent', open: true }] };
    const { store, groups } = memoryStore([question('q1', 'a', 1)], [existing]);
    const shown = await groupQuestions('u', { store, answer: noAnswer });
    expect(groups).toHaveLength(1);
    expect(shown).toEqual([]);
  });
});

describe('review fixes', () => {
  it('#2 offers an answered group to the model by its question, never its answer', async () => {
    const answered: GroupState = { id: 'old', state: 'shown', leadQuestionId: 'q0', leadText: 'Where would you relocate?', answerText: 'Berlin', createdAt: at(0), shownAt: at(0), emailedAt: null, members: [{ questionId: 'q0', intentId: 'a', scope: 'intent', open: false }] };
    const { store } = memoryStore([question('q2', 'b', 2)], [answered]);
    let labels: string[] = [];
    await groupQuestions('u', { store, answer: async () => undefined, decide: async ({ options }) => { labels = Object.values(options); return { choice: 'none' }; } });
    expect(labels).toContain('Where would you relocate?');
    expect(labels).not.toContain('Berlin');
  });

  it('#4 answers a member still open in an answered group', async () => {
    const answered: GroupState = { id: 'g', state: 'shown', leadQuestionId: 'q1', leadText: 'remote?', answerText: 'yes', createdAt: at(0), shownAt: at(0), emailedAt: null, members: [
      { questionId: 'q1', intentId: 'a', scope: 'intent', open: false },
      { questionId: 'q2', intentId: 'b', scope: 'intent', open: true },
    ] };
    const { store } = memoryStore([question('q2', 'b', 2)], [answered]);
    const answers: [string, string][] = [];
    await groupQuestions('u', { store, answer: async (q, text) => { answers.push([q.questionId, text]); } });
    expect(answers).toEqual([['q2', 'yes']]);
  });

  it('#8 asks the model only about the questions it is told to', async () => {
    const { store, groups } = memoryStore([question('q1', 'a', 1), question('q2', 'b', 2)]);
    let calls = 0;
    await groupQuestions('u', { store, answer: noAnswer, decide: async () => { calls++; return { choice: 'g1' }; }, decideFor: new Set(['nothing-new']) });
    expect(calls).toBe(0);
    expect(groups).toHaveLength(2);
  });
});
