import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Frame } from '../components/Frame';
import { api, type CompareResult, type ArtifactRef } from '../api/client';

interface CompareState {
  artifacts: ArtifactRef[];
  referenceId: string | null;
  subjectId: string | null;
  result: CompareResult | null;
  loading: boolean;
  error: string | null;
}

export function Compare() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<CompareState>({
    artifacts: [],
    referenceId: searchParams.get('reference'),
    subjectId: searchParams.get('subject'),
    result: null,
    loading: false,
    error: null,
  });

  // Fetch artifacts on mount
  useEffect(() => {
    let mounted = true;
    api
      .artifacts()
      .then((data) => {
        if (mounted) {
          setState((prev) => ({ ...prev, artifacts: data.refs }));
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
    if (!state.referenceId || !state.subjectId) {
      setState((prev) => ({ ...prev, result: null }));
      return;
    }

    let mounted = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    api
      .compare(state.referenceId, state.subjectId)
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
  }, [state.referenceId, state.subjectId]);

  const handleReferenceChange = (id: string) => {
    setState((prev) => ({ ...prev, referenceId: id || null }));
    const params = new URLSearchParams(searchParams);
    if (id) params.set('reference', id);
    else params.delete('reference');
    setSearchParams(params);
  };

  const handleSubjectChange = (id: string) => {
    setState((prev) => ({ ...prev, subjectId: id || null }));
    const params = new URLSearchParams(searchParams);
    if (id) params.set('subject', id);
    else params.delete('subject');
    setSearchParams(params);
  };

  // Get the harness of the selected reference to filter subjects
  const referenceHarness = state.artifacts.find((a) => a.id === state.referenceId)?.harness;

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
              value={state.referenceId || ''}
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
              value={state.subjectId || ''}
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

      {state.result && !state.result.comparable && (
        <Frame label="These artifacts cannot be compared">
          <p className="mb-[1lh]">
            Comparison requires identical harness, corpus fingerprint, configuration fingerprint, and case selection.
          </p>
          <div className="space-y-[0.5lh]">
            {state.result.findings.map((finding, idx) => (
              <div key={idx} className="font-mono">
                <span className="text-term-cyan">{finding.dimension}</span>
                <span className="text-term-dim"> · reference: </span>
                <span className="text-term-fg">{finding.reference}</span>
                <span className="text-term-dim"> · subject: </span>
                <span className="text-term-fg">{finding.subject}</span>
              </div>
            ))}
          </div>
        </Frame>
      )}

      {state.result && state.result.comparable && (
        <>
          <Frame label="Aggregate">
            <div className="flex gap-[4ch] font-mono">
              <div>
                <span className="text-term-dim">Reference: </span>
                <span className="text-term-fg">{(state.result.aggregate.reference * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-term-dim">Subject: </span>
                <span className="text-term-fg">{(state.result.aggregate.subject * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-term-dim">Δ: </span>
                <span
                  className={
                    state.result.aggregate.delta > 0
                      ? 'text-term-green'
                      : state.result.aggregate.delta < 0
                        ? 'text-term-red'
                        : 'text-term-dim'
                  }
                >
                  {state.result.aggregate.delta > 0 ? '+' : ''}
                  {(state.result.aggregate.delta * 100).toFixed(2)}%
                </span>
              </div>
            </div>
          </Frame>

          {state.result.regressions.regressions.length > 0 && (
            <Frame label="Regressions (subject worse)">
              <table className="w-full font-mono">
                <thead>
                  <tr className="text-term-dim border-b border-term-rule">
                    <th className="text-left py-[0.5lh]">ID</th>
                    <th className="text-left py-[0.5lh]">Type</th>
                    <th className="text-right py-[0.5lh]">Before</th>
                    <th className="text-right py-[0.5lh]">After</th>
                    <th className="text-right py-[0.5lh]">p-value</th>
                  </tr>
                </thead>
                <tbody>
                  {state.result.regressions.regressions.map((reg, idx) => (
                    <tr key={idx} className="border-b border-term-rule">
                      <td className="py-[0.5lh]">{reg.id}</td>
                      <td className="py-[0.5lh] text-term-dim">{reg.kind}</td>
                      <td className="text-right py-[0.5lh]">{(reg.before * 100).toFixed(1)}%</td>
                      <td className="text-right py-[0.5lh] text-term-red">{(reg.after * 100).toFixed(1)}%</td>
                      <td className="text-right py-[0.5lh] text-term-dim">{reg.pValue.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}

          {state.result.improvements.regressions.length > 0 && (
            <Frame label="Improvements (subject better)">
              <table className="w-full font-mono">
                <thead>
                  <tr className="text-term-dim border-b border-term-rule">
                    <th className="text-left py-[0.5lh]">ID</th>
                    <th className="text-left py-[0.5lh]">Type</th>
                    <th className="text-right py-[0.5lh]">Before</th>
                    <th className="text-right py-[0.5lh]">After</th>
                    <th className="text-right py-[0.5lh]">p-value</th>
                  </tr>
                </thead>
                <tbody>
                  {state.result.improvements.regressions.map((reg, idx) => (
                    <tr key={idx} className="border-b border-term-rule">
                      <td className="py-[0.5lh]">{reg.id}</td>
                      <td className="py-[0.5lh] text-term-dim">{reg.kind}</td>
                      <td className="text-right py-[0.5lh]">{(reg.before * 100).toFixed(1)}%</td>
                      <td className="text-right py-[0.5lh] text-term-green">{(reg.after * 100).toFixed(1)}%</td>
                      <td className="text-right py-[0.5lh] text-term-dim">{reg.pValue.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}

          {state.result.regressions.regressions.length === 0 &&
            state.result.improvements.regressions.length === 0 && (
              <Frame label="No Significant Differences">
                <p className="text-term-dim">
                  No statistically significant regressions or improvements detected between these artifacts.
                </p>
              </Frame>
            )}

          <Frame label="Statistical Note">
            <p className="text-term-dim text-sm">
              Significance uses the same one-sided beta-binomial posterior-predictive test as the CLI, evaluated in
              both directions. It is not a symmetric two-sided test.
            </p>
          </Frame>
        </>
      )}
    </div>
  );
}
