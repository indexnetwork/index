import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Frame } from '../components/Frame';
import { StatusChip } from '../components/StatusChip';
import { LogView } from '../components/LogView';
import { CaseTable } from '../components/CaseTable';
import { api, subscribeToRun, type RunRecord, type RunStatus } from '../api/client';

interface Artifact {
  payload: {
    cases: Array<{
      caseId: string;
      rule: string;
      runs: number;
      passes: number;
      passRate: number;
      flaky: boolean;
    }>;
    aggregatePassRate: number;
  };
}

interface ComparabilityFinding {
  dimension: 'harness' | 'corpusFingerprint' | 'configFingerprint' | 'selection';
  reference: string;
  subject: string;
}

interface BaselineDiff {
  regressions: Array<{
    id: string;
    kind: 'case' | 'rule';
    before: number;
    after: number;
    pValue: number;
  }>;
  skippedCaseIds: string[];
  addedCaseIds: string[];
  removedCaseIds: string[];
  unscoredCaseIds: string[];
}

type CompareOutcome =
  | { comparable: false; findings: ComparabilityFinding[] }
  | {
      comparable: true;
      regressions: BaselineDiff;
      improvements: BaselineDiff;
      aggregate: { reference: number; subject: number; delta: number };
    };

interface RunState {
  run: RunRecord | null;
  log: string;
  artifact: Artifact | null;
  baseline: Artifact | null;
  comparison: CompareOutcome | null;
  error: string | null;
}

const TERMINAL_STATUSES: RunStatus[] = [
  'passed',
  'regression',
  'execution-error',
  'insufficient-evidence',
  'cancelled',
  'interrupted',
  'crashed',
];

function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function Run() {
  const { runId } = useParams<{ runId: string }>();
  
  if (!runId) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">Run ID is required</p>
        </Frame>
      </div>
    );
  }
  const [state, setState] = useState<RunState>({
    run: null,
    log: '',
    artifact: null,
    baseline: null,
    comparison: null,
    error: null,
  });
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let logAccumulator = '';
    let mounted = true;

    const unsubscribe = subscribeToRun(runId, {
      onLog: (chunk: string) => {
        if (!mounted) return;
        logAccumulator += chunk;
        setState((prev) => ({ ...prev, log: logAccumulator }));
      },
      onStatus: (record: RunRecord) => {
        if (!mounted) return;
        setState((prev) => ({ ...prev, run: record }));

        // Fetch artifact and comparison when the run finishes
        if (isTerminal(record.status) && record.artifactPath !== null) {
          void fetchArtifactAndComparison(record);
        }
      },
      onError: (_event: Event) => {
        // EventSource auto-reconnects. On reconnect, the server replays from byte 0.
        // Reset the accumulator so we don't duplicate the log.
        logAccumulator = '';
        setState((prev) => ({ ...prev, log: '' }));
      },
    });

    async function fetchArtifactAndComparison(record: RunRecord) {
      if (!record.artifactPath || record.spec.kind !== 'eval') return;

      try {
        const artifact = (await api.artifact(
          btoa(record.artifactPath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
        )) as Artifact;

        if (!mounted) return;
        setState((prev) => ({ ...prev, artifact }));

        // Only compare if non-experimental
        if (!record.experimental) {
          try {
            const artifacts = await api.artifacts();
            const baseline = artifacts.refs
              .filter((ref) => ref.harness === record.spec.harness && ref.kind === 'baseline')
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

            if (baseline && mounted) {
              const baselineArtifact = (await api.artifact(baseline.id)) as Artifact;
              const comparison = (await api.compare(baseline.id, btoa(record.artifactPath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''))) as CompareOutcome;

              if (mounted) {
                setState((prev) => ({
                  ...prev,
                  baseline: baselineArtifact,
                  comparison,
                }));
              }
            }
          } catch (error) {
            // Comparison failure is not fatal - just don't show the diff
            console.warn('Failed to fetch comparison:', error);
          }
        }
      } catch (error) {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    }

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [runId]);

  async function handleCancel() {
    if (!state.run || cancelling) return;
    setCancelling(true);
    try {
      await api.cancel(runId);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setCancelling(false);
    }
  }

  if (state.error !== null) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">{state.error}</p>
        </Frame>
      </div>
    );
  }

  if (state.run === null) {
    return (
      <div className="p-4">
        <p className="text-term-dim">Loading...</p>
      </div>
    );
  }

  const run = state.run;
  const isRunning = run.status === 'running' || run.status === 'queued';

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-4">
        <Link to="/" className="text-term-blue hover:underline">
          ← overview
        </Link>
      </div>

      <Frame label="run">
        <div className="space-y-2">
          <div className="flex gap-4">
            <span className="text-term-dim w-24">id:</span>
            <span className="font-mono">{run.id}</span>
          </div>

          {run.spec.kind === 'eval' ? (
            <>
              <div className="flex gap-4">
                <span className="text-term-dim w-24">harness:</span>
                <Link to={`/h/${run.spec.harness}`} className="text-term-blue hover:underline">
                  {run.spec.harness}
                </Link>
              </div>
              <div className="flex gap-4">
                <span className="text-term-dim w-24">profile:</span>
                <span>{run.spec.profile}</span>
              </div>
            </>
          ) : (
            <div className="flex gap-4">
              <span className="text-term-dim w-24">type:</span>
              <span>fixture-reset</span>
              <span className="text-term-dim ml-4">personas:</span>
              <span>{run.spec.personas}</span>
              <span className="text-term-dim ml-4">database:</span>
              <span>{run.spec.databaseName}</span>
            </div>
          )}

          <div className="flex gap-4 items-center">
            <span className="text-term-dim w-24">status:</span>
            <StatusChip status={run.status} />
            {run.endedAt && run.exitCode !== null && (
              <span className="text-term-dim ml-4">exit {run.exitCode}</span>
            )}
            {run.endedAt && (
              <span className="text-term-dim ml-4">
                {formatDuration(new Date(run.startedAt || run.createdAt), new Date(run.endedAt))}
              </span>
            )}
            {isRunning && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="ml-auto px-2 py-1 text-term-yellow border border-term-rule hover:bg-term-panel disabled:opacity-50"
              >
                {cancelling ? 'cancelling...' : 'cancel'}
              </button>
            )}
          </div>

          <div className="flex gap-4">
            <span className="text-term-dim w-24">command:</span>
            <span className="font-mono text-sm">
              {run.argv.length > 0
                ? run.argv.join(' ')
                : run.steps?.map((s) => s.argv.join(' ')).join(' && ') || '—'}
            </span>
          </div>

          {run.spec.kind === 'eval' && (
            <div className="flex gap-4">
              <span className="text-term-dim w-24">workload:</span>
              <span>
                {run.workload} case-runs
                {run.spec.flags.runs && ` (${run.spec.flags.runs} runs/case)`}
              </span>
            </div>
          )}
        </div>
      </Frame>

      {run.experimental && (
        <Frame label="experimental">
          <p className="text-term-yellow">
            Experimental configuration — this run is not compared to the committed
            baseline, and was not saved as rolling-baseline fuel.
          </p>
        </Frame>
      )}

      {state.artifact && (
        <Frame label="scorecard">
          <div className="space-y-2">
            <div className="flex gap-4">
              <span className="text-term-dim w-32">aggregate pass rate:</span>
              <span>{(state.artifact.payload.aggregatePassRate * 100).toFixed(1)}%</span>
            </div>
            <CaseTable
              cases={state.artifact.payload.cases}
              baseline={state.baseline?.payload.cases}
            />
          </div>
        </Frame>
      )}

      {state.comparison && !run.experimental && (
        <Frame label="baseline diff">
          {state.comparison.comparable ? (
            <div className="space-y-2">
              <div className="flex gap-4">
                <span className="text-term-dim w-32">reference:</span>
                <span>{(state.comparison.aggregate.reference * 100).toFixed(1)}%</span>
              </div>
              <div className="flex gap-4">
                <span className="text-term-dim w-32">subject:</span>
                <span>{(state.comparison.aggregate.subject * 100).toFixed(1)}%</span>
              </div>
              <div className="flex gap-4">
                <span className="text-term-dim w-32">delta:</span>
                <Delta value={state.comparison.aggregate.delta} />
              </div>

              {state.comparison.regressions.regressions.length > 0 && (
                <div className="mt-4">
                  <p className="text-term-red mb-2">
                    Regressions ({state.comparison.regressions.regressions.length}):
                  </p>
                  <div className="space-y-1 ml-4">
                    {state.comparison.regressions.regressions.map((reg) => (
                      <div key={reg.id} className="font-mono text-sm">
                        <span className="text-term-dim">{reg.kind}:</span> {reg.id}{' '}
                        <span className="text-term-dim">
                          {(reg.before * 100).toFixed(1)}% → {(reg.after * 100).toFixed(1)}%
                        </span>
                        {' '}
                        <span className="text-term-dim">(p={reg.pValue.toFixed(3)})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {state.comparison.improvements.regressions.length > 0 && (
                <div className="mt-4">
                  <p className="text-term-green mb-2">
                    Improvements ({state.comparison.improvements.regressions.length}):
                  </p>
                  <div className="space-y-1 ml-4">
                    {state.comparison.improvements.regressions.map((reg) => (
                      <div key={reg.id} className="font-mono text-sm">
                        <span className="text-term-dim">{reg.kind}:</span> {reg.id}{' '}
                        <span className="text-term-dim">
                          {(reg.before * 100).toFixed(1)}% → {(reg.after * 100).toFixed(1)}%
                        </span>
                        {' '}
                        <span className="text-term-dim">(p={reg.pValue.toFixed(3)})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-term-yellow">Not comparable:</p>
              <div className="ml-4 space-y-1">
                {state.comparison.findings.map((finding, i) => (
                  <div key={i} className="font-mono text-sm">
                    <span className="text-term-dim">{finding.dimension}:</span>
                    <div className="ml-4">
                      <div>
                        <span className="text-term-dim">reference:</span> {finding.reference}
                      </div>
                      <div>
                        <span className="text-term-dim">subject:</span> {finding.subject}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Frame>
      )}

      <Frame label="log">
        <LogView text={state.log} />
      </Frame>
    </div>
  );
}

function Delta({ value }: { value: number }) {
  if (Math.abs(value) < 0.001) return <span className="text-term-dim">—</span>;
  const sign = value > 0 ? '+' : '';
  const arrow = value > 0 ? '↑' : '↓';
  const className = value > 0 ? 'text-term-green' : 'text-term-red';
  return (
    <span className={className}>
      {arrow} {sign}
      {(value * 100).toFixed(1)}%
    </span>
  );
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
