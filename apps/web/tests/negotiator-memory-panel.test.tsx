/**
 * Negotiator memory panel (P5.4 / IND-408).
 *
 * Verifies the inspection surface: kinds render grouped with disclosure
 * rules first and labelled as standing consent, edits PATCH the memory API,
 * deletes confirm then DELETE and drop the row, and the empty state explains
 * where memory comes from.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import NegotiatorMemoryPanel from '@/components/NegotiatorMemoryPanel';
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

const MEMORIES: NegotiatorMemory[] = [
  mkMemory({ id: 'mem-rule', kind: 'disclosure_rule', content: 'Never share my budget.', confidence: 0.9 }),
  mkMemory({ id: 'mem-play', kind: 'playbook', content: 'Open with the shared-interest angle.' }),
  mkMemory({ id: 'mem-thresh', kind: 'threshold', content: 'Minimum rate is $150/h.', confidence: 0.8 }),
  mkMemory({
    id: 'mem-dossier',
    kind: 'counterparty_dossier',
    content: 'Prefers async communication.',
    subjectUser: { id: 'u-2', name: 'Bob Counterparty', avatar: null },
  }),
];

describe('NegotiatorMemoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiClient.get.mockResolvedValue({ memories: MEMORIES });
  });

  test('renders every kind group, disclosure rules first and labelled as standing consent', async () => {
    render(<NegotiatorMemoryPanel userId="u-1" />);

    await waitFor(() => expect(screen.getByText('Never share my budget.')).toBeInTheDocument());
    expect(mocks.apiClient.get).toHaveBeenCalledWith('/users/u-1/negotiator/memories');

    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Disclosure rules', 'Thresholds', 'Playbooks', 'Counterparty notes']);
    expect(screen.getByText('Standing consent')).toBeInTheDocument();
    expect(screen.getByText('About Bob Counterparty')).toBeInTheDocument();
    expect(screen.getByText('Confidence 90%')).toBeInTheDocument();
  });

  test('editing a memory PATCHes content and re-renders the updated row', async () => {
    mocks.apiClient.patch.mockResolvedValue({
      memory: mkMemory({ id: 'mem-rule', kind: 'disclosure_rule', content: 'Never share my budget with vendors.', confidence: 0.9 }),
    });
    render(<NegotiatorMemoryPanel userId="u-1" />);
    await waitFor(() => expect(screen.getByText('Never share my budget.')).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText('Edit memory')[0]);
    const textarea = screen.getByLabelText('Edit memory', { selector: 'textarea' });
    fireEvent.change(textarea, { target: { value: 'Never share my budget with vendors.' } });
    fireEvent.click(screen.getByLabelText('Save memory'));

    await waitFor(() =>
      expect(mocks.apiClient.patch).toHaveBeenCalledWith(
        '/users/u-1/negotiator/memories/mem-rule',
        { content: 'Never share my budget with vendors.' },
      ));
    await waitFor(() =>
      expect(screen.getByText('Never share my budget with vendors.')).toBeInTheDocument());
  });

  test('delete asks for confirmation, DELETEs, and drops the row', async () => {
    mocks.apiClient.delete.mockResolvedValue({ success: true });
    render(<NegotiatorMemoryPanel userId="u-1" />);
    await waitFor(() => expect(screen.getByText('Never share my budget.')).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText('Delete memory')[0]);
    expect(mocks.apiClient.delete).not.toHaveBeenCalled(); // confirm step first
    expect(screen.getByText('Forget this?')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Confirm delete'));
    await waitFor(() =>
      expect(mocks.apiClient.delete).toHaveBeenCalledWith('/users/u-1/negotiator/memories/mem-rule'));
    await waitFor(() =>
      expect(screen.queryByText('Never share my budget.')).not.toBeInTheDocument());
    // The rest of the panel is untouched.
    expect(screen.getByText('Minimum rate is $150/h.')).toBeInTheDocument();
  });

  test('empty memory shows the explanatory empty state', async () => {
    mocks.apiClient.get.mockResolvedValue({ memories: [] });
    render(<NegotiatorMemoryPanel userId="u-1" />);
    await waitFor(() =>
      expect(screen.getByText('Your Personal Agent hasn’t learned anything yet')).toBeInTheDocument());
  });
});
