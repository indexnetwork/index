import { useMemo } from 'react';

import type { EnvFlagMeta } from '../api/client';
import { FlagListbox } from './FlagListbox';

/**
 * One flag as the form holds it: one key, and one value per column.
 *
 * A single-configuration run has one column; a comparison has two. The key lives
 * on the row rather than on either column, which is what makes the asymmetric
 * pair the server refuses (a flag set on one side and omitted on the other)
 * unbuildable here rather than merely rejected after the operator has committed.
 */
export interface EnvFlagRow {
  /** Empty until the operator picks a flag. */
  key: string;
  /** One value per column id; `['single']` or `['a','b']`. */
  values: Record<string, string>;
}

interface EnvConfigEditorProps {
  /** Column ids in display order: `['single']`, or `['a','b']` for a comparison. */
  columns: readonly string[];
  /** Heading per column; empty string for the single column, which needs none. */
  columnLabels: Readonly<Record<string, string>>;
  /** The flags this harness reads, with the server's copy and value schema. */
  flags: readonly EnvFlagMeta[];
  /**
   * Whether the server's flag copy arrived. Distinguishes "this harness reads
   * nothing" from "the descriptions failed to load", which are the same empty
   * `flags` array but not the same message.
   */
  metadataLoaded: boolean;
  /**
   * Whether THIS build's generated catalogue knows the selected harness. False
   * when the server offers one the bundle predates — a third way to reach an
   * empty `flags`, and the only one where "reads no environment variables"
   * would be a claim about code this build has never seen.
   */
  knownHarness: boolean;
  rows: readonly EnvFlagRow[];
  /** The server's refusal for this column's value of `key`, if it has one. */
  issueFor: (column: string, key: string) => string | undefined;
  onKeyChange: (index: number, key: string) => void;
  onValueChange: (column: string, index: number, value: string) => void;
  /**
   * Adds a row. Handed THIS editor's columns, so the new row is shaped for the
   * shape on screen even when it is the first — the case a parent inferring the
   * shape from an existing row cannot get right.
   */
  onAddRow: (columns: readonly string[]) => void;
  onRemoveRow: (index: number) => void;
}

const INPUT_CLASS = 'bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]';

const VALUE_PLACEHOLDER: Record<EnvFlagMeta['kind'], string> = {
  enum: '',
  boolean: '',
  'csv-enum': 'e.g. intent,profile',
  integer: 'e.g. 4',
  number: 'e.g. 7',
  'decimal-range': 'e.g. 0.30',
  string: 'value',
  // Shows the shape rather than describing it: this is the one kind whose value
  // is structured, and its read site throws on a malformed one.
  'json-model-map': '{"opportunityEvaluator":"google/gemini-2.5-flash"}',
};

/**
 * The environment configuration for a run: which flags it sets, and to what.
 *
 * Every harness gets one. Before this, only the comparison harness had an env
 * editor and it offered nine flags; the catalogue is now derived from each
 * harness's own import closure (HARNESS_ENV_KEYS), so a harness offers exactly
 * the non-credential flags its code reads — twenty-eight for discovery, eight
 * for each scorecard harness — and can never offer a flag that would be recorded
 * and then ignored.
 *
 * One editor renders both shapes. A single run has one value column; a
 * comparison has two that share the row's key. Rendering them from one component
 * is what stops the two shapes from drifting into two different sets of rules
 * about what a value means.
 *
 * Fully controlled: the parent owns the rows, and every refusal shown here is
 * the server's own text passed in, so this component derives no rules of its own
 * and cannot come to disagree with what a launch will accept.
 */
export function EnvConfigEditor({
  columns,
  columnLabels,
  flags,
  metadataLoaded,
  knownHarness,
  rows,
  issueFor,
  onKeyChange,
  onValueChange,
  onAddRow,
  onRemoveRow,
}: EnvConfigEditorProps) {
  const flagByKey = useMemo(() => new Map(flags.map((flag) => [flag.key, flag])), [flags]);
  const usedKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
  const paired = columns.length > 1;

  if (flags.length === 0) {
    return (
      <div data-testid="env-editor" className="border border-term-rule p-3">
        {/* Three different causes, and telling them apart matters: the operator
            can act on two of them and cannot on the third. "Reload the page" was
            printed for both of the first two, which is false advice for a
            harness whose catalogue is genuinely empty — the descriptions loaded
            fine, and reloading will produce the same empty list forever.

            `knownHarness` is the third: this BUILD has no catalogue entry for the
            selected harness, because the server is offering one the bundle
            predates. Claiming it "reads no environment variables" would be a
            statement about code this build has never seen, and here reloading is
            exactly the right advice — the opposite of the empty-catalogue case. */}
        <p className="text-term-red">
          {!knownHarness
            ? 'This build does not know this harness, so it cannot say which environment variables it reads. Reload the page to pick up a newer build.'
            : metadataLoaded
              ? 'This harness reads no environment variables, so there is nothing to configure here.'
              : 'The flag descriptions could not be loaded, so there is nothing safe to offer here. Reload the page to configure this run.'}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="env-editor" className="border border-term-rule p-3 space-y-3">
      <p className="text-term-dim">
        Environment for this run{paired ? ', one value per side' : ''}. Only flags this harness
        actually reads are offered.
      </p>

      {rows.map((row, index) => {
        const flag = row.key === '' ? undefined : flagByKey.get(row.key);
        const n = index + 1;
        return (
          <div key={`env-row-${index}`} className="border border-term-rule p-[1ch] space-y-2">
            <div className="flex items-center gap-2">
              <FlagListbox
                flags={flags}
                takenKeys={usedKeys}
                value={row.key}
                label={`flag ${n}`}
                onChange={(key) => onKeyChange(index, key)}
              />
              <button
                type="button"
                aria-label={paired ? `remove flag ${n} from both sides` : `remove flag ${n}`}
                className="px-[1ch] py-[0.5lh] border border-term-rule text-term-dim shrink-0"
                onClick={() => onRemoveRow(index)}
              >
                ✕
              </button>
            </div>

            {flag !== undefined && (
              // whitespace-normal + break-words: descriptions are full sentences
              // naming their read site, and they overflowed the column before.
              <p className="text-term-dim whitespace-normal break-words">
                {flag.description} Default: {flag.defaultDescription}.
              </p>
            )}

            <div className={paired ? 'grid grid-cols-2 gap-2' : ''}>
              {columns.map((column) => {
                const value = row.values[column] ?? '';
                // An empty value is "not filled in yet", not a refusal: the
                // parent says that once, plainly, rather than every row shouting.
                const issue = value.trim() === '' ? undefined : issueFor(column, row.key);
                const valueLabel = paired ? `side ${column} value ${n}` : `value ${n}`;
                return (
                  <div key={column} className="space-y-1">
                    {paired && <p className="text-term-dim">{columnLabels[column]}</p>}
                    {flag !== undefined && (flag.kind === 'enum' || flag.kind === 'boolean') ? (
                      <select
                        aria-label={valueLabel}
                        aria-invalid={issue !== undefined ? true : undefined}
                        className={`${INPUT_CLASS} w-full`}
                        value={value}
                        onChange={(e) => onValueChange(column, index, e.target.value)}
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
                          flag?.kind === 'integer'
                            ? 'numeric'
                            : flag?.kind === 'number'
                              ? 'decimal'
                              : undefined
                        }
                        aria-label={valueLabel}
                        aria-invalid={issue !== undefined ? true : undefined}
                        placeholder={
                          flag === undefined ? 'pick a flag first' : VALUE_PLACEHOLDER[flag.kind]
                        }
                        disabled={flag === undefined}
                        className={`${INPUT_CLASS} w-full`}
                        value={value}
                        onChange={(e) => onValueChange(column, index, e.target.value)}
                      />
                    )}
                    {issue !== undefined && (
                      <p className="text-term-red whitespace-normal break-words">{issue}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {rows.length < flags.length && (
        <button
          type="button"
          className="px-[2ch] py-[0.5lh] border border-term-rule text-term-dim"
          onClick={() => onAddRow(columns)}
        >
          {/* One control, not one per column: a key belongs to the row, so two
              buttons were two ways to do the identical thing. */}
          {paired ? 'add flag to both sides' : 'add flag'}
        </button>
      )}
    </div>
  );
}
