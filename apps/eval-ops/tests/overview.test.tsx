import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router';

import { Overview } from '../src/routes/Overview';
import { INCOMPLETE_HISTORICAL_QUALITY_ARTIFACT, historicalQualityRef } from './historical-quality.fixture';

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

  /**
   * A sides harness has no baseline by design and no aggregate that scores it:
   * its run report's `aggregatePassRate` is the mean over two DIFFERENT
   * configurations. Both cells are omitted rather than filled with "—" and a
   * number about neither side.
   */
  it('gives a sides harness no baseline cell and no aggregate to read as its score', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/api/harnesses'))
          return new Response(
            JSON.stringify({
              harnesses: [
                { harness: 'discovery', script: 'eval:discovery', caseCount: 5, defaultRuns: 1, flags: [] },
              ],
            }),
          );
        if (String(url).endsWith('/api/artifacts'))
          return new Response(
            JSON.stringify({
              refs: [
                {
                  id: 'ab',
                  harness: 'discovery',
                  kind: 'run',
                  aggregatePassRate: 1,
                  createdAt: '2026-08-04T18:19:06.257Z',
                  models: ['google/gemini-3-flash-preview'],
                  runs: 1,
                  caseCount: 2,
                  path: 'discovery/runs/2026-08-04T18-17-55-461Z.json',
                },
              ],
              issues: [],
            }),
          );
        if (String(url).endsWith('/api/runs'))
          return new Response(JSON.stringify({ runs: [], issues: [] }));
        if (String(url).endsWith('/api/fixture'))
          return new Response(JSON.stringify({ allowed: false, reason: 'not configured' }));
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    render(
      <BrowserRouter>
        <Overview />
      </BrowserRouter>,
    );

    expect(await screen.findByTestId('harness-sides-discovery')).toBeInTheDocument();
    expect(screen.queryByText('baseline:')).toBeNull();
    expect(screen.queryByText('latest:')).toBeNull();
    // 100.0% is the artifact's aggregate: the mean across both sides.
    expect(screen.queryByText(/100\.0%/)).toBeNull();
  });

  it('shows quality execution as completed/requested instead of a score or delta', async () => {
    const qualityRef = historicalQualityRef(INCOMPLETE_HISTORICAL_QUALITY_ARTIFACT, 'quality');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href.endsWith('/api/harnesses')) {
          return new Response(JSON.stringify({
            harnesses: [{
              harness: 'discovery',
              script: 'eval:discovery',
              caseCount: 5,
              defaultRuns: 1,
              flags: [],
              question: 'Does discovery return useful candidates?',
              detail: 'detail',
              agents: [],
            }],
          }));
        }
        if (href.endsWith('/api/artifacts')) {
          return new Response(JSON.stringify({ refs: [qualityRef], issues: [] }));
        }
        if (href.endsWith('/api/runs')) return new Response(JSON.stringify({ runs: [], issues: [] }));
        if (href.endsWith('/api/fixture')) return new Response(JSON.stringify({ allowed: false, reason: 'not configured' }));
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    render(
      <BrowserRouter>
        <Overview />
      </BrowserRouter>,
    );

    expect(await screen.findByText('29/30')).toBeInTheDocument();
    expect(screen.getByText(/completed\/requested/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('90.0%');
    expect(document.body.textContent).not.toMatch(/baseline delta|regression|winner/i);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/artifacts/quality');
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
