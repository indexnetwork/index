import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { SUPPORTS_SIDES } from '../../../../packages/protocol/eval/ops/ops.sides';
import { Frame } from '../components/Frame';
import { QualityCompleteness } from '../components/QualityCompleteness';
import { StatusChip } from '../components/StatusChip';
import { api, type HarnessDescriptor, type ArtifactRef, type IndexIssue, type RunRecord, type FixtureStatus } from '../api/client';

interface OverviewState {
  harnesses: HarnessDescriptor[];
  artifacts: ArtifactRef[];
  artifactIssues: IndexIssue[];
  runs: RunRecord[];
  runIssues: IndexIssue[];
  fixture: FixtureStatus | null;
  error: string | null;
}

export function Overview() {
  const [state, setState] = useState<OverviewState>({
    harnesses: [],
    artifacts: [],
    artifactIssues: [],
    runs: [],
    runIssues: [],
    fixture: null,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    Promise.all([api.harnesses(), api.artifacts(), api.runs(), api.fixture()])
      .then(([harnesses, artifacts, runs, fixture]) => {
        if (mounted) {
          setState({
            harnesses: harnesses.harnesses,
            artifacts: artifacts.refs,
            artifactIssues: artifacts.issues,
            runs: runs.runs,
            runIssues: runs.issues,
            fixture,
            error: null,
          });
        }
      })
      .catch((error) => {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (state.error !== null) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">{state.error}</p>
        </Frame>
      </div>
    );
  }

  const allIssues = [...state.artifactIssues, ...state.runIssues];

  return (
    <div className="p-4 space-y-4">
      <Frame label="harness health">
        <HarnessHealth
          harnesses={state.harnesses}
          artifacts={state.artifacts}
        />
      </Frame>

      <Frame label="recent runs">
        <RecentRuns runs={state.runs.slice(0, 10)} />
      </Frame>

      <Frame label="fixture status">
        <FixtureStatusView status={state.fixture} />
      </Frame>

      {allIssues.length > 0 && (
        <Frame label="index issues">
          <IndexIssues issues={allIssues} />
        </Frame>
      )}
    </div>
  );
}

function HarnessHealth({
  harnesses,
  artifacts,
}: {
  harnesses: HarnessDescriptor[];
  artifacts: ArtifactRef[];
}) {
  if (harnesses.length === 0) {
    return <p className="text-term-dim">No harnesses configured.</p>;
  }

  return (
    <div className="space-y-2">
      {harnesses.map((harness) => {
        const baseline = artifacts
          .filter((a) => a.harness === harness.harness && a.kind === 'baseline')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const latestRun = artifacts
          .filter((a) => a.harness === harness.harness && a.kind === 'run')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

        return (
          <div key={harness.harness}>
            <div className="flex gap-4">
              <Link
                to={`/h/${harness.harness}`}
                className="text-term-blue hover:underline w-24"
              >
                {harness.harness}
              </Link>
              {latestRun?.measurementKind === 'historical-quality-pilot' ? (
                <>
                  <span className="text-term-dim">historical quality:</span>
                  <QualityCompleteness completeness={latestRun.qualityCompleteness} />
                </>
              ) : SUPPORTS_SIDES[harness.harness] ? (
                /**
                 * This harness gets neither cell, because neither number exists
                 * for it. It reads, writes and compares no baseline by design —
                 * in either of its shapes — so "baseline: —" would state a
                 * missing value rather than an absent concept; and a comparison
                 * run's aggregate is the mean across two DIFFERENT
                 * configurations, so showing it as "latest" would put a score of
                 * neither side in a column read as a score of the harness. What
                 * a run measured is on the run page.
                 */
                <span className="text-term-dim" data-testid={`harness-sides-${harness.harness}`}>
                  operator-chosen configurations — no baseline to score against, and a comparison
                  run's aggregate is the mean over both sides, so it is a score of neither
                </span>
              ) : (
                <>
                  <span className="text-term-dim w-20">baseline:</span>
                  <span className="w-16">
                    {baseline
                      ? `${(baseline.aggregatePassRate * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                  <span className="text-term-dim w-20">latest:</span>
                  <span className="w-16">
                    {latestRun
                      ? `${(latestRun.aggregatePassRate * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                  {baseline && latestRun && (
                    <Delta
                      baseline={baseline.aggregatePassRate}
                      current={latestRun.aggregatePassRate}
                    />
                  )}
                </>
              )}
            </div>
            <p className="text-term-dim ml-28 -mt-1">{harness.question}</p>
          </div>
        );
      })}
    </div>
  );
}

function Delta({ baseline, current }: { baseline: number; current: number }) {
  const delta = current - baseline;
  if (Math.abs(delta) < 0.001) return <span className="text-term-dim">—</span>;
  const sign = delta > 0 ? '+' : '';
  const arrow = delta > 0 ? '↑' : '↓';
  const className = delta > 0 ? 'text-term-green' : 'text-term-red';
  return (
    <span className={className}>
      {arrow} {sign}
      {(delta * 100).toFixed(1)}%
    </span>
  );
}

function RecentRuns({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) {
    return <p className="text-term-dim">No runs yet.</p>;
  }

  return (
    <div className="space-y-1">
      {runs.map((run) => (
        <div key={run.id} className="flex gap-4">
          <StatusChip status={run.status} />
          <Link to={`/r/${run.id}`} className="w-24 text-term-blue hover:underline">
            {run.spec.kind === 'eval' ? run.spec.harness : 'fixture-reset'}
          </Link>
          <span className="text-term-dim">
            {run.spec.kind === 'eval' ? run.spec.profile : `${run.spec.personas} personas`}
          </span>
          <span className="text-term-dim ml-auto">
            {formatAge(run.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

function FixtureStatusView({ status }: { status: FixtureStatus | null }) {
  if (status === null) {
    return <p className="text-term-dim">Loading...</p>;
  }

  if (!status.allowed) {
    return <p className="text-term-yellow">{status.reason}</p>;
  }

  return (
    <div className="space-y-1">
      <p>
        <span className="text-term-dim">database: </span>
        {status.target.databaseName}
      </p>
      {status.personaCount !== null && (
        <p>
          <span className="text-term-dim">personas: </span>
          {status.personaCount}
        </p>
      )}
      {status.countsError !== null && (
        <p className="text-term-yellow">{status.countsError}</p>
      )}
    </div>
  );
}

function IndexIssues({ issues }: { issues: IndexIssue[] }) {
  return (
    <div className="space-y-1">
      {issues.map((issue, i) => (
        <div key={i} className="text-term-yellow">
          <span className="text-term-dim">{issue.path}: </span>
          {issue.message}
        </div>
      ))}
    </div>
  );
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
