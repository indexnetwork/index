import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

afterEach(cleanup);

import type { EnvFlagMeta } from '../src/api/client';
import { envRowsToOverrides, envRowsValid, envValueIssue, GuidedEnvEditor, type EnvOverrideRow } from '../src/components/GuidedEnvEditor';

const FLAGS: EnvFlagMeta[] = [
  {
    key: 'POOL_QUESTIONS_MODE',
    label: 'Pool questions',
    description: 'Enqueues a pool question for the top discriminator.',
    kind: 'enum',
    values: ['off', 'on'],
    defaultDescription: 'off',
  },
  {
    key: 'NEGOTIATION_EVIDENCE_QUESTIONS_MODE',
    label: 'Negotiation-evidence questions',
    description: 'Lens C question producer with shadow support.',
    kind: 'enum',
    values: ['off', 'shadow', 'on'],
    defaultDescription: 'off',
  },
  {
    key: 'NEGOTIATION_MAX_TURNS_CHAT',
    label: 'Max negotiation turns (chat)',
    description: 'Turn cap for chat negotiations.',
    kind: 'integer',
    defaultDescription: '4',
  },
  {
    key: 'DISCOVERY_REJECTION_COOLDOWN_DAYS',
    label: 'Rejection cooldown (days)',
    description: 'Days a rejected candidate stays suppressed.',
    kind: 'number',
    defaultDescription: '7 days',
  },
  {
    key: 'DISCOVERY_ALLOWED_TYPES',
    label: 'Discovery allowed types',
    description: 'Comma-separated type gate.',
    kind: 'string',
    defaultDescription: 'both intent and profile',
  },
  {
    key: 'RUN_OPPORTUNITY_EVAL_IN_PARALLEL',
    label: 'Parallel opportunity evaluation',
    description: 'Evaluates candidates in parallel.',
    kind: 'boolean',
    values: ['true', 'false'],
    defaultDescription: 'false',
  },
];

function Harness({ initial }: { initial: EnvOverrideRow[] }) {
  const [rows, setRows] = useState<EnvOverrideRow[]>(initial);
  const [valid, setValid] = useState(() => envRowsValid(FLAGS, initial));
  return (
    <>
      <GuidedEnvEditor
        flags={FLAGS}
        rows={rows}
        onChange={(nextRows, nextValid) => {
          setRows(nextRows);
          setValid(nextValid);
        }}
      />
      <output data-testid="valid">{String(valid)}</output>
      <output data-testid="rows">{JSON.stringify(rows)}</output>
    </>
  );
}

const emptyRow: EnvOverrideRow = { key: '', value: '', reason: '' };

function readRows(): EnvOverrideRow[] {
  return JSON.parse(screen.getByTestId('rows').textContent ?? '[]') as EnvOverrideRow[];
}

describe('GuidedEnvEditor', () => {
  it('offers every unused flag in a row’s key dropdown, labelled in plain English', () => {
    render(<Harness initial={[emptyRow]} />);
    const keySelect = screen.getByLabelText('flag 1');
    const labels = within(keySelect)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    for (const flag of FLAGS) {
      expect(labels.some((text) => text.includes(flag.label) && text.includes(flag.key))).toBe(true);
    }
  });

  it('shows the flag’s description and default once a key is chosen', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[emptyRow]} />);
    await user.selectOptions(screen.getByLabelText('flag 1'), 'POOL_QUESTIONS_MODE');
    expect(screen.getByText(/Enqueues a pool question/)).toBeInTheDocument();
    expect(screen.getByText(/Default: off/)).toBeInTheDocument();
    expect(readRows()[0]?.key).toBe('POOL_QUESTIONS_MODE');
  });

  it('renders a value select with exactly the valid values for enum flags', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ ...emptyRow, key: 'NEGOTIATION_EVIDENCE_QUESTIONS_MODE' }]} />);
    const valueSelect = screen.getByLabelText('value 1');
    const values = within(valueSelect)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(values).toEqual(['', 'off', 'shadow', 'on']);
    await user.selectOptions(valueSelect, 'shadow');
    expect(readRows()[0]?.value).toBe('shadow');
    expect(screen.getByTestId('valid').textContent).toBe('true');
  });

  it('renders true/false choices for boolean flags', () => {
    render(<Harness initial={[{ ...emptyRow, key: 'RUN_OPPORTUNITY_EVAL_IN_PARALLEL' }]} />);
    const values = within(screen.getByLabelText('value 1'))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(values).toEqual(['', 'true', 'false']);
  });

  it('marks a non-integer value invalid and reports valid=false to the parent', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ ...emptyRow, key: 'NEGOTIATION_MAX_TURNS_CHAT' }]} />);
    const input = screen.getByLabelText('value 1');
    await user.type(input, '4.5');
    expect(screen.getByTestId('valid').textContent).toBe('false');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/must be an integer/)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '4');
    expect(screen.getByTestId('valid').textContent).toBe('true');
  });

  it('requires a positive number for the cooldown flag', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ ...emptyRow, key: 'DISCOVERY_REJECTION_COOLDOWN_DAYS' }]} />);
    const input = screen.getByLabelText('value 1');
    await user.type(input, '0');
    expect(screen.getByTestId('valid').textContent).toBe('false');
    expect(screen.getByText(/must be a positive number/)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '2.5');
    expect(screen.getByTestId('valid').textContent).toBe('true');
  });

  it('treats an unchosen key or unchosen enum value as incomplete (invalid)', () => {
    render(<Harness initial={[emptyRow]} />);
    expect(screen.getByTestId('valid').textContent).toBe('false');
  });

  it('changing a row’s key resets its value, since the new flag has a different schema', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ ...emptyRow, key: 'POOL_QUESTIONS_MODE', value: 'on' }]} />);
    await user.selectOptions(screen.getByLabelText('flag 1'), 'NEGOTIATION_MAX_TURNS_CHAT');
    expect(readRows()[0]).toEqual({ key: 'NEGOTIATION_MAX_TURNS_CHAT', value: '', reason: '' });
    expect(screen.getByTestId('valid').textContent).toBe('false');
  });

  it('rejects negative integers — startup.env optionalInt is non-negative', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ ...emptyRow, key: 'NEGOTIATION_MAX_TURNS_CHAT' }]} />);
    const input = screen.getByLabelText('value 1');
    await user.type(input, '-3');
    expect(screen.getByText(/must be an integer/)).toBeInTheDocument();
    expect(screen.getByTestId('valid').textContent).toBe('false');
  });

  it('treats a whitespace-only string value as incomplete and drops it from overrides', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ ...emptyRow, key: 'DISCOVERY_ALLOWED_TYPES' }]} />);
    await user.type(screen.getByLabelText('value 1'), '   ');
    expect(screen.getByTestId('valid').textContent).toBe('false');
    expect(envRowsToOverrides(readRows())).toEqual({});
  });

  it('never renders “undefined” in the enum issue message for a flag without values', () => {
    const noValues: EnvFlagMeta = {
      key: 'BROKEN_FLAG',
      label: 'broken',
      description: 'enum flag missing its values list',
      kind: 'enum',
      defaultDescription: 'off',
    };
    const issue = envValueIssue(noValues, 'nope');
    expect(issue).not.toBeNull();
    expect(issue).not.toMatch(/undefined/);
  });

  it('excludes keys already used in other rows from the dropdown', () => {
    render(
      <Harness initial={[{ ...emptyRow, key: 'POOL_QUESTIONS_MODE' }, { ...emptyRow }]} />,
    );
    const secondKeySelect = screen.getByLabelText('flag 2');
    const values = within(secondKeySelect)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(values).not.toContain('POOL_QUESTIONS_MODE');
    expect(values).toContain('NEGOTIATION_MAX_TURNS_CHAT');
    // The row that owns the key keeps it selected.
    const firstKeySelect = screen.getByLabelText('flag 1');
    expect(within(firstKeySelect).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toContain(
      'POOL_QUESTIONS_MODE',
    );
  });

  it('adds and removes rows', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ ...emptyRow, key: 'POOL_QUESTIONS_MODE', value: 'on' }]} />);
    await user.click(screen.getByRole('button', { name: 'add flag override' }));
    expect(readRows()).toHaveLength(2);
    await user.click(screen.getByLabelText('remove override 1'));
    expect(readRows()).toHaveLength(1);
    expect(readRows()[0]?.key).toBe('');
  });

  it('keeps an optional free-text reason per row', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ ...emptyRow, key: 'POOL_QUESTIONS_MODE', value: 'on' }]} />);
    await user.type(screen.getByLabelText('why 1'), 'checking question enqueue');
    expect(readRows()[0]?.reason).toBe('checking question enqueue');
    expect(screen.getByTestId('valid').textContent).toBe('true');
  });

  it('envRowsToOverrides drops incomplete rows and reasons', () => {
    const rows: EnvOverrideRow[] = [
      { key: 'POOL_QUESTIONS_MODE', value: 'on', reason: 'why' },
      { key: '', value: '', reason: '' },
      { key: 'NEGOTIATION_MAX_TURNS_CHAT', value: '', reason: '' },
    ];
    expect(envRowsToOverrides(rows)).toEqual({ POOL_QUESTIONS_MODE: 'on' });
  });
});
