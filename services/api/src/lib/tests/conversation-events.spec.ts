import { describe, expect, test } from 'bun:test';

import { conversationEventRecipientUserIds } from '../conversation-events';

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
