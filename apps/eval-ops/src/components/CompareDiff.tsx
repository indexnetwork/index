import { Frame } from './Frame';
import type { CompareResult } from '../api/client';

/**
 * The diff half of a comparison: the refusal with its findings, or the
 * aggregate delta with regressions and improvements. Rendering is shared by
 * the artifact compare page and the run pair page — the two modes differ in
 * how the pair is chosen, not in how the outcome reads.
 */
export function CompareDiff({ result }: { result: CompareResult }) {
  if (!result.comparable) {
    return (
      <Frame label="These artifacts cannot be compared">
        <p className="mb-[1lh]">
          Comparison requires identical harness, corpus fingerprint, configuration fingerprint, and case selection.
        </p>
        <div className="space-y-[0.5lh]">
          {result.findings.map((finding, idx) => (
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
    );
  }

  return (
    <>
      <Frame label="Aggregate">
        <div className="flex gap-[4ch] font-mono">
          <div>
            <span className="text-term-dim">Reference: </span>
            <span className="text-term-fg">{(result.aggregate.reference * 100).toFixed(2)}%</span>
          </div>
          <div>
            <span className="text-term-dim">Subject: </span>
            <span className="text-term-fg">{(result.aggregate.subject * 100).toFixed(2)}%</span>
          </div>
          <div>
            <span className="text-term-dim">Δ: </span>
            <span
              className={
                result.aggregate.delta > 0
                  ? 'text-term-green'
                  : result.aggregate.delta < 0
                    ? 'text-term-red'
                    : 'text-term-dim'
              }
            >
              {result.aggregate.delta > 0 ? '+' : ''}
              {(result.aggregate.delta * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      </Frame>

      {result.regressions.regressions.length > 0 && (
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
              {result.regressions.regressions.map((reg, idx) => (
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

      {result.improvements.regressions.length > 0 && (
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
              {result.improvements.regressions.map((reg, idx) => (
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

      {result.regressions.regressions.length === 0 &&
        result.improvements.regressions.length === 0 && (
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
  );
}
