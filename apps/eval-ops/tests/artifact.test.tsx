import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { ArtifactView } from '../src/routes/ArtifactView';
import { encodeArtifactId } from '../src/api/client';

const BASELINE_PATH = 'matching/baselines/matching.baseline.json';
const BASELINE_ID = encodeArtifactId(BASELINE_PATH);

const BASELINE = {
  artifactType: 'index-eval/baseline',
  schemaVersion: 1,
  harness: 'matching',
  harnessVersion: '1',
  createdAt: '2026-05-29T18:05:23.210Z',
  models: ['google/gemini-2.5-flash'],
  runs: 7,
  selection: { fullCorpus: true, filters: {} },
  corpusFingerprint: 'corpus-fingerprint-aaa',
  configFingerprint: 'config-fingerprint-bbb',
  git: { revision: 'abc1234', dirty: false },
  payload: {
    aggregatePassRate: 0.989,
    cases: [
      {
        caseId: 'valency_role/seeker-gets-patient',
        rule: 'valency_role',
        runs: 3,
        passes: 3,
        passRate: 1,
        flaky: false,
      },
      {
        caseId: 'location/known-city',
        rule: 'location',
        runs: 3,
        passes: 2,
        passRate: 0.667,
        flaky: true,
      },
    ],
  },
};

function stubArtifact(artifact: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      status === 200
        ? new Response(JSON.stringify(artifact))
        : new Response(JSON.stringify({ error: 'Artifact not found' }), { status }),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderArtifact(id = BASELINE_ID) {
  return render(
    <MemoryRouter initialEntries={[`/a/${id}`]}>
      <Routes>
        <Route path="/a/:artifactId" element={<ArtifactView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ArtifactView', () => {
  beforeEach(() => stubArtifact(BASELINE));

  it('renders the scorecard for an artifact that has no run record', async () => {
    renderArtifact();

    expect(await screen.findByText('98.9%')).toBeInTheDocument();
    expect(screen.getByText('valency_role/seeker-gets-patient')).toBeInTheDocument();
    expect(screen.getByText('location/known-city')).toBeInTheDocument();
  });

  it('shows the artifact provenance', async () => {
    renderArtifact();

    expect(await screen.findByText('google/gemini-2.5-flash')).toBeInTheDocument();
    expect(screen.getByText('corpus-fingerprint-aaa')).toBeInTheDocument();
    expect(screen.getByText('config-fingerprint-bbb')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('full corpus')).toBeInTheDocument();
  });

  it('fetches by the artifact id from the route', async () => {
    renderArtifact();
    await screen.findByText('98.9%');

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(`/api/artifacts/${BASELINE_ID}`, undefined);
  });

  it('offers a compare affordance rather than inventing a diff view', async () => {
    renderArtifact();

    const link = await screen.findByRole('link', { name: 'compare' });
    expect(link).toHaveAttribute(
      'href',
      `/compare?subject=${encodeURIComponent(BASELINE_ID)}`,
    );
  });

  it('has no live-log, cancel, or run-status affordance', async () => {
    renderArtifact();
    await screen.findByText('98.9%');

    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    expect(screen.queryByText(/^exit /)).toBeNull();
  });
});

describe('ArtifactView errors', () => {
  it('reports a missing artifact instead of loading forever', async () => {
    stubArtifact(null, 404);
    renderArtifact('bogus');

    expect(await screen.findByText(/Artifact not found/)).toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
