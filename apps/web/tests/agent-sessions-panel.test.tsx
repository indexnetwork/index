import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: '/agent',
  features: { negotiatorChat: false } as { negotiatorChat?: boolean },
  get: vi.fn(),
  error: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname }),
}));

vi.mock('@/lib/api', () => ({
  apiClient: { get: mocks.get, post: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    user: { id: 'user-1', name: 'Panel User' },
    features: mocks.features,
  }),
}));

vi.mock('@/contexts/AIChatSessionsContext', () => ({
  useAIChatSessions: () => ({ sessionsVersion: 0 }),
}));

vi.mock('@/contexts/IndexesContext', () => ({
  useNetworksState: () => ({ indexes: [] }),
}));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({ error: mocks.error }),
}));

import AgentSessionsPanel from '@/components/AgentSessionsPanel';

describe('AgentSessionsPanel', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.get.mockReset();
    mocks.error.mockReset();
    mocks.pathname = '/agent';
    mocks.features = { negotiatorChat: false };
    mocks.get.mockResolvedValue({
      sessions: [{
        id: 'past-session',
        title: 'Earlier conversation',
        networkId: null,
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T01:00:00.000Z',
      }],
    });
  });

  test('lists persisted history and routes New conversation to /agent', async () => {
    render(<AgentSessionsPanel />);

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/chat/web/sessions'));
    expect(screen.getByText('Earlier conversation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent');
    await waitFor(() => expect(mocks.error).not.toHaveBeenCalled());
  });
});
