import { useMemo } from 'react';

import type { EnvFlagMeta } from '../api/client';

/** One flag on one side: the key is shared with the other side, the value is not. */
export interface SideEnvRow {
  /** Empty until the operator picks a flag. */
  key: string;
  value: string;
}

interface SideEnvEditorProps {
  /** The engine's own side ids, as they appear in the artifact and in argv. */
  side: 'a' | 'b';
  heading: string;
  /** The flags this harness can test, with the copy and value schema for each. */
  flags: readonly EnvFlagMeta[];
  rows: readonly SideEnvRow[];
  /** The server's refusal for this side's value of `key`, if it has one. */
  issueFor: (key: string) => string | undefined;
  /**
   * Adding, renaming and removing a flag are NOT per-side operations: a flag set
   * on one side and omitted on the other is refused (the omitted side would take
   * the graph's own default, which may equal the other side's value, so the run
   * could measure nothing while reporting a difference). The parent therefore
   * applies all three to both sides, and the copy under the add button says so.
   */
  onKeyChange: (index: number, key: string) => void;
  onRemoveRow: (index: number) => void;
  onAddRow: () => void;
  /** The only per-side edit there is. */
  onValueChange: (index: number, value: string) => void;
}

const INPUT_CLASS = 'bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]';

const VALUE_PLACEHOLDER: Record<EnvFlagMeta['kind'], string> = {
  enum: '',
  boolean: '',
  'csv-enum': 'e.g. intent,profile',
  integer: 'e.g. 4',
  number: 'e.g. 7',
  string: 'value',
};

/**
 * One of the two environment configurations a discovery-ab run compares.
 *
 * The key column is the same on both sides by construction — the parent holds
 * one row per flag and hands each side its own value — so the form cannot build
 * the asymmetric pair the server refuses. Value controls match each flag's real
 * read site (a choice list for enums and booleans, free entry otherwise), and
 * every refusal shown here is the server's own text, passed in by the parent:
 * this component derives no rules of its own, so it cannot come to disagree with
 * what a launch will accept.
 *
 * Fully controlled; the parent owns the rows.
 */
export function SideEnvEditor({
  side,
  heading,
  flags,
  rows,
  issueFor,
  onKeyChange,
  onValueChange,
  onAddRow,
  onRemoveRow,
}: SideEnvEditorProps) {
  const flagByKey = useMemo(() => new Map(flags.map((flag) => [flag.key, flag])), [flags]);
  const usedKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);

  return (
    <div data-testid={`side-${side}`} className="border border-term-rule p-3 space-y-3">
      <p className="text-term-cyan">{heading}</p>

      {flags.length === 0 && (
        <p className="text-term-red">
          The flag descriptions could not be loaded, so there is nothing safe to offer here. Reload
          the page to configure this run.
        </p>
      )}

      {rows.map((row, index) => {
        const flag = row.key === '' ? undefined : flagByKey.get(row.key);
        // An empty value is "not filled in yet", not a refusal: the parent says
        // so once, below both columns, rather than every row shouting it.
        const issue = row.value.trim() === '' ? undefined : issueFor(row.key);
        const n = index + 1;
        return (
          <div key={`side-${side}-row-${index}`} className="border border-term-rule p-[1ch] space-y-2">
            <div className="flex items-center gap-2">
              <select
                aria-label={`side ${side} flag ${n}`}
                className={`${INPUT_CLASS} flex-1`}
                value={row.key}
                onChange={(e) => onKeyChange(index, e.target.value)}
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
                aria-label={`remove flag ${n} from both sides`}
                className="px-[1ch] py-[0.5lh] border border-term-rule text-term-dim"
                onClick={() => onRemoveRow(index)}
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
                aria-label={`side ${side} value ${n}`}
                aria-invalid={issue !== undefined ? true : undefined}
                className={`${INPUT_CLASS} w-full`}
                value={row.value}
                onChange={(e) => onValueChange(index, e.target.value)}
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
                aria-label={`side ${side} value ${n}`}
                aria-invalid={issue !== undefined ? true : undefined}
                placeholder={flag === undefined ? 'pick a flag first' : VALUE_PLACEHOLDER[flag.kind]}
                disabled={flag === undefined}
                className={`${INPUT_CLASS} w-full`}
                value={row.value}
                onChange={(e) => onValueChange(index, e.target.value)}
              />
            )}

            {issue !== undefined && <p className="text-term-red">{issue}</p>}
          </div>
        );
      })}

      {rows.length < flags.length && (
        <button
          type="button"
          className="px-[2ch] py-[0.5lh] border border-term-rule text-term-dim"
          onClick={onAddRow}
        >
          add flag to both sides
        </button>
      )}
    </div>
  );
}
