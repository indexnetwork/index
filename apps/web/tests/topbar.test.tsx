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
import type { ConversationSummary } from '@/services/conversation';

const mocks = vi.hoisted(() => ({
  features: { negotiatorChat: true } as { negotiatorChat?: boolean },
  apiGet: vi.fn(),
  conversations: [] as Array<ConversationSummary & { persona: string }>,
  negotiations: [] as Array<ConversationSummary & { persona: string }>,
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
    features: mocks.features,
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiClient: { get: mocks.apiGet, post: vi.fn() },
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

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({ conversations: mocks.conversations, negotiations: mocks.negotiations }),
}));

vi.mock('@/components/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

function conversationSummary(
  id: string,
  unreadCount: number,
  participantTypes: Array<'user' | 'agent'> = ['user', 'user'],
  persona = 'orchestrator',
): ConversationSummary & { persona: string } {
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
    mocks.conversations = [];
    mocks.negotiations = [];
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

  test('Negotiations badge counts rows that require the user to act', () => {
    const question = conversationSummary('negotiation-question', 0, ['agent', 'agent']);
    question.lastMessage = {
      parts: [{ kind: 'data', data: { action: 'ask_user' } }],
      senderId: 'agent:user-1',
      createdAt: new Date().toISOString(),
    };
    question.negotiation = {
      taskId: 'task-1',
      state: 'input_required',
      statusTimestamp: new Date().toISOString(),
      opportunityId: 'opportunity-1',
      opportunityStatus: 'negotiating',
      acceptedByViewer: false,
      turnCount: 2,
      maxTurns: 6,
      signalCount: 2,
      outcome: null,
      updatedAt: new Date().toISOString(),
    };
    mocks.negotiations = [question];

    renderTopBar();

    expect(screen.getByTestId('negotiations-your-move-badge')).toHaveTextContent('1');
  });

  test('Agent click clears chat state and navigates to /agent', () => {
    renderTopBar();
    screen.getByRole('button', { name: /^Agent$/ }).click();
    expect(mocks.navigate).toHaveBeenCalledWith('/agent');
  });

  // The question inbox and its badge are retired: questions are conversation
  // in the signal's DM, and the Agent entry always routes home.
  test('renders no question badge anywhere', () => {
    renderTopBar();
    expect(screen.queryByTestId('negotiator-question-badge')).toBeNull();
  });
});
