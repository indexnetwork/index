import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

import DiscoverHome from '@/components/DiscoverHome';

const mocks = vi.hoisted(() => ({
  apiClient: {
    post: vi.fn(),
    patch: vi.fn(),
    get: vi.fn(),
  },
  showError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ apiClient: mocks.apiClient }));
vi.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({ error: mocks.showError }),
}));

function renderHome() {
  return render(
    <MemoryRouter>
      <DiscoverHome />
    </MemoryRouter>,
  );
}

const intent = (overrides: Record<string, unknown> = {}) => ({
  id: 'intent-1',
  payload: 'Looking for collaborators',
  summary: 'Looking for collaborators',
  createdAt: '2026-07-01T00:00:00.000Z',
  status: 'ACTIVE',
  warming: false,
  waitingOpportunityCount: 0,
  ...overrides,
});

describe('DiscoverHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiClient.post.mockResolvedValue({ intents: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders header totals from listed signals and their opportunities', async () => {
    mocks.apiClient.post.mockResolvedValueOnce({
      intents: [
        intent({ id: 'intent-1', waitingOpportunityCount: 2 }),
        intent({ id: 'intent-2', waitingOpportunityCount: 1 }),
      ],
    });

    renderHome();

    expect(await screen.findByText('2 signals · 3 opportunities')).toBeInTheDocument();
  });

  test('renders WARMING and an unknown opportunity count without a live dot', async () => {
    mocks.apiClient.post.mockResolvedValueOnce({
      intents: [intent({ warming: true, waitingOpportunityCount: 4 })],
    });

    renderHome();

    expect(await screen.findByText('WARMING')).toBeInTheDocument();
    expect(screen.getByLabelText('opportunities unknown')).toHaveTextContent('—');
    expect(screen.queryByText('live')).not.toBeInTheDocument();
  });

  test('polling clears WARMING without remounting when discovery completes', async () => {
    vi.useFakeTimers();
    mocks.apiClient.post
      .mockResolvedValueOnce({ intents: [intent({ warming: true })] })
      .mockResolvedValueOnce({ intents: [intent({ warming: false })] });

    renderHome();
    await vi.waitFor(() => expect(screen.getByText('WARMING')).toBeInTheDocument());

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(mocks.apiClient.post).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.queryByText('WARMING')).not.toBeInTheDocument());
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  test('uses the conversational new-signal CTA copy', async () => {
    renderHome();

    expect(await screen.findByText('who are you trying to meet?')).toBeInTheDocument();
  });
});
