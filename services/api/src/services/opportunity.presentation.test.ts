import { describe, expect, test } from 'bun:test';

import {
  chatCardToPresentedOpportunity,
  isOpportunityPresentationCacheable,
  radarItemToPresentedOpportunity,
} from './opportunity.presentation';

describe('presented-opportunity mappers', () => {
  test('radarItemToPresentedOpportunity maps peer identity and copy fields', () => {
    const presented = radarItemToPresentedOpportunity({
      opportunityId: 'opp-1',
      status: 'pending',
      userId: 'user-2',
      name: 'Ada',
      avatar: 'avatar.png',
      mainText: 'You both care about climate tech.',
      cta: 'Say hello',
      headline: 'Climate overlap',
      primaryActionLabel: 'Connect',
      secondaryActionLabel: 'Skip',
      mutualIntentsLabel: '2 mutual intents',
    });

    expect(presented.opportunityId).toBe('opp-1');
    expect(presented.peer).toEqual({
      userId: 'user-2',
      name: 'Ada',
      avatar: 'avatar.png',
    });
    expect(presented.mainText).toBe('You both care about climate tech.');
    expect(presented.personalizedSummary).toBe('You both care about climate tech.');
  });

  test('chatCardToPresentedOpportunity maps accepted chat fields', () => {
    const presented = chatCardToPresentedOpportunity({
      opportunityId: 'opp-2',
      headline: 'Great fit',
      personalizedSummary: 'You already accepted this match.',
      narratorRemark: '',
      peerName: 'Bob',
      peerAvatar: null,
      acceptedAt: '2026-01-01T00:00:00.000Z',
      peerUserId: 'user-3',
    });

    expect(presented.peer.userId).toBe('user-3');
    expect(presented.acceptedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(presented.personalizedSummary).toBe('You already accepted this match.');
  });
});

describe('isOpportunityPresentationCacheable', () => {
  test('allows cacheable lifecycle statuses except negotiating', () => {
    expect(isOpportunityPresentationCacheable('pending')).toBe(true);
    expect(isOpportunityPresentationCacheable('accepted')).toBe(true);
    expect(isOpportunityPresentationCacheable('negotiating')).toBe(false);
  });
});
