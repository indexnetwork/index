import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: '/agent',
  features: { agentSurface: true, negotiatorChat: false } as {
    agentSurface?: boolean;
    negotiatorChat?: boolean;
  },
  get: vi.fn(),
  startReporterSession: vi.fn().mockResolvedValue(true),
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
    user: { id: 'user-1', name: 'Reporter User' },
    features: mocks.features,
  }),
}));

vi.mock('@/contexts/AIChatContext', () => ({
  useAIChat: () => ({ startReporterSession: mocks.startReporterSession }),
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

describe('AgentSessionsPanel reporter conversations', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.get.mockReset();
    mocks.startReporterSession.mockReset();
    mocks.startReporterSession.mockResolvedValue(true);
    mocks.error.mockReset();
    mocks.pathname = '/agent';
    mocks.features = { agentSurface: true, negotiatorChat: false };
    mocks.get.mockResolvedValue({
      sessions: [{
        id: 'stale-reporter',
        title: 'Yesterday briefing',
        networkId: null,
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T01:00:00.000Z',
      }],
    });
  });

  test('preserves stale reporter history and force-starts New conversation', async () => {
    render(<AgentSessionsPanel />);

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/chat/web/sessions'));
    expect(screen.getByText('Yesterday briefing')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(mocks.startReporterSession).toHaveBeenCalledWith({ forceNew: true });
    expect(mocks.navigate).toHaveBeenCalledWith('/agent');
    await waitFor(() => expect(mocks.error).not.toHaveBeenCalled());
  });

  test('keeps navigation-only behavior when the reporter surface is disabled', async () => {
    mocks.features = { agentSurface: false, negotiatorChat: false };
    render(<AgentSessionsPanel />);

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/chat/web/sessions'));
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(mocks.startReporterSession).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/agent');
  });
});
