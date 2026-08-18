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

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/chat']}>
      <LocationProbe />
      <ChatSidebar />
    </MemoryRouter>,
  );
}

async function openNegotiationsTab() {
  fireEvent.click(screen.getByRole('button', { name: /^Negotiations/ }));
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

describe('ChatSidebar negotiations tab (IND-523)', () => {
  it('shows the your-move badge on the toggle only when action is needed', () => {
    mocks.conversations = [];
    mocks.negotiations = [answerNegotiation];
    const { unmount } = renderSidebar();

    const badge = screen.getByTestId('chat-negotiations-your-move-badge');
    expect(badge).toHaveTextContent('1');
    // Self-scoped pill: fixed 16px height, no segment padding/flex inheritance.
    expect(badge.className).toContain('h-4');
    expect(badge.className).toContain('flex-none');
    unmount();

    mocks.negotiations = [];
    renderSidebar();
    expect(screen.queryByTestId('chat-negotiations-your-move-badge')).not.toBeInTheDocument();
  });

  it('groups opportunities by counterparty and exposes truthful lifecycle labels', async () => {
    mocks.conversations = [];
    mocks.negotiations = [
      negotiation('resolved', 'Jonas Berg', { opportunityStatus: 'rejected', action: 'decline' }),
      negotiation('waiting', 'Tom Wolfe', { turnCount: 0 }),
      negotiation('live', 'Aisha Khan', { turnCount: 3 }),
      answerNegotiation,
    ];
    renderSidebar();
    await openNegotiationsTab();

    const mira = screen.getByRole('button', { name: /Mira Chen/ });
    expect(mira).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(mira);
    expect(mira).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText("Mira Chen's opportunity")).toBeInTheDocument();
    expect(screen.getByText('Negotiating')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Jonas Berg/ }));
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('shows mode-aware empty copy and the persistent inbox footer link', async () => {
    mocks.conversations = [];
    mocks.negotiations = [];
    renderSidebar();
    await openNegotiationsTab();

    expect(screen.getByText('No negotiations yet')).toBeInTheDocument();
    expect(screen.getByText('Your agents’ connection work will appear here.')).toBeInTheDocument();
    expect(screen.getByText(/View all in Negotiations inbox/)).toBeInTheDocument();
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
  });

  it('preserves the negotiation hide action on an opportunity row', async () => {
    mocks.conversations = [];
    mocks.negotiations = [negotiation('live', 'Aisha Khan')];
    renderSidebar();
    await openNegotiationsTab();

    fireEvent.click(screen.getByRole('button', { name: /Aisha Khan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Negotiation options' }));
    expect(screen.getByText('Hide')).toBeInTheDocument();
  });

  it('routes an opportunity to its exact task session', async () => {
    mocks.conversations = [];
    mocks.negotiations = [negotiation('live', 'Aisha Khan', { turnCount: 3 })];
    renderSidebar();
    await openNegotiationsTab();

    fireEvent.click(screen.getByRole('button', { name: /Aisha Khan/ }));
    fireEvent.click(screen.getByText("Aisha Khan's opportunity"));
    await waitFor(() => expect(currentPath.value).toBe('/chat/live?taskId=live-task'));
  });
});
