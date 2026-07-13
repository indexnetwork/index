/**
 * IntentMemoryStrip — the intent-scoped "What your agent has learned here"
 * window on the intent page. Verifies: fetch is intent-scoped, the strip is
 * hidden when there is nothing to show (empty or fetch failure), and
 * expanding reveals rows plus the link to the full memory panel.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import IntentMemoryStrip from '@/components/IntentMemoryStrip';
import type { NegotiatorMemory } from '@/services/negotiatorMemories';

const mocks = vi.hoisted(() => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  apiClient: mocks.apiClient,
  useAuthenticatedAPI: () => mocks.apiClient,
}));

const mkMemory = (partial: Partial<NegotiatorMemory>): NegotiatorMemory => ({
  id: 'mem-1',
  kind: 'playbook',
  content: 'Open with the shared-interest angle.',
  confidence: 0.6,
  subjectUser: null,
  sourceRefs: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...partial,
});

const renderStrip = () =>
  render(
    <MemoryRouter>
      <IntentMemoryStrip intentId="intent-1" userId="u-1" />
    </MemoryRouter>,
  );

describe('IntentMemoryStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('fetches intent-scoped memories and expands to rows with a link to the full panel', async () => {
    mocks.apiClient.get.mockResolvedValue({
      memories: [
        mkMemory({ id: 'mem-a', kind: 'threshold', content: 'Minimum rate is $150/h.' }),
        mkMemory({ id: 'mem-b', kind: 'playbook', content: 'Lead with the timeline question.' }),
      ],
    });

    renderStrip();

    await waitFor(() =>
      expect(screen.getByTestId('intent-memory-strip')).toBeInTheDocument());
    expect(mocks.apiClient.get).toHaveBeenCalledWith(
      '/users/u-1/negotiator/memories?intentId=intent-1',
    );
    expect(screen.getByText('What your agent has learned here (2)')).toBeInTheDocument();

    // Collapsed by default — content hidden until expanded.
    expect(screen.queryByText('Minimum rate is $150/h.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('What your agent has learned here (2)'));
    expect(screen.getByText('Minimum rate is $150/h.')).toBeInTheDocument();
    expect(screen.getByText('Threshold')).toBeInTheDocument();
    expect(screen.getByText('Lead with the timeline question.')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /Review or edit in Memory/ });
    expect(link).toHaveAttribute('href', '/agent/memory');
  });

  test('renders nothing when the intent has produced no memories', async () => {
    mocks.apiClient.get.mockResolvedValue({ memories: [] });

    renderStrip();

    await waitFor(() => expect(mocks.apiClient.get).toHaveBeenCalled());
    expect(screen.queryByTestId('intent-memory-strip')).not.toBeInTheDocument();
  });

  test('renders nothing when the fetch fails (best-effort surface)', async () => {
    mocks.apiClient.get.mockRejectedValue(new Error('boom'));

    renderStrip();

    await waitFor(() => expect(mocks.apiClient.get).toHaveBeenCalled());
    expect(screen.queryByTestId('intent-memory-strip')).not.toBeInTheDocument();
  });
});
