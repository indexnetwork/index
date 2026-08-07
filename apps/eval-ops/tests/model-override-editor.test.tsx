import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

afterEach(cleanup);

import type { AgentMeta, ModelMeta } from '../src/api/client';
import { ModelOverrideEditor } from '../src/components/ModelOverrideEditor';

const AGENTS: AgentMeta[] = [
  {
    id: 'opportunityEvaluator',
    label: 'Evaluator',
    role: 'Decides accept or reject for each candidate pair.',
  },
  {
    id: 'opportunityPresenter',
    label: 'Card writer',
    role: 'Writes the personalized card a user sees.',
  },
];

const MODELS: ModelMeta[] = [
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', blurb: 'Current default.' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', blurb: 'Cheap smoke runs.' },
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', blurb: 'Mid-tier Claude.' },
];

function Harness({
  initial,
  profileDefaults,
}: {
  initial: Record<string, string>;
  profileDefaults: Record<string, string>;
}) {
  const [value, setValue] = useState<Record<string, string>>(initial);
  return (
    <>
      <ModelOverrideEditor
        agents={AGENTS}
        models={MODELS}
        profileDefaults={profileDefaults}
        value={value}
        onChange={setValue}
      />
      <output data-testid="models">{JSON.stringify(value)}</output>
    </>
  );
}

function readModels(): Record<string, string> {
  return JSON.parse(screen.getByTestId('models').textContent ?? '{}') as Record<string, string>;
}

describe('ModelOverrideEditor', () => {
  it('renders one row per agent with its plain-English role', () => {
    render(<Harness initial={{}} profileDefaults={{}} />);
    expect(screen.getByText('Evaluator')).toBeInTheDocument();
    expect(screen.getByText(/Decides accept or reject/)).toBeInTheDocument();
    expect(screen.getByText('Card writer')).toBeInTheDocument();
    expect(screen.getByText(/Writes the personalized card/)).toBeInTheDocument();
  });

  it('names the profile’s current model in the default option', () => {
    render(
      <Harness
        initial={{}}
        profileDefaults={{ opportunityEvaluator: 'anthropic/claude-sonnet-4' }}
      />,
    );
    const select = screen.getByLabelText('model for Evaluator');
    const first = within(select).getAllByRole('option')[0] as HTMLOptionElement;
    expect(first.value).toBe('');
    expect(first.textContent).toBe('profile default (Claude Sonnet 4)');
  });

  it('falls back to the base default model when the profile does not set one', () => {
    render(<Harness initial={{}} profileDefaults={{}} />);
    const first = within(screen.getByLabelText('model for Evaluator')).getAllByRole(
      'option',
    )[0] as HTMLOptionElement;
    expect(first.textContent).toBe('profile default (Gemini 2.5 Flash)');
  });

  it('shows the raw model id when the profile default is outside the curated list', () => {
    render(
      <Harness
        initial={{}}
        profileDefaults={{ opportunityEvaluator: 'some/experimental-model' }}
      />,
    );
    const first = within(screen.getByLabelText('model for Evaluator')).getAllByRole(
      'option',
    )[0] as HTMLOptionElement;
    expect(first.textContent).toBe('profile default (some/experimental-model)');
  });

  it('lists each model with its blurb', () => {
    render(<Harness initial={{}} profileDefaults={{}} />);
    const texts = within(screen.getByLabelText('model for Evaluator'))
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(texts.some((text) => text.includes('Gemini 2.5 Flash Lite') && text.includes('Cheap smoke runs.'))).toBe(
      true,
    );
  });

  it('reports overrides as a models map, dropping agents set back to default', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{}} profileDefaults={{}} />);
    await user.selectOptions(
      screen.getByLabelText('model for Evaluator'),
      'anthropic/claude-sonnet-4',
    );
    expect(readModels()).toEqual({ opportunityEvaluator: 'anthropic/claude-sonnet-4' });
    await user.selectOptions(
      screen.getByLabelText('model for Card writer'),
      'google/gemini-2.5-flash-lite',
    );
    expect(readModels()).toEqual({
      opportunityEvaluator: 'anthropic/claude-sonnet-4',
      opportunityPresenter: 'google/gemini-2.5-flash-lite',
    });
    await user.selectOptions(screen.getByLabelText('model for Evaluator'), '');
    expect(readModels()).toEqual({ opportunityPresenter: 'google/gemini-2.5-flash-lite' });
  });
});
