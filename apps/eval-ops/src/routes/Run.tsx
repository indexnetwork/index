import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';

import { SUPPORTS_SIDES } from '../../../../packages/protocol/eval/ops/ops.sides';
import { AbComparison } from '../components/AbComparison';
import { Frame } from '../components/Frame';
import { StatusChip } from '../components/StatusChip';
import { LogView } from '../components/LogView';
import { CaseTable } from '../components/CaseTable';
import { HistoricalQualityReport } from '../components/HistoricalQualityReport';
import { RunProgressView } from '../components/RunProgress';
import { HarnessProgressParser, type RunProgress } from '../../../../packages/protocol/eval/ops/ops.progress';
import { api, encodeArtifactId, isHistoricalQualityArtifact, isTerminalStatus, subscribeToRun, type Artifact, type CompareResult, type HarnessDescriptor, type RunRecord } from '../api/client';

interface RunState {
  run: RunRecord | null;
  log: string;
  progress: RunProgress | null;
  harnesses: HarnessDescriptor[];
  artifact: Artifact | null;
  baseline: Artifact | null;
  comparison: CompareResult | null;
  comparisonError: string | null;
  error: string | null;
  /** Artifact classification completed without a usable artifact. */
  artifactUnavailable: boolean;
  /** Set when the stream fails before any status frame arrives. */
  streamError: string | null;
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

  return <RunDetail key={runId} runId={runId} />;
}

function RunDetail({ runId }: { runId: string }) {
  const [state, setState] = useState<RunState>({
    run: null,
    log: '',
    progress: null,
    harnesses: [],
    artifact: null,
    baseline: null,
    comparison: null,
    comparisonError: null,
    error: null,
    artifactUnavailable: false,
    streamError: null,
  });
  const [cancelling, setCancelling] = useState(false);
  const [showRawLog, setShowRawLog] = useState(false);
  const parserRef = useRef(new HarnessProgressParser());
  /** First-seen and completion timestamps per case id, for live durations. */
  const caseTimesRef = useRef(new Map<string, number>());

  useEffect(() => {
    let logAccumulator = '';
    let mounted = true;
    let sawStatus = false;
    let closed = false;

    const feedProgress = (chunk: string) => {
      parserRef.current.push(chunk);
      const snapshot = parserRef.current.snapshot();
      const times = caseTimesRef.current;
      const nowMs = Date.now();
      for (const c of snapshot.cases) {
        if (!times.has(c.id)) times.set(c.id, nowMs);
        if (c.done && !times.has(`${c.id}::done`)) times.set(`${c.id}::done`, nowMs);
      }
      return snapshot;
    };

    const unsubscribe = subscribeToRun(runId, {
      onLog: (chunk: string) => {
        if (!mounted) return;
        logAccumulator += chunk;
        const progress = feedProgress(chunk);
        setState((prev) => ({ ...prev, log: logAccumulator, progress }));
      },
      onStatus: (record: RunRecord) => {
        if (!mounted) return;
        sawStatus = true;
        setState((prev) => ({ ...prev, run: record, streamError: null }));

        // Fetch artifact and comparison when the run finishes
        if (isTerminalStatus(record.status) && record.artifactPath !== null) {
          void fetchArtifactAndComparison(record);
        }

        // The server closes the stream once a run is terminal. A browser
        // EventSource treats a closed stream as an error and reconnects every
        // ~3s forever, and each reconnect replays the whole log from byte 0.
        // Nothing further can arrive, so stop listening.
        if (isTerminalStatus(record.status)) {
          closed = true;
          unsubscribe();
        }
      },
      onError: (_event: Event) => {
        if (!mounted || closed) return;

        // A stream that errors before ever delivering a status frame is not a
        // transient reconnect: the run id does not resolve (the server 404s an
        // unknown id). Say so, rather than showing "Loading..." forever.
        if (!sawStatus) {
          closed = true;
          unsubscribe();
          setState((prev) => ({
            ...prev,
            streamError:
              `No run with id "${runId}" is available to stream. `
              + 'It may have been removed, or this may be an artifact id rather than a run id.',
          }));
          return;
        }

        // Mid-stream failure: EventSource reconnects and the server replays from
        // byte 0, so reset the accumulator AND the parser to avoid rendering
        // the log twice or counting every case a second time.
        logAccumulator = '';
        parserRef.current = new HarnessProgressParser();
        caseTimesRef.current.clear();
        setState((prev) => ({ ...prev, log: '', progress: null }));
      },
    });

    // The harness's own description of what this run answers, shown next to
    // its name. A courtesy line: never let it break the run page.
    void api.harnesses().then((result) => {
      if (!mounted) return;
      const harnesses = result.harnesses ?? [];
      setState((prev) => ({ ...prev, harnesses }));
    }).catch(() => {});

    async function fetchArtifactAndComparison(record: RunRecord) {
      const { artifactPath, spec } = record;
      if (!artifactPath) return;

      const artifactId = encodeArtifactId(artifactPath);

      try {
        const artifact = (await api.artifact(artifactId)) as Artifact;

        if (!mounted) return;

        // Classification is resolved before publishing the artifact so a quality
        // result can atomically discard every scorecard-only presentation state.
        if (isHistoricalQualityArtifact(artifact)) {
          setShowRawLog(false);
          setState((prev) => ({
            ...prev,
            artifact,
            baseline: null,
            comparison: null,
            comparisonError: null,
            artifactUnavailable: false,
          }));
          return;
        }

        setState((prev) => ({ ...prev, artifact, artifactUnavailable: false }));

        if (spec.kind !== 'eval') return;

        // Only compare if non-experimental, and never for a harness that runs
        // operator-chosen configurations: it has no committed baseline and never
        // will, in EITHER of its shapes (`discovery --help`: "Runs the real
        // discovery graph under one operator-chosen environment configuration,
        // or under two … It never reads, writes or compares a baseline"). So
        // asking for one would at best find nothing and at worst diff this run
        // against another harness's artifact.
        //
        // Keyed on the HARNESS, unlike the pair view below: a single discovery
        // run has one scorecard and still has no baseline to score it against.
        if (!record.experimental && !SUPPORTS_SIDES[spec.harness]) {
          try {
            const artifacts = await api.artifacts();
            const baseline = artifacts.refs
              .filter((ref) => ref.harness === spec.harness && ref.kind === 'baseline')
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

            if (baseline && mounted) {
              const baselineArtifact = (await api.artifact(baseline.id)) as Artifact;
              const comparison = await api.compare(baseline.id, artifactId);

              if (mounted) {
                setState((prev) => ({
                  ...prev,
                  baseline: baselineArtifact,
                  comparison,
                }));
              }
            }
          } catch (error) {
            // A comparison failure is not fatal: the run and its scorecard are
            // still worth showing. Surface it in the UI rather than logging it,
            // so a missing baseline diff is never silently indistinguishable
            // from "there was nothing to compare".
            if (mounted) {
              setState((prev) => ({
                ...prev,
                comparisonError:
                  error instanceof Error ? error.message : String(error),
              }));
            }
          }
        }
      } catch {
        if (mounted) {
          setShowRawLog(false);
          setState((prev) => ({
            ...prev,
            artifact: null,
            baseline: null,
            comparison: null,
            comparisonError: null,
            artifactUnavailable: true,
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

  if (state.run === null && state.streamError !== null) {
    return (
      <div className="p-4 space-y-4">
        <Link to="/" className="text-term-blue hover:underline">
          ← overview
        </Link>
        <Frame label="error">
          <p className="text-term-red">{state.streamError}</p>
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
  const classificationPending =
    isTerminalStatus(run.status)
    && run.artifactPath !== null
    && state.artifact === null
    && !state.artifactUnavailable;

  if (classificationPending || state.artifactUnavailable) {
    return (
      <div className="p-4">
        <p className="text-term-dim">
          {classificationPending ? 'Loading result classification...' : 'Result unavailable.'}
        </p>
      </div>
    );
  }

  const isRunning = run.status === 'running' || run.status === 'queued';
  const qualityArtifact = isHistoricalQualityArtifact(state.artifact) ? state.artifact : null;
  const isQuality = qualityArtifact !== null;
  const harnessQuestion =
    run.spec.kind === 'eval'
      ? state.harnesses.find((h) => h.harness === (run.spec as { harness: string }).harness)?.question ?? null
      : null;
  const overridesSummary = run.spec.kind === 'eval' ? summarizeRunEnv(run.env) : null;
  /**
   * True when THIS run compared two configurations — read from the spec's own
   * shape, not from the harness.
   *
   * Discovery runs in both shapes now: `sides` present is a comparison, absent
   * is a single scorecard. Asking the harness instead would render the pair view
   * for a run that has only one side, whose `b` column does not exist.
   */
  const comparesSides = run.spec.kind === 'eval' && run.spec.sides !== undefined;
  /**
   * True when this row holds the configuration the run set out to MEASURE,
   * rather than a deviation applied on top of what it measures.
   *
   * The distinction is the subject of the result, not the presence of defaults:
   * a single discovery run's pass rate IS the pass rate of the configuration
   * named on this line, whereas a scorecard harness's result is a corpus score
   * that this environment modifies. (Discovery has 28 committed defaults of its
   * own — ops.sides.ts and ops.server.ts both say so — so "it has no baseline"
   * would be false.)
   *
   * Keyed on the SPEC's shape, exactly like `comparesSides` two lines up, and
   * not on the harness: for a PAIR this row holds the shared baseline env, while
   * the two configurations under comparison live in the A/B panels. Asking the
   * harness relabelled that shared baseline as "the configuration it measured",
   * which is the one case the label was chosen to exclude.
   */
  const measuresEnv =
    run.spec.kind === 'eval'
    && SUPPORTS_SIDES[run.spec.harness] === true
    && run.spec.sides === undefined;

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
                {harnessQuestion !== null && (
                  <span className="text-term-dim">{harnessQuestion}</span>
                )}
              </div>
              {!isQuality && (
                <div className="flex gap-4">
                  <span className="text-term-dim w-24">profile:</span>
                  <span>{run.spec.profile}</span>
                </div>
              )}
              {!isQuality && overridesSummary !== null && (
                <div className="flex gap-4">
                  {/* "environment" for a run whose environment IS the subject, and
                      "overrides" for one where it is a deviation from a baseline.
                      A single discovery run has no baseline to deviate from — its
                      whole result is the pass rate of the configuration named
                      here — so calling it an override would misdescribe the one
                      line that says what the run measured. */}
                  <span className="text-term-dim w-24">
                    {measuresEnv ? 'environment:' : 'overrides:'}
                  </span>
                  <span className="text-term-dim">{overridesSummary}</span>
                </div>
              )}
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

          {!isQuality && (
            <div className="flex gap-4">
              <span className="text-term-dim w-24">command:</span>
              <span className="font-mono text-sm">
                {run.argv.length > 0
                  ? run.argv.join(' ')
                  : run.steps?.map((s) => s.argv.join(' ')).join(' && ') || '—'}
              </span>
            </div>
          )}

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

      {run.experimental && !isQuality && (
        <Frame label="experimental">
          <p className="text-term-yellow">
            Experimental configuration — this run is not compared to the committed
            baseline, and was not saved as rolling-baseline fuel.
          </p>
        </Frame>
      )}

      {state.artifact && (qualityArtifact !== null ? (
        <HistoricalQualityReport artifact={qualityArtifact} />
      ) : comparesSides ? (
        // The scorecard frame would report this run's aggregate pass rate: the
        // mean across two DIFFERENT configurations, which is a number about
        // neither of them, over a case table listing each side's rows as if
        // they were unrelated cases. The pair is what this run measured.
        <AbComparison artifact={state.artifact} />
      ) : (
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
      ))}

      {state.comparison && !isQuality && !run.experimental && (
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

      {state.comparisonError !== null && !isQuality && !run.experimental && (
        <Frame label="baseline diff">
          <p className="text-term-yellow">
            Could not load the baseline comparison: {state.comparisonError}
          </p>
        </Frame>
      )}

      {!isQuality && (state.progress !== null && state.progress.totalCases !== null ? (
        <Frame label="progress">
          <RunProgressView
            progress={state.progress}
            caseStartedAt={caseTimesRef.current}
            runStartedAt={run.startedAt !== null ? new Date(run.startedAt).getTime() : null}
            live={isRunning}
          />
          <div className="mt-2">
            <button
              onClick={() => setShowRawLog((v) => !v)}
              className="text-term-blue hover:underline"
            >
              {showRawLog ? 'hide raw output' : 'show raw output'}
            </button>
          </div>
          {showRawLog && (
            <div className="mt-2 border-t border-term-rule pt-2">
              <LogView text={state.log} />
            </div>
          )}
        </Frame>
      ) : (
        <Frame label="log">
          <LogView text={state.log} />
        </Frame>
      ))}
    </div>
  );
}

/**
 * renderRun's internal pins are bookkeeping for the spawn, not operator
 * signal, so they never appear in the summary.
 */
const INTERNAL_ENV_PINS: ReadonlySet<string> = new Set(['OPENROUTER_FALLBACK_MODEL']);

/**
 * Renders a run's injected env as a one-line overrides summary: `agent → model`
 * pairs from EVAL_MODEL_OVERRIDES, then the remaining KEY=value entries sorted
 * by key. Returns null when there is nothing to show — a default run's env is
 * empty. Never throws: a hand-written or corrupt record must not break the run
 * page.
 */
function summarizeRunEnv(env: Record<string, string>): string | null {
  const parts: string[] = [];
  // Trimmed, and empty means "no overrides" — the reading readModelOverrides
  // gives it (src/shared/agent/model.config.ts:45-46: `?.trim()` then
  // `if (!raw) return {}`), and the one renderRun relies on when it writes
  // EVAL_MODEL_OVERRIDES="" onto EVERY run record to neutralise an inherited
  // value (ops.argv.ts:308-318). Passing "" to JSON.parse throws, so reading it
  // as a parse failure put "EVAL_MODEL_OVERRIDES (unparseable)" on the front of
  // every single run's summary — including the line this page now labels as the
  // configuration the run measured.
  const rawOverrides = env.EVAL_MODEL_OVERRIDES?.trim();
  if (rawOverrides !== undefined && rawOverrides !== '') {
    try {
      const parsed: unknown = JSON.parse(rawOverrides);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [agent, model] of Object.entries(parsed as Record<string, unknown>)) {
          parts.push(`${agent} → ${String(model)}`);
        }
      }
    } catch {
      parts.push('EVAL_MODEL_OVERRIDES (unparseable)');
    }
  }
  for (const key of Object.keys(env).sort()) {
    if (key === 'EVAL_MODEL_OVERRIDES' || INTERNAL_ENV_PINS.has(key)) continue;
    parts.push(`${key}=${env[key]}`);
  }
  return parts.length === 0 ? null : parts.join(', ');
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
