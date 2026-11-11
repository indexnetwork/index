import { describe, expect, it } from 'bun:test';

import { prepareAnswers } from './answers';

const queue = [{ id: 'q1' }, { id: 'q2' }];

describe('prepareAnswers', () => {
  it('keeps the person\'s own words even when the question has closed', () => {
    expect(prepareAnswers(queue, [{ questionId: 'gone', text: 'hi' }], { onlyWaiting: false }))
      .toEqual([{ text: 'hi', question: null }]);
  });

  it('#5 drops an automatic answer whose question is no longer waiting', () => {
    expect(prepareAnswers(queue, [{ questionId: 'gone', text: 'yes' }, { questionId: 'q2', text: 'yes' }], { onlyWaiting: true }))
      .toEqual([{ text: 'yes', question: { id: 'q2' } }]);
  });
});
