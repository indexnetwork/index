import { describe, expect, it } from 'bun:test';

import type { AdapterPersistedQuestion } from '../../../adapters/questioner.adapter';
import { stripInternalDetection } from '../question.public';

function negotiationQuestion(): AdapterPersistedQuestion {
  return {
    id: 'question-1',
    detection: {
      mode: 'negotiation_inflight',
      purpose: 'inflight_consultation',
      sourceType: 'opportunity',
      sourceId: 'opportunity-public',
      timestamp: '2026-07-23T00:00:00.000Z',
      messageId: 'verified-public-anchor',
      sessionId: 'session-secret',
      strategy: 'surface_missing_detail',
      underspecificationType: 'missing_constraint',
      voidedReason: 'negotiation_stale',
      negotiation: {
        version: 1,
        purpose: 'inflight_consultation',
        recipientUserId: 'recipient-secret',
        recipientIntentId: 'intent-secret',
        opportunityId: 'opportunity-public',
        taskId: 'task-secret',
        networkId: 'network-secret',
        intentFingerprint: 'fingerprint-secret',
        opportunityStatus: 'negotiating',
        opportunityUpdatedAt: '2026-07-23T00:00:00.000Z',
        taskState: 'input_required',
        taskUpdatedAt: '2026-07-23T00:00:01.000Z',
        questionOrdinal: 0,
      },
    },
    actors: [{ userId: 'recipient-secret', networkId: 'network-secret', role: 'subject' }],
    payload: {
      title: 'Disclosure',
      prompt: 'May I share your timeline with the other participant in this match?',
      options: [
        { label: 'Share', description: 'Share and continue' },
        { label: 'Keep private', description: 'Continue without sharing' },
      ],
      multiSelect: false,
    },
    status: 'pending',
    answer: null,
    expiresAt: null,
    createdAt: '2026-07-23T00:00:02.000Z',
    conversationId: null,
  };
}

describe('public question serialization', () => {
  it('strips all negotiation routing, lifecycle, fingerprint, and session metadata', () => {
    const publicQuestion = stripInternalDetection(negotiationQuestion());
    expect(publicQuestion.detection).toEqual({
      mode: 'negotiation_inflight',
      sourceType: 'opportunity',
      sourceId: 'opportunity-public',
      timestamp: '2026-07-23T00:00:00.000Z',
      messageId: 'verified-public-anchor',
    });
    const serialized = JSON.stringify(publicQuestion);
    for (const secret of [
      'inflight_consultation', 'intent-secret', 'task-secret',
      'network-secret', 'fingerprint-secret', 'input_required', 'session-secret',
      'negotiation_stale', 'missing_constraint',
    ]) expect(serialized).not.toContain(secret);
  });
});
