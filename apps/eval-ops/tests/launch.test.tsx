import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

import { flagValueIssues } from '../../../packages/protocol/eval/ops/ops.flags';
import { HARNESS_REGISTRY } from '../../../packages/protocol/eval/ops/ops.registry';
import { HARNESS_ENV_KEYS } from '../../../packages/protocol/eval/ops/ops.envcatalog';
import { unreadEnvKeys } from '../../../packages/protocol/eval/ops/ops.envreach';
import { abSideIssues, sidesPerRun } from '../../../packages/protocol/eval/ops/ops.sides';
import { Launch } from '../src/routes/Launch';

// Flag bounds are the server's, verbatim from HARNESS_REGISTRY: `accepts` is
// what the API enforces and who holds each end, min/max/step is what the control
// offers. A fixture carrying only the control bounds would test a form the
// server does not feed — and would quietly change which sentence a refusal uses.
const RUNS_FLAG = {
  name: 'runs',
  cli: '--runs',
  kind: 'number',
  min: 1,
  max: 25,
  step: 1,
  accepts: { min: { value: 1, heldBy: 'harness' }, max: { value: 25, heldBy: 'site' } },
};

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
        RUNS_FLAG,
        { name: 'case', cli: '--case', kind: 'string' },
        {
          name: 'tier',
          cli: '--tier',
          kind: 'number',
          min: 1,
          max: 4,
          step: 1,
          accepts: { min: { value: 1, heldBy: 'harness' }, max: { value: 4, heldBy: 'harness' } },
        },
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
    {
      harness: 'discovery',
      script: 'eval:discovery',
      caseCount: 5,
      defaultRuns: 3,
      question: 'What pass rate does each of two discovery configurations reach on the same cases?',
      detail: 'Runs the real discovery graph once per operator-chosen environment configuration.',
      agents: [],
      // The confirmation quotes this rather than a sentence written into the
      // page, because the page branches on SUPPORTS_SIDES and not on a name.
      // Keyed by shape: a single run resets one branch, a comparison resets two,
      // and the confirmation is the last moment anyone can decline it.
      resets: {
        single: 'the Neon evaluation branch this configuration runs on',
        sides: 'both Neon evaluation branches',
      },
      flags: [
        {
          name: 'runs',
          cli: '--runs',
          kind: 'number',
          min: 1,
          max: 10,
          step: 1,
          accepts: { min: { value: 1, heldBy: 'harness' }, max: { value: 10, heldBy: 'harness' } },
        },
        { name: 'case', cli: '--case', kind: 'string' },
      ],
    },
  ],
};

// Env copy is the server's ENV_FLAG_METADATA. The three discovery keys here are
// verbatim (key, kind, values): the form validates through the same
// abSideIssues the server does, which resolves values against the real table,
// so a fixture that invented a kind would test a form nobody can launch from.
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
      key: 'DISCOVERY_PROFILE_SOURCE',
      label: 'Discovery profile source',
      description: 'Selects how profiles participate in matching.',
      kind: 'enum',
      values: ['premise', 'user_context'],
      defaultDescription: 'premise',
    },
    {
      key: 'DISCOVERY_CONTEXT_TO_INTENT',
      label: 'Context-to-intent discovery',
      description: 'Also match contexts against intents.',
      kind: 'enum',
      values: ['0', '1'],
      defaultDescription: '1',
    },
    {
      // In every harness's catalogue, discovery's and each scorecard's alike:
      // the model/provider keys are what a scorecard harness actually reads.
      key: 'CHAT_MODEL',
      label: 'Chat model',
      description: 'Model for the chat agent only.',
      kind: 'enum',
      values: ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4'],
      defaultDescription: 'google/gemini-3-pro-preview',
    },
    {
      // The key the per-agent model pickers ALSO write, which is why setting
      // both is refused rather than silently resolved.
      key: 'EVAL_MODEL_OVERRIDES',
      label: 'Per-agent model overrides',
      description: 'JSON object of agent id to model id.',
      kind: 'json-model-map',
      defaultDescription: 'no overrides',
    },
    {
      key: 'NEGOTIATION_MAX_TURNS_CHAT',
      label: 'Max negotiation turns (chat)',
      description: 'Turn cap for negotiations started from a chat conversation.',
      kind: 'integer',
      min: 1,
      defaultDescription: '4',
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
    // Empty on the server too: the two sides never differ in models.
    'discovery': [],
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

/**
 * The page as it behaves when every request but the launch succeeds. Used by the
 * tests that assert what the operator sees when the SERVER refuses — which is a
 * different thing from what the form refuses before posting anything.
 */
const stubFetchRefusingLaunch = (status: number, error: string) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
    if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
    if (String(url).endsWith('/api/configs/metadata')) return new Response(JSON.stringify(METADATA));
    if (String(url).endsWith('/api/configs')) {
      return new Response(JSON.stringify({ repo: PROFILES.profiles, saved: [] }));
    }
    if (String(url).endsWith('/api/runs') && init?.method === 'POST') {
      return new Response(JSON.stringify({ error }), { status });
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
  // A deep-link test navigates; every other test reads the harness from the form.
  window.history.pushState({}, '', '/launch');
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

/** Selects the harness whose run can compare two environment configurations. */
const selectDiscovery = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(await screen.findByLabelText('Harness'), 'discovery');
  return screen.findByRole('button', { name: /^add flag/ });
};

/** Turns on the form's A/B mode, which is what makes a run carry two sides. */
const enableAb = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('checkbox', { name: 'A/B' }));
};

/**
 * Picks a flag through the listbox, which replaced the native select.
 * Mouse-driven, as the site is: open the trigger, click the option.
 */
const pickFlag = async (
  user: ReturnType<typeof userEvent.setup>,
  row: number,
  key: string,
) => {
  await user.click(screen.getByRole('combobox', { name: `flag ${row}` }));
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: new RegExp(key) }));
};

/**
 * Adds a row, then puts one flag on both sides with the given values.
 *
 * Turns A/B on when it is not already, because a two-sided configuration only
 * exists in that shape — the caller asking for two values has said which shape
 * it means.
 */
const configureFirstFlag = async (
  user: ReturnType<typeof userEvent.setup>,
  key: string,
  a: string,
  b: string,
) => {
  const toggle = await screen.findByRole('checkbox', { name: 'A/B' });
  if (!(toggle as HTMLInputElement).checked) await user.click(toggle);
  await user.click(await screen.findByRole('button', { name: /^add flag/ }));
  await pickFlag(user, 1, key);
  await user.selectOptions(await screen.findByLabelText('side a value 1'), a);
  await user.selectOptions(await screen.findByLabelText('side b value 1'), b);
};

describe('Launch — discovery', () => {
  it('replaces the per-agent model editors with an env editor', async () => {
    const user = userEvent.setup();
    renderLaunch();
    expect(await screen.findByLabelText(/evaluator/i)).toBeTruthy();

    await selectDiscovery(user);
    await enableAb(user);

    expect(screen.queryByLabelText(/evaluator/i)).toBeNull();
    expect(screen.getByTestId('env-editor')).toBeTruthy();
    // The absence above is guaranteed by this harness declaring no agents, which
    // the FIXTURE decides; the config column's own control is not. Two profiles
    // ship, so a scorecard column rendered here would put a Config picker on the
    // page — this asserts the page's branch, not the fixture's agent list.
    expect(screen.queryByLabelText('Config')).toBeNull();
    expect(screen.queryByText(/runs as saved/i)).toBeNull();
  });

  it('offers A/B as a choice, because one configuration is a run this harness can make', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);

    // The single shape is now reachable: previously this checkbox was pinned on
    // and disabled, so the cheaper of the two runs could not be launched at all.
    const toggle = screen.getByRole('checkbox', { name: 'A/B' });
    expect(toggle).not.toBeChecked();
    expect(toggle).not.toBeDisabled();

    await enableAb(user);
    expect(screen.getByText(/one run, both configurations/i)).toBeTruthy();
  });

  it('offers none of the scoring flags this harness does not have', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await enableAb(user);

    for (const absent of [/llm judge/i, /regression threshold/i, /strict evidence/i, /^tier$/i, /^rule$/i]) {
      expect(screen.queryByLabelText(absent)).toBeNull();
    }
    // Those absences follow from this harness declaring no scoring flags, which
    // the fixture decides. The config column that would have HELD them is the
    // page's own branch, and it announces itself with a Config picker whatever
    // the harness's flag list says. Asserted for the COMPARISON shape only: a
    // single run may legitimately name a saved config (ops.argv.ts refuses a
    // named profile only alongside `sides`), so the picker belongs there.
    expect(screen.queryByLabelText('Config')).toBeNull();
    // What it does have: runs and case, shared by both sides.
    expect(screen.getAllByLabelText('Runs per case')).toHaveLength(1);
    expect(screen.getAllByLabelText('Case')).toHaveLength(1);
  });

  it('offers only the flags this harness reads, from the generated catalogue', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await user.click(screen.getByRole('button', { name: /^add flag/ }));
    await user.click(screen.getByRole('combobox', { name: 'flag 1' }));
    const offered = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(offered.some((text) => text?.includes('DISCOVERY_PROFILE_SOURCE'))).toBe(true);
    // In the 16-flag allowlist, but no harness's code reads it (IND-630), so it
    // is in no catalogue and cannot be offered anywhere.
    expect(offered.some((text) => text?.includes('POOL_QUESTIONS_MODE'))).toBe(false);
  });

  it('adds one row to both sides at once, because an asymmetric pair is refused', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await enableAb(user);
    await user.click(screen.getByRole('button', { name: /^add flag to both sides/ }));
    await pickFlag(user, 1, 'DISCOVERY_PROFILE_SOURCE');

    // One key, two values: the row owns the key, so the asymmetric pair the
    // server refuses cannot be built here.
    expect(screen.getByLabelText('side a value 1')).toBeTruthy();
    expect(screen.getByLabelText('side b value 1')).toBeTruthy();

    // And there is ONE add control, not one per column: both buttons did the
    // identical thing, which is what the operator reported.
    expect(screen.getAllByRole('button', { name: /^add flag to both sides/ })).toHaveLength(1);
  });

  it('refuses two identical configurations in the server\u2019s own words', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'premise');

    const refusal = abSideIssues({
      a: { DISCOVERY_PROFILE_SOURCE: 'premise' },
      b: { DISCOVERY_PROFILE_SOURCE: 'premise' },
    })[0]!.message;
    expect(screen.getByText(refusal)).toBeTruthy();
    expect(screen.getByRole('button', { name: /run both sides/i })).toBeDisabled();

    // Making them differ clears the refusal and enables the launch.
    await user.selectOptions(screen.getByLabelText('side b value 1'), 'user_context');

    expect(screen.queryByText(refusal)).toBeNull();
    expect(screen.getByRole('button', { name: /run both sides/i })).not.toBeDisabled();
  });

  it('prices a single run at one pass and a comparison at two', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);

    // A single run passes over the corpus ONCE. The constant this replaced was
    // pinned at 2 for discovery, so this line read "× 2 sides = 30" for a run
    // that costs 15 — the page overstated the spend it asks the operator to
    // authorise by double.
    expect(screen.getByText(/5 cases × 3 runs = 15/)).toBeTruthy();

    await enableAb(user);

    expect(screen.getByText(/5 cases × 3 runs × 2 sides = 30/)).toBeTruthy();

    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'user_context');
    await user.click(screen.getByRole('button', { name: /run both sides/i }));

    expect(screen.getByText(/30 model invocations/)).toBeTruthy();
  });

  it('launches one run carrying both sides, with no model overrides', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'user_context');
    await user.clear(screen.getByLabelText('Runs per case'));
    await user.type(screen.getByLabelText('Runs per case'), '2');
    await runAndConfirm(user, /run both sides/i);

    expect(postedRuns).toEqual([
      {
        kind: 'eval',
        harness: 'discovery',
        profile: 'default',
        flags: { runs: 2 },
        sides: {
          a: { DISCOVERY_PROFILE_SOURCE: 'premise' },
          b: { DISCOVERY_PROFILE_SOURCE: 'user_context' },
        },
      },
    ]);
  });

  it('opens on the harness named by a deep link, priced for a single run', async () => {
    window.history.pushState({}, '', '/launch?harness=discovery');
    renderLaunch();

    // No dropdown interaction happened, so this comes from the page's own load
    // path. A single run, because A/B is the operator's choice and nobody has
    // made it yet — and priced as ONE pass over the corpus.
    expect(await screen.findByRole('button', { name: /^add flag/ })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'A/B' })).not.toBeChecked();
    expect(screen.getByText(/5 cases × 3 runs = 15/)).toBeTruthy();
  });

  it('offers no config picker for a comparison, and says why the sides are otherwise identical', async () => {
    const user = userEvent.setup();
    renderLaunch();

    // The picker is on the page for a scorecard harness: two profiles ship.
    expect(await screen.findByLabelText('Config')).toBeTruthy();

    await selectDiscovery(user);
    await enableAb(user);

    expect(screen.queryByLabelText('Config')).toBeNull();
    expect(screen.getByText(/same models and the same environment/i)).toBeTruthy();
  });

  it('clears the env when a scorecard harness is chosen, because catalogues differ', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'user_context');
    await user.selectOptions(screen.getByLabelText('Harness'), 'matching');

    // Two, because the form is still in A/B: one model editor per column.
    expect(await screen.findAllByLabelText(/evaluator/i)).toHaveLength(2);
    // The row is gone, not carried over: DISCOVERY_PROFILE_SOURCE is absent from
    // matching's catalogue, so posting it would earn a 400 the operator did
    // nothing to deserve.
    expect(screen.queryByLabelText('side a value 1')).toBeNull();
    expect(screen.queryByLabelText('value 1')).toBeNull();

    await runAndConfirm(user, /^run a\/b$/i);

    // No `overrides` key at all: the env was cleared, and this harness has no
    // model override either.
    expect(postedRuns).toEqual([
      { kind: 'eval', harness: 'matching', profile: 'default', flags: {} },
      { kind: 'eval', harness: 'matching', profile: 'default', flags: {} },
    ]);
  });

  it('shows the server\u2019s refusal when a run is already in flight', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchRefusingLaunch(409, 'A discovery run is already in flight; cancel it before launching another.'),
    );
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'user_context');
    await runAndConfirm(user, /run both sides/i);

    expect(await screen.findByRole('alert')).toHaveTextContent(/already in flight/i);
    // The configuration survives the refusal.
    expect(screen.getByLabelText('side a value 1')).toHaveValue('premise');
  });

  it('shows the server\u2019s refusal when it holds no credentials for this harness', async () => {
    // A different status and a different cause from the in-flight refusal: 503,
    // because the request is valid and it is the server that cannot serve it.
    // The operator's configuration has to survive this one too — the fix is on
    // the server, and they will launch the same run again once it is applied.
    vi.stubGlobal(
      'fetch',
      stubFetchRefusingLaunch(
        503,
        'This server holds no Neon control-plane key, so it cannot reset the two evaluation branches this harness needs.',
      ),
    );
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'user_context');
    await runAndConfirm(user, /run both sides/i);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no Neon control-plane key/i);
    expect(screen.getByLabelText('side b value 1')).toHaveValue('user_context');
  });

  it('refuses a run count this harness caps lower than the shared schema does', async () => {
    // The failure this prevents, proven end to end before the fix: the form took
    // --runs 25, priced it at 250 invocations, took the confirmation and posted
    // it; the engine then died on "--runs must not exceed 10", after the
    // operator had committed. The refusal is the server's own sentence, from the
    // same function RunSpecSchema calls.
    const refusal = flagValueIssues('discovery', HARNESS_REGISTRY['discovery'].flags, { runs: 25 })[0]!
      .message;
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'user_context');
    await user.clear(screen.getByLabelText('Runs per case'));
    await user.type(screen.getByLabelText('Runs per case'), '25');

    expect(screen.getByText(refusal)).toBeTruthy();
    expect(refusal).toMatch(/--runs/);
    expect(refusal).toMatch(/10/);
    expect(screen.getByRole('button', { name: /run both sides/i })).toBeDisabled();

    // Nothing was posted, and the harness's own maximum clears the refusal.
    await user.clear(screen.getByLabelText('Runs per case'));
    await user.type(screen.getByLabelText('Runs per case'), '10');

    expect(screen.queryByText(refusal)).toBeNull();
    expect(screen.getByRole('button', { name: /run both sides/i })).not.toBeDisabled();
    expect(postedRuns).toEqual([]);
  });

  it('enforces each harness\u2019s own bounds, not one shared cap', async () => {
    const user = userEvent.setup();
    renderLaunch();

    // 25 runs is this scorecard harness's declared maximum, so it is accepted
    // here and refused on discovery: the bound is per harness, not global.
    await user.clear(await screen.findByLabelText('Runs per case'));
    await user.type(screen.getByLabelText('Runs per case'), '25');

    expect(screen.getByRole('button', { name: /^run$/i })).not.toBeDisabled();

    // And a scorecard harness's own bound bites the same way: --tier is 1..4.
    const tierRefusal = flagValueIssues('matching', HARNESS_REGISTRY.matching.flags, { tier: 9 })[0]!.message;
    await user.type(screen.getByLabelText('Tier'), '9');

    expect(screen.getByText(tierRefusal)).toBeTruthy();
    expect(tierRefusal).toMatch(/--tier/);
    expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled();
  });

  it('shows the server\u2019s per-value refusal under the control that produced it', async () => {
    // A trailing space is invisible on the page and fatal in meaning: the
    // discovery graph does not parse "6 " as an integer, falls back to its own
    // default, and the artifact would report a difference that never ran. The
    // message belongs to one side's one field, so it is rendered there.
    const refusal = abSideIssues({
      a: { NEGOTIATION_MAX_TURNS_CHAT: '4' },
      b: { NEGOTIATION_MAX_TURNS_CHAT: '6 ' },
    })[0]!.message;
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await enableAb(user);
    await user.click(await screen.findByRole('button', { name: /^add flag/ }));
    await pickFlag(user, 1, 'NEGOTIATION_MAX_TURNS_CHAT');
    await user.type(screen.getByLabelText('side a value 1'), '4');
    await user.type(screen.getByLabelText('side b value 1'), '6 ');

    const message = screen.getByText(refusal);
    // Under the offending control, not merely somewhere on the page: same row,
    // and the input is marked invalid.
    const field = screen.getByLabelText('side b value 1');
    expect(field.closest('div')!.contains(message)).toBe(true);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    // Side a gave the same flag a value the graph honours, so it says nothing:
    // exactly one copy of the refusal on the page, under side b.
    expect(screen.getAllByText(refusal)).toHaveLength(1);
    expect(screen.getByLabelText('side a value 1')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: /run both sides/i })).toBeDisabled();
  });

  it('confirms a filtered run too, because the branch resets are not filtered', async () => {
    // --case narrows what is MEASURED. It does not narrow what is destroyed:
    // every run of this harness resets both Neon evaluation branches. So the
    // only spend gate on the page must fire here, and say what it is confirming.
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'user_context');
    await user.type(screen.getByLabelText('Case'), 'historical/songwriting-duo');

    expect(screen.getByText(/1 case \(filtered\) × 3 runs × 2 sides = 6/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /run both sides/i }));

    expect(screen.getByText(/resets both Neon evaluation branches/i)).toBeTruthy();
    expect(screen.getByText(/6 model invocations/)).toBeTruthy();
    // Nothing is posted until the operator confirms.
    expect(postedRuns).toEqual([]);

    await user.click(screen.getByRole('button', { name: /confirm and run/i }));

    expect(postedRuns).toHaveLength(1);
  });

  it('tells a single run it resets one branch, not both', async () => {
    // The confirmation is the last moment anyone can decline, so it must describe
    // what will actually happen. A single run resets only the branch it reads
    // (discovery.main.ts filters the attested targets to the sides being run);
    // quoting the comparison's sentence told an operator launching ONE
    // configuration that both branches would be destroyed — the same false claim
    // the engine's own contract was rewritten to eliminate.
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    // No A/B: one configuration, one branch.
    await user.click(await screen.findByRole('button', { name: /^add flag/ }));
    await pickFlag(user, 1, 'DISCOVERY_PROFILE_SOURCE');
    await user.selectOptions(await screen.findByLabelText('value 1'), 'user_context');
    await user.type(screen.getByLabelText('Case'), 'historical/songwriting-duo');

    await user.click(screen.getByRole('button', { name: /^run$/i }));

    expect(screen.getByText(/resets the Neon evaluation branch this configuration runs on/i)).toBeTruthy();
    expect(screen.queryByText(/resets both Neon evaluation branches/i)).toBeNull();
  });

  it('asks for a flag, not for values, when every row has been removed', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await enableAb(user);
    await user.click(await screen.findByRole('button', { name: /^add flag/ }));
    // Removing is a pair-level operation: one control, for both columns.
    await user.click(screen.getByRole('button', { name: /remove flag 1 from both sides/i }));

    expect(screen.queryByRole('combobox', { name: 'flag 1' })).toBeNull();
    // "Give every flag a value" names controls that are not on the screen.
    expect(screen.getByText(/add a flag to both sides before running/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /run both sides/i })).toBeDisabled();
  });

  it('names what a run destroys from the harness, not from the branch that shows it', async () => {
    // The page branches on the descriptor's own `resets` field rather than on
    // "discovery", so another harness would reach this confirmation too — and
    // must not inherit a claim about Neon branches it may not reset. A server
    // that names nothing to reset gets no such sentence, and the spend is still
    // confirmed: a full-corpus run is gated on its cost either way.
    const silent = {
      harnesses: HARNESSES.harnesses.map(({ resets: _resets, ...rest }) => rest),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(silent));
        if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
        if (String(url).endsWith('/api/configs/metadata')) return new Response(JSON.stringify(METADATA));
        if (String(url).endsWith('/api/configs')) {
          return new Response(JSON.stringify({ repo: PROFILES.profiles, saved: [] }));
        }
        return new Response(JSON.stringify({}));
      }),
    );
    const user = userEvent.setup();
    renderLaunch();

    await selectDiscovery(user);
    await configureFirstFlag(user, 'DISCOVERY_PROFILE_SOURCE', 'premise', 'user_context');
    await user.click(screen.getByRole('button', { name: /run both sides/i }));

    // Still gated, still priced — and silent about branches nobody declared.
    expect(screen.getByText(/confirm full-corpus run: 30 model invocations/i)).toBeTruthy();
    expect(screen.queryByText(/neon/i)).toBeNull();
    expect(screen.queryByText(/resets/i)).toBeNull();
    expect(screen.getByRole('button', { name: /confirm and run/i })).toBeTruthy();
  });

  it('prices a harness this build has never heard of, rather than saying NaN', async () => {
    // A server one release ahead names a harness the bundled SPA does not know,
    // and SIDES_PER_RUN has no entry for it. Without the `?? 1` the multiplier
    // is undefined and the workload line — the one line whose whole job is to
    // say what a run costs — reads "= NaN" on every render for that harness.
    const future = {
      harnesses: [
        ...HARNESSES.harnesses,
        {
          harness: 'discovery-v2',
          script: 'eval:discovery-v2',
          caseCount: 6,
          defaultRuns: 3,
          question: 'Which of two configurations wins on the next corpus?',
          detail: 'A harness this build does not know.',
          agents: [],
          flags: [RUNS_FLAG],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(future));
        if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
        if (String(url).endsWith('/api/configs/metadata')) return new Response(JSON.stringify(METADATA));
        if (String(url).endsWith('/api/configs')) {
          return new Response(JSON.stringify({ repo: PROFILES.profiles, saved: [] }));
        }
        return new Response(JSON.stringify({}));
      }),
    );
    const user = userEvent.setup();
    renderLaunch();

    await user.selectOptions(await screen.findByLabelText('Harness'), 'discovery-v2');

    // 6 cases x 3 runs x one pass, because one pass is all this build can know
    // about a harness it has never heard of.
    expect(await screen.findByText(/6 cases × 3 runs = 18/)).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

describe('Launch — environment configuration for every harness', () => {
  it('offers a scorecard harness the keys its own code reads', async () => {
    const user = userEvent.setup();
    renderLaunch();

    // matching, the default selection. Before this change it had no env editor
    // at all: the site offered environment configuration only to discovery, and
    // the claim that the scorecard harnesses "do not read env" was true only of
    // the sixteen-key allowlist that had been scanned against.
    await user.click(await screen.findByRole('button', { name: /^add flag$/ }));
    await user.click(screen.getByRole('combobox', { name: 'flag 1' }));
    const offered = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.textContent);

    // In matching's generated catalogue.
    expect(offered.some((text) => text?.includes('CHAT_MODEL'))).toBe(true);
    // Read by the discovery graph, and by nothing matching imports. Offering it
    // here would record a value on the run that provably nothing acts on.
    expect(offered.some((text) => text?.includes('DISCOVERY_PROFILE_SOURCE'))).toBe(false);
    expect(HARNESS_ENV_KEYS.matching).toContain('CHAT_MODEL');
    expect(HARNESS_ENV_KEYS.matching).not.toContain('DISCOVERY_PROFILE_SOURCE');
  });

  it('posts a scorecard run with its environment, on one column', async () => {
    const user = userEvent.setup();
    renderLaunch();

    await user.click(await screen.findByRole('button', { name: /^add flag$/ }));
    await pickFlag(user, 1, 'CHAT_MODEL');
    await user.selectOptions(screen.getByLabelText('value 1'), 'anthropic/claude-sonnet-4');
    await runAndConfirm(user, /^run$/i);

    expect(postedRuns).toEqual([
      {
        kind: 'eval',
        harness: 'matching',
        profile: 'default',
        flags: {},
        overrides: { models: {}, env: { CHAT_MODEL: 'anthropic/claude-sonnet-4' } },
      },
    ]);
  });

  it('gives both sides of a scorecard A/B the same environment', async () => {
    // Env is a property of the run, not of a column: this A/B posts two specs
    // that differ in models and scoring, and a second, unlabelled axis of
    // difference would break the one claim a comparison makes.
    const user = userEvent.setup();
    renderLaunch();

    await user.click(await screen.findByRole('checkbox', { name: 'A/B' }));
    await user.click(await screen.findByRole('button', { name: /^add flag$/ }));
    await pickFlag(user, 1, 'CHAT_MODEL');
    await user.selectOptions(screen.getByLabelText('value 1'), 'google/gemini-2.5-flash');
    await runAndConfirm(user, /^run a\/b$/i);

    expect(postedRuns).toHaveLength(2);
    for (const run of postedRuns as { overrides?: { env: Record<string, string> } }[]) {
      expect(run.overrides?.env).toEqual({ CHAT_MODEL: 'google/gemini-2.5-flash' });
    }
  });

  it('refuses a model picker and a typed EVAL_MODEL_OVERRIDES together', async () => {
    // Measured, not assumed: resolveProfile writes EVAL_MODEL_OVERRIDES from the
    // profile's models block, so with both set the typed value is DISCARDED and
    // the run spends real money on models the operator did not choose, while the
    // page shows their value as accepted. Refused, naming both controls.
    const user = userEvent.setup();
    renderLaunch();

    await user.selectOptions(await screen.findByLabelText(/evaluator/i), 'anthropic/claude-sonnet-4');
    await user.click(await screen.findByRole('button', { name: /^add flag$/ }));
    await pickFlag(user, 1, 'EVAL_MODEL_OVERRIDES');
    await user.type(
      screen.getByLabelText('value 1'),
      '{{"opportunityEvaluator":"google/gemini-2.5-flash"}',
    );

    expect(screen.getByText(/EVAL_MODEL_OVERRIDES is set here and the per-agent model pickers/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled();
    expect(postedRuns).toEqual([]);

    // Clearing one of the two resolves it, which is what the message asks for.
    await user.click(screen.getByRole('button', { name: /remove flag 1/i }));

    expect(screen.queryByText(/is set here and the per-agent model pickers/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^run$/i })).not.toBeDisabled();
  });

  it('names the keys a saved config sets that this harness will not read', async () => {
    // Recorded-but-not-read (spec §6): a saved config is harness-agnostic and
    // may carry a key this harness never reads because it is shared with one
    // that does. So the run is NOT blocked — the keys are named.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
        if (String(url).endsWith('/api/profiles')) return new Response(JSON.stringify(PROFILES));
        if (String(url).endsWith('/api/configs/metadata')) return new Response(JSON.stringify(METADATA));
        if (String(url).endsWith('/api/configs')) {
          return new Response(
            JSON.stringify({
              repo: PROFILES.profiles,
              saved: [
                {
                  name: 'shared-discovery',
                  description: 'written for discovery, selected here on matching',
                  models: {},
                  env: { DISCOVERY_PROFILE_SOURCE: 'user_context' },
                },
              ],
            }),
          );
        }
        if (String(url).endsWith('/api/runs') && init?.method === 'POST') {
          postedRuns.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ id: 'run-1' }), { status: 202 });
        }
        return new Response(JSON.stringify({}));
      }),
    );
    const user = userEvent.setup();
    renderLaunch();

    await user.selectOptions(await screen.findByLabelText('Config'), 'shared-discovery');

    expect(screen.getByText(/Recorded but not read by matching: DISCOVERY_PROFILE_SOURCE/)).toBeTruthy();
    // Named, never blocked: the config is legitimate.
    expect(screen.getByRole('button', { name: /^run$/i })).not.toBeDisabled();
    // And it is the server's own answer, from the same function the 202 uses.
    expect(unreadEnvKeys('matching', { DISCOVERY_PROFILE_SOURCE: 'user_context' })).toEqual([
      'DISCOVERY_PROFILE_SOURCE',
    ]);
  });

  it('prices every shape the way the server records it', async () => {
    // The one number the operator authorises a spend against. Asserted against
    // sidesPerRun, the function renderRun writes the record's workload from, so
    // the page and the record cannot drift.
    const user = userEvent.setup();
    renderLaunch();

    // matching: 40 cases × 3 runs, one pass.
    expect(await screen.findByText(/40 cases × 3 runs = 120/)).toBeTruthy();
    expect(sidesPerRun({ harness: 'matching' })).toBe(1);

    // matching A/B: two launches of one pass each.
    await user.click(screen.getByRole('checkbox', { name: 'A/B' }));
    expect(screen.getByText(/40 cases × 3 runs × 2 sides = 240/)).toBeTruthy();

    // discovery paired: ONE launch carrying two passes — A/B stays on across a
    // harness change, because it is the operator's own answer and not the
    // harness's.
    await user.selectOptions(screen.getByLabelText('Harness'), 'discovery');
    expect(screen.getByText(/5 cases × 3 runs × 2 sides = 30/)).toBeTruthy();
    expect(sidesPerRun({ harness: 'discovery', sides: { a: { X: '1' }, b: { X: '2' } } })).toBe(2);

    // discovery single: ONE pass. The constant this replaced was pinned at 2 for
    // discovery, so this line read 30 for a run that costs 15 — the page
    // overstated the spend it asks the operator to authorise by double.
    await user.click(screen.getByRole('checkbox', { name: 'A/B' }));
    expect(screen.getByText(/5 cases × 3 runs = 15/)).toBeTruthy();
    expect(sidesPerRun({ harness: 'discovery' })).toBe(1);
  });
});

describe('FlagListbox — the flag picker', () => {
  /** Opens the picker on the default harness and returns its trigger. */
  const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
    renderLaunch();
    await user.click(await screen.findByRole('button', { name: /^add flag$/ }));
    const trigger = screen.getByRole('combobox', { name: 'flag 1' });
    await user.click(trigger);
    return trigger;
  };

  it('shows each flag description before the operator has to choose', async () => {
    // The reason it replaced a native select: an <option> carries no second
    // line, so the description only appeared AFTER a flag had been chosen.
    const user = userEvent.setup();
    await openPicker(user);

    const option = within(screen.getByRole('listbox')).getByRole('option', { name: /CHAT_MODEL/ });
    expect(option.textContent).toContain('Model for the chat agent only.');
  });

  it('is operable from the keyboard, as a native select was', async () => {
    // A custom listbox owes its user what the control it replaced gave for
    // free. This is the standard ARIA listbox pattern, not a bespoke chord.
    const user = userEvent.setup();
    const trigger = await openPicker(user);
    // Scoped to the listbox, and read live each time. Both matter: the harness
    // <select> on the same page also holds role="option" children, and the
    // ELEMENTS are replaced on every render so captured nodes go stale.
    const optionsNow = () => within(screen.getByRole('listbox')).getAllByRole('option');
    const activeIndex = () => {
      const active = screen.getByRole('listbox').getAttribute('aria-activedescendant');
      return optionsNow().findIndex((option) => option.id === active);
    };
    const lastIndex = optionsNow().length - 1;

    // Opens onto the first option.
    expect(activeIndex()).toBe(0);

    await user.keyboard('{ArrowDown}');
    expect(activeIndex()).toBe(1);

    await user.keyboard('{ArrowUp}');
    expect(activeIndex()).toBe(0);

    await user.keyboard('{End}');
    expect(activeIndex()).toBe(lastIndex);

    await user.keyboard('{Home}');
    expect(activeIndex()).toBe(0);

    // Enter chooses the active option, the popup closes, and focus returns to
    // the trigger — so the tab order never strands anyone inside a dismissed
    // popup.
    const chosenLabel = optionsNow()[0]!.textContent;
    screen.getByRole('listbox').focus();
    expect(trigger).not.toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(chosenLabel).toContain(trigger.textContent!.split(' — ')[0]!);
  });

  it('dismisses on Escape without choosing, and returns focus', async () => {
    const user = userEvent.setup();
    const trigger = await openPicker(user);
    const before = trigger.textContent;

    // Focus is inside the popup, not on the trigger, so "returns focus" is a
    // real claim: without the refocus call this assertion fails.
    screen.getByRole('listbox').focus();
    expect(trigger).not.toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger.textContent).toBe(before);
  });

  it('marks the trigger expanded, so a screen reader knows the popup is open', async () => {
    const user = userEvent.setup();
    renderLaunch();
    await user.click(await screen.findByRole('button', { name: /^add flag$/ }));
    const trigger = screen.getByRole('combobox', { name: 'flag 1' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers no flag twice, because a key belongs to one row', async () => {
    const user = userEvent.setup();
    renderLaunch();
    await user.click(await screen.findByRole('button', { name: /^add flag$/ }));
    await pickFlag(user, 1, 'CHAT_MODEL');
    await user.click(screen.getByRole('button', { name: /^add flag$/ }));
    await user.click(screen.getByRole('combobox', { name: 'flag 2' }));

    const offered = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered.some((text) => text?.includes('CHAT_MODEL'))).toBe(false);
  });
});
