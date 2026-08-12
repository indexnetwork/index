import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { Harness } from '../src/routes/Harness';
import { encodeArtifactId } from '../src/api/client';
import type { HarnessDescriptor } from '../src/api/client';
import { COMPLETE_HISTORICAL_QUALITY_ARTIFACT, INCOMPLETE_HISTORICAL_QUALITY_ARTIFACT, historicalQualityRef } from './historical-quality.fixture';

const BASELINE_PATH = 'matching/baselines/matching.baseline.json';
const RUN_PATH = 'matching/runs/2026-07-30.json';

const ARTIFACTS = {
  refs: [
    {
      id: encodeArtifactId(BASELINE_PATH),
      harness: 'matching',
      kind: 'baseline',
      path: BASELINE_PATH,
      schemaVersion: 1,
      createdAt: '2026-05-29T18:05:23.210Z',
      models: ['google/gemini-2.5-flash'],
      runs: 7,
      selection: { fullCorpus: true, filters: {} },
      git: { revision: 'unknown', dirty: null },
      corpusFingerprint: 'corpus-a',
      configFingerprint: 'config-a',
      aggregatePassRate: 0.989,
      caseCount: 40,
      complete: null,
      sizeBytes: 1024,
      mtimeMs: 1,
    },
    {
      id: encodeArtifactId(RUN_PATH),
      harness: 'matching',
      kind: 'run',
      path: RUN_PATH,
      schemaVersion: 2,
      createdAt: '2026-07-30T10:00:00.000Z',
      models: ['google/gemini-2.5-flash'],
      runs: 3,
      selection: { fullCorpus: true, filters: {} },
      git: { revision: 'abc1234', dirty: false },
      corpusFingerprint: 'corpus-a',
      configFingerprint: 'config-a',
      aggregatePassRate: 0.971,
      caseCount: 40,
      complete: true,
      sizeBytes: 2048,
      mtimeMs: 2,
    },
    {
      id: encodeArtifactId('premise/baselines/premise.baseline.json'),
      harness: 'premise',
      kind: 'baseline',
      path: 'premise/baselines/premise.baseline.json',
      schemaVersion: 1,
      createdAt: '2026-05-01T00:00:00.000Z',
      models: ['google/gemini-2.5-flash'],
      runs: 3,
      selection: { fullCorpus: true, filters: {} },
      git: { revision: 'unknown', dirty: null },
      corpusFingerprint: 'corpus-b',
      configFingerprint: 'config-b',
      aggregatePassRate: 1,
      caseCount: 12,
      complete: null,
      sizeBytes: 512,
      mtimeMs: 3,
    },
  ],
  issues: [
    { path: 'matching/runs/broken.json', message: 'not valid JSON' },
    { path: 'premise/runs/other.json', message: 'unrelated harness issue' },
  ],
};

// Typed against the real descriptor so registry drift fails tsc, not just runtime.
const HARNESSES: { harnesses: HarnessDescriptor[] } = {
  harnesses: [
    {
      harness: 'matching',
      script: 'eval:matching',
      flags: [],
      defaultRuns: 3,
      caseCount: 40,
      question: 'Does the evaluator pick the right matches?',
      detail: 'Each case scores accept/reject decisions against a known baseline.',
      agents: ['opportunityEvaluator'],
    },
  ],
};

beforeEach(() => {
  // URL-aware stub: artifacts and harness descriptors are different endpoints.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const href = String(url);
      if (href.endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
      return new Response(JSON.stringify(ARTIFACTS));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHarness(harness = 'matching') {
  return render(
    <MemoryRouter initialEntries={[`/h/${harness}`]}>
      <Routes>
        <Route path="/h/:harness" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Harness', () => {
  it('lists only the artifacts of the selected harness, newest first', async () => {
    renderHarness();

    expect(await screen.findByText(RUN_PATH)).toBeInTheDocument();
    expect(screen.getByText(BASELINE_PATH)).toBeInTheDocument();
    expect(
      screen.queryByText('premise/baselines/premise.baseline.json'),
    ).toBeNull();

    const links = screen.getAllByRole('link', { name: /matching\// });
    expect(links.map((link) => link.textContent)).toEqual([RUN_PATH, BASELINE_PATH]);
  });

  it('renders the plain-English harness description from the registry', async () => {
    renderHarness();

    expect(await screen.findByText(/Does the evaluator pick the right matches\?/)).toBeInTheDocument();
    expect(screen.getByText(/Each case scores accept\/reject decisions/)).toBeInTheDocument();
  });

  it('links every artifact to the artifact route, not the run route', async () => {
    renderHarness();

    const baselineLink = await screen.findByRole('link', { name: BASELINE_PATH });
    expect(baselineLink).toHaveAttribute(
      'href',
      `/a/${encodeArtifactId(BASELINE_PATH)}`,
    );

    // A committed baseline has no run record, so /r/:runId would 404 the stream
    // and hang the page. Every artifact link must address the artifact.
    for (const link of screen.getAllByRole('link', { name: /matching\// })) {
      expect(link.getAttribute('href')).toMatch(/^\/a\//);
    }
  });

  it('shows the pass rate and kind of each artifact', async () => {
    renderHarness();

    expect(await screen.findByText('98.9%')).toBeInTheDocument();
    expect(screen.getByText('97.1%')).toBeInTheDocument();
    expect(screen.getByText('baseline')).toBeInTheDocument();
    expect(screen.getByText('run')).toBeInTheDocument();
  });

  it('shows a quality artifact as completed/requested instead of a pass-rate score', async () => {
    const qualityRef = historicalQualityRef(INCOMPLETE_HISTORICAL_QUALITY_ARTIFACT, 'quality');
    const completeQualityRef = historicalQualityRef(COMPLETE_HISTORICAL_QUALITY_ARTIFACT, 'quality-complete');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href.endsWith('/api/harnesses')) {
          return new Response(JSON.stringify({
            harnesses: [{
              harness: 'discovery',
              script: 'eval:discovery',
              flags: [],
              defaultRuns: 1,
              caseCount: 5,
              question: 'Does discovery return useful candidates?',
              detail: 'detail',
              agents: [],
            }],
          }));
        }
        return new Response(JSON.stringify({ refs: [qualityRef, completeQualityRef], issues: [] }));
      }),
    );

    renderHarness('discovery');

    expect(await screen.findByText('29/30')).toBeInTheDocument();
    expect(screen.getByText('30/30')).toBeInTheDocument();
    expect(screen.getAllByText(/completed\/requested/i)).toHaveLength(2);
    expect(document.body.textContent).not.toContain('90.0%');
    expect(document.body.textContent).not.toMatch(/baseline delta|regression|winner/i);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/artifacts/quality');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/artifacts/quality-complete');
  });

  it('surfaces index issues for this harness and hides unrelated ones', async () => {
    renderHarness();

    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
    expect(screen.queryByText(/unrelated harness issue/)).toBeNull();
  });

  it('reports an empty harness rather than rendering nothing', async () => {
    renderHarness('opportunity');

    expect(await screen.findByText(/No artifacts yet/i)).toBeInTheDocument();
  });
});
