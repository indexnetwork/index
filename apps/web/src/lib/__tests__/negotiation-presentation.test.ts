import { describe, expect, it } from 'vitest';

import { deriveNegotiationPresentation } from '@/lib/negotiation-presentation';
import type { ConversationNegotiationLifecycle, NegotiationPauseReason } from '@/services/conversation';

function lifecycle(input: Partial<ConversationNegotiationLifecycle> = {}): ConversationNegotiationLifecycle {
  return {
    taskId: 'task', state: 'working', pause: null, statusTimestamp: null, opportunityId: 'opportunity', opportunityStatus: 'negotiating', acceptedByViewer: false, turnCount: 1, signalCount: 1, updatedAt: '2026-08-19T00:00:00.000Z', ...input,
  };
}

function paused(reason: NegotiationPauseReason, overrides: Partial<ConversationNegotiationLifecycle> = {}) {
  return lifecycle({ state: 'paused', pause: { reason }, ...overrides });
}

describe('deriveNegotiationPresentation', () => {
  it.each([
    ['needs_principal pause for the viewer agent', paused('needs_principal'), 'agent:viewer', 'needs_input', 'Needs your input'],
    ['ready_for_verdict pause', paused('ready_for_verdict'), 'agent:peer', 'awaiting_review', 'Awaiting your review'],
    ['pending opportunity (a verdict was already written)', lifecycle({ state: 'completed', opportunityStatus: 'pending' }), 'agent:peer', 'awaiting_review', 'Awaiting your review'],
    ['in-flight task', lifecycle(), 'agent:peer', 'negotiating', 'Negotiating'],
    ['counterparty_silent pause', paused('counterparty_silent'), 'agent:peer', 'negotiating', 'Negotiating'],
    ['viewer accepted', lifecycle({ state: 'completed', opportunityStatus: 'accepted', acceptedByViewer: true }), 'agent:viewer', 'accepted_by_viewer', 'Accepted by you'],
    ['counterparty accepted', lifecycle({ state: 'completed', opportunityStatus: 'accepted' }), 'agent:peer', 'connection_accepted', 'Connection accepted'],
    ['rejected opportunity', lifecycle({ state: 'completed', opportunityStatus: 'rejected' }), 'agent:peer', 'no_match', 'No match'],
    ['stalled opportunity', lifecycle({ state: 'completed', opportunityStatus: 'stalled' }), null, 'no_agreement', 'No agreement'],
    ['expired opportunity', lifecycle({ state: 'completed', opportunityStatus: 'expired' }), null, 'expired', 'Expired'],
    ['task completed with no terminal opportunity status', lifecycle({ state: 'completed', opportunityStatus: 'negotiating' }), null, 'no_agreement', 'No agreement'],
    ['draft opportunity', lifecycle({ state: 'working', opportunityStatus: 'draft', turnCount: 0 }), null, 'not_started', 'Not started'],
    ['latent opportunity', lifecycle({ state: 'working', opportunityStatus: 'latent', turnCount: 0 }), null, 'not_started', 'Not started'],
  ])('%s is presented as %s', (_case, value, senderId, status, label) => {
    const presentation = deriveNegotiationPresentation({ lifecycle: value, latestSenderId: senderId, viewerUserId: 'viewer' });
    expect(presentation).toMatchObject({ status, label });
  });

  it('does not treat another agent’s pause for guidance as the viewer’s own', () => {
    expect(deriveNegotiationPresentation({
      lifecycle: paused('needs_principal'), latestSenderId: 'agent:peer', viewerUserId: 'viewer',
    }).status).toBe('negotiating');
  });

  it('keeps a stalled opportunity authoritative over a pending pause', () => {
    expect(deriveNegotiationPresentation({
      lifecycle: paused('needs_principal', { opportunityStatus: 'stalled' }), latestSenderId: 'agent:viewer', viewerUserId: 'viewer',
    })).toMatchObject({ status: 'no_agreement', label: 'No agreement' });
  });

  it.each(['draft', 'latent'] as const)('does not promote a %s opportunity from a stale pause', (opportunityStatus) => {
    expect(deriveNegotiationPresentation({
      lifecycle: lifecycle({ state: 'working', opportunityStatus, turnCount: 0 }), latestSenderId: 'agent:peer', viewerUserId: 'viewer',
    }).status).toBe('not_started');
  });
});
