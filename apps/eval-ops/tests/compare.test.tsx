import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

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
  ],
  issues: [],
};

function stub(compare: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/compare')) return new Response(JSON.stringify(compare));
    return new Response(JSON.stringify(REFS));
  }));
}

beforeEach(() => vi.unstubAllGlobals());

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
});
