import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

const mocks = vi.hoisted(() => ({
  conversations: [] as ConversationSummary[],
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: viewer }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    conversations: mocks.conversations,
    negotiations: [],
    refreshConversations: vi.fn(async () => {}),
    refreshNegotiations: vi.fn(async () => {}),
    hideConversation: vi.fn(async () => {}),
  }),
}));

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/chat']}>
      <ChatSidebar />
    </MemoryRouter>,
  );
}

describe('ChatSidebar conversation preview wiring (IND-504)', () => {
  it('renders the muted placeholder for a row with lastMessage: null and the excerpt for a real message', async () => {
    mocks.conversations = [emptyConversation, messageConversation];
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
    renderSidebar();

    expect(await screen.findByTestId('conversation-preview-empty')).toHaveTextContent('No messages yet');
    expect(screen.queryByText(/RAW_MATCH_REASON/)).not.toBeInTheDocument();
    expect(screen.queryByText(/RAW_REASONING/)).not.toBeInTheDocument();
  });
});
