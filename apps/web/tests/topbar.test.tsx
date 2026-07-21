/**
 * TopBar navigation — Personal Agent pending-question badge.
 *
 * The badge was ported from the retired Sidebar: it renders on the Agent nav
 * item when the Personal Agent inbox has open questions, caps at 99+, and
 * disappears at zero.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import TopBar from '@/components/TopBar';

const mocks = vi.hoisted(() => ({
  questionsState: { personalAgentPending: 0 },
  conversations: [] as Array<Record<string, unknown>>,
  navigate: vi.fn(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    user: { id: 'user-1', name: 'Alice Smith', avatar: null },
    signOut: vi.fn(),
  }),
}));

vi.mock('@/contexts/APIContext', () => ({
  useOpportunities: () => ({ getOpportunities: vi.fn().mockResolvedValue([]) }),
}));

vi.mock('@/contexts/AIChatContext', () => ({
  useAIChat: () => ({ clearChat: vi.fn() }),
}));

vi.mock('@/contexts/IndexFilterContext', () => ({
  useNetworkFilter: () => ({ setSelectedNetworkIds: vi.fn() }),
}));

vi.mock('@/contexts/QuestionsContext', () => ({
  useQuestions: () => ({ personalAgentPending: mocks.questionsState.personalAgentPending }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({ conversations: mocks.conversations }),
}));

vi.mock('@/components/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

function conversationSummary(
  id: string,
  unreadCount: number,
  participantTypes: Array<'user' | 'agent'> = ['user', 'user'],
  persona = 'orchestrator',
) {
  return {
    id,
    persona,
    participants: participantTypes.map((participantType, index) => ({
      participantId: `${participantType}-${index}`,
      participantType,
      name: null,
      avatar: null,
    })),
    lastMessage: null,
    metadata: null,
    via: [],
    unreadCount,
    lastMessageAt: null,
    createdAt: new Date().toISOString(),
  };
}

function renderTopBar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TopBar />
    </MemoryRouter>,
  );
}

describe('TopBar Personal Agent badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.questionsState.personalAgentPending = 0;
    mocks.conversations = [];
  });

  test('renders primary nav including Signals and Agent', () => {
    renderTopBar();
    expect(screen.getByRole('button', { name: 'Signals' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Agent$/ })).toBeInTheDocument();
  });

  test('chat badge counts visible unread H2H threads rather than unread messages', () => {
    mocks.conversations = [
      conversationSummary('visible-1', 12),
      conversationSummary('visible-2', 1),
      conversationSummary('read', 0),
    ];
    renderTopBar();
    expect(screen.getByTestId('chat-unread-badge')).toHaveTextContent('2');
  });

  test('chat badge excludes sidebar-hidden persona sessions', () => {
    mocks.conversations = [
      // H2H rows also inherit the orchestrator default, so participant topology
      // rather than persona determines whether a conversation is visible.
      conversationSummary('visible-h2h', 1, ['user', 'user'], 'orchestrator'),
      conversationSummary('signal', 1, ['user', 'agent'], 'signal'),
      conversationSummary('reporter', 1, ['user', 'agent'], 'reporter'),
      conversationSummary('negotiator', 1, ['user', 'agent'], 'negotiator'),
      conversationSummary('legacy-orchestrator', 1, ['user', 'agent'], 'orchestrator'),
      conversationSummary('hidden-group', 1, ['user', 'user', 'user'], 'orchestrator'),
    ];
    renderTopBar();
    expect(screen.getByTestId('chat-unread-badge')).toHaveTextContent('1');
  });

  test('chat badge disappears when all visible threads are read', () => {
    mocks.conversations = [
      conversationSummary('read-h2h', 0),
      conversationSummary('unread-signal', 3, ['user', 'agent'], 'signal'),
    ];
    renderTopBar();
    expect(screen.queryByTestId('chat-unread-badge')).toBeNull();
  });

  test('pending-question badge renders on the Agent entry when the inbox has open questions', () => {
    mocks.questionsState.personalAgentPending = 3;
    renderTopBar();
    expect(screen.getByTestId('negotiator-question-badge')).toHaveTextContent('3');
  });

  test('badge caps at 99+', () => {
    mocks.questionsState.personalAgentPending = 120;
    renderTopBar();
    expect(screen.getByTestId('negotiator-question-badge')).toHaveTextContent('99+');
  });

  test('badge disappears at zero', () => {
    renderTopBar();
    expect(screen.queryByTestId('negotiator-question-badge')).toBeNull();
  });

  test('Agent click clears chat state and navigates to /agent', () => {
    renderTopBar();
    screen.getByRole('button', { name: /^Agent$/ }).click();
    expect(mocks.navigate).toHaveBeenCalledWith('/agent');
  });
});
