import { describe, expect, test } from 'bun:test';

import { conversationEventRecipientUserIds, publishPersonalAgentTurnCompletedEvent } from '../conversation-events';
import { getRedisClient } from '../../adapters/cache.adapter';

describe('conversationEventRecipientUserIds', () => {
  test('maps negotiation agents to their owners without exposing agent IDs', () => {
    expect(conversationEventRecipientUserIds([
      { participantId: 'agent:owner-a' },
      { participantId: 'agent:owner-b' },
      { participantId: 'agent:owner-a' },
    ])).toEqual(['owner-a', 'owner-b']);
  });

  test('retains ordinary participant IDs and drops empty channels', () => {
    expect(conversationEventRecipientUserIds([
      { participantId: 'owner-a' },
      { participantId: '' },
    ])).toEqual(['owner-a']);
  });
});

test('publishes a completed PersonalAgent turn only to its owner channel', async () => {
  const redis = getRedisClient();
  const published: Array<{ channel: string; payload: string }> = [];
  const originalPublish = redis.publish.bind(redis);
  redis.publish = (async (channel: string, payload: string) => {
    published.push({ channel, payload });
    return 1;
  }) as typeof redis.publish;
  try {
    await publishPersonalAgentTurnCompletedEvent({ userId: 'owner-a', intentId: 'intent-a' });
    expect(published).toEqual([{
      channel: 'conversations:user:owner-a',
      payload: JSON.stringify({ type: 'personal_agent_turn_completed', intentId: 'intent-a' }),
    }]);
  } finally {
    redis.publish = originalPublish;
  }
});
