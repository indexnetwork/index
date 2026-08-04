import { useMemo } from 'react';

import { Frame } from './Frame';
import { deriveAbView, type AbCasePair, type AbConfigRow, type AbSideCase, type AbSideId, type AbSideSummary, type AbSideValue } from '../lib/ab';
import type { Artifact } from '../api/client';

/**
 * A finished discovery A/B run, read as the pair it is.
 *
 * Every number here is derived from the artifact's own rows (see src/lib/ab.ts):
 * the two sides come from `payload.rules`, and the configuration difference is
 * reconstructed from the `configDeltas` each side repeats on the case rows it
 * owns, because that is the only place a configuration reaches disk.
 *
 * Nothing on this page compares the run to a baseline, and nothing offers to
 * write one. Two arbitrary operator-chosen configurations have no committed
 * baseline and never will (`discovery-ab --help`: "It never reads, writes or
 * compares a baseline"), so a regression verdict against one would be invented.
 */
export function AbComparison({ artifact }: { artifact: Artifact }) {
  // No React compiler here: without this the whole derivation re-runs on every
  // log chunk the run page streams.
  const view = useMemo(() => deriveAbView(artifact), [artifact]);

  return (
    <Frame label="a/b comparison">
      <div className="space-y-4">
        <p className="text-term-dim">
          The same cases run twice, once per operator-chosen configuration. This harness reads, writes
          and compares no baseline — two arbitrary configurations have none — so the pair is the result.
        </p>

        {view.kind === 'no-verdict' ? (
          <div className="space-y-1">
            <p className="text-term-yellow">No verdict: {view.reason}</p>
            <p className="text-term-dim">
              What each side was configured to do is still shown below; what it scored is not, because
              these rows do not support a comparison.
            </p>
          </div>
        ) : (
          <SideSummaries sides={view.sides} />
        )}

        <ConfigDifference rows={view.config} />

        {view.kind === 'comparison' && <PairTable pairs={view.pairs} />}

        {view.unpairedCaseIds.length > 0 && (
          <p className="text-term-yellow">
            {view.unpairedCaseIds.length} case row(s) name no side of this run and are not compared:{' '}
            <span className="font-mono">{view.unpairedCaseIds.join(', ')}</span>
          </p>
        )}
      </div>
    </Frame>
  );
}

/**
 * The two sides and the gap between them.
 *
 * "reference" and "candidate" are the reading direction, not a claim of
 * authority: the engine requires side `a` first and side `b` second and computes
 * every difference as a → b (`assertOrderedDistinctSides` and `configDiff`,
 * services/api/src/cli/discovery-ab.plan.ts), so B is what A is read against.
 */
function SideSummaries({ sides }: { sides: Record<AbSideId, AbSideSummary> }) {
  const delta = sides.b.passRate - sides.a.passRate;
  return (
    <div className="space-y-2">
      <SideLine summary={sides.a} role="reference" />
      <SideLine summary={sides.b} role="candidate" />
      <div className="flex gap-4">
        <span className="text-term-dim w-40">difference (B − A):</span>
        <Delta value={delta} />
      </div>
      <p className="text-term-dim">
        Side a runs first and every difference is read as a → b, so B is the candidate and A is what it
        is measured against. Neither is a committed baseline.
      </p>
    </div>
  );
}

function SideLine({ summary, role }: { summary: AbSideSummary; role: 'reference' | 'candidate' }) {
  return (
    <div className="flex gap-4" data-testid={`ab-side-${summary.id}`}>
      <span className="text-term-dim w-40">
        {summary.id.toUpperCase()} · side {summary.id} <span className="text-term-cyan">{role}</span>:
      </span>
      <span>{(summary.passRate * 100).toFixed(1)}%</span>
      <span className="text-term-dim">
        {summary.passes}/{summary.runs} case-runs passed across {summary.caseCount} case(s)
      </span>
    </div>
  );
}

/**
 * What the two sides were, and where they parted.
 *
 * Keys held equal on both sides are shown as well as the ones that differ: a
 * reader needs to know what was held constant to know what the difference is
 * attributable to.
 */
function ConfigDifference({ rows }: { rows: AbConfigRow[] }) {
  const differing = rows.filter((row) => row.differs);
  const shared = rows.filter((row) => !row.differs);

  return (
    <div className="space-y-2">
      <p className="text-term-dim">configuration difference</p>

      {rows.length === 0 ? (
        <p className="text-term-yellow">
          No case row records a configuration, so what these two sides were cannot be read from this
          artifact.
        </p>
      ) : differing.length === 0 ? (
        <p className="text-term-yellow">
          The two sides recorded no difference: every flag holds the same value on both, so this run
          measured nothing.
        </p>
      ) : (
        <table className="font-mono text-sm">
          <thead>
            <tr className="text-term-dim border-b border-term-rule">
              <th className="text-left py-1 pr-4">flag</th>
              <th className="text-left py-1 pr-4">A · side a</th>
              <th className="text-left py-1">B · side b</th>
            </tr>
          </thead>
          <tbody>
            {differing.map((row) => (
              <tr key={row.key} data-testid={`ab-config-${row.key}`} className="border-b border-term-rule/30">
                <td className="py-1 pr-4">{row.key}</td>
                <td className="py-1 pr-4">
                  <SideValue value={row.a} />
                </td>
                <td className="py-1">
                  <SideValue value={row.b} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {shared.length > 0 && (
        <p className="text-term-dim">
          Held equal on both sides:{' '}
          <span className="font-mono">
            {shared.map((row) => `${row.key}=${describe(row.a)}`).join(', ')}
          </span>
        </p>
      )}
    </div>
  );
}

/** A side's value for one flag, or the reason it cannot be stated as one value. */
function SideValue({ value }: { value: AbSideValue }) {
  if (value.kind === 'set') return <span>{value.value}</span>;
  if (value.kind === 'unset') return <span className="text-term-dim">unset</span>;
  if (value.kind === 'unrecorded') {
    return <span className="text-term-yellow">not recorded — this side scored no rows</span>;
  }
  return (
    <span className="text-term-yellow">
      rows disagree: {value.values.join(', ')}
      {value.unsetOnSomeRows && ', unset on some rows'}
    </span>
  );
}

function describe(value: AbSideValue): string {
  if (value.kind === 'set') return value.value;
  if (value.kind === 'unset') return 'unset';
  if (value.kind === 'unrecorded') return 'not recorded';
  return `rows disagree (${value.values.join(', ')})`;
}

/**
 * One row per case, both sides side by side.
 *
 * A case is one row however many times it was repeated: the artifact files each
 * repetition as a case row of its own, so the repetitions are summed here (see
 * src/lib/ab.ts) and the count is shown beside the rate. A case where the sides
 * parted and a case where they agreed are told apart by words first ("same"
 * against a signed difference) and colour second, so the distinction survives a
 * monochrome screen.
 */
function PairTable({ pairs }: { pairs: AbCasePair[] }) {
  return (
    <div className="font-mono text-sm overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-term-dim border-b border-term-rule">
            <th className="text-left py-1 pr-4" style={{ width: '34ch' }}>
              case
            </th>
            <th className="text-right py-1 pr-4" style={{ width: '12ch' }}>
              A
            </th>
            <th className="text-right py-1 pr-4" style={{ width: '12ch' }}>
              B
            </th>
            <th className="text-left py-1 pr-4" style={{ width: '20ch' }}>
              B − A
            </th>
            <th className="text-left py-1" style={{ width: '16ch' }}>
              {/* flaky marker column */}
            </th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair) => (
            <tr
              key={pair.id}
              data-testid={`ab-case-${pair.id}`}
              className={pair.differs ? 'border-b border-term-rule/30' : 'border-b border-term-rule/30 text-term-dim'}
            >
              <td className="py-1 pr-4 truncate" style={{ maxWidth: '34ch' }} title={pair.id}>
                {pair.id}
              </td>
              <td className="py-1 pr-4 text-right">{scored(pair.a)}</td>
              <td className="py-1 pr-4 text-right">{scored(pair.b)}</td>
              <td className="py-1 pr-4">
                {pair.delta === null ? (
                  <span className="text-term-yellow">one side scored none of this case</span>
                ) : pair.differs ? (
                  <span className={pair.delta > 0 ? 'text-term-green' : 'text-term-red'}>
                    {pair.delta > 0 ? '+' : ''}
                    {(pair.delta * 100).toFixed(1)}% · B {pair.delta > 0 ? 'higher' : 'lower'}
                  </span>
                ) : (
                  <span className="text-term-dim">same</span>
                )}
              </td>
              <td className="py-1">
                {pair.flakySides.length > 0 && (
                  <span
                    className="text-term-yellow"
                    title="this case both passed and failed across its repetitions, so its rate is not a settled result"
                  >
                    ⚠ flaky on {pair.flakySides.map((side) => side.toUpperCase()).join(' and ')}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One side's reading of a case: its rate, and how many repetitions it is over. */
function scored(side: AbSideCase | null): string {
  if (side === null) return '—';
  return `${(side.passRate * 100).toFixed(1)}% (${side.passes}/${side.runs})`;
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-term-dim">same on both sides</span>;
  const className = value > 0 ? 'text-term-green' : 'text-term-red';
  return (
    <span className={className}>
      {value > 0 ? '+' : ''}
      {(value * 100).toFixed(1)}%
    </span>
  );
}
