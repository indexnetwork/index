import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import ChatView from '@/components/chat/ChatView';
import { renderWithRouter } from '@/test/test-utils';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'viewer', name: 'Viewer', avatar: null } },
  conversations: [] as Array<Record<string, unknown>>,
  messages: new Map<string, Array<Record<string, unknown>>>(),
  getOrCreateDM: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  loadMessages: vi.fn().mockResolvedValue(undefined),
  loadSessionHistory: vi.fn().mockResolvedValue(undefined),
  loadPreviousSessionMessages: vi.fn().mockResolvedValue(undefined),
  getChatContext: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => mocks.auth,
}));

vi.mock('@/contexts/APIContext', () => ({
  useOpportunities: () => ({ getChatContext: mocks.getChatContext }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    conversations: mocks.conversations,
    messages: mocks.messages,
    sessionHistory: new Map(),
    sendMessage: vi.fn(),
    loadMessages: mocks.loadMessages,
    loadSessionHistory: mocks.loadSessionHistory,
    loadPreviousSessionMessages: mocks.loadPreviousSessionMessages,
    getOrCreateDM: mocks.getOrCreateDM,
    markConversationRead: mocks.markConversationRead,
    hideConversation: vi.fn(),
  }),
}));

vi.mock('@/components/UserAvatar', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock('@/components/GhostBadge', () => ({ default: () => null }));

const props = {
  userId: 'peer',
  userName: 'Peer',
  onClose: vi.fn(),
};

function summary(via: Array<{ intentId: string; opportunityId: string; title: string }>, unreadCount = 0) {
  return {
    id: 'conv-1',
    participants: [],
    lastMessage: null,
    metadata: null,
    via,
    unreadCount,
    lastMessageAt: null,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  mocks.conversations = [summary([])];
  mocks.messages = new Map();
  mocks.getOrCreateDM.mockResolvedValue(summary([]));
  mocks.markConversationRead.mockClear();
  mocks.loadSessionHistory.mockClear();
  mocks.loadPreviousSessionMessages.mockClear();
  mocks.getChatContext.mockResolvedValue([]);
});

describe('ChatView match provenance', () => {
  test('renders the latest via chip linking to the viewer intent and the seeded opener', async () => {
    const via = [
      { intentId: 'intent-latest', opportunityId: 'opp-latest', title: 'Latest signal' },
      { intentId: 'intent-earlier', opportunityId: 'opp-earlier', title: 'Earlier signal' },
    ];
    mocks.conversations = [summary(via)];
    mocks.getOrCreateDM.mockResolvedValue(summary(via));

    renderWithRouter(<ChatView {...props} initialGroupId="conv-1" />);

    const chip = await screen.findByRole('link', { name: 'via: Latest signal' });
    expect(chip).toHaveAttribute('href', '/i/intent-latest');
    expect(chip).toHaveAttribute('title', 'Latest signal · Earlier signal');
    expect(screen.getByText('agents matched you on this signal — say hi.')).toBeInTheDocument();
  });

  test('removes the seeded opener once a real message exists', async () => {
    const via = [{ intentId: 'intent-1', opportunityId: 'opp-1', title: 'A signal' }];
    mocks.conversations = [summary(via)];
    mocks.getOrCreateDM.mockResolvedValue(summary(via));
    mocks.messages = new Map([['conv-1', [{
      id: 'message-1', conversationId: 'conv-1', senderId: 'viewer', role: 'user',
      parts: [{ text: 'hello' }], createdAt: new Date().toISOString(),
    }]]]);

    renderWithRouter(<ChatView {...props} initialGroupId="conv-1" />);

    expect(screen.queryByText('agents matched you on this signal — say hi.')).not.toBeInTheDocument();
  });

  test('marks an unread thread read when it opens', async () => {
    mocks.conversations = [summary([], 2)];
    mocks.getOrCreateDM.mockResolvedValue(summary([], 2));

    renderWithRouter(<ChatView {...props} initialGroupId="conv-1" />);

    await vi.waitFor(() => expect(mocks.markConversationRead).toHaveBeenCalledWith('conv-1'));
  });

  test('does not render provenance UI for a plain DM', async () => {
    renderWithRouter(<ChatView {...props} initialGroupId="conv-1" />);

    await screen.findByText('Start a conversation with Peer');
    expect(screen.queryByText(/^via:/)).not.toBeInTheDocument();
    expect(screen.queryByText('agents matched you on this signal — say hi.')).not.toBeInTheDocument();
  });
});
