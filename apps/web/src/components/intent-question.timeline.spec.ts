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
});
