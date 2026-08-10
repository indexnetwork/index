import { describe, expect, it } from 'bun:test';

import { HistoricalQualityArtifactEnvelopeSchema } from '../../../../../packages/protocol/eval/shared/artifact.js';
import { makeHistoricalQualityArtifact } from '../../../../../packages/protocol/eval/shared/tests/artifact.fixtures.js';
import { HistoricalQualityChildOutputSchema } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.child-output.js';
import { aggregateHistoricalQualityChildren, writeOperationalDiagnosticBestEffort, type HistoricalQualityArtifactWriter, type HistoricalQualityParentDiagnostic } from '../discovery-quality.runtime';

const runId = 'hq-run-11111111111111111111111111111111';

function fixture(input: { slots?: number; failedSlot?: number } = {}) {
  const slots = input.slots ?? 2;
  const source = makeHistoricalQualityArtifact({ emittedSlots: slots, requestedSlots: slots, failedSlot: input.failedSlot });
  const planSlots = source.payload.cases.map((row, index) => ({
    slotId: `hq-slot-${String(index + 1).padStart(64, '0')}`,
    caseId: row.logicalCaseId,
    trigger: row.trigger,
    repetition: row.repetition,
    selectedSide: 'a' as const,
    configurationFingerprint: source.configFingerprint,
    maxAttempts: 1 as const,
  }));
  const plan = {
    slots: planSlots,
    childSlots: planSlots.map(({ slotId }) => ({ slotId, configurationId: 'a' as const })),
    configurationFingerprint: source.configFingerprint,
    graphInvocations: slots,
    evaluatorCalls: slots,
    maxAttempts: 1 as const,
  };
  const outputs = source.payload.cases.map((transportRow, index) => HistoricalQualityChildOutputSchema.parse({
    schemaVersion: 1,
    runId,
    slotId: planSlots[index]!.slotId,
    configurationId: 'a',
    transportRow: {
      kind: transportRow.kind,
      logicalCaseId: transportRow.logicalCaseId,
      trigger: transportRow.trigger,
      repetition: transportRow.repetition,
      configurationFingerprint: transportRow.configurationFingerprint,
      completed: transportRow.completed,
      participantMetrics: transportRow.participantMetrics,
      stageFunnel: transportRow.stageFunnel,
    },
    executionRun: source.execution.runs[index],
  }));
  return { plan, outputs };
}

const diagnostic = (failureClass: HistoricalQualityParentDiagnostic['failureClass']): HistoricalQualityParentDiagnostic => ({
  failureClass,
});

describe('historical quality strict aggregation', () => {
  it('builds a real strict V2 artifact and a full-plan quality summary from exact unique outputs', async () => {
    const { plan, outputs } = fixture();
    const result = await aggregateHistoricalQualityChildren({ plan, outputs, diagnostics: [] });

    expect(HistoricalQualityArtifactEnvelopeSchema.safeParse(result.artifact).success).toBeTrue();
    expect(result.artifact.measurement).toMatchObject({
      requestedSlots: 2,
      completedSlots: 2,
      qualityVerdictAvailable: true,
    });
    expect(result.qualitySummary).toMatchObject({
      qualityVerdictAvailable: true,
      requestedSlots: 2,
      completedSlots: 2,
    });
    expect(result.artifact.payload.cases).toHaveLength(2);
    expect(result.artifact.execution.runs).toHaveLength(2);
  });

  it('keeps all terminal failed rows but suppresses the complete quality summary instead of averaging the subset', async () => {
    const { plan, outputs } = fixture({ failedSlot: 1 });
    const result = await aggregateHistoricalQualityChildren({ plan, outputs, diagnostics: [] });

    expect(HistoricalQualityArtifactEnvelopeSchema.safeParse(result.artifact).success).toBeTrue();
    expect(result.artifact.measurement).toMatchObject({ completedSlots: 1, requestedSlots: 2, qualityVerdictAvailable: false });
    expect(result.qualitySummary).toEqual({
      qualityVerdictAvailable: false,
      completedSlots: 1,
      requestedSlots: 2,
      groups: null,
      message: 'no quality verdict',
    });
    expect(result.artifact.payload.aggregatePassRate).toBe(0.5);
  });

  it('rejects duplicate, unplanned, missing, and cross-output run identities', async () => {
    const { plan, outputs } = fixture();
    const mutations: Array<[string, unknown[]]> = [
      ['duplicate', [outputs[0], outputs[0]]],
      ['unplanned', [{ ...outputs[0], slotId: `hq-slot-${'f'.repeat(64)}` }, outputs[1]]],
      ['missing', [outputs[0]]],
      ['cross-run', [outputs[0], { ...outputs[1], runId: 'hq-run-22222222222222222222222222222222' }]],
    ];
    for (const [label, mutated] of mutations) {
      await expect(aggregateHistoricalQualityChildren({ plan, outputs: mutated as never, diagnostics: [] }), label).rejects.toThrow();
    }
  });

  it('rejects wrong case, trigger, repetition, configuration, transport/execution IDs, and plan cardinality', async () => {
    const { plan, outputs } = fixture();
    const mutations: Array<(value: typeof outputs) => void> = [
      (value) => { value[0]!.transportRow.logicalCaseId = 'historical/wrong'; },
      (value) => { value[0]!.transportRow.trigger = 'enrichment'; },
      (value) => { value[0]!.transportRow.repetition = 9; },
      (value) => { value[0]!.transportRow.configurationFingerprint = 'f'.repeat(64); },
      (value) => { value[0]!.executionRun.caseId = 'wrong'; },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(outputs);
      mutate(value);
      await expect(aggregateHistoricalQualityChildren({ plan, outputs: value, diagnostics: [] })).rejects.toThrow();
    }
    await expect(aggregateHistoricalQualityChildren({
      plan: { ...plan, graphInvocations: plan.graphInvocations + 1 },
      outputs,
      diagnostics: [],
    })).rejects.toThrow(/cardinality/i);
  });
});

describe('historical quality operational diagnostics', () => {
  it('writes a schema-valid unavailable-verdict report with accepted rows and only an opaque failure class', async () => {
    const { plan, outputs } = fixture();
    const written: unknown[] = [];
    const writer: HistoricalQualityArtifactWriter = async (_path, artifact) => { written.push(artifact); };
    const result = await writeOperationalDiagnosticBestEffort({
      plan,
      acceptedOutputs: outputs.slice(0, 1),
      primaryFailure: diagnostic('supervisor-timeout'),
      reportPath: '/tmp/report.json',
      writer,
    });

    expect(result).toEqual({ written: true });
    expect(written).toHaveLength(1);
    const artifact = HistoricalQualityArtifactEnvelopeSchema.parse(written[0]);
    expect(artifact.measurement.qualityVerdictAvailable).toBeFalse();
    expect(artifact.payload.cases).toHaveLength(1);
    expect(artifact.selection.filters.operationalFailureClass).toBe('supervisor-timeout');
    expect(JSON.stringify(artifact)).not.toContain('Error:');
  });

  it('can write a strict zero-row diagnostic without inventing a child file or execution row', async () => {
    const { plan } = fixture();
    let written: unknown;
    const result = await writeOperationalDiagnosticBestEffort({
      plan,
      acceptedOutputs: [],
      primaryFailure: diagnostic('restore-failure'),
      reportPath: '/tmp/report.json',
      writer: async (_path, artifact) => { written = artifact; },
    });
    expect(result.written).toBeTrue();
    const artifact = HistoricalQualityArtifactEnvelopeSchema.parse(written);
    expect(artifact.payload.cases).toEqual([]);
    expect(artifact.execution.runs).toEqual([]);
    expect(artifact.measurement).toMatchObject({ completedSlots: 0, qualityVerdictAvailable: false });
  });

  it('reports artifact writing failure separately without leaking or replacing the primary failure class', async () => {
    const { plan } = fixture();
    const result = await writeOperationalDiagnosticBestEffort({
      plan,
      acceptedOutputs: [],
      primaryFailure: diagnostic('spawn-failure'),
      reportPath: '/tmp/report.json',
      writer: async () => { throw new Error('postgres://user:secret@example.invalid/raw'); },
    });
    expect(result).toEqual({
      written: false,
      artifactWriteFailure: { failureClass: 'artifact-write-failure' },
    });
  });
});
