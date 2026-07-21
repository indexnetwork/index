import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import ChatSidebar from '@/components/ChatSidebar';
import { render } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  conversations: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'viewer' } }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    conversations: mocks.conversations,
    negotiations: [],
    refreshConversations: vi.fn().mockResolvedValue(undefined),
    refreshNegotiations: vi.fn().mockResolvedValue(undefined),
    hideConversation: vi.fn(),
  }),
}));

vi.mock('@/components/UserAvatar', () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

function summary(unreadCount: number) {
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

beforeEach(() => {
  mocks.conversations = [summary(0)];
});

describe('ChatSidebar unread indicators', () => {
  test('renders the unread count on a conversation row', () => {
    mocks.conversations = [summary(2)];
    render(<MemoryRouter><ChatSidebar /></MemoryRouter>);

    expect(screen.getByTestId('chat-unread-conv-1')).toHaveTextContent('2');
  });

  test('hides the unread indicator when the count is zero', () => {
    render(<MemoryRouter><ChatSidebar /></MemoryRouter>);

    expect(screen.queryByTestId('chat-unread-conv-1')).toBeNull();
  });
});
