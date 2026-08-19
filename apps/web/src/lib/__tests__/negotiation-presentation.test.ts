import { describe, expect, it } from 'vitest';

import { deriveNegotiationPresentation } from '@/lib/negotiation-presentation';
import type { ConversationNegotiationLifecycle } from '@/services/conversation';

function lifecycle(input: Partial<ConversationNegotiationLifecycle> = {}): ConversationNegotiationLifecycle {
  return {
    taskId: 'task', state: 'working', statusTimestamp: null, opportunityId: 'opportunity', opportunityStatus: 'negotiating', acceptedByViewer: false, turnCount: 1, maxTurns: 6, signalCount: 1, outcome: null, updatedAt: '2026-08-19T00:00:00.000Z', ...input,
  };
}

describe('deriveNegotiationPresentation', () => {
  it.each([
    ['input required by the viewer agent', lifecycle({ state: 'input_required' }), 'ask_user', 'agent:viewer', 'needs_input', 'Needs your input'],
    ['successful pending opportunity', lifecycle({ state: 'completed', opportunityStatus: 'pending', outcome: { hasOpportunity: true, reason: null } }), 'accept', 'agent:peer', 'awaiting_review', 'Awaiting your review'],
    ['in-flight task', lifecycle(), 'counter', 'agent:peer', 'negotiating', 'Negotiating'],
    ['viewer accepted', lifecycle({ state: 'completed', opportunityStatus: 'accepted', acceptedByViewer: true }), 'accept', 'agent:viewer', 'accepted_by_viewer', 'Accepted by you'],
    ['counterparty accepted', lifecycle({ state: 'completed', opportunityStatus: 'accepted' }), 'accept', 'agent:peer', 'connection_accepted', 'Connection accepted'],
    ['rejected opportunity', lifecycle({ state: 'completed', opportunityStatus: 'rejected' }), 'decline', 'agent:peer', 'no_match', 'No match'],
    ['stalled outcome', lifecycle({ state: 'completed', opportunityStatus: 'stalled', outcome: { hasOpportunity: false, reason: 'turn_cap' } }), null, null, 'no_agreement', 'No agreement'],
    ['expired opportunity', lifecycle({ state: 'completed', opportunityStatus: 'expired' }), null, null, 'expired', 'Expired'],
    ['terminal task failure', lifecycle({ state: 'failed', opportunityStatus: 'negotiating' }), null, null, 'couldnt_complete', 'Couldn\'t complete'],
    ['cancelled task', lifecycle({ state: 'canceled', opportunityStatus: 'negotiating' }), null, null, 'couldnt_complete', 'Couldn\'t complete'],
    ['task requiring authorization', lifecycle({ state: 'auth_required', opportunityStatus: 'negotiating' }), null, null, 'couldnt_complete', 'Couldn\'t complete'],
    ['rejected task', lifecycle({ state: 'rejected', opportunityStatus: 'negotiating' }), 'decline', 'agent:peer', 'no_match', 'No match'],
    ['draft opportunity', lifecycle({ state: 'submitted', opportunityStatus: 'draft', turnCount: 0 }), null, null, 'not_started', 'Not started'],
    ['latent opportunity', lifecycle({ state: 'submitted', opportunityStatus: 'latent', turnCount: 0 }), null, null, 'not_started', 'Not started'],
  ])('%s is presented as %s', (_case, value, action, senderId, status, label) => {
    const presentation = deriveNegotiationPresentation({ lifecycle: value, latestAction: action, latestSenderId: senderId, viewerUserId: 'viewer' });
    expect(presentation).toMatchObject({ status, label });
  });

  it('does not treat another agent’s request for guidance as the viewer’s action', () => {
    expect(deriveNegotiationPresentation({
      lifecycle: lifecycle({ state: 'input_required' }), latestAction: 'ask_user', latestSenderId: 'agent:peer', viewerUserId: 'viewer',
    }).status).toBe('negotiating');
  });

  it.each([
    ['stale request for guidance', lifecycle({ state: 'input_required', opportunityStatus: 'stalled' }), 'ask_user', 'agent:viewer'],
    ['stale acceptance', lifecycle({ state: 'completed', opportunityStatus: 'stalled', outcome: { hasOpportunity: true, reason: null } }), 'accept', 'agent:peer'],
  ])('keeps a stalled opportunity authoritative over %s', (_case, value, action, senderId) => {
    expect(deriveNegotiationPresentation({ lifecycle: value, latestAction: action, latestSenderId: senderId, viewerUserId: 'viewer' }))
      .toMatchObject({ status: 'no_agreement', label: 'No agreement' });
  });

  it.each(['draft', 'latent'] as const)('does not promote a %s opportunity from a stale acceptance', (opportunityStatus) => {
    expect(deriveNegotiationPresentation({
      lifecycle: lifecycle({ state: 'submitted', opportunityStatus }), latestAction: 'accept', latestSenderId: 'agent:peer', viewerUserId: 'viewer',
    }).status).toBe('not_started');
  });
});
