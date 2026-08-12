import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Frame } from '../components/Frame';
import { CompareDiff } from '../components/CompareDiff';
import { RunProgressView } from '../components/RunProgress';
import { useRunProgress, type RunProgressState } from '../hooks/useRunProgress';
import { api, isTerminalStatus, type CompareResult, type RunCompareResult, type ArtifactRef } from '../api/client';

export function Compare() {
  const [searchParams] = useSearchParams();
  // The URL is the only home of the selection, so back/forward moves the
  // selects (or the pair) and the comparison together.
  const referenceRun = searchParams.get('referenceRun');
  const subjectRun = searchParams.get('subjectRun');

  // Pair mode: two runs, launched together, compared the moment both end.
  // Keyed by the pair so navigating to a different pair resets all state.
  if (referenceRun !== null && subjectRun !== null) {
    return (
      <PairCompare
        key={`${referenceRun}/${subjectRun}`}
        referenceRunId={referenceRun}
        subjectRunId={subjectRun}
      />
    );
  }

  return <ArtifactCompare />;
}

interface CompareState {
  artifacts: ArtifactRef[];
  result: CompareResult | null;
  loading: boolean;
  indexed: boolean;
  error: string | null;
}

function ArtifactCompare() {
  const [searchParams, setSearchParams] = useSearchParams();
  const referenceId = searchParams.get('reference');
  const subjectId = searchParams.get('subject');
  const [state, setState] = useState<CompareState>({
    artifacts: [],
    result: null,
    loading: false,
    indexed: false,
    error: null,
  });

  // Fetch artifacts on mount
  useEffect(() => {
    let mounted = true;
    api
      .artifacts()
      .then((data) => {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            artifacts: data.refs.filter(
              (artifact) => artifact.measurementKind !== 'historical-quality-pilot',
            ),
            indexed: true,
          }));
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

  // Fetch comparison when both IDs are selected
  useEffect(() => {
    if (!referenceId || !subjectId) {
      setState((prev) => ({ ...prev, result: null }));
      return;
    }
    if (!state.indexed) return;
    if (
      !state.artifacts.some((artifact) => artifact.id === referenceId)
      || !state.artifacts.some((artifact) => artifact.id === subjectId)
    ) {
      setState((prev) => ({ ...prev, result: null, loading: false }));
      return;
    }

    let mounted = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    api
      .compare(referenceId, subjectId)
      .then((result) => {
        if (mounted) {
          setState((prev) => ({ ...prev, result, loading: false }));
        }
      })
      .catch((error) => {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          }));
        }
      });

    return () => {
      mounted = false;
    };
  }, [referenceId, subjectId, state.artifacts, state.indexed]);

  const handleReferenceChange = (id: string) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set('reference', id);
    else params.delete('reference');

    // A subject from another harness can never be compared, so drop it rather
    // than let the operator submit a pair that can only be refused.
    const nextHarness = state.artifacts.find((a) => a.id === id)?.harness;
    const subjectHarness = state.artifacts.find((a) => a.id === subjectId)?.harness;
    if (subjectHarness !== undefined && subjectHarness !== nextHarness) params.delete('subject');

    setSearchParams(params);
  };

  const handleSubjectChange = (id: string) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set('subject', id);
    else params.delete('subject');
    setSearchParams(params);
  };

  // Get the harness of the selected reference to filter subjects
  const referenceHarness = state.artifacts.find((a) => a.id === referenceId)?.harness;

  // Filter artifacts to only those matching the reference harness
  const subjectArtifacts = referenceHarness
    ? state.artifacts.filter((a) => a.harness === referenceHarness)
    : state.artifacts;

  return (
    <div className="flex flex-col gap-[2lh] p-[2ch]">
      <h1 className="text-term-cyan text-[2em]">A/B Comparison</h1>

      <Frame label="Select Artifacts">
        <div className="flex gap-[4ch]">
          <div className="flex-1">
            <label htmlFor="reference" className="block mb-[0.5lh] text-term-dim">
              Reference
            </label>
            <select
              id="reference"
              value={referenceId || ''}
              onChange={(e) => handleReferenceChange(e.target.value)}
              className="w-full bg-term-panel border border-term-rule text-term-fg p-[1ch]"
            >
              <option value="">Select reference artifact...</option>
              {state.artifacts.map((artifact) => (
                <option key={artifact.id} value={artifact.id}>
                  {artifact.harness} {artifact.kind} · {(artifact.aggregatePassRate * 100).toFixed(1)}% ·{' '}
                  {new Date(artifact.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label htmlFor="subject" className="block mb-[0.5lh] text-term-dim">
              Subject
            </label>
            <select
              id="subject"
              value={subjectId || ''}
              onChange={(e) => handleSubjectChange(e.target.value)}
              className="w-full bg-term-panel border border-term-rule text-term-fg p-[1ch]"
              disabled={!referenceHarness}
            >
              <option value="">Select subject artifact...</option>
              {subjectArtifacts.map((artifact) => (
                <option key={artifact.id} value={artifact.id}>
                  {artifact.harness} {artifact.kind} · {(artifact.aggregatePassRate * 100).toFixed(1)}% ·{' '}
                  {new Date(artifact.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
            {referenceHarness && (
              <p className="mt-[0.5lh] text-term-dim text-sm">
                Filtered to {referenceHarness} harness
              </p>
            )}
          </div>
        </div>
      </Frame>

      {state.error && (
        <Frame label="Error">
          <pre className="text-term-red">{state.error}</pre>
        </Frame>
      )}

      {state.loading && (
        <Frame label="Comparing...">
          <p className="text-term-dim">Loading comparison...</p>
        </Frame>
      )}

      {state.result && <CompareDiff result={state.result} />}
    </div>
  );
}

/**
 * The A/B payoff loop: both runs' progress side by side (stacked), and the
 * moment the second run goes terminal the run-vs-run diff loads itself.
 * The URL carries the pair, so the page is shareable and back/forward-safe.
 */
function PairCompare({ referenceRunId, subjectRunId }: { referenceRunId: string; subjectRunId: string }) {
  const reference = useRunProgress(referenceRunId);
  const subject = useRunProgress(subjectRunId);
  const [result, setResult] = useState<RunCompareResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const referenceDone = reference.run !== null && isTerminalStatus(reference.run.status);
  const subjectDone = subject.run !== null && isTerminalStatus(subject.run.status);

  useEffect(() => {
    if (!referenceDone || !subjectDone || fetchedRef.current) return;
    fetchedRef.current = true;
    let mounted = true;
    api
      .compareRuns(referenceRunId, subjectRunId)
      .then((outcome) => {
        if (mounted) setResult(outcome);
      })
      .catch((error) => {
        if (mounted) {
          setCompareError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      mounted = false;
    };
  }, [referenceDone, subjectDone, referenceRunId, subjectRunId]);

  const bothDone = referenceDone && subjectDone;

  return (
    <div className="flex flex-col gap-[2lh] p-[2ch]">
      <h1 className="text-term-cyan text-[2em]">A/B Comparison</h1>

      <PairPanel side="reference" state={reference} />
      <PairPanel side="candidate" state={subject} />

      {!bothDone && (
        <p className="text-term-dim">comparison appears when both runs finish</p>
      )}

      {compareError !== null && (
        <Frame label="Error">
          <pre className="text-term-red">{compareError}</pre>
        </Frame>
      )}

      {result !== null && (
        <>
          {result.runs !== undefined && (
            <Frame label="runs compared">
              <div className="space-y-[0.5lh] font-mono">
                <SideHeader side="reference" label={result.runs.reference} />
                <SideHeader side="candidate" label={result.runs.subject} />
              </div>
            </Frame>
          )}
          <CompareDiff result={result} />
        </>
      )}
    </div>
  );
}

function PairPanel({ side, state }: { side: 'reference' | 'candidate'; state: RunProgressState }) {
  const profile =
    state.run !== null && state.run.spec.kind === 'eval' ? state.run.spec.profile : null;
  const live =
    state.run !== null && (state.run.status === 'running' || state.run.status === 'queued');

  return (
    <Frame label={profile !== null ? `${side} · ${profile}` : side}>
      {state.streamError !== null && <p className="text-term-red">{state.streamError}</p>}
      {state.streamError === null && state.run === null && (
        <p className="text-term-dim">Loading…</p>
      )}
      {state.streamError === null && state.run !== null && state.progress !== null && state.progress.totalCases !== null && (
        <RunProgressView
          progress={state.progress}
          caseStartedAt={state.caseTimes}
          runStartedAt={state.run.startedAt !== null ? new Date(state.run.startedAt).getTime() : null}
          live={live}
        />
      )}
      {state.streamError === null && state.run !== null && (state.progress === null || state.progress.totalCases === null) && (
        <p className="text-term-dim">waiting for harness output…</p>
      )}
    </Frame>
  );
}

function SideHeader({
  side,
  label,
}: {
  side: 'reference' | 'candidate';
  label: { profile: string; profileFingerprint: string; complete: boolean | null };
}) {
  return (
    <div>
      <span className="text-term-cyan">{side}</span>
      <span className="text-term-dim"> · </span>
      <span className="text-term-fg">{label.profile}</span>
      <span className="text-term-dim"> · config </span>
      <span className="text-term-fg">{label.profileFingerprint.slice(0, 12)}</span>
      {label.complete === false && (
        <span className="text-term-yellow"> · incomplete evidence — interpret with care</span>
      )}
    </div>
  );
}
