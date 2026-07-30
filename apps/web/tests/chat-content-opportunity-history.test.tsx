import { describe, expect, test, vi } from 'vitest';
import { screen } from '@testing-library/react';

import InlineDiscoveryCard from '@/components/chat/InlineDiscoveryCard';
import OpportunityCard from '@/components/chat/OpportunityCardInChat';
import { renderWithRouter } from '@/test/test-utils';

vi.mock('@/components/InviteMessageModal', () => ({ default: () => null }));

describe('historical opportunity-card compatibility', () => {
  test('renders hydrated legacy discoveries and persisted streaming drafts without requesting a new run', () => {
    const request = vi.fn();
    const storedMessage = {
      discoveries: [{ candidateId: 'legacy-user', candidateName: 'Legacy Ada', candidateAvatar: null, score: 91, sourceDescription: 'Stored legacy opportunity' }],
      streamingDrafts: [{ opportunityId: 'draft-1', opportunity: { id: 'draft-1', status: 'pending', interpretation: { reasoning: 'Stored draft opportunity' } }, counterparty: { userId: 'draft-user', name: 'Draft Grace' }, receivedAt: 0 }],
    };

    renderWithRouter(<>
      {storedMessage.discoveries.map((discovery) => <InlineDiscoveryCard key={discovery.candidateId} discovery={discovery} />)}
      {storedMessage.streamingDrafts.map((draft) => <OpportunityCard key={draft.opportunityId} card={{ opportunityId: draft.opportunityId, userId: draft.counterparty.userId, name: draft.counterparty.name, mainText: draft.opportunity.interpretation?.reasoning ?? '', status: draft.opportunity.status }} />)}
    </>);

    expect(screen.getByText('Legacy Ada')).toBeInTheDocument();
    expect(screen.getByText('Stored legacy opportunity')).toBeInTheDocument();
    expect(screen.getByText('Draft Grace')).toBeInTheDocument();
    expect(screen.getByText('Stored draft opportunity')).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});
