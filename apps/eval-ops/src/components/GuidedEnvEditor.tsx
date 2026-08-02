import { useCallback, useId, useMemo } from 'react';

import type { EnvFlagMeta } from '../api/client';

export interface EnvOverrideRow {
  /** Empty until the user picks a flag. */
  key: string;
  value: string;
  /** Optional annotation — never sent to the server today, kept for the parent. */
  reason: string;
}

export const EMPTY_ENV_ROW: EnvOverrideRow = { key: '', value: '', reason: '' };

/**
 * Human-readable problem with a non-empty value, or null when the value is
 * acceptable for the flag's kind. Mirrors validateProfileEnv in
 * packages/protocol/eval/ops/ops.profiles.ts — the server still re-validates,
 * this only gives the user feedback before submit. Empty values are not an
 * issue here; they are "incomplete", which envRowsValid reports separately.
 * Whitespace-only values are reported for every kind: envRowsToOverrides drops
 * them, so without a marker the row would silently block submit.
 */
export function envValueIssue(flag: EnvFlagMeta, value: string): string | null {
  if (value !== '' && value.trim() === '') return 'must not be blank';
  switch (flag.kind) {
    case 'enum':
    case 'boolean':
      return flag.values?.includes(value)
        ? null
        : `expected one of: ${flag.values?.join(', ') ?? '(no values defined)'}`;
    case 'integer':
      // Non-negative digits only — mirrors optionalInt in services/api/src/startup.env.ts.
      return /^\d+$/.test(value) ? null : 'must be an integer';
    case 'number':
      return Number.isFinite(Number(value)) && Number(value) > 0
        ? null
        : 'must be a positive number';
    case 'string':
      return null;
  }
}

/**
 * True when every row names a flag and holds a value that passes
 * envValueIssue. The parent uses this to decide whether its submit button is
 * enabled — the component reports it as the second onChange argument, and the
 * parent can compute the initial value for freshly mounted state.
 */
export function envRowsValid(flags: readonly EnvFlagMeta[], rows: readonly EnvOverrideRow[]): boolean {
  const flagByKey = new Map(flags.map((flag) => [flag.key, flag]));
  return rows.every((row) => {
    if (row.key === '' || row.value.trim() === '') return false;
    const flag = flagByKey.get(row.key);
    return flag !== undefined && envValueIssue(flag, row.value) === null;
  });
}

/**
 * Projects rows into the Overrides.env record parents send to the server:
 * complete rows only, reasons dropped.
 */
export function envRowsToOverrides(rows: readonly EnvOverrideRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.key !== '' && row.value.trim() !== '').map((row) => [row.key, row.value]),
  );
}

interface GuidedEnvEditorProps {
  /** The allowlisted flags with their descriptions and value schemas. */
  flags: readonly EnvFlagMeta[];
  rows: readonly EnvOverrideRow[];
  /** Receives the new rows plus whether envRowsValid holds for them. */
  onChange: (rows: EnvOverrideRow[], valid: boolean) => void;
}

const INPUT_CLASS = 'bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]';

const VALUE_PLACEHOLDER: Record<EnvFlagMeta['kind'], string> = {
  enum: '',
  boolean: '',
  integer: 'e.g. 4',
  number: 'e.g. 7',
  string: 'value',
};

/**
 * Guided editor for live-pipeline env flags: the key is a dropdown of the
 * allowlisted flags with a plain-English description, and the value control
 * matches the flag's real schema (choices for enums/booleans, validated free
 * input otherwise). Fully controlled — the parent owns the rows.
 */
export function GuidedEnvEditor({ flags, rows, onChange }: GuidedEnvEditorProps) {
  const prefix = useId();
  const flagByKey = useMemo(() => new Map(flags.map((flag) => [flag.key, flag])), [flags]);
  const usedKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);

  const publish = useCallback(
    (next: EnvOverrideRow[]) => {
      onChange(next, envRowsValid(flags, next));
    },
    [flags, onChange],
  );

  const setKey = useCallback(
    (index: number, key: string) => {
      // A different flag has a different value schema — the old value never carries over.
      publish(rows.map((row, i) => (i === index ? { ...row, key, value: '' } : row)));
    },
    [rows, publish],
  );

  const setValue = useCallback(
    (index: number, value: string) => {
      publish(rows.map((row, i) => (i === index ? { ...row, value } : row)));
    },
    [rows, publish],
  );

  const setReason = useCallback(
    (index: number, reason: string) => {
      publish(rows.map((row, i) => (i === index ? { ...row, reason } : row)));
    },
    [rows, publish],
  );

  const removeRow = useCallback(
    (index: number) => {
      publish(rows.filter((_, i) => i !== index));
    },
    [rows, publish],
  );

  const addRow = useCallback(() => {
    publish([...rows, { ...EMPTY_ENV_ROW }]);
  }, [rows, publish]);

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const flag = row.key === '' ? undefined : flagByKey.get(row.key);
        const issue = flag !== undefined && row.value !== '' ? envValueIssue(flag, row.value) : null;
        const n = index + 1;
        return (
          <div key={`${prefix}-row-${index}`} className="border border-term-rule p-[1ch] space-y-2">
            <div className="flex items-center gap-2">
              <select
                aria-label={`flag ${n}`}
                className={`${INPUT_CLASS} flex-1`}
                value={row.key}
                onChange={(e) => setKey(index, e.target.value)}
              >
                <option value="">choose a flag…</option>
                {flag !== undefined && (
                  <option value={flag.key}>
                    {flag.label} — {flag.key}
                  </option>
                )}
                {flags
                  .filter((candidate) => candidate.key !== row.key && !usedKeys.has(candidate.key))
                  .map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.label} — {candidate.key}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                aria-label={`remove override ${n}`}
                className="px-[1ch] py-[0.5lh] border border-term-rule text-term-dim"
                onClick={() => removeRow(index)}
              >
                ✕
              </button>
            </div>

            {flag !== undefined && (
              <p className="text-term-dim">
                {flag.description} Default: {flag.defaultDescription}.
              </p>
            )}

            {flag !== undefined && (flag.kind === 'enum' || flag.kind === 'boolean') ? (
              <select
                aria-label={`value ${n}`}
                aria-invalid={issue !== null ? true : undefined}
                className={`${INPUT_CLASS} w-full`}
                value={row.value}
                onChange={(e) => setValue(index, e.target.value)}
              >
                <option value="">choose a value…</option>
                {flag.values?.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                inputMode={
                  flag?.kind === 'integer' ? 'numeric' : flag?.kind === 'number' ? 'decimal' : undefined
                }
                aria-label={`value ${n}`}
                aria-invalid={issue !== null ? true : undefined}
                placeholder={flag === undefined ? 'pick a flag first' : VALUE_PLACEHOLDER[flag.kind]}
                disabled={flag === undefined}
                className={`${INPUT_CLASS} w-full`}
                value={row.value}
                onChange={(e) => setValue(index, e.target.value)}
              />
            )}

            {issue !== null && <p className="text-term-red">{issue}</p>}

            <input
              type="text"
              aria-label={`why ${n}`}
              placeholder="why (optional)"
              className={`${INPUT_CLASS} w-full`}
              value={row.reason}
              onChange={(e) => setReason(index, e.target.value)}
            />
          </div>
        );
      })}

      {rows.length < flags.length && (
        <button
          type="button"
          className="px-[2ch] py-[0.5lh] border border-term-rule text-term-dim"
          onClick={addRow}
        >
          add flag override
        </button>
      )}
    </div>
  );
}
