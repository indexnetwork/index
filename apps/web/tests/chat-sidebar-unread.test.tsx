import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import ChatSidebar from '@/components/ChatSidebar';

const mocks = vi.hoisted(() => ({
  conversations: [] as Array<Record<string, unknown>>,
  negotiations: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'viewer' } }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    conversations: mocks.conversations,
    negotiations: mocks.negotiations,
    refreshConversations: vi.fn().mockResolvedValue(undefined),
    refreshNegotiations: vi.fn().mockResolvedValue(undefined),
    hideConversation: vi.fn(),
  }),
}));

vi.mock('@/components/UserAvatar', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

function h2hSummary(unreadCount: number) {
  return {
    id: 'conv-1',
    participants: [
      { participantId: 'viewer', participantType: 'user', name: 'Viewer', avatar: null },
      { participantId: 'peer', participantType: 'user', name: 'Peer', avatar: null },
    ],
    lastMessage: { parts: [{ text: 'hello' }], senderId: 'peer', createdAt: new Date().toISOString() },
    metadata: null,
    via: [],
    unreadCount,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

function negotiationSummary(unreadCount: number) {
  return {
    id: 'neg-1',
    participants: [
      { participantId: 'agent:viewer', participantType: 'agent', name: 'Viewer Agent', avatar: null },
      { participantId: 'agent:peer', participantType: 'agent', name: 'Peer Agent', avatar: null },
    ],
    lastMessage: {
      parts: [{ kind: 'data', data: { action: 'accept', message: 'Ready to connect' } }],
      senderId: 'agent:peer',
      createdAt: new Date().toISOString(),
    },
    metadata: { title: 'Agent negotiation' },
    via: [],
    unreadCount,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  mocks.conversations = [h2hSummary(0)];
  mocks.negotiations = [];
});

describe('ChatSidebar unread indicators', () => {
  test('renders the unread count on a conversation row', () => {
    mocks.conversations = [h2hSummary(2)];
    render(<MemoryRouter><ChatSidebar /></MemoryRouter>);

    const unreadBadge = screen.getByTestId('chat-unread-conv-1');
    expect(unreadBadge).toHaveTextContent('2');
    expect(unreadBadge).toHaveAccessibleName('2 unread messages');
  });

  test('hides the unread indicator when the count is zero', () => {
    render(<MemoryRouter><ChatSidebar /></MemoryRouter>);

    expect(screen.queryByTestId('chat-unread-conv-1')).toBeNull();
  });

  test('suppresses unread counts on negotiation rows while preserving status and action guidance', () => {
    mocks.negotiations = [negotiationSummary(4)];
    render(<MemoryRouter><ChatSidebar /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /Negotiations/ }));

    expect(screen.getAllByText('Agent negotiation').length).toBeGreaterThan(0);
    expect(screen.getByText(/their agent recommended moving forward/)).toBeInTheDocument();
    expect(screen.getByText('Agents agreed')).toBeInTheDocument();
    expect(screen.getByText('Tap to review and start the chat')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-unread-neg-1')).toBeNull();
    expect(screen.queryByLabelText('4 unread messages')).toBeNull();
  });
});
