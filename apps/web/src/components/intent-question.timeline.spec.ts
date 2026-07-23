import { describe, expect, it } from 'vitest';

import { buildIntentQuestionTimeline } from './intent-question.timeline';
import type { PendingQuestion } from '@/services/questions';

function question(id: string, mode: 'intent' | 'pool_discovery'): PendingQuestion {
  return {
    id,
    detection: {
      mode,
      sourceType: 'intent',
      sourceId: 'intent-1',
      timestamp: '2026-07-22T12:00:00.000Z',
    },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: {
      title: `${mode} question`,
      prompt: 'What matters most?',
      options: [],
      multiSelect: false,
    },
    status: 'pending',
    answer: null,
    expiresAt: '2026-07-29T12:00:00.000Z',
    createdAt: '2026-07-22T12:00:00.000Z',
    conversationId: null,
  };
}

describe('buildIntentQuestionTimeline', () => {
  it('keeps canonical refinement and pool discriminator questions together for the intent page', () => {
    const refinement = question('refinement-question', 'intent');
    const discriminator = question('pool-question', 'pool_discovery');

    const timeline = buildIntentQuestionTimeline([], [refinement, discriminator], []);

    expect(timeline.trailingPending).toEqual([discriminator, refinement]);
    expect(timeline.trailingPending.map((item) => item.detection.mode)).toEqual([
      'pool_discovery',
      'intent',
    ]);
  });

  it('anchors only to an existing assistant message and trails everything else deterministically', () => {
    const anchored = question('anchored', 'intent');
    anchored.detection.messageId = 'assistant-1';
    const invalidAnchor = question('invalid-anchor', 'intent');
    invalidAnchor.detection.messageId = 'other-session-message';
    invalidAnchor.detection.timestamp = '2026-07-22T12:02:00.000Z';
    const trailing = question('trailing', 'intent');
    trailing.detection.timestamp = '2026-07-22T12:01:00.000Z';
    const messages = [{ id: 'assistant-1', role: 'assistant' as const, timestamp: new Date('2026-07-22T12:00:00.000Z') }];

    const timeline = buildIntentQuestionTimeline(messages, [invalidAnchor, anchored, trailing], [
      { id: 'answered-late', prompt: 'Late?', response: 'Yes', answeredAt: '2026-07-22T12:04:00.000Z' },
      { id: 'answered-early', prompt: 'Early?', response: 'No', answeredAt: '2026-07-22T12:03:00.000Z' },
    ]);

    expect(timeline.pendingByMessageId.get('assistant-1')).toEqual([anchored]);
    expect(timeline.trailingPending.map((item) => item.id)).toEqual(['trailing', 'invalid-anchor']);
    expect(timeline.trailingAnswered.map((item) => item.id)).toEqual(['answered-early', 'answered-late']);
    expect(timeline.items.map((item) => item.type)).toEqual(['message']);
  });
});
