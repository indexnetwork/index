import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

import { Profiles } from '../src/routes/Profiles';

const METADATA = {
  env: [
    {
      key: 'POOL_QUESTIONS_MODE',
      label: 'Pool question mining',
      description: 'Mines discovery questions from intents.',
      kind: 'enum',
      values: ['off', 'on'],
      defaultDescription: 'off',
    },
    {
      key: 'NEGOTIATION_MAX_TURNS_CHAT',
      label: 'Chat turn cap',
      description: 'Caps negotiation turns in chat.',
      kind: 'integer',
      defaultDescription: '8',
    },
  ],
  models: [
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', blurb: 'fast and inexpensive' },
    { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', blurb: 'stronger reasoning' },
  ],
  harnessAgents: {
    matching: [
      {
        id: 'opportunityEvaluator',
        label: 'Evaluator',
        role: 'Decides accept or reject for each candidate pair.',
      },
    ],
    profile: [
      { id: 'profileGenerator', label: 'Profile writer', role: 'Writes the user profile.' },
    ],
    premise: [
      { id: 'premiseDecomposer', label: 'Decomposer', role: 'Splits a request into premises.' },
      { id: 'premiseAnalyzer', label: 'Analyzer', role: 'Scores each candidate premise.' },
    ],
    opportunity: [
      { id: 'opportunityPresenter', label: 'Card writer', role: 'Writes the opportunity card.' },
    ],
  },
};

const REPO = [
  { name: 'default', description: 'no overrides', models: {}, env: {} },
  {
    name: 'claude-evaluator',
    description: 'claude, shipped',
    // `negotiator` is beyond the five scorecard agents and has no metadata
    // entry: the editor must fall back to the raw id with no role text.
    models: {
      opportunityEvaluator: 'anthropic/claude-sonnet-4',
      negotiator: 'anthropic/claude-sonnet-4',
    },
    env: {},
  },
];

const SAVED: {
  name: string;
  description: string;
  models: Record<string, string>;
  env: Record<string, string>;
}[] = [
  {
    name: 'my-config',
    description: 'mine',
    models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
    env: {},
  },
  // Launch's "save as config" can create a config with env overrides only. Its
  // models map is empty, so nothing but agent metadata can offer model rows.
  {
    name: 'env-only',
    description: 'flags only',
    models: {},
    env: { POOL_QUESTIONS_MODE: 'on' },
  },
];

let patched: { name: string; body: unknown } | null;
let deleted: string[];
let savedConfigs: {
  name: string;
  description: string;
  models: Record<string, string>;
  env: Record<string, string>;
}[];
let metadataAvailable: boolean;
let metadataGate: Promise<void> | null;

beforeEach(() => {
  patched = null;
  deleted = [];
  metadataAvailable = true;
  metadataGate = null;
  savedConfigs = SAVED.map((config) => ({ ...config }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/configs/metadata')) {
        if (metadataGate !== null) await metadataGate;
        return metadataAvailable
          ? new Response(JSON.stringify(METADATA))
          : new Response('boom', { status: 500 });
      }
      if (href.includes('/api/configs/') && init?.method === 'PATCH') {
        const name = decodeURIComponent(href.split('/api/configs/')[1]);
        patched = { name, body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ name, ...(patched.body as object) }));
      }
      if (href.includes('/api/configs/') && init?.method === 'DELETE') {
        deleted.push(decodeURIComponent(href.split('/api/configs/')[1]));
        return new Response(null, { status: 204 });
      }
      if (href.endsWith('/api/configs')) {
        return new Response(JSON.stringify({ repo: REPO, saved: savedConfigs }));
      }
      if (href.endsWith('/api/runs')) {
        return new Response(JSON.stringify({ runs: [], issues: [] }));
      }
      return new Response(JSON.stringify({}));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderProfiles = () =>
  render(
    <BrowserRouter>
      <Profiles />
    </BrowserRouter>,
  );

/** Opens the live-pipeline flags disclosure inside a config's edit panel. */
const openEnvEditor = (panel: HTMLElement) => {
  const summary = within(panel).getByText(/live-pipeline flags/i);
  const details = summary.closest('details');
  expect(details).not.toBeNull();
  details!.open = true;
  return details!;
};

describe('Profiles (configs page)', () => {
  it('lists shipped profiles read-only and saved configs with edit/delete', async () => {
    renderProfiles();

    const shipped = await screen.findByRole('region', { name: 'config default' });
    expect(within(shipped).getByText('shipped')).toBeInTheDocument();
    expect(within(shipped).queryByRole('button', { name: 'edit' })).toBeNull();
    expect(within(shipped).queryByRole('button', { name: 'delete' })).toBeNull();

    const saved = screen.getByRole('region', { name: 'config my-config' });
    expect(within(saved).getByRole('button', { name: 'edit' })).toBeInTheDocument();
    expect(within(saved).getByRole('button', { name: 'delete' })).toBeInTheDocument();
  });

  it('deletes a saved config after confirmation', async () => {
    renderProfiles();
    const saved = await screen.findByRole('region', { name: 'config my-config' });

    await userEvent.click(within(saved).getByRole('button', { name: 'delete' }));
    // Nothing leaves until the operator confirms.
    expect(deleted).toEqual([]);
    expect(await within(saved).findByText('delete my-config?')).toBeInTheDocument();

    await userEvent.click(within(saved).getByRole('button', { name: 'yes' }));

    await waitFor(() => expect(deleted).toEqual(['my-config']));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'config my-config' })).toBeNull(),
    );
  });

  it('edits models through per-agent guided rows with labels, roles, and id fallback', async () => {
    renderProfiles();
    const saved = await screen.findByRole('region', { name: 'config my-config' });
    await userEvent.click(within(saved).getByRole('button', { name: 'edit' }));

    // The known agent gets its metadata label, role, and named default.
    const evaluator = within(saved).getByLabelText('model for Evaluator');
    expect(within(saved).getByText('Decides accept or reject for each candidate pair.')).toBeInTheDocument();
    expect(
      within(evaluator).getByRole('option', { name: 'profile default (Gemini 2.5 Flash)' }),
    ).toBeInTheDocument();
    // An agent without metadata falls back to its raw id and no role text.
    expect(within(saved).getByLabelText('model for negotiator')).toBeInTheDocument();

    await userEvent.selectOptions(evaluator, 'google/gemini-2.5-flash');
    await userEvent.click(within(saved).getByRole('button', { name: 'save changes' }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.name).toBe('my-config');
    expect(patched!.body).toEqual({
      description: 'mine',
      models: { opportunityEvaluator: 'google/gemini-2.5-flash' },
      env: {},
    });
  });

  it('edits env through guided dropdowns with validated enum values', async () => {
    renderProfiles();
    const saved = await screen.findByRole('region', { name: 'config my-config' });
    await userEvent.click(within(saved).getByRole('button', { name: 'edit' }));

    openEnvEditor(saved);
    await userEvent.click(within(saved).getByRole('button', { name: 'add flag override' }));
    await userEvent.selectOptions(within(saved).getByLabelText('flag 1'), 'POOL_QUESTIONS_MODE');
    // Choosing a flag explains it and offers exactly its valid values.
    expect(within(saved).getByText(/Mines discovery questions/)).toBeInTheDocument();
    const valueSelect = within(saved).getByLabelText('value 1');
    expect(within(valueSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'choose a value…',
      'off',
      'on',
    ]);
    await userEvent.selectOptions(valueSelect, 'on');

    await userEvent.click(within(saved).getByRole('button', { name: 'save changes' }));
    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.body).toEqual({
      description: 'mine',
      models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
      env: { POOL_QUESTIONS_MODE: 'on' },
    });
  });

  it('offers every scorecard agent when editing a config that overrides no model', async () => {
    // Regression: editAgentIds was derived only from agent ids already present in
    // some loaded profile's models map. The only repo profile ships models:{},
    // so an env-only config offered NO model dropdowns and no way to add one —
    // the user had to delete and recreate the config to set a model.
    renderProfiles();
    const envOnly = await screen.findByRole('region', { name: 'config env-only' });
    await userEvent.click(within(envOnly).getByRole('button', { name: 'edit' }));

    for (const label of ['Evaluator', 'Profile writer', 'Decomposer', 'Analyzer', 'Card writer']) {
      expect(within(envOnly).getByText(label)).toBeInTheDocument();
    }
    const evaluator = within(envOnly).getByLabelText('model for Evaluator');
    expect(evaluator).toHaveValue('');

    await userEvent.selectOptions(evaluator, 'google/gemini-2.5-flash');
    await userEvent.click(within(envOnly).getByRole('button', { name: 'save changes' }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.name).toBe('env-only');
    expect(patched!.body).toEqual({
      description: 'flags only',
      models: { opportunityEvaluator: 'google/gemini-2.5-flash' },
      env: { POOL_QUESTIONS_MODE: 'on' },
    });
  });

  it('makes duplicate env keys impossible: a used flag leaves the dropdowns', async () => {
    renderProfiles();
    const saved = await screen.findByRole('region', { name: 'config my-config' });
    await userEvent.click(within(saved).getByRole('button', { name: 'edit' }));

    openEnvEditor(saved);
    await userEvent.click(within(saved).getByRole('button', { name: 'add flag override' }));
    await userEvent.selectOptions(within(saved).getByLabelText('flag 1'), 'POOL_QUESTIONS_MODE');
    await userEvent.click(within(saved).getByRole('button', { name: 'add flag override' }));

    const secondRow = within(saved).getByLabelText('flag 2');
    expect(
      within(secondRow).queryByRole('option', { name: /POOL_QUESTIONS_MODE/ }),
    ).toBeNull();
    expect(
      within(secondRow).getByRole('option', { name: /NEGOTIATION_MAX_TURNS_CHAT/ }),
    ).toBeInTheDocument();
  });

  it('blocks save while an env value is invalid and re-enables when fixed', async () => {
    renderProfiles();
    const saved = await screen.findByRole('region', { name: 'config my-config' });
    await userEvent.click(within(saved).getByRole('button', { name: 'edit' }));

    openEnvEditor(saved);
    await userEvent.click(within(saved).getByRole('button', { name: 'add flag override' }));
    await userEvent.selectOptions(
      within(saved).getByLabelText('flag 1'),
      'NEGOTIATION_MAX_TURNS_CHAT',
    );
    await userEvent.type(within(saved).getByLabelText('value 1'), 'lots');

    expect(within(saved).getByText('must be an integer')).toBeInTheDocument();
    expect(within(saved).getByRole('button', { name: 'save changes' })).toBeDisabled();

    await userEvent.clear(within(saved).getByLabelText('value 1'));
    await userEvent.type(within(saved).getByLabelText('value 1'), '4');
    expect(within(saved).getByRole('button', { name: 'save changes' })).toBeEnabled();
  });

  it('prefills the guided env editor from the config being edited', async () => {
    savedConfigs.push({
      name: 'env-config',
      description: 'has env',
      models: {},
      env: { POOL_QUESTIONS_MODE: 'off' },
    });
    renderProfiles();
    const region = await screen.findByRole('region', { name: 'config env-config' });
    await userEvent.click(within(region).getByRole('button', { name: 'edit' }));

    openEnvEditor(region);
    expect(within(region).getByLabelText('flag 1')).toHaveValue('POOL_QUESTIONS_MODE');
    expect(within(region).getByLabelText('value 1')).toHaveValue('off');

    await userEvent.click(within(region).getByRole('button', { name: 'save changes' }));
    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.body).toEqual({
      description: 'has env',
      models: {},
      env: { POOL_QUESTIONS_MODE: 'off' },
    });
  });

  it('recomputes env validity when metadata resolves after the edit panel opened', async () => {
    savedConfigs.push({
      name: 'env-config',
      description: 'has env',
      models: {},
      env: { POOL_QUESTIONS_MODE: 'off' },
    });
    // Hold the metadata response until the edit panel is already open: the panel
    // computes editEnvValid against an empty flag list (false), and without a
    // recompute on arrival save would stick disabled even though the value is valid.
    let release!: () => void;
    metadataGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderProfiles();
    const region = await screen.findByRole('region', { name: 'config env-config' });
    await userEvent.click(within(region).getByRole('button', { name: 'edit' }));

    release();
    // Metadata has landed once the guided env disclosure renders.
    await within(region).findByText(/live-pipeline flags/i);
    expect(within(region).getByRole('button', { name: 'save changes' })).toBeEnabled();
  });

  it('hides the guided editors with a note when metadata does not load', async () => {
    metadataAvailable = false;
    renderProfiles();
    const saved = await screen.findByRole('region', { name: 'config my-config' });
    await userEvent.click(within(saved).getByRole('button', { name: 'edit' }));

    expect(
      await within(saved).findByText(/configuration metadata did not load/i),
    ).toBeInTheDocument();
    expect(within(saved).queryByLabelText('model for Evaluator')).toBeNull();
    expect(within(saved).queryByText(/live-pipeline flags/i)).toBeNull();
    // The rest of the panel keeps working.
    expect(within(saved).getByRole('button', { name: 'save changes' })).toBeEnabled();
  });

  it('links every config to a prefilled launch', async () => {
    renderProfiles();

    for (const name of ['default', 'claude-evaluator', 'my-config']) {
      const region = await screen.findByRole('region', { name: `config ${name}` });
      expect(within(region).getByRole('link', { name: 'launch →' })).toHaveAttribute(
        'href',
        `/launch?profile=${name}`,
      );
    }
  });
});
