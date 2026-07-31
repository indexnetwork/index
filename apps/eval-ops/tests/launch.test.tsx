import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

import { Launch } from '../src/routes/Launch';

const HARNESSES = {
  harnesses: [
    {
      harness: 'matching',
      script: 'eval:matching',
      caseCount: 40,
      defaultRuns: 3,
      flags: [
        { name: 'runs', cli: '--runs', kind: 'number' },
        { name: 'tier', cli: '--tier', kind: 'number' },
        { name: 'noJudge', cli: '--no-judge', kind: 'boolean' },
      ],
    },
    {
      harness: 'premise',
      script: 'eval:premise',
      caseCount: 12,
      defaultRuns: 3,
      flags: [{ name: 'runs', cli: '--runs', kind: 'number' }],
    },
  ],
};

const PROFILES = {
  profiles: [
    { name: 'default', description: 'no overrides', models: {}, env: {} },
    {
      name: 'claude-evaluator',
      description: 'claude',
      models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
      env: {},
    },
  ],
};

let launched: unknown = null;

beforeEach(() => {
  launched = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
      if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
      if (String(url).endsWith('/api/runs') && init?.method === 'POST') {
        launched = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ id: 'run-1' }), { status: 202 });
      }
      return new Response(JSON.stringify({}));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderLaunch = () => render(
  <BrowserRouter>
    <Launch />
  </BrowserRouter>,
);

describe('Launch', () => {
  it('offers only the flags the selected harness supports', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.selectOptions(screen.getByLabelText(/harness/i), 'premise');
    expect(screen.queryByLabelText(/tier/i)).toBeNull();
  });

  it('shows the computed workload before launching', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    expect(await screen.findByText(/40 cases × 3 runs = 120/)).toBeInTheDocument();
  });

  it('requires confirmation for a full-corpus run', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(await screen.findByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(launched).toBeNull();
  });

  it('posts only harness, profile and flags — never env or argv', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    await userEvent.click(await screen.findByRole('button', { name: /confirm/i }));

    expect(Object.keys(launched as object).sort()).toEqual(['flags', 'harness', 'kind', 'profile']);
  });

  it('warns that a non-default profile produces an experimental run', async () => {
    renderLaunch();
    await screen.findByLabelText(/profile/i);
    await userEvent.selectOptions(screen.getByLabelText(/profile/i), 'claude-evaluator');
    expect(await screen.findByText(/experimental/i)).toBeInTheDocument();
  });
});
