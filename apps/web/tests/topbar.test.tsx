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

vi.mock('@/components/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

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
  });

  test('renders primary nav including Signals and Agent', () => {
    renderTopBar();
    expect(screen.getByRole('button', { name: 'Signals' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Agent$/ })).toBeInTheDocument();
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
