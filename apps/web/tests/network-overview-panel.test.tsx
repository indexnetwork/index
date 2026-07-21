import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import NetworkOverviewPanel from '@/components/NetworkOverviewPanel';

interface OverviewResponse {
  intents: Array<{
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
    userId: string;
    userName: string;
  }>;
  premises: Array<{ id: string; text: string; summary: string | null; createdAt: string }>;
  userContext: { text: string; generatedAt: string } | null;
}

const mocks = vi.hoisted(() => ({
  getNetworkOverview: vi.fn(),
  navigate: vi.fn(),
  clearChat: vi.fn(),
  resolveIntentSession: vi.fn(),
  setSelectedNetworkIds: vi.fn(),
  removeIndex: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@/contexts/APIContext', () => ({
  useNetworks: () => ({ getNetworkOverview: mocks.getNetworkOverview }),
}));

vi.mock('@/contexts/IndexesContext', () => ({
  useNetworksState: () => ({ removeIndex: mocks.removeIndex }),
}));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({ success: mocks.success, error: mocks.error }),
}));

vi.mock('@/contexts/AIChatContext', () => ({
  useAIChat: () => ({
    clearChat: mocks.clearChat,
    resolveIntentSession: mocks.resolveIntentSession,
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ features: { signalAgent: false } }),
}));

vi.mock('@/contexts/IndexFilterContext', () => ({
  useNetworkFilter: () => ({ setSelectedNetworkIds: mocks.setSelectedNetworkIds }),
}));

vi.mock('@/lib/api', () => ({
  useAuthenticatedAPI: () => ({ post: mocks.apiPost }),
}));

const network = {
  id: 'network-1',
  title: 'Design Network',
  permissions: { joinPolicy: 'anyone' },
} as Parameters<typeof NetworkOverviewPanel>[0]['index'];

const renderPanel = () =>
  render(
    <MemoryRouter>
      <NetworkOverviewPanel index={network} isOwner />
    </MemoryRouter>,
  );

const emptyOverview = (): OverviewResponse => ({
  intents: [],
  premises: [],
  userContext: null,
});

describe('NetworkOverviewPanel context and signals overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveIntentSession.mockResolvedValue('session-1');
  });

  test('renders Your Context before Your Signals with a context loading state', async () => {
    let resolveOverview!: (overview: OverviewResponse) => void;
    mocks.getNetworkOverview.mockReturnValue(new Promise<OverviewResponse>((resolve) => {
      resolveOverview = resolve;
    }));

    renderPanel();

    expect(screen.getAllByText(/Your (Context|Signals)/).map((node) => node.textContent)).toEqual([
      'Your Context',
      'Your Signals',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your network context…');
    expect(screen.queryByText('My Intents')).not.toBeInTheDocument();
    expect(screen.queryByText('My Premises')).not.toBeInTheDocument();

    resolveOverview(emptyOverview());
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  test('renders coherent empty states and never presents premises from the overview API', async () => {
    mocks.getNetworkOverview.mockResolvedValue({
      ...emptyOverview(),
      premises: [{
        id: 'premise-1',
        text: 'Internal premise that must not appear',
        summary: 'Hidden premise summary',
        createdAt: '2026-07-01T00:00:00.000Z',
      }],
    });

    renderPanel();

    expect(await screen.findByText('Your context for this network is still being generated')).toBeInTheDocument();
    expect(screen.getByText("You haven't shared any signals in this network yet")).toBeInTheDocument();
    expect(screen.getByText('0 signals')).toBeInTheDocument();
    expect(screen.queryByText('My Premises')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden premise summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal premise that must not appear')).not.toBeInTheDocument();
    expect(mocks.getNetworkOverview).toHaveBeenCalledWith('network-1');
  });

  test('preserves network-scoped context, signal count/list rendering, and click-through', async () => {
    mocks.getNetworkOverview.mockResolvedValue({
      intents: [
        {
          id: 'intent-1',
          payload: 'Find a product designer',
          summary: 'Seeking a product designer',
          createdAt: '2026-07-02T00:00:00.000Z',
          userId: 'user-1',
          userName: 'Alice',
        },
        {
          id: 'intent-2',
          payload: 'Explore climate partnerships',
          summary: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          userId: 'user-1',
          userName: 'Alice',
        },
      ],
      premises: [],
      userContext: {
        text: 'In this network, you focus on collaborative product design.',
        generatedAt: '2026-07-03T00:00:00.000Z',
      },
    });

    renderPanel();

    expect(await screen.findByText('In this network, you focus on collaborative product design.')).toBeInTheDocument();
    expect(screen.getByText('2 signals')).toBeInTheDocument();
    expect(screen.getByText('Seeking a product designer')).toBeInTheDocument();
    expect(screen.getByText('Explore climate partnerships')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Seeking a product designer'));

    await waitFor(() => {
      expect(mocks.clearChat).toHaveBeenCalledWith({ abortStream: false });
      expect(mocks.setSelectedNetworkIds).toHaveBeenCalledWith([]);
      expect(mocks.resolveIntentSession).toHaveBeenCalledWith(
        { id: 'intent-1', label: 'Seeking a product designer' },
        undefined,
      );
      expect(mocks.navigate).toHaveBeenCalledWith('/d/session-1');
    });
  });
});
