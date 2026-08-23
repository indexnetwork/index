import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import NegotiationDetailPage from '@/app/chat/[conversationId]/page';

const mocks = vi.hoisted(() => ({
  lifecycle: null as Record<string, unknown> | null,
  loadSessionHistory: vi.fn(async () => {}),
}));

vi.mock('@/components/chat/ConversationHeader', () => ({
  default: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));

vi.mock('@/components/negotiations/ResolvedBanner', () => ({
  default: ({ variant }: { variant: string }) => <div data-testid="resolved-banner">{variant}</div>,
}));

vi.mock('@/components/negotiations/use-ticking-now', () => ({
  useTickingNow: () => Date.parse('2026-08-23T10:00:00.000Z'),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'viewer', name: 'Viewer' } }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    negotiations: [{
      id: 'conversation-1',
      participants: [
        { participantId: 'agent:viewer', name: 'Index Negotiator', ownerName: 'Viewer', avatar: null },
        { participantId: 'agent:peer', name: 'Index Negotiator', ownerName: 'Peer', avatar: null },
      ],
      metadata: { title: 'Peer' },
      negotiation: mocks.lifecycle,
      negotiationOpportunities: [],
    }],
    messages: new Map([['conversation-1', []]]),
    loadSessionHistory: mocks.loadSessionHistory,
    loadPreviousSessionMessages: vi.fn(async () => {}),
    refreshNegotiations: vi.fn(async () => {}),
    sessionHistory: new Map(),
    sessionOpportunityMap: new Map(),
  }),
}));

vi.mock('@/hooks/useOpportunityActions', () => ({
  useOpportunityActions: () => ({
    handleOpportunityAction: vi.fn(),
    opportunityStatusMap: {},
    opportunityActionLoading: {},
    opportunityModalElement: null,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/negotiations/conversation-1']}>
      <Routes>
        <Route path="/negotiations/:conversationId" element={<NegotiationDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Negotiation detail zero-message states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lifecycle = null;
  });

  test('a resolved zero-message negotiation shows its outcome without a contradictory empty transcript', async () => {
    mocks.lifecycle = {
      taskId: 'task-1',
      opportunityId: 'opportunity-1',
      opportunityStatus: 'rejected',
      state: 'completed',
      turnCount: 0,
      maxTurns: 6,
      outcome: { hasOpportunity: false, reason: 'screened_out' },
    };

    renderPage();

    expect(await screen.findByTestId('resolved-banner')).toHaveTextContent('rejected');
    expect(screen.queryByText('No messages in this negotiation')).toBeNull();
  });

  test('an unresolved negotiation with no turns retains the genuine empty state', async () => {
    renderPage();

    expect(await screen.findByText('No messages in this negotiation')).toBeInTheDocument();
    expect(screen.queryByTestId('resolved-banner')).toBeNull();
  });
});
