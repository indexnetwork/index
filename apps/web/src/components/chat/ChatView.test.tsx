import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatContextOpportunity } from '@/services/opportunities';
import type { ConversationMessage } from '@/services/conversation';
const mocks = vi.hoisted(() => ({
  getChatContext: vi.fn(), getOrCreateDm: vi.fn(), loadMessages: vi.fn(),
  loadSessionHistory: vi.fn(), markConversationRead: vi.fn(), hideConversation: vi.fn(), sendMessage: vi.fn(),
}));
const messages = new Map<string, ConversationMessage[]>();
const conversations: { id: string; participants: { participantId: string; participantType: string }[] }[] = [];
vi.mock('@/contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 'me' } }) }));
vi.mock('@/contexts/APIContext', () => ({ useOpportunities: () => mocks }));
vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({ ...mocks, messages, conversations, sessionHistory: new Map() }),
}));
vi.mock('@/components/UserAvatar', () => ({ default: () => null }));
vi.mock('./OpportunityDivider', () => ({
  default: ({ opportunities }: { opportunities: ChatContextOpportunity[] }) => <div>{opportunities[0].headline}</div>,
}));
import ChatView from './ChatView';
beforeEach(() => {
  vi.clearAllMocks(); messages.clear(); conversations.length = 0;
  mocks.loadMessages.mockResolvedValue(undefined);
  mocks.getOrCreateDm.mockResolvedValue({ id: 'conversation' });
  Element.prototype.scrollIntoView = vi.fn();
});
it('shows messages while opportunity context is pending, then inserts cards', async () => {
  let resolve!: (cards: ChatContextOpportunity[]) => void;
  mocks.getChatContext.mockReturnValue(new Promise<ChatContextOpportunity[]>((r) => { resolve = r; }));
  conversations.push({ id: 'conversation', participants: [{ participantId: 'peer', participantType: 'user' }] });
  messages.set('conversation', [{
    id: 'message', conversationId: 'conversation', senderId: 'peer',
    parts: [{ text: 'Already loaded message' }], createdAt: '2026-10-29T01:00:00Z',
  } as ConversationMessage]);
  render(<MemoryRouter><ChatView userId="peer" userName="Peer" onClose={() => {}} /></MemoryRouter>);
  expect(screen.getByText('Already loaded message')).toBeInTheDocument();
  await act(async () => resolve([{
    opportunityId: 'opportunity', headline: 'Late opportunity card', acceptedAt: '2026-10-29T00:00:00Z',
  } as ChatContextOpportunity]));
  expect(screen.getByText('Already loaded message')).toBeInTheDocument();
  expect(screen.getByText('Late opportunity card')).toBeInTheDocument();
});
it('initializes the DM once when its ID becomes available', async () => {
  mocks.getChatContext.mockResolvedValue([]);
  render(<MemoryRouter><ChatView userId="peer" userName="Peer" onClose={() => {}} /></MemoryRouter>);
  await waitFor(() => expect(mocks.loadMessages).toHaveBeenCalledWith('conversation'));
  expect(mocks.getOrCreateDm).toHaveBeenCalledTimes(1);
});
