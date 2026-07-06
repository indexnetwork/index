import { describe, it, expect } from 'bun:test';

import { awaitChatQuestionAnswers, emitChatQuestionResolution, hasChatQuestionWaiter } from '../chat-question.events';

const answer = {
  selectedOptions: ['Option A'],
  answeredBy: 'user-1',
  answeredAt: new Date().toISOString(),
};

describe('chat-question.events', () => {
  it('resolves when every awaited question is answered', async () => {
    const wait = awaitChatQuestionAnswers(['qa-1', 'qa-2'], { timeoutMs: 1000 });

    // Waiters are registered synchronously.
    expect(hasChatQuestionWaiter('qa-1')).toBe(true);
    expect(hasChatQuestionWaiter('qa-2')).toBe(true);

    emitChatQuestionResolution({ questionId: 'qa-1', status: 'answered', answer });
    emitChatQuestionResolution({ questionId: 'qa-2', status: 'dismissed' });

    const outcomes = await wait;
    expect(outcomes).toEqual([
      { questionId: 'qa-1', status: 'answered', answer },
      { questionId: 'qa-2', status: 'dismissed' },
    ]);

    // Waiters unsubscribe after settling.
    expect(hasChatQuestionWaiter('qa-1')).toBe(false);
    expect(hasChatQuestionWaiter('qa-2')).toBe(false);
  });

  it('reports timeout for unanswered questions and keeps resolved ones', async () => {
    const wait = awaitChatQuestionAnswers(['qt-1', 'qt-2'], { timeoutMs: 50 });
    emitChatQuestionResolution({ questionId: 'qt-1', status: 'answered', answer });

    const outcomes = await wait;
    expect(outcomes[0]).toEqual({ questionId: 'qt-1', status: 'answered', answer });
    expect(outcomes[1]).toEqual({ questionId: 'qt-2', status: 'timeout' });
  });

  it('settles immediately on an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const outcomes = await awaitChatQuestionAnswers(['qs-1'], {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    expect(outcomes).toEqual([{ questionId: 'qs-1', status: 'timeout' }]);
  });

  it('settles when the signal aborts mid-wait', async () => {
    const controller = new AbortController();
    const wait = awaitChatQuestionAnswers(['qm-1'], { timeoutMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    const outcomes = await wait;
    expect(outcomes).toEqual([{ questionId: 'qm-1', status: 'timeout' }]);
    expect(hasChatQuestionWaiter('qm-1')).toBe(false);
  });

  it('emitting with no waiter is a no-op', () => {
    expect(hasChatQuestionWaiter('missing')).toBe(false);
    expect(() =>
      emitChatQuestionResolution({ questionId: 'missing', status: 'answered', answer }),
    ).not.toThrow();
  });

  it('resolves an empty id list immediately', async () => {
    const outcomes = await awaitChatQuestionAnswers([], { timeoutMs: 10_000 });
    expect(outcomes).toEqual([]);
  });
});
