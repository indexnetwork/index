import { describe, expect, it } from 'vitest';

import { intentNegotiationActivityRevision } from '@/lib/intent-negotiation-activity';
import type { ConversationSummary } from '@/services/conversation';

const conversation = (overrides: Partial<ConversationSummary>): ConversationSummary => ({
  id: 'conversation-1',
  participants: [],
  lastMessage: null,
  metadata: null,
  via: [],
  unreadCount: 0,
  lastMessageAt: null,
  createdAt: '2026-07-24T00:00:00.000Z',
  ...overrides,
});

describe('intentNegotiationActivityRevision', () => {
  it('includes only the authenticated viewer intent provenance', () => {
    const revision = intentNegotiationActivityRevision([
      conversation({
        id: 'in-scope',
        lastMessageAt: '2026-07-24T10:00:00.000Z',
        via: [{ intentId: 'intent-owner', opportunityId: 'opportunity-1', title: 'My intent' }],
      }),
      conversation({
        id: 'out-of-scope',
        lastMessageAt: '2026-07-24T11:00:00.000Z',
        via: [{ intentId: 'intent-other', opportunityId: 'opportunity-2', title: 'Other intent' }],
      }),
    ], 'intent-owner');

    expect(revision).toBe('in-scope:2026-07-24T10:00:00.000Z');
    expect(revision).not.toContain('out-of-scope');
  });

  it('changes when a scoped negotiation receives a newer message', () => {
    const before = intentNegotiationActivityRevision([
      conversation({ via: [{ intentId: 'intent-owner', opportunityId: 'opportunity-1', title: 'My intent' }] }),
    ], 'intent-owner');
    const after = intentNegotiationActivityRevision([
      conversation({
        lastMessageAt: '2026-07-24T10:00:00.000Z',
        via: [{ intentId: 'intent-owner', opportunityId: 'opportunity-1', title: 'My intent' }],
      }),
    ], 'intent-owner');

    expect(after).not.toBe(before);
  });
});
