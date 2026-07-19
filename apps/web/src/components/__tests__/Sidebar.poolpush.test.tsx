import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Sidebar from '../Sidebar';

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    user: { id: 'user-1', name: 'User', email: 'user@example.com' },
    features: { negotiatorChat: true },
    signOut: vi.fn(),
  }),
}));
vi.mock('@/contexts/IndexFilterContext', () => ({ useNetworkFilter: () => ({ setSelectedNetworkIds: vi.fn() }) }));
vi.mock('@/contexts/AIChatSessionsContext', () => ({ useAIChatSessions: () => ({ sessionsVersion: 0 }) }));
vi.mock('@/contexts/AIChatContext', () => ({ useAIChat: () => ({ clearChat: vi.fn() }) }));
vi.mock('@/contexts/ConversationContext', () => ({ useConversation: vi.fn() }));
vi.mock('@/contexts/IndexesContext', () => ({ useNetworksState: () => ({ indexes: [], addIndex: vi.fn() }) }));
vi.mock('@/contexts/APIContext', () => ({
  useNetworks: () => ({ createNetwork: vi.fn(), uploadIndexImage: vi.fn() }),
  useOpportunities: () => ({ getOpportunities: vi.fn(async () => []) }),
}));
vi.mock('@/contexts/NotificationContext', () => ({ useNotifications: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/contexts/QuestionsContext', () => ({
  useQuestions: () => ({ globalPending: 1, personalAgentPending: 3 }),
}));
vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(async () => ({ sessions: [] })),
    post: vi.fn(),
  },
}));
vi.mock('@/components/UserAvatar', () => ({ default: () => <div /> }));
vi.mock('@/components/modals/CreateIndexModal', () => ({ default: () => null }));
vi.mock('@/components/MasterKeyDialog', () => ({ default: () => null }));

describe('Sidebar pool push counts', () => {
  it('shows the summed count on Personal Agent without a Questions entry', async () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(await screen.findByTestId('negotiator-question-badge')).toHaveTextContent('3');
    expect(screen.queryByRole('button', { name: /Questions/i })).not.toBeInTheDocument();
  });
});
