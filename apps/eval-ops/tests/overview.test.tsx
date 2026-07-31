import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router';

import { Overview } from '../src/routes/Overview';

const HARNESSES = {
  harnesses: [
    {
      harness: 'matching',
      script: 'eval:matching',
      caseCount: 40,
      defaultRuns: 3,
      flags: [],
    },
  ],
};
const ARTIFACTS = {
  refs: [
    {
      id: 'a',
      harness: 'matching',
      kind: 'baseline',
      aggregatePassRate: 0.989,
      createdAt: '2026-05-29T18:05:23.210Z',
      models: ['google/gemini-2.5-flash'],
      runs: 7,
      caseCount: 40,
      path: 'matching/baselines/matching.baseline.json',
    },
    {
      id: 'b',
      harness: 'matching',
      kind: 'run',
      aggregatePassRate: 0.971,
      createdAt: '2026-07-30T10:00:00.000Z',
      models: ['google/gemini-2.5-flash'],
      runs: 3,
      caseCount: 40,
      path: 'matching/runs/x.json',
    },
  ],
  issues: [{ path: 'matching/runs/broken.json', message: 'not valid JSON' }],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/harnesses'))
        return new Response(JSON.stringify(HARNESSES));
      if (String(url).endsWith('/api/artifacts'))
        return new Response(JSON.stringify(ARTIFACTS));
      if (String(url).endsWith('/api/runs'))
        return new Response(JSON.stringify({ runs: [], issues: [] }));
      if (String(url).endsWith('/api/fixture'))
        return new Response(
          JSON.stringify({
            allowed: true,
            target: { databaseName: 'neondb' },
            personaCount: 50,
          }),
        );
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Overview', () => {
  it('shows each harness with its baseline and latest run', async () => {
    render(
      <BrowserRouter>
        <Overview />
      </BrowserRouter>,
    );
    expect(await screen.findByText('matching')).toBeInTheDocument();
    expect(await screen.findByText(/98\.9%/)).toBeInTheDocument();
    expect(await screen.findByText(/97\.1%/)).toBeInTheDocument();
  });

  it('surfaces index issues instead of hiding them', async () => {
    render(
      <BrowserRouter>
        <Overview />
      </BrowserRouter>,
    );
    expect(await screen.findByText(/broken\.json/)).toBeInTheDocument();
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
  });

  it('shows the fixture database name and persona count', async () => {
    render(
      <BrowserRouter>
        <Overview />
      </BrowserRouter>,
    );
    expect(await screen.findByText(/neondb/)).toBeInTheDocument();
    expect(await screen.findByText(/50/)).toBeInTheDocument();
  });
});
