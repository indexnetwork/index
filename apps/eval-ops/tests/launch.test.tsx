import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter } from 'react-router';

import { Launch } from '../src/routes/Launch';

const HARNESSES = {
  harnesses: [
    {
      harness: 'matching',
      script: 'eval:matching',
      caseCount: 40,
      defaultRuns: 3,
      question: 'Should these two people be connected at all?',
      detail: 'Evaluates candidates.',
      agents: ['opportunityEvaluator'],
      flags: [
        { name: 'runs', cli: '--runs', kind: 'number', min: 1, max: 25, step: 1 },
        { name: 'case', cli: '--case', kind: 'string' },
        { name: 'tier', cli: '--tier', kind: 'number', min: 1, max: 4, step: 1 },
        { name: 'noJudge', cli: '--no-judge', kind: 'boolean' },
      ],
    },
    {
      harness: 'premise',
      script: 'eval:premise',
      caseCount: 12,
      defaultRuns: 3,
      question: 'Did we break an intent into correct atomic premises?',
      detail: 'Decomposes and classifies.',
      agents: ['premiseDecomposer', 'premiseAnalyzer'],
      flags: [{ name: 'runs', cli: '--runs', kind: 'number' }],
    },
  ],
};

const CONFIG_MODELS = { models: ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4'] };

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
let postedRuns: unknown[] = [];
let postedConfigs: unknown[] = [];
let runCounter = 0;

beforeEach(() => {
  launched = null;
  postedRuns = [];
  postedConfigs = [];
  runCounter = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
      if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
      if (String(url).endsWith('/api/configs/models')) return new Response(JSON.stringify(CONFIG_MODELS));
      if (String(url).endsWith('/api/configs') && init?.method === 'POST') {
        postedConfigs.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(JSON.parse(String(init.body))), { status: 201 });
      }
      if (String(url).endsWith('/api/configs')) {
        return new Response(JSON.stringify({ repo: PROFILES.profiles, saved: [] }));
      }
      if (String(url).endsWith('/api/runs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        launched = body;
        postedRuns.push(body);
        runCounter += 1;
        return new Response(JSON.stringify({ id: `run-${runCounter}` }), { status: 202 });
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

  it('shows the narrowed workload when a selection flag filters the corpus', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.type(screen.getByLabelText('--tier'), '2');
    expect(await screen.findByText(/1 case \(filtered\) × 3 runs = 3/)).toBeInTheDocument();
  });

  it('explains a selection value beginning with "-" and refuses to launch it', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.type(screen.getByLabelText('--case'), '-foo');

    expect(screen.getByLabelText('--case')).toHaveValue('-foo');
    expect(await screen.findByText(/--case values may not begin with/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('keeps the entered flags and explains a refused launch inline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
        if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
        if (String(url).endsWith('/api/runs') && init?.method === 'POST') {
          return new Response(JSON.stringify({ error: 'flags.tier: too big' }), { status: 400 });
        }
        return new Response(JSON.stringify({}));
      }),
    );

    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.type(screen.getByLabelText('--tier'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/flags\.tier: too big/);
    expect(screen.getByLabelText('--tier')).toHaveValue(2);
  });

  it('warns that a non-default profile produces an experimental run', async () => {
    renderLaunch();
    await screen.findByLabelText(/profile/i);
    await userEvent.selectOptions(screen.getByLabelText(/profile/i), 'claude-evaluator');
    expect(await screen.findByText(/experimental/i)).toBeInTheDocument();
  });

  it('submits ad-hoc overrides with profile default', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByText('overrides (this run only)'));
    await userEvent.selectOptions(
      await screen.findByLabelText('opportunityEvaluator'),
      'anthropic/claude-sonnet-4',
    );
    // Narrow the corpus so no full-corpus confirmation stands in the way.
    await userEvent.type(screen.getByLabelText('--tier'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(1));
    const spec = postedRuns[0] as { profile: string; overrides?: { models: Record<string, string> } };
    expect(spec.profile).toBe('default');
    expect(spec.overrides?.models).toEqual({ opportunityEvaluator: 'anthropic/claude-sonnet-4' });
  });

  it('omits the overrides key entirely when nothing is overridden', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.type(screen.getByLabelText('--tier'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(1));
    expect(Object.keys(postedRuns[0] as object).sort()).toEqual(['flags', 'harness', 'kind', 'profile']);
  });

  it('saves the current overrides as a named config', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByText('overrides (this run only)'));
    await userEvent.selectOptions(
      await screen.findByLabelText('opportunityEvaluator'),
      'anthropic/claude-sonnet-4',
    );
    await userEvent.click(screen.getByRole('button', { name: /save as config/i }));
    await userEvent.type(screen.getByLabelText(/config name/i), 'sonnet-evaluator');
    await userEvent.type(screen.getByLabelText(/config description/i), 'evaluator on sonnet');
    await userEvent.click(screen.getByRole('button', { name: 'Save config' }));

    await vi.waitFor(() => expect(postedConfigs).toHaveLength(1));
    expect(postedConfigs[0]).toEqual({
      name: 'sonnet-evaluator',
      description: 'evaluator on sonnet',
      models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
      env: {},
    });
    // The form switches to the freshly saved config.
    await vi.waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>(/profile/i).value).toBe('sonnet-evaluator'),
    );
  });

  it('A/B mode fires two launches and navigates to the pair URL', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByLabelText(/a\/b/i));
    await userEvent.click(screen.getByText('overrides (this run only)'));
    const candidate = await screen.findByRole('group', { name: 'candidate' });
    await userEvent.selectOptions(
      within(candidate).getByLabelText('opportunityEvaluator'),
      'anthropic/claude-sonnet-4',
    );
    await userEvent.type(screen.getByLabelText('--tier'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(2));
    const reference = postedRuns[0] as { overrides?: unknown };
    const candidateSpec = postedRuns[1] as { overrides?: { models: Record<string, string> } };
    expect('overrides' in reference).toBe(false);
    expect(candidateSpec.overrides?.models).toEqual({ opportunityEvaluator: 'anthropic/claude-sonnet-4' });
    await vi.waitFor(() =>
      expect(window.location.search).toBe('?referenceRun=run-1&subjectRun=run-2'),
    );
  });

  it('A/B mode defaults both sides to the same profile and shares flags', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByLabelText(/a\/b/i));
    await userEvent.type(screen.getByLabelText('--tier'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(2));
    for (const spec of postedRuns as { profile: string; flags: { tier?: number } }[]) {
      expect(spec.profile).toBe('default');
      expect(spec.flags.tier).toBe(2);
    }
  });

  it('disables overrides when a named profile is selected and points to configs', async () => {
    renderLaunch();
    await screen.findByLabelText(/profile/i);
    await userEvent.selectOptions(screen.getByLabelText(/profile/i), 'claude-evaluator');
    await userEvent.click(screen.getByText('overrides (this run only)'));

    expect(screen.queryByLabelText('opportunityEvaluator')).toBeNull();
    expect(await screen.findByText(/edit it on the configs page/i)).toBeInTheDocument();
  });
  it('preselects the profile named by the ?profile= search param', async () => {
    render(
      <MemoryRouter initialEntries={['/launch?profile=claude-evaluator']}>
        <Launch />
      </MemoryRouter>,
    );
    await screen.findByLabelText(/harness/i);
    expect(screen.getByLabelText(/profile/i)).toHaveValue('claude-evaluator');
  });
});
