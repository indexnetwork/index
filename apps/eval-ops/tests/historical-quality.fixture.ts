import { EvalArtifactEnvelopeV2Schema, isHistoricalQualityArtifact, type HistoricalQualityArtifactEnvelope } from '../../../packages/protocol/eval/shared/artifact';
import { makeHistoricalQualityArtifact } from '../../../packages/protocol/eval/shared/tests/artifact.fixtures';
import type { ArtifactRef } from '../src/api/client';

function parseQualityFixture(value: unknown): HistoricalQualityArtifactEnvelope {
  const artifact = EvalArtifactEnvelopeV2Schema.parse(value);
  if (!isHistoricalQualityArtifact(artifact)) {
    throw new Error('fixture is not a historical quality artifact');
  }
  return artifact;
}

/** Every UI fixture passes through the protocol's real strict V2 dispatcher. */
export const COMPLETE_HISTORICAL_QUALITY_ARTIFACT = parseQualityFixture(
  makeHistoricalQualityArtifact({ repetitions: 3 }),
);

export const INCOMPLETE_HISTORICAL_QUALITY_ARTIFACT = parseQualityFixture(
  makeHistoricalQualityArtifact({ repetitions: 3, failedSlot: 29 }),
);

/** Proves quality routing is owned by the artifact discriminator, not its harness. */
export const NON_DISCOVERY_HISTORICAL_QUALITY_ARTIFACT = parseQualityFixture({
  ...makeHistoricalQualityArtifact({ repetitions: 3 }),
  harness: 'matching',
});

export function historicalQualityRef(
  artifact: HistoricalQualityArtifactEnvelope = COMPLETE_HISTORICAL_QUALITY_ARTIFACT,
  id = 'historical-quality',
): ArtifactRef {
  return {
    id,
    harness: artifact.harness as ArtifactRef['harness'],
    kind: 'run',
    path: `discovery/runs/${id}.json`,
    schemaVersion: artifact.schemaVersion,
    createdAt: artifact.createdAt,
    models: artifact.models,
    runs: artifact.runs,
    selection: artifact.selection,
    git: artifact.git,
    corpusFingerprint: artifact.corpusFingerprint,
    configFingerprint: artifact.configFingerprint,
    aggregatePassRate: artifact.payload.aggregatePassRate,
    caseCount: artifact.payload.cases.length,
    complete: artifact.completeness.complete,
    measurementKind: artifact.measurement.kind,
    qualityCompleteness: {
      requestedSlots: artifact.measurement.requestedSlots,
      completedSlots: artifact.measurement.completedSlots,
    },
    sizeBytes: 4096,
    mtimeMs: Date.parse(artifact.createdAt),
  };
}
