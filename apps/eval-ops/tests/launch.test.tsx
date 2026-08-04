import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
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
  flags: [
    { name: 'runs', label: 'Runs per case', description: 'How many times every case is executed.', scope: 'selection', defaultLabel: '3' },
    { name: 'case', label: 'Case', description: 'Run only cases whose id contains this text.', scope: 'selection', defaultLabel: 'all cases' },
    { name: 'tier', label: 'Tier', description: 'Run only one difficulty tier.', scope: 'selection', defaultLabel: 'all tiers' },
    { name: 'noJudge', label: 'LLM judge', description: 'The judge runs reasoning checks.', scope: 'scoring', defaultLabel: 'on' },
  ],
};

const PROFILES = {
  profiles: [
    { name: 'default', description: 'no overrides', models: { opportunityEvaluator: 'google/gemini-2.5-flash' }, env: {} },
    {
      name: 'claude-evaluator',
      description: 'claude',
      models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
      env: {},
    },
  ],
};

let postedRuns: unknown[] = [];
let postedConfigs: unknown[] = [];
let runCounter = 0;

const stubFetch = ({ withMetadata = true }: { withMetadata?: boolean } = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
    if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
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
      postedRuns.push(body);
      runCounter += 1;
      return new Response(JSON.stringify({ id: `run-${runCounter}` }), { status: 202 });
    }
    return new Response(JSON.stringify({}));
  });

beforeEach(() => {
  postedRuns = [];
  postedConfigs = [];
  runCounter = 0;
  vi.stubGlobal('fetch', stubFetch());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderLaunch = () =>
  render(
    <BrowserRouter>
      <Launch />
    </BrowserRouter>,
  );

/** Full-corpus runs ask for confirmation first; this completes that handshake. */
const runAndConfirm = async (user: ReturnType<typeof userEvent.setup>, label: RegExp) => {
  await user.click(await screen.findByRole('button', { name: label }));
  await user.click(await screen.findByRole('button', { name: /confirm and run/i }));
};

describe('Launch', () => {
  it('shows the harness it will run and its agents, with nothing collapsed', async () => {
    renderLaunch();

    // The model that decides this harness's results is on screen immediately.
    expect(await screen.findByLabelText(/evaluator/i)).toBeTruthy();
    expect(screen.getByText(/decides accept or reject/i)).toBeTruthy();
    // No disclosure widgets at all: the page is flat.
    expect(document.querySelectorAll('details')).toHaveLength(0);
  });

  it('shows only the agents the selected harness exercises', async () => {
    const user = userEvent.setup();
    renderLaunch();

    expect(await screen.findByLabelText(/evaluator/i)).toBeTruthy();
    expect(screen.queryByLabelText(/premise decomposer/i)).toBeNull();

    await user.selectOptions(screen.getByLabelText('Harness'), 'premise');

    expect(await screen.findByLabelText(/premise decomposer/i)).toBeTruthy();
    expect(screen.getByLabelText(/premise analyzer/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^evaluator$/i)).toBeNull();
  });

  it('shows what gets tested directly, without an advanced disclosure', async () => {
    renderLaunch();

    expect(await screen.findByLabelText('Runs per case')).toBeTruthy();
    expect(screen.getByLabelText('Case')).toBeTruthy();
    expect(screen.getByLabelText('Tier')).toBeTruthy();
    expect(screen.getByText(/what gets tested/i)).toBeTruthy();
  });

  it('never offers live-pipeline env flags: they do not affect these harnesses', async () => {
    renderLaunch();
    await screen.findByLabelText(/evaluator/i);

    expect(screen.queryByText(/live-pipeline/i)).toBeNull();
    expect(screen.queryByText(/POOL_QUESTIONS_MODE/)).toBeNull();
    expect(screen.queryByText(/pool questions/i)).toBeNull();
  });

  it('offers only the flags the selected harness supports', async () => {
    const user = userEvent.setup();
    renderLaunch();

    expect(await screen.findByLabelText('Tier')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Harness'), 'premise');

    // premise declares runs only: tier and the judge toggle must disappear.
    expect(await screen.findByLabelText('Runs per case')).toBeTruthy();
    expect(screen.queryByLabelText('Tier')).toBeNull();
    expect(screen.queryByLabelText(/llm judge/i)).toBeNull();
  });

  it('launches with the selected model override and the shared selection flags', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.selectOptions(await screen.findByLabelText(/evaluator/i), 'anthropic/claude-sonnet-4');
    await user.clear(screen.getByLabelText('Runs per case'));
    await user.type(screen.getByLabelText('Runs per case'), '5');
    await runAndConfirm(user, /^run$/i);

    expect(postedRuns).toHaveLength(1);
    expect(postedRuns[0]).toEqual({
      kind: 'eval',
      harness: 'matching',
      profile: 'default',
      flags: { runs: 5 },
      overrides: { models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' }, env: {} },
    });
  });

  it('puts the two A/B configurations side by side and shares what gets tested', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.click(await screen.findByRole('checkbox', { name: 'A/B' }));

    const headingA = await screen.findByText(/A · reference/);
    const headingB = screen.getByText(/B · candidate/);
    // Side by side, not stacked: both columns are cells of one 2-column grid.
    const grid = headingA.parentElement!.parentElement!;
    expect(grid.className).toMatch(/grid-cols-2/);
    expect(grid).toBe(headingB.parentElement!.parentElement!);
    // One shared selection control, not one per side.
    expect(screen.getAllByLabelText('Runs per case')).toHaveLength(1);
    expect(screen.getByText(/shared by both sides/i)).toBeTruthy();
    // Each side carries its own model choice.
    expect(screen.getAllByLabelText(/evaluator/i)).toHaveLength(2);
  });

  it('launches both A/B sides with shared selection and per-side models', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.click(await screen.findByRole('checkbox', { name: 'A/B' }));
    const evaluators = await screen.findAllByLabelText(/evaluator/i);
    await user.selectOptions(evaluators[1]!, 'anthropic/claude-sonnet-4');
    await user.clear(screen.getByLabelText('Runs per case'));
    await user.type(screen.getByLabelText('Runs per case'), '2');
    await runAndConfirm(user, /run a\/b/i);

    expect(postedRuns).toHaveLength(2);
    expect(postedRuns[0]).toEqual({
      kind: 'eval',
      harness: 'matching',
      profile: 'default',
      flags: { runs: 2 },
    });
    expect(postedRuns[1]).toEqual({
      kind: 'eval',
      harness: 'matching',
      profile: 'default',
      flags: { runs: 2 },
      overrides: { models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' }, env: {} },
    });
  });

  it('says so when the two sides score differently, because the results are not like-for-like', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.click(await screen.findByRole('checkbox', { name: 'A/B' }));
    const judges = await screen.findAllByLabelText(/llm judge/i);
    expect(judges).toHaveLength(2);
    expect(screen.queryByText(/not like-for-like/i)).toBeNull();

    await user.click(judges[1]!);

    expect(screen.getByText(/not like-for-like/i)).toBeTruthy();
  });

  it('counts both sides in the workload', async () => {
    const user = userEvent.setup();
    renderLaunch();

    expect(await screen.findByText(/40 cases × 3 runs = 120/)).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'A/B' }));

    expect(screen.getByText(/40 cases × 3 runs × 2 sides = 240/)).toBeTruthy();
  });

  it('explains a selection value beginning with "-" and refuses to launch it', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.type(await screen.findByLabelText('Case'), '--force');

    expect(screen.getByText(/fix --case before running/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled();
  });

  it('keeps the entered values and explains a refused launch inline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
        if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
        if (String(url).endsWith('/api/configs/metadata')) return new Response(JSON.stringify(METADATA));
        if (String(url).endsWith('/api/configs')) return new Response(JSON.stringify({ repo: PROFILES.profiles, saved: [] }));
        if (String(url).endsWith('/api/runs') && init?.method === 'POST') {
          return new Response(JSON.stringify({ error: 'queue is full' }), { status: 429 });
        }
        return new Response(JSON.stringify({}));
      }),
    );
    const user = userEvent.setup();
    renderLaunch();

    await user.clear(await screen.findByLabelText('Runs per case'));
    await user.type(screen.getByLabelText('Runs per case'), '7');
    await runAndConfirm(user, /^run$/i);

    expect(await screen.findByRole('alert')).toHaveTextContent(/launch refused/i);
    expect(screen.getByLabelText('Runs per case')).toHaveValue(7);
  });

  it('hides model overrides for a saved config and points at the configs page', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.selectOptions(await screen.findByLabelText('Config'), 'claude-evaluator');

    expect(screen.queryByLabelText(/evaluator model/i)).toBeNull();
    expect(screen.getByRole('link', { name: /edit this config/i })).toBeTruthy();
  });

  it('saves the chosen models as a named config', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.selectOptions(await screen.findByLabelText(/evaluator/i), 'anthropic/claude-sonnet-4');
    await user.click(screen.getByRole('button', { name: /save as config/i }));
    await user.type(screen.getByLabelText('config name'), 'claude-eval');
    await user.type(screen.getByLabelText('config description'), 'evaluator on claude');
    await user.click(screen.getByRole('button', { name: /^save config$/i }));

    expect(postedConfigs).toEqual([
      {
        name: 'claude-eval',
        description: 'evaluator on claude',
        models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
        env: {},
      },
    ]);
  });

  it('still launches when the metadata endpoint is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetch({ withMetadata: false }));
    const user = userEvent.setup();
    renderLaunch();

    // Falls back to the CLI spelling rather than rendering an empty form.
    const runs = await screen.findByLabelText('--runs');
    await user.clear(runs);
    await user.type(runs, '1');
    await runAndConfirm(user, /^run$/i);

    expect(postedRuns).toEqual([
      { kind: 'eval', harness: 'matching', profile: 'default', flags: { runs: 1 } },
    ]);
  });

  it('narrows the workload when a selection flag filters the corpus', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.type(await screen.findByLabelText('Case'), 'is_a_identity');

    expect(screen.getByText(/1 case \(filtered\) × 3 runs = 3/)).toBeTruthy();
  });

  it('scopes A/B scoring controls to their own side', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.click(await screen.findByRole('checkbox', { name: 'A/B' }));
    const columns = screen.getAllByText(/· (reference|candidate)/).map((el) => el.parentElement!);
    const judgeA = within(columns[0]!).getByLabelText(/llm judge/i);
    const judgeB = within(columns[1]!).getByLabelText(/llm judge/i);

    await user.click(judgeA);

    expect(judgeA).toBeChecked();
    expect(judgeB).not.toBeChecked();
  });
});
