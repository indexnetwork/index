export interface CaseTableProps {
  cases: Array<{
    caseId: string;
    rule: string;
    runs: number;
    passes: number;
    passRate: number;
    flaky: boolean;
  }>;
  baseline?: Array<{
    caseId: string;
    rule: string;
    runs: number;
    passes: number;
    passRate: number;
    flaky: boolean;
  }>;
}

/**
 * Displays a table of case results with optional baseline comparison.
 *
 * Columns are ch-sized; long case ids truncate with ellipsis for scannability.
 * The delta column appears only when a baseline is provided.
 */
export function CaseTable({ cases, baseline }: CaseTableProps) {
  const baselineMap = new Map(baseline?.map((c) => [c.caseId, c]));

  return (
    <div className="font-mono text-sm overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-term-dim border-b border-term-rule">
            <th className="text-left py-1 pr-4" style={{ width: '30ch' }}>
              case
            </th>
            <th className="text-left py-1 pr-4" style={{ width: '15ch' }}>
              rule
            </th>
            <th className="text-right py-1 pr-4" style={{ width: '10ch' }}>
              passes/runs
            </th>
            <th className="text-right py-1 pr-4" style={{ width: '10ch' }}>
              rate
            </th>
            {baseline && (
              <th className="text-right py-1 pr-4" style={{ width: '10ch' }}>
                Δ
              </th>
            )}
            <th className="text-left py-1" style={{ width: '6ch' }}>
              {/* flaky marker column */}
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const base = baselineMap.get(c.caseId);
            const delta = base ? c.passRate - base.passRate : null;
            return (
              <tr key={c.caseId} className="border-b border-term-rule/30">
                <td
                  className="py-1 pr-4 truncate"
                  style={{ maxWidth: '30ch' }}
                  title={c.caseId}
                >
                  {c.caseId}
                </td>
                <td className="py-1 pr-4 text-term-dim truncate" style={{ maxWidth: '15ch' }}>
                  {c.rule}
                </td>
                <td className="py-1 pr-4 text-right">
                  {c.passes}/{c.runs}
                </td>
                <td className="py-1 pr-4 text-right">
                  {(c.passRate * 100).toFixed(1)}%
                </td>
                {baseline && (
                  <td className="py-1 pr-4 text-right">
                    {delta !== null ? <DeltaCell value={delta} /> : '—'}
                  </td>
                )}
                <td className="py-1">
                  {c.flaky && <span className="text-term-yellow">⚠</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeltaCell({ value }: { value: number }) {
  if (Math.abs(value) < 0.001) return <span className="text-term-dim">—</span>;
  const sign = value > 0 ? '+' : '';
  const className = value > 0 ? 'text-term-green' : 'text-term-red';
  return (
    <span className={className}>
      {sign}
      {(value * 100).toFixed(1)}%
    </span>
  );
}
