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

const METADATA = {
  env: [
    {
      key: 'POOL_QUESTIONS_MODE',
      label: 'Pool questions',
      description: 'Mine discovery questions from the intent pool.',
      kind: 'enum',
      values: ['off', 'on'],
      defaultDescription: 'off',
    },
    {
      key: 'NEGOTIATION_MAX_TURNS_CHAT',
      label: 'Chat turn cap',
      description: 'Maximum negotiation turns in chat mode.',
      kind: 'integer',
      defaultDescription: 'server default',
    },
  ],
  models: [
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', blurb: 'fast and inexpensive' },
    { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', blurb: 'stronger reasoning' },
  ],
  harnessAgents: {
    matching: [
      { id: 'opportunityEvaluator', label: 'Evaluator', role: 'Decides accept or reject for each candidate pair.' },
    ],
    premise: [
      { id: 'premiseDecomposer', label: 'Premise decomposer', role: 'Breaks a request into candidate premises.' },
      { id: 'premiseAnalyzer', label: 'Premise analyzer', role: 'Scores each candidate premise.' },
    ],
  },
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
let postedRuns: unknown[] = [];
let postedConfigs: unknown[] = [];
let runCounter = 0;

const stubFetch = ({ withMetadata = true }: { withMetadata?: boolean } = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
    if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
    if (String(url).endsWith('/api/configs/models')) return new Response(JSON.stringify(CONFIG_MODELS));
    if (String(url).endsWith('/api/configs/metadata')) {
      return withMetadata ? new Response(JSON.stringify(METADATA)) : new Response(JSON.stringify({}));
    }
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
  });

beforeEach(() => {
  launched = null;
  postedRuns = [];
  postedConfigs = [];
  runCounter = 0;
  vi.stubGlobal('fetch', stubFetch());
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

/** The runner knobs live behind a collapsed disclosure; jsdom lets us open it directly. */
const openAdvancedOptions = () => {
  const summary = screen.getByText(/advanced options/i);
  const details = summary.closest('details');
  expect(details).not.toBeNull();
  details!.open = true;
  return details!;
};

const openEnvFlags = (scope: HTMLElement | typeof screen = screen) => {
  const queries = 'getByText' in scope ? (scope as typeof screen) : within(scope as HTMLElement);
  const summary = queries.getByText(/live-pipeline flags/i);
  const details = summary.closest('details');
  expect(details).not.toBeNull();
  details!.open = true;
  return details!;
};

describe('Launch', () => {
  it('offers only the flags the selected harness supports', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    openAdvancedOptions();
    await userEvent.selectOptions(screen.getByLabelText(/harness/i), 'premise');
    expect(screen.queryByLabelText(/tier filter/i)).toBeNull();
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
    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
    expect(await screen.findByText(/1 case \(filtered\) × 3 runs = 3/)).toBeInTheDocument();
  });

  it('explains a selection value beginning with "-" and refuses to launch it', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/case filter/i), '-foo');

    expect(screen.getByLabelText(/case filter/i)).toHaveValue('-foo');
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
    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/flags\.tier: too big/);
    expect(screen.getByLabelText(/tier filter/i)).toHaveValue(2);
  });

  it('warns that a non-default profile produces an experimental run', async () => {
    renderLaunch();
    await screen.findByLabelText(/profile/i);
    await userEvent.selectOptions(screen.getByLabelText(/profile/i), 'claude-evaluator');
    expect(await screen.findByText(/experimental/i)).toBeInTheDocument();
  });

  it('scopes model overrides to the agents the harness exercises', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    // matching exercises only the evaluator — no premise agents on offer.
    expect(await screen.findByLabelText('model for Evaluator')).toBeInTheDocument();
    expect(screen.queryByLabelText('model for Premise decomposer')).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText(/harness/i), 'premise');
    expect(await screen.findByLabelText('model for Premise decomposer')).toBeInTheDocument();
    expect(screen.getByLabelText('model for Premise analyzer')).toBeInTheDocument();
    expect(screen.queryByLabelText('model for Evaluator')).toBeNull();
  });

  it('keeps the runner knobs behind advanced options, explained in plain English', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    const details = screen.getByText(/advanced options/i).closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');

    openAdvancedOptions();
    expect(
      await screen.findByText(/How many times every case is executed; 3 lets flaky behavior show up/i),
    ).toBeInTheDocument();
  });

  it('keeps live-pipeline flags behind a disclosure with the honesty note', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    const details = screen.getByText(/live-pipeline flags/i).closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');

    openEnvFlags();
    expect(
      await screen.findByText(/This scorecard harness does not read them/i),
    ).toBeInTheDocument();
  });

  it('hides the guided sections when configuration metadata is unavailable', async () => {
    vi.stubGlobal('fetch', stubFetch({ withMetadata: false }));
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    // No guided model rows, no env-flag disclosure — but the form still launches.
    expect(screen.queryByLabelText('model for Evaluator')).toBeNull();
    expect(screen.queryByText(/live-pipeline flags/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(await screen.findByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });

  it('blocks launch while an env override is invalid', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    openEnvFlags();
    await userEvent.click(screen.getByRole('button', { name: /add flag override/i }));
    await userEvent.selectOptions(screen.getByLabelText('flag 1'), 'NEGOTIATION_MAX_TURNS_CHAT');
    await userEvent.type(screen.getByLabelText('value 1'), 'lots');

    expect(await screen.findByText(/must be an integer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('value 1'));
    await userEvent.type(screen.getByLabelText('value 1'), '4');
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled();
  });

  it('submits ad-hoc model and env overrides with profile default', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.selectOptions(
      await screen.findByLabelText('model for Evaluator'),
      'anthropic/claude-sonnet-4',
    );
    openEnvFlags();
    await userEvent.click(screen.getByRole('button', { name: /add flag override/i }));
    await userEvent.selectOptions(screen.getByLabelText('flag 1'), 'POOL_QUESTIONS_MODE');
    await userEvent.selectOptions(screen.getByLabelText('value 1'), 'on');

    // Narrow the corpus so no full-corpus confirmation stands in the way.
    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(1));
    const spec = postedRuns[0] as {
      profile: string;
      overrides?: { models: Record<string, string>; env: Record<string, string> };
    };
    expect(spec.profile).toBe('default');
    expect(spec.overrides?.models).toEqual({ opportunityEvaluator: 'anthropic/claude-sonnet-4' });
    expect(spec.overrides?.env).toEqual({ POOL_QUESTIONS_MODE: 'on' });
  });

  it('omits the overrides key entirely when nothing is overridden', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(1));
    expect(Object.keys(postedRuns[0] as object).sort()).toEqual(['flags', 'harness', 'kind', 'profile']);
  });

  it('saves the current overrides as a named config', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.selectOptions(
      await screen.findByLabelText('model for Evaluator'),
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
    const candidate = await screen.findByRole('group', { name: 'candidate' });
    await userEvent.selectOptions(
      within(candidate).getByLabelText('model for Evaluator'),
      'anthropic/claude-sonnet-4',
    );
    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
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

  it('A/B mode lets each side pick its own profile independently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
        if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
        if (String(url).endsWith('/api/configs/models')) return new Response(JSON.stringify(CONFIG_MODELS));
        if (String(url).endsWith('/api/configs/metadata')) return new Response(JSON.stringify(METADATA));
        if (String(url).endsWith('/api/configs')) {
          return new Response(
            JSON.stringify({
              repo: PROFILES.profiles,
              saved: [
                {
                  name: 'sonnet-evaluator',
                  description: 'evaluator on sonnet',
                  models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
                  env: {},
                },
              ],
            }),
          );
        }
        if (String(url).endsWith('/api/runs') && init?.method === 'POST') {
          postedRuns.push(JSON.parse(String(init.body)));
          runCounter += 1;
          return new Response(JSON.stringify({ id: `run-${runCounter}` }), { status: 202 });
        }
        return new Response(JSON.stringify({}));
      }),
    );

    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByLabelText(/a\/b/i));

    const reference = await screen.findByRole('group', { name: 'reference' });
    const candidate = screen.getByRole('group', { name: 'candidate' });
    await userEvent.selectOptions(within(reference).getByLabelText('profile'), 'claude-evaluator');
    await userEvent.selectOptions(within(candidate).getByLabelText('profile'), 'sonnet-evaluator');

    // A named profile leaves no model editor on that side.
    expect(within(reference).queryByLabelText('model for Evaluator')).toBeNull();
    expect(within(reference).getByText(/edit it on the configs page/i)).toBeInTheDocument();
    expect(within(candidate).queryByLabelText('model for Evaluator')).toBeNull();

    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(2));
    expect((postedRuns[0] as { profile: string }).profile).toBe('claude-evaluator');
    expect((postedRuns[1] as { profile: string }).profile).toBe('sonnet-evaluator');
    for (const spec of postedRuns as { overrides?: unknown }[]) {
      expect('overrides' in spec).toBe(false);
    }
    // Shared flags still apply to both sides.
    for (const spec of postedRuns as { flags: { tier?: number } }[]) {
      expect(spec.flags.tier).toBe(2);
    }
  });

  it('A/B posts overrides only on the side whose profile is default', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByLabelText(/a\/b/i));

    const reference = await screen.findByRole('group', { name: 'reference' });
    const candidate = screen.getByRole('group', { name: 'candidate' });
    await userEvent.selectOptions(within(reference).getByLabelText('profile'), 'claude-evaluator');
    await userEvent.selectOptions(
      within(candidate).getByLabelText('model for Evaluator'),
      'anthropic/claude-sonnet-4',
    );

    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(2));
    const referenceSpec = postedRuns[0] as { profile: string; overrides?: unknown };
    const candidateSpec = postedRuns[1] as { profile: string; overrides?: { models: Record<string, string> } };
    expect(referenceSpec.profile).toBe('claude-evaluator');
    expect('overrides' in referenceSpec).toBe(false);
    expect(candidateSpec.profile).toBe('default');
    expect(candidateSpec.overrides?.models).toEqual({ opportunityEvaluator: 'anthropic/claude-sonnet-4' });
  });

  it('A/B mode defaults both sides to the same profile and shares flags', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByLabelText(/a\/b/i));
    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(2));
    for (const spec of postedRuns as { profile: string; flags: { tier?: number } }[]) {
      expect(spec.profile).toBe('default');
      expect(spec.flags.tier).toBe(2);
    }
  });

  it('A/B gives each side its own env-flag disclosure', async () => {
    renderLaunch();
    await screen.findByLabelText(/harness/i);
    await userEvent.click(screen.getByLabelText(/a\/b/i));
    const candidate = await screen.findByRole('group', { name: 'candidate' });

    openEnvFlags(candidate);
    await userEvent.click(within(candidate).getByRole('button', { name: /add flag override/i }));
    await userEvent.selectOptions(within(candidate).getByLabelText('flag 1'), 'POOL_QUESTIONS_MODE');
    await userEvent.selectOptions(within(candidate).getByLabelText('value 1'), 'on');

    openAdvancedOptions();
    await userEvent.type(screen.getByLabelText(/tier filter/i), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await vi.waitFor(() => expect(postedRuns).toHaveLength(2));
    const referenceSpec = postedRuns[0] as { overrides?: { env?: Record<string, string> } };
    const candidateSpec = postedRuns[1] as { overrides?: { env?: Record<string, string> } };
    expect('overrides' in referenceSpec).toBe(false);
    expect(candidateSpec.overrides?.env).toEqual({ POOL_QUESTIONS_MODE: 'on' });
  });

  it('disables overrides when a named profile is selected and points to configs', async () => {
    renderLaunch();
    await screen.findByLabelText(/profile/i);
    await userEvent.selectOptions(screen.getByLabelText(/profile/i), 'claude-evaluator');

    expect(screen.queryByLabelText('model for Evaluator')).toBeNull();
    expect(screen.queryByText(/live-pipeline flags/i)).toBeNull();
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
