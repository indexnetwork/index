import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

import { Profiles } from '../src/routes/Profiles';

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
      flags: [],
    },
    {
      harness: 'premise',
      script: 'eval:premise',
      caseCount: 12,
      defaultRuns: 3,
      question: 'Did we break an intent into correct atomic premises?',
      detail: 'Decomposes and classifies.',
      agents: ['premiseDecomposer', 'premiseAnalyzer'],
      flags: [],
    },
  ],
};

const CONFIG_MODELS = { models: ['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4'] };

const REPO = [
  { name: 'default', description: 'no overrides', models: {}, env: {} },
  {
    name: 'claude-evaluator',
    description: 'claude, shipped',
    models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
    env: {},
  },
];

const SAVED = [
  {
    name: 'my-config',
    description: 'mine',
    models: { opportunityEvaluator: 'anthropic/claude-sonnet-4' },
    env: {},
  },
];

let patched: { name: string; body: unknown } | null;
let deleted: string[];
let savedConfigs: typeof SAVED;

beforeEach(() => {
  patched = null;
  deleted = [];
  savedConfigs = SAVED.map((config) => ({ ...config }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/harnesses')) return new Response(JSON.stringify(HARNESSES));
      if (href.endsWith('/api/configs/models')) return new Response(JSON.stringify(CONFIG_MODELS));
      if (href.includes('/api/configs/') && init?.method === 'PATCH') {
        const name = decodeURIComponent(href.split('/api/configs/')[1]);
        patched = { name, body: JSON.parse(String(init.body)) };
        return new Response(
          JSON.stringify({ name, ...(patched.body as object) }),
        );
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

  it("edits a saved config's models through the overrides editor", async () => {
    renderProfiles();
    const saved = await screen.findByRole('region', { name: 'config my-config' });

    await userEvent.click(within(saved).getByRole('button', { name: 'edit' }));
    await userEvent.selectOptions(
      within(saved).getByLabelText('opportunityEvaluator'),
      'google/gemini-2.5-flash',
    );
    await userEvent.click(within(saved).getByRole('button', { name: 'save changes' }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.name).toBe('my-config');
    expect(patched!.body).toEqual({
      description: 'mine',
      models: { opportunityEvaluator: 'google/gemini-2.5-flash' },
      env: {},
    });
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
