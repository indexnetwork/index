/**
 * EnvConfigEditor's contract with its parent, tested at the component boundary.
 *
 * The row-shape rule cannot be pinned through the Launch page: the A/B toggle
 * reshapes every EXISTING row as it flips, so by the time the operator adds a
 * row through the UI, `prev.env[0]` already carries the right shape and a
 * parent that infers the shape from it agrees with one that is told. The two
 * only disagree when the row list is EMPTY — which the toggle path cannot
 * produce, because it reshapes rather than clears.
 *
 * That is why restoring the old shape-inferring reducer left the whole suite
 * green. Testing here instead pins the actual contract: the editor hands its
 * own columns to `onAddRow`, so a first row is shaped by the editor on screen
 * and not by a row that is not there.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { EnvFlagMeta } from '../src/api/client';
import { EnvConfigEditor } from '../src/components/EnvConfigEditor';

afterEach(cleanup);

const FLAGS: EnvFlagMeta[] = [
  {
    key: 'DISCOVERY_PROFILE_SOURCE',
    label: 'Discovery profile source',
    description: 'Selects how profiles participate in matching.',
    kind: 'enum',
    values: ['premise', 'user_context'],
    defaultDescription: 'premise',
  },
  {
    key: 'CHAT_MODEL',
    label: 'Chat model',
    description: 'The chat agent model.',
    kind: 'string',
    defaultDescription: 'google/gemini-3-pro-preview',
  },
];

function renderEditor(
  columns: readonly string[],
  rows: never[] = [],
  onAddRow: (columns: readonly string[]) => void = () => {},
) {
  const labels = Object.fromEntries(columns.map((c) => [c, c === 'single' ? '' : c.toUpperCase()]));
  return render(
    <EnvConfigEditor
      columns={columns}
      columnLabels={labels}
      flags={FLAGS}
      metadataLoaded
      knownHarness
      rows={rows}
      issueFor={() => undefined}
      onKeyChange={() => {}}
      onValueChange={() => {}}
      onAddRow={onAddRow}
      onRemoveRow={() => {}}
    />,
  );
}

describe('EnvConfigEditor hands its own columns to onAddRow', () => {
  it('hands the PAIRED columns when there is no row to infer a shape from', async () => {
    // The case that distinguishes the two reducers. A parent inferring the shape
    // from `rows[0]` has nothing to read here and falls back to the single
    // shape, producing a row the paired editor cannot render a second column
    // for.
    const seen: string[][] = [];
    const user = userEvent.setup();
    renderEditor(['a', 'b'], [], (cols) => seen.push([...cols]));

    await user.click(screen.getByRole('button', { name: /add flag/i }));

    expect(seen).toEqual([['a', 'b']]);
  });

  it('hands the SINGLE column when that is the shape on screen', async () => {
    const seen: string[][] = [];
    const user = userEvent.setup();
    renderEditor(['single'], [], (cols) => seen.push([...cols]));

    await user.click(screen.getByRole('button', { name: /add flag/i }));

    expect(seen).toEqual([['single']]);
  });

  it('names the add control for the shape, so the operator knows the row is shared', async () => {
    // A paired row is one key across both sides, not two independent rows; the
    // label is what says so before the row exists.
    renderEditor(['a', 'b']);
    expect(screen.getByRole('button', { name: 'add flag to both sides' })).toBeTruthy();
    cleanup();
    renderEditor(['single']);
    expect(screen.getByRole('button', { name: 'add flag' })).toBeTruthy();
  });
});
