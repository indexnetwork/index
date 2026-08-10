import type { HistoricalParticipantMetric, HistoricalQualityArtifact, HistoricalStageFunnel } from '../api/client';
import { groupHistoricalQualityCases } from '../lib/historical-quality';
import { Frame } from './Frame';

export function HistoricalQualityReport({
  artifact,
}: {
  artifact: HistoricalQualityArtifact;
}) {
  const { measurement } = artifact;
  const groups = measurement.qualityVerdictAvailable
    ? groupHistoricalQualityCases(artifact.payload.cases)
    : [];

  return (
    <Frame label="historical quality evidence">
      <div className="space-y-4">
        <div className="space-y-1">
          <ReportRow label="execution completeness">
            <span className="font-mono">
              {measurement.completedSlots}/{measurement.requestedSlots}
            </span>
            <span className="text-term-dim ml-2">completed/requested</span>
          </ReportRow>
          <ReportRow label="quality verdict">
            {measurement.qualityVerdictAvailable ? (
              <span className="text-term-green">evidence available</span>
            ) : (
              <span className="text-term-yellow">quality verdict unavailable</span>
            )}
          </ReportRow>
          <p className="text-term-dim">
            The runtime restores the selected child before every measured slot and uses one
            attempt per slot.
          </p>
        </div>

        {measurement.qualityVerdictAvailable && (
          <div className="space-y-6">
            {groups.map((group) => (
              <section
                key={`${group.logicalCaseId}:${group.trigger}`}
                data-testid="quality-group"
                className="border-t border-term-rule pt-3 space-y-3"
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
                  <h3 className="font-mono text-term-cyan">{group.logicalCaseId}</h3>
                  <span className="text-term-dim">trigger</span>
                  <span data-trigger className="font-mono">{group.trigger}</span>
                  <span className="font-mono">
                    {group.completedRepetitions}/{group.requestedRepetitions} repetitions
                  </span>
                </div>
                <StageFunnel
                  funnel={group.stageFunnel}
                  repetitions={group.repetitions}
                  targetRetrievalRanks={group.targetRetrievalRanks}
                  targetFinalRanks={group.targetFinalRanks}
                />
                <div className="space-y-5">
                  {group.rows.map((row) => (
                    <div key={row.caseId} data-testid="participant-repetition" className="space-y-2">
                      <h4 className="text-term-cyan font-mono">repetition {row.repetition + 1}</h4>
                      <ParticipantMetrics metrics={row.participantMetrics} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}

function StageFunnel({
  funnel,
  repetitions,
  targetRetrievalRanks,
  targetFinalRanks,
}: {
  funnel: HistoricalStageFunnel;
  repetitions: number[];
  targetRetrievalRanks: Array<number | null>;
  targetFinalRanks: Array<number | null>;
}) {
  const groups = [
    ['target', funnel.target],
    ['semantic-negative', funnel.semanticNegatives],
    ['background', funnel.backgrounds],
  ] as const;

  return (
    <div className="space-y-2">
      <h4 className="text-term-cyan">stage funnel</h4>
      <p className="text-term-dim font-mono">
        {funnel.slots} slot · {funnel.participants} participants
      </p>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead>
            <tr className="text-term-dim border-b border-term-rule">
              <th className="text-left py-1 pr-3">role</th>
              <th className="text-right py-1 pr-3">total</th>
              <th className="text-right py-1 pr-3">retrieved</th>
              <th className="text-right py-1 pr-3">evaluator eligible</th>
              <th className="text-right py-1 pr-3">evaluator submitted</th>
              <th className="text-right py-1 pr-3">evaluator returned</th>
              <th className="text-right py-1">final included</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([role, counts]) => (
              <tr key={role} className="border-b border-term-rule/30">
                <td className="py-1 pr-3">{role}</td>
                <td className="text-right py-1 pr-3">{counts.total}</td>
                <td className="text-right py-1 pr-3">{counts.retrieved}</td>
                <td className="text-right py-1 pr-3">{counts.evaluatorEligible}</td>
                <td className="text-right py-1 pr-3">{counts.evaluatorSubmitted}</td>
                <td className="text-right py-1 pr-3">{counts.evaluatorReturned}</td>
                <td className="text-right py-1">{counts.finalIncluded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-1 md:grid-cols-2 font-mono text-sm">
        <RankDistribution
          label="target retrieval rank distribution"
          repetitions={repetitions}
          ranks={targetRetrievalRanks}
        />
        <RankDistribution
          label="target final rank distribution"
          repetitions={repetitions}
          ranks={targetFinalRanks}
        />
      </div>
      <div className="font-mono text-sm">
        <span className="text-term-dim">failure stages</span>{' '}
        {Object.entries(funnel.failureStages)
          .map(([stage, count]) => `${stage}=${count}`)
          .join(' · ')}
      </div>
    </div>
  );
}

function RankDistribution({
  label,
  repetitions,
  ranks,
}: {
  label: string;
  repetitions: number[];
  ranks: Array<number | null>;
}) {
  return (
    <div>
      <span className="text-term-dim">{label}</span>{' '}
      {ranks.map((rank, index) => `r${repetitions[index]! + 1}=${rank ?? '—'}`).join(' · ')}
    </div>
  );
}

function ParticipantMetrics({ metrics }: { metrics: HistoricalParticipantMetric[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-term-cyan">participant metrics</h4>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead>
            <tr className="text-term-dim border-b border-term-rule">
              <th className="text-left py-1 pr-3">participant</th>
              <th className="text-left py-1 pr-3">role</th>
              <th className="text-right py-1 pr-3">retrieval rank</th>
              <th className="text-right py-1 pr-3">retrieval score</th>
              <th className="text-left py-1 pr-3">evidence type</th>
              <th className="text-left py-1 pr-3">eligible</th>
              <th className="text-left py-1 pr-3">submitted</th>
              <th className="text-left py-1 pr-3">returned</th>
              <th className="text-right py-1 pr-3">evaluator score</th>
              <th className="text-right py-1 pr-3">final rank</th>
              <th className="text-left py-1">failure stage</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr
                key={metric.participantId}
                data-testid="participant-metric"
                className="border-b border-term-rule/30"
              >
                <td className="py-1 pr-3">{metric.participantId}</td>
                <td data-role className={`py-1 pr-3 ${roleClass(metric.role)}`}>
                  {metric.role}
                </td>
                <td className="text-right py-1 pr-3">{metric.retrieval?.rank ?? '—'}</td>
                <td className="text-right py-1 pr-3">
                  {formatOptionalNumber(metric.retrieval?.bestScore ?? null)}
                </td>
                <td className="py-1 pr-3">
                  {metric.retrieval?.evidenceTypes.join(', ') || '—'}
                </td>
                <td className="py-1 pr-3">{yesNo(metric.evaluator.eligible)}</td>
                <td className="py-1 pr-3">{yesNo(metric.evaluator.submitted)}</td>
                <td className="py-1 pr-3">{yesNo(metric.evaluator.returned)}</td>
                <td className="text-right py-1 pr-3">
                  {formatOptionalNumber(metric.evaluator.score)}
                </td>
                <td className="text-right py-1 pr-3">{metric.finalRank ?? '—'}</td>
                <td className="py-1">{metric.failureStage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="text-term-dim w-44 shrink-0">{label}:</span>
      <span>{children}</span>
    </div>
  );
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function formatOptionalNumber(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

function roleClass(role: HistoricalParticipantMetric['role']): string {
  if (role === 'target') return 'text-term-green';
  if (role === 'semantic-negative') return 'text-term-yellow';
  return 'text-term-dim';
}
