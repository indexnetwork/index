import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import ChatSidebar from '../ChatSidebar';
import type { ConversationSummary } from '@/services/conversation';

const viewer = { id: 'me', name: 'Viewer' };

const emptyConversation: ConversationSummary = {
  id: 'conv-empty',
  participants: [
    { participantId: 'me', participantType: 'user', name: 'Viewer', avatar: null },
    { participantId: 'peer-1', participantType: 'user', name: 'Andrea Gallagher', avatar: null },
  ],
  lastMessage: null,
  metadata: null,
  via: [],
  unreadCount: 0,
  lastMessageAt: null,
  createdAt: '2025-07-06T12:00:00.000Z',
};

const messageConversation: ConversationSummary = {
  id: 'conv-message',
  participants: [
    { participantId: 'me', participantType: 'user', name: 'Viewer', avatar: null },
    { participantId: 'peer-2', participantType: 'user', name: 'Christopher', avatar: null },
  ],
  lastMessage: {
    parts: [{ kind: 'text', text: 'I noticed your interest in graphs' }],
    senderId: 'peer-2',
    createdAt: '2025-07-21T12:00:00.000Z',
  },
  metadata: null,
  via: [],
  unreadCount: 0,
  lastMessageAt: '2025-07-21T12:00:00.000Z',
  createdAt: '2025-06-11T12:00:00.000Z',
};

function negotiation(
  id: string,
  counterpartName: string,
  input: {
    state?: NonNullable<ConversationSummary['negotiation']>['state'];
    opportunityStatus?: NonNullable<ConversationSummary['negotiation']>['opportunityStatus'];
    action?: string;
    senderId?: string;
    turnCount?: number;
  } = {},
): ConversationSummary {
  return {
    id,
    participants: [
      { participantId: 'agent:me', participantType: 'agent', name: 'Index Negotiator', avatar: null, ownerName: 'Viewer' },
      { participantId: `agent:${id}-peer`, participantType: 'agent', name: 'Index Negotiator', avatar: null, ownerName: counterpartName },
    ],
    lastMessage: {
      parts: [{ kind: 'data', data: { action: input.action ?? 'counter' } }],
      senderId: input.senderId ?? `agent:${id}-peer`,
      createdAt: '2026-07-24T11:00:00.000Z',
      taskId: `${id}-task`,
    },
    metadata: null,
    via: [],
    unreadCount: 0,
    lastMessageAt: '2026-07-24T11:00:00.000Z',
    createdAt: '2026-07-24T10:00:00.000Z',
    negotiation: {
      taskId: `${id}-task`,
      state: input.state ?? 'working',
      statusTimestamp: '2026-07-24T11:00:00.000Z',
      opportunityId: `${id}-opportunity`,
      opportunityStatus: input.opportunityStatus ?? 'negotiating',
      acceptedByViewer: false,
      turnCount: input.turnCount ?? 1,
      maxTurns: 6,
      signalCount: 2,
      outcome: null,
      updatedAt: '2026-07-24T11:00:00.000Z',
    },
    negotiationOpportunities: [{
      intentId: `${id}-intent`,
      opportunityId: `${id}-opportunity`,
      title: `${counterpartName}'s opportunity`,
      taskId: `${id}-task`,
      state: input.state ?? 'working',
      opportunityStatus: input.opportunityStatus ?? 'negotiating',
      acceptedByViewer: false,
      turnCount: input.turnCount ?? 1,
      maxTurns: 6,
      signalCount: 2,
      outcome: null,
      updatedAt: '2026-07-24T11:00:00.000Z',
    }],
  };
}

const answerNegotiation = negotiation('question', 'Mira Chen', {
  state: 'input_required',
  action: 'ask_user',
  senderId: 'agent:me',
});

/**
 * The dev shape that made the badge and the list disagree after #1444: the API
 * projected no `negotiationOpportunities` (the conversation carries no match
 * provenance for this viewer) while `negotiation` still describes a pending
 * opportunity the your-move badge counts.
 */
const ungroupableNegotiation: ConversationSummary = {
  ...negotiation('ungrouped', 'Dana Okafor', { state: 'completed', opportunityStatus: 'pending' }),
  via: [],
  negotiationOpportunities: [],
};

/** A zero-message screened-out shell: owner-only, and never grouped. */
const screenedOutNegotiation: ConversationSummary = {
  ...negotiation('screened', 'Ilya Roth', { state: 'completed', opportunityStatus: 'rejected' }),
  lastMessage: null,
  lastMessageAt: null,
  negotiationOpportunities: [],
  negotiation: {
    ...negotiation('screened', 'Ilya Roth', { state: 'completed', opportunityStatus: 'rejected' }).negotiation!,
    screenDecision: {
      source: 'screen',
      decision: 'pass',
      reasoning: 'not enough mutual value',
      counterpartyPremiseFit: null,
      intentAlignment: null,
      screenedAt: '2026-07-24T11:00:00.000Z',
    },
  },
};

const mocks = vi.hoisted(() => ({
  conversations: [] as ConversationSummary[],
  negotiations: [] as ConversationSummary[],
  features: undefined as { negotiatorChat?: boolean } | undefined,
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: viewer, features: mocks.features }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    conversations: mocks.conversations,
    negotiations: mocks.negotiations,
    isConnected: true,
    refreshConversations: vi.fn(async () => {}),
    refreshNegotiations: vi.fn(async () => {}),
    hideConversation: vi.fn(async () => {}),
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiClient: { get: mocks.apiGet, post: mocks.apiPost },
}));

const currentPath = { value: '/' };

function LocationProbe() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    currentPath.value = `${pathname}${search}`;
  }, [pathname, search]);
  return null;
}

function renderSidebar(initialEntry = '/chat') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <ChatSidebar />
    </MemoryRouter>,
  );
}

async function waitForNegotiations() {
  // Wait for the first refresh to settle so empty-state assertions are stable.
  await waitFor(() => expect(screen.queryByTestId('chat-sidebar-skeleton')).not.toBeInTheDocument());
}

describe('ChatSidebar conversation preview wiring (IND-504)', () => {
  it('renders the muted placeholder for a row with lastMessage: null and the excerpt for a real message', async () => {
    mocks.conversations = [emptyConversation, messageConversation];
    mocks.negotiations = [];
    renderSidebar();

    // Excerpt row: real last message, standard excerpt styling, no placeholder.
    const excerpt = await screen.findByTestId('conversation-preview-message');
    expect(excerpt).toHaveTextContent('I noticed your interest in graphs');
    expect(excerpt.className).toContain('text-gray-500');

    // Empty row: neutral placeholder, muted styling distinct from the excerpt.
    const placeholder = screen.getByTestId('conversation-preview-empty');
    expect(placeholder).toHaveTextContent('No messages yet');
    expect(placeholder.className).toContain('italic');
    expect(placeholder.className).toContain('text-gray-400');

    // Exactly one of each — the empty row did not fabricate an excerpt and the
    // message row did not fall back to the placeholder.
    expect(screen.getAllByTestId('conversation-preview-empty')).toHaveLength(1);
    expect(screen.getAllByTestId('conversation-preview-message')).toHaveLength(1);

    // Both peer names still render as row titles.
    expect(screen.getByText('Andrea Gallagher')).toBeInTheDocument();
    expect(screen.getByText('Christopher')).toBeInTheDocument();
  });

  it('never renders raw evaluator reasoning or matchReason text in rows', async () => {
    mocks.conversations = [
      {
        ...emptyConversation,
        metadata: { matchReason: 'RAW_MATCH_REASON', interpretation: { reasoning: 'RAW_REASONING' } } as unknown as ConversationSummary['metadata'],
      },
    ];
    mocks.negotiations = [];
    renderSidebar();

    expect(await screen.findByTestId('conversation-preview-empty')).toHaveTextContent('No messages yet');
    expect(screen.queryByText(/RAW_MATCH_REASON/)).not.toBeInTheDocument();
    expect(screen.queryByText(/RAW_REASONING/)).not.toBeInTheDocument();
  });
});
