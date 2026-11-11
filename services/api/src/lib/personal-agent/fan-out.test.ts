import { describe, expect, it } from 'bun:test';

import { fanOutAnswer, type FanOutDeps } from './fan-out';
import type { GroupState, OpenQuestion } from './question-groups';

const at = new Date(Date.UTC(2026, 10, 11, 9));
const question = (questionId: string, intentId: string): OpenQuestion => ({ questionId, intentId, scope: 'intent', text: `${questionId}?`, matches: [], createdAt: at });

function setup(options: { open: OpenQuestion[]; members: [string, string][]; archived?: string[]; answerText?: string | null }) {
  const group: GroupState = {
    id: 'g', state: 'shown', leadQuestionId: options.members[0][0], answerText: options.answerText ?? null,
    createdAt: at, shownAt: at, emailedAt: null,
    members: options.members.map(([questionId, intentId]) => ({ questionId, intentId, scope: 'intent', open: options.open.some((q) => q.questionId === questionId) })),
  };
  const answered: [string, string][] = [];
  let recorded: string | null = options.answerText ?? null;
  const deps: FanOutDeps = {
    listOpenQuestions: async () => options.open,
    listGroups: async () => [group],
    recordAnswer: async (_groupId, text) => { if (recorded !== null) return false; recorded = text; return true; },
    isIntentActive: async (intentId) => !(options.archived ?? []).includes(intentId),
    answerOne: async (q, text) => { answered.push([q.questionId, text]); },
  };
  return { deps, answered, recorded: () => recorded };
}

describe('fanOutAnswer', () => {
  it('answers every other open member, and records the answer once', async () => {
    const { deps, answered, recorded } = setup({ open: [question('q2', 'b')], members: [['q1', 'a'], ['q2', 'b'], ['q3', 'c']] });
    expect(await fanOutAnswer('u', 'q1', 'yes', deps)).toEqual(['q2']);
    expect(answered).toEqual([['q2', 'yes']]);
    expect(recorded()).toBe('yes');
  });

  it('skips a member whose intent is no longer active', async () => {
    const { deps, answered } = setup({ open: [question('q2', 'b'), question('q3', 'c')], members: [['q1', 'a'], ['q2', 'b'], ['q3', 'c']], archived: ['c'] });
    await fanOutAnswer('u', 'q1', 'yes', deps);
    expect(answered).toEqual([['q2', 'yes']]);
  });

  it('writes nothing when another surface already answered the group', async () => {
    const { deps, answered } = setup({ open: [question('q2', 'b')], members: [['q1', 'a'], ['q2', 'b']], answerText: 'no' });
    expect(await fanOutAnswer('u', 'q1', 'yes', deps)).toEqual([]);
    expect(answered).toEqual([]);
  });

  it('does nothing for a question in no group', async () => {
    const { deps, answered, recorded } = setup({ open: [question('q2', 'b')], members: [['q1', 'a'], ['q2', 'b']] });
    expect(await fanOutAnswer('u', 'elsewhere', 'yes', deps)).toEqual([]);
    expect(answered).toEqual([]);
    expect(recorded()).toBeNull();
  });
});
