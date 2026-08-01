import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';

import { Compare } from '../src/routes/Compare';

const REFS = {
  refs: [
    {
      id: 'a',
      harness: 'matching',
      kind: 'run',
      createdAt: '2026-07-30T10:00:00.000Z',
      aggregatePassRate: 0.971,
      models: ['google/gemini-2.5-flash'],
      path: 'x',
    },
    {
      id: 'b',
      harness: 'matching',
      kind: 'run',
      createdAt: '2026-07-31T10:00:00.000Z',
      aggregatePassRate: 0.976,
      models: ['anthropic/claude-sonnet-4'],
      path: 'y',
    },
    {
      id: 'c',
      harness: 'premise',
      kind: 'run',
      createdAt: '2026-07-31T11:00:00.000Z',
      aggregatePassRate: 0.8,
      models: ['google/gemini-2.5-flash'],
      path: 'z',
    },
  ],
  issues: [],
};

function stub(compare: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/api/compare')) return new Response(JSON.stringify(compare));
    return new Response(JSON.stringify(REFS));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function compareCalls(fetchMock: ReturnType<typeof stub>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/compare'));
}

beforeEach(() => vi.unstubAllGlobals());

afterEach(() => cleanup());

describe('Compare', () => {
  it('explains a refusal instead of showing a delta', async () => {
    stub({
      comparable: false,
      findings: [{ dimension: 'corpusFingerprint', reference: 'aaa', subject: 'bbb' }],
    });
    render(
      <MemoryRouter initialEntries={['/?reference=a&subject=b']}>
        <Compare />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/cannot be compared/i)).toBeInTheDocument();
    expect(await screen.findByText(/corpusFingerprint/)).toBeInTheDocument();
    expect(screen.queryByText(/Δ/)).toBeNull();
  });

  it('labels regressions and improvements separately', async () => {
    stub({
      comparable: true,
      aggregate: { reference: 0.971, subject: 0.976, delta: 0.005 },
      regressions: {
        regressions: [{ id: 'case-x', kind: 'case', before: 1, after: 0.5, pValue: 0.01 }],
        skippedCaseIds: [],
        addedCaseIds: [],
        removedCaseIds: [],
        unscoredCaseIds: [],
      },
      improvements: {
        regressions: [{ id: 'case-y', kind: 'case', before: 0.5, after: 1, pValue: 0.02 }],
        skippedCaseIds: [],
        addedCaseIds: [],
        removedCaseIds: [],
        unscoredCaseIds: [],
      },
    });
    render(
      <MemoryRouter initialEntries={['/?reference=a&subject=b']}>
        <Compare />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/case-x/)).toBeInTheDocument();
    expect(await screen.findByText(/case-y/)).toBeInTheDocument();
    expect(await screen.findByText(/one-sided/i)).toBeInTheDocument();
  });

  it('follows browser back to the previously compared pair', async () => {
    const fetchMock = stub({ comparable: false, findings: [] });
    const router = createMemoryRouter([{ path: '/', element: <Compare /> }], {
      initialEntries: ['/?reference=a&subject=b', '/?reference=b&subject=a'],
      initialIndex: 1,
    });
    render(<RouterProvider router={router} />);

    const reference = (await screen.findByLabelText('Reference')) as HTMLSelectElement;
    await waitFor(() => expect(reference.value).toBe('b'));

    await act(async () => {
      await router.navigate(-1);
    });

    await waitFor(() =>
      expect((screen.getByLabelText('Reference') as HTMLSelectElement).value).toBe('a'),
    );
    expect((screen.getByLabelText('Subject') as HTMLSelectElement).value).toBe('b');
    await waitFor(() =>
      expect(compareCalls(fetchMock).at(-1)).toContain('reference=a&subject=b'),
    );
  });

  it('clears a subject the new reference cannot be compared against', async () => {
    stub({ comparable: false, findings: [] });
    const router = createMemoryRouter([{ path: '/', element: <Compare /> }], {
      initialEntries: ['/?reference=a&subject=b'],
    });
    render(<RouterProvider router={router} />);

    const reference = (await screen.findByLabelText('Reference')) as HTMLSelectElement;
    await waitFor(() => expect(reference.value).toBe('a'));

    await userEvent.selectOptions(reference, 'c');

    // Assert the search params were actually cleared, not just that the select
    // value is empty (which it would be anyway since option 'b' no longer exists
    // after filtering to the 'premise' harness).
    await waitFor(() => {
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('reference')).toBe('c');
      expect(params.get('subject')).toBeNull();
    });
  });
});
