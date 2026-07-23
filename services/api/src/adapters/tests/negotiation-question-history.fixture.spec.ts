import { describe, expect, it } from 'bun:test';

import { isExpectedHistoricalNegotiationSettlement } from '../../lib/question/negotiation-question.contract';

const settlement = {
  version: 1,
  settlementId: 'negotiation-question-settlement-v1-task-1',
  taskId: 'task-1',
  recipientUserId: 'user-1',
  recipientIntentId: 'intent-1',
  opportunityId: 'opp-1',
  networkId: 'network-1',
  kind: 'answer',
  questionId: 'question-1',
  continuationStatus: 'completed',
  settledAt: '2026-07-23T00:00:00.000Z',
  completedAt: '2026-07-23T00:01:00.000Z',
};

describe('negotiation answered-history fixture contract', () => {
  it('keeps the exact answered exchange visible after continuation completion', () => {
    expect(isExpectedHistoricalNegotiationSettlement('answered', 'question-1', settlement)).toBe(true);
  });

  it('rejects unrelated question, timeout, and malformed settlement history', () => {
    expect(isExpectedHistoricalNegotiationSettlement('answered', 'question-newer', settlement)).toBe(false);
    expect(isExpectedHistoricalNegotiationSettlement('answered', 'question-1', { ...settlement, kind: 'timeout', questionId: undefined })).toBe(false);
    expect(isExpectedHistoricalNegotiationSettlement('answered', 'question-1', { ...settlement, settlementId: 'wrong' })).toBe(false);
  });

  it('keeps only the exact manually dismissed card in dismissed history', () => {
    expect(isExpectedHistoricalNegotiationSettlement('dismissed', 'question-1', { ...settlement, kind: 'dismiss' })).toBe(true);
    expect(isExpectedHistoricalNegotiationSettlement('dismissed', 'sibling', { ...settlement, kind: 'dismiss' })).toBe(false);
  });
});
