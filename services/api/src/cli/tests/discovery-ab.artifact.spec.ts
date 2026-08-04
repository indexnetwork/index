import { describe, expect, it } from 'bun:test';

import { assertAbConfigProvenance, buildAbArtifactMeta, buildAbSlotScoreInput, formatAbConfigDiff, toGovernedRunMeta } from '../discovery-ab.main';
import { buildAbPlan, type AbSide } from '../discovery-ab.plan';
import { buildMatrixArtifactEvidence, loadMatrixEval, type MatrixExecutionEvidence, type MatrixSlotResult } from '../discovery-env-matrix.main';

import type { HistoricalMatrixFixture } from '../discovery-env-matrix.shared';

const cases: HistoricalMatrixFixture[] = [{
  id: 'c1', description: 'c1', networkContext: 'ctx', sourceUserId: 'u1',
  expectedUserId: 'u2', excludedUserIds: [],
  participants: ['u1', 'u2'].map((id) => ({
    id, profileText: `c1 ${id} profile`, location: 'fixture city', interests: [], skills: [],
    intent: { text: `c1 ${id} intent` },
  })),
}];

/**
 * Symmetric on purpose. The plan's key-set rule refuses a flag stated on one
 * side only (an omitted flag takes the graph's own default, which may equal the
 * other side's value), so an asymmetric pair could never reach an artifact and
 * a fixture built that way would be testing an unreachable shape.
 */
const sides: [AbSide, AbSide] = [
  { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent', DISCOVERY_SOURCE_PREMISE_LIMIT: '40' } },
  { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' } },
];

const git = { revision: 'abc123', dirty: false };
const meta = await buildAbArtifactMeta({ sides, cases, repetitions: 3, startedAt: '2026-08-04T00:00:00.000Z', git });
const { scoreMatrixSlot, buildScorecard, buildEvalArtifact, EVAL_RUN_REPORT_ARTIFACT_TYPE, resolveEvalJudgeModelId } = await loadMatrixEval();
const judgeModelId = resolveEvalJudgeModelId() as string;

/** Builds a meta with CHAT_MODEL set to whatever the case under test needs. */
const metaWithChatModel = async (chatModel: string | undefined): Promise<Record<string, unknown>> => {
  const previous = process.env.CHAT_MODEL;
  if (chatModel === undefined) delete process.env.CHAT_MODEL;
  else process.env.CHAT_MODEL = chatModel;
  try {
    return await buildAbArtifactMeta({ sides, cases, repetitions: 3, startedAt: '2026-08-04T00:00:00.000Z', git });
  } finally {
    if (previous === undefined) delete process.env.CHAT_MODEL;
    else process.env.CHAT_MODEL = previous;
  }
};

describe('buildAbArtifactMeta', () => {
  it('describes a pair these two sides could actually be planned as', () => {
    expect(buildAbPlan(cases, sides, 3)).toHaveLength(6);
  });

  it('names the harness and does not claim a baseline', () => {
    expect(meta.harness).toBe('discovery-ab');
    expect(meta).not.toHaveProperty('baselinePath');
    expect(meta.selection).toMatchObject({ fullCorpus: true, filters: {} });
  });

  it("records each side's exact configuration", () => {
    expect(meta.configs).toEqual({
      a: { DISCOVERY_ALLOWED_TYPES: 'intent', DISCOVERY_SOURCE_PREMISE_LIMIT: '40' },
      b: { DISCOVERY_ALLOWED_TYPES: 'intent,profile', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' },
    });
  });

  it('records the diff, so the artifact says what produced any difference', () => {
    expect(meta.configDiff).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', a: 'intent', b: 'intent,profile' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', a: '40', b: '5' },
    ]);
  });

  it('fingerprints the corpus and the scoring configuration', () => {
    expect(meta.corpusFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.configFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives different configurations different scoring fingerprints', async () => {
    const other = await buildAbArtifactMeta({
      sides: [sides[0], { id: 'b', config: { DISCOVERY_ALLOWED_TYPES: 'profile', DISCOVERY_SOURCE_PREMISE_LIMIT: '5' } }],
      cases, repetitions: 3, startedAt: '2026-08-04T00:00:00.000Z', git,
    });
    expect(other.configFingerprint).not.toBe(meta.configFingerprint);
  });

  it('gives different repetition counts different scoring fingerprints', async () => {
    const other = await buildAbArtifactMeta({ sides, cases, repetitions: 1, startedAt: '2026-08-04T00:00:00.000Z', git });
    expect(other.configFingerprint).not.toBe(meta.configFingerprint);
  });

  it('gives the same comparison the same fingerprints, whatever order the flags were typed in', async () => {
    const reordered = await buildAbArtifactMeta({
      sides: [
        { id: 'a', config: { DISCOVERY_SOURCE_PREMISE_LIMIT: '40', DISCOVERY_ALLOWED_TYPES: 'intent' } },
        { id: 'b', config: { DISCOVERY_SOURCE_PREMISE_LIMIT: '5', DISCOVERY_ALLOWED_TYPES: 'intent,profile' } },
      ],
      cases, repetitions: 3, startedAt: '2026-08-04T00:00:00.000Z', git,
    });
    expect(reordered.configFingerprint).toBe(meta.configFingerprint);
    expect(reordered.corpusFingerprint).toBe(meta.corpusFingerprint);
  });

  it('reports a filtered run as a filtered run rather than as the full corpus', async () => {
    const filtered = await buildAbArtifactMeta({
      sides, cases, repetitions: 1, startedAt: '2026-08-04T00:00:00.000Z', git, filters: { case: 'c1' },
    });
    expect(filtered.selection).toEqual({ fullCorpus: false, filters: { case: 'c1' } });
  });

  /**
   * The runtime and judge models are configured independently, and an operator
   * running the judge model as CHAT_MODEL is the case that would otherwise fail
   * at the write, at the end of a forty-minute paid run. Asserting only that the
   * list has no duplicates proves nothing here: in a test environment CHAT_MODEL
   * is unset, so the two entries differ whether or not anything de-duplicates
   * them. So the collision is set up explicitly.
   */
  it('collapses a CHAT_MODEL that equals the judge model, which the envelope would refuse', async () => {
    const collided = await metaWithChatModel(judgeModelId);
    expect(collided.models).toEqual([judgeModelId]);
  });

  it('keeps both models when they differ', async () => {
    const distinct = await metaWithChatModel('some-other-runtime-model');
    expect(distinct.models).toEqual(['some-other-runtime-model', judgeModelId]);
  });
});

describe('toGovernedRunMeta', () => {
  const execution: MatrixExecutionEvidence = { policy: 'strict', runs: [] };
  const governed = toGovernedRunMeta(meta, { completedAt: '2026-08-04T00:10:00.000Z', execution });

  it('carries every field the governed envelope requires', () => {
    expect(governed).toMatchObject({
      harness: 'discovery-ab',
      runs: 1,
      corpusFingerprint: meta.corpusFingerprint,
      configFingerprint: meta.configFingerprint,
      startedAt: '2026-08-04T00:00:00.000Z',
      completedAt: '2026-08-04T00:10:00.000Z',
    });
    expect(governed.execution).toBe(execution);
  });

  it('drops configs and configDiff, because the envelope and payload schemas are strict', () => {
    // Asserted rather than assumed: the meta really does carry them, and the
    // projection really is what removes them. Per-case configDeltas is where
    // the same information reaches disk.
    expect(meta.configs).toBeDefined();
    expect(meta.configDiff).toBeDefined();
    expect(Object.keys(governed)).not.toContain('configs');
    expect(Object.keys(governed)).not.toContain('configDiff');
  });

  it('refuses a meta missing a field the envelope requires, rather than writing an invalid artifact', () => {
    const { corpusFingerprint: _dropped, ...incomplete } = meta;
    expect(() => toGovernedRunMeta(incomplete, { completedAt: '2026-08-04T00:10:00.000Z', execution }))
      .toThrow(/corpusFingerprint/);
  });
});

describe('formatAbConfigDiff', () => {
  it('prints the difference for the operator, since the artifact keeps it per case', () => {
    const printed = formatAbConfigDiff(meta);
    expect(printed).toContain('DISCOVERY_ALLOWED_TYPES: a=intent  b=intent,profile');
    expect(printed).toContain('DISCOVERY_SOURCE_PREMISE_LIMIT: a=40  b=5');
  });

  it('says so plainly when there is no recorded difference', () => {
    expect(formatAbConfigDiff({ configDiff: [] })).toMatch(/no recorded difference/);
  });
});

describe('assertAbConfigProvenance', () => {
  const slot = (side: AbSide) => ({ matrixCase: cases[0]!, side, repetition: 0 });

  /** Scores one A/B slot exactly the way the child does, judge aside. */
  const score = async (side: AbSide, completed: boolean): Promise<MatrixSlotResult> => {
    const { caseId, ...scoreInput } = buildAbSlotScoreInput(slot(side), { candidates: [], completed });
    return { ...(await scoreMatrixSlot(scoreInput)), caseId } as MatrixSlotResult;
  };

  it('accepts slots scored through the real policy on the completed path', async () => {
    const slots = [await score(sides[0], true), await score(sides[1], true)];
    expect(() => assertAbConfigProvenance(slots, sides)).not.toThrow();
    expect(slots[0]!.configDeltas).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'intent' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', before: null, after: '40' },
    ]);
  });

  it('accepts the failed-slot fallback, which is where a configuration is easiest to lose', async () => {
    const failed = await score(sides[1], false);
    const evidence: MatrixExecutionEvidence = {
      policy: 'strict',
      runs: [{ runId: 'r', caseId: failed.caseId, runIndex: 0, outcome: 'failed', recovered: false, attempts: [] }],
    };
    const artifact = buildMatrixArtifactEvidence([failed], evidence);
    expect(artifact.slots[0]!.runs).toBe(0);
    expect(() => assertAbConfigProvenance(artifact.slots, sides)).not.toThrow();
    expect(artifact.slots[0]!.configDeltas).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'intent,profile' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', before: null, after: '5' },
    ]);
  });

  it('refuses a slot whose configuration went missing, which would hide what was compared', async () => {
    const stripped = { ...(await score(sides[0], true)), configDeltas: [] };
    expect(() => assertAbConfigProvenance([stripped], sides)).toThrow(/does not record side a's configuration/);
  });

  it('refuses a slot recording the other side\'s configuration', async () => {
    const mislabelled = { ...(await score(sides[1], true)), rowId: 'a' };
    expect(() => assertAbConfigProvenance([mislabelled as MatrixSlotResult], sides)).toThrow(/does not record side a's configuration/);
  });

  it('refuses a slot from a side this run did not compare', async () => {
    const foreign = { ...(await score(sides[0], true)), rowId: 'intent-only' };
    expect(() => assertAbConfigProvenance([foreign as MatrixSlotResult], sides)).toThrow(/did not compare/);
  });
});

/**
 * The write path itself, without a database: real scored slots, real execution
 * evidence and the real envelope builder the parent writes through. It is the
 * only thing that proves `toGovernedRunMeta` produces something the strict
 * schema accepts — a projection that typechecks but cannot be written would
 * fail for the first time at the end of a forty-minute live run.
 */
describe('the artifact the parent writes', () => {
  const slot = (side: AbSide) => ({ matrixCase: cases[0]!, side, repetition: 0 });
  // The envelope requires every attempt to fall inside the run window, so the
  // window is anchored to now rather than to a fixed date.
  const runStartedAt = new Date(Date.now() - 120_000).toISOString();
  const runCompletedAt = new Date(Date.now() - 1_000).toISOString();
  const attemptAt = (outcome: 'success' | 'failure') => ({
    attemptId: 'placeholder::attempt:1', runId: 'placeholder', runIndex: 0, attemptNumber: 1,
    startedAt: new Date(Date.now() - 110_000).toISOString(),
    completedAt: new Date(Date.now() - 58_000).toISOString(),
    durationMs: 52_000,
    outcome, retryable: false, backoffMs: 0,
    ...(outcome === 'success' ? {} : { error: { class: 'MatrixExecutionError', message: 'matrix_graph_failure' } }),
  });

  /** One side's child output, built exactly as the child builds it. */
  const sideOutput = async (side: AbSide, completed: boolean) => {
    const { caseId, ...scoreInput } = buildAbSlotScoreInput(slot(side), { candidates: [], completed });
    const scored = { ...(await scoreMatrixSlot(scoreInput)), caseId } as MatrixSlotResult;
    return buildMatrixArtifactEvidence([scored], {
      policy: 'strict',
      runs: [{
        runId: 'placeholder', caseId, runIndex: 0,
        outcome: completed ? 'success' : 'failed', recovered: false,
        attempts: [attemptAt(completed ? 'success' : 'failure')],
      }],
    } as MatrixExecutionEvidence);
  };

  const buildArtifact = async (bothCompleted: boolean) => {
    const outputs = [await sideOutput(sides[0], true), await sideOutput(sides[1], bothCompleted)];
    const slots = outputs.flatMap((output) => output.slots);
    const execution: MatrixExecutionEvidence = { policy: 'strict', runs: outputs.flatMap((output) => output.execution.runs) };
    const runMeta = await buildAbArtifactMeta({
      sides, cases, repetitions: 1, startedAt: runStartedAt,
      git: { revision: 'a'.repeat(40), dirty: false },
    });
    return buildEvalArtifact(
      EVAL_RUN_REPORT_ARTIFACT_TYPE,
      buildScorecard(slots, { model: 'configured runtime models', runs: 1 }),
      toGovernedRunMeta(runMeta, { completedAt: runCompletedAt, execution }),
    ) as { harness: string; completeness: { complete: boolean }; payload: { rules: Array<{ rule: string }>; cases: Array<Record<string, unknown>> } };
  };

  it('is accepted by the strict governed envelope, projection and all', async () => {
    expect((await buildArtifact(true)).harness).toBe('discovery-ab');
  });

  it('holds both sides as its two rules', async () => {
    expect((await buildArtifact(true)).payload.rules.map((rule) => rule.rule).sort()).toEqual(['a', 'b']);
  });

  it('carries each configuration on its case rows, which is where configs live on disk', async () => {
    const artifact = await buildArtifact(true);
    const byCase = new Map(artifact.payload.cases.map((entry) => [entry.caseId as string, entry.configDeltas]));
    expect(byCase.get('c1/a/r1')).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'intent' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', before: null, after: '40' },
    ]);
    expect(byCase.get('c1/b/r1')).toEqual([
      { key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: 'intent,profile' },
      { key: 'DISCOVERY_SOURCE_PREMISE_LIMIT', before: null, after: '5' },
    ]);
  });

  it('marks a complete run complete', async () => {
    expect((await buildArtifact(true)).completeness.complete).toBe(true);
  });

  it('marks a run with a failed slot incomplete, without anyone setting the flag', async () => {
    expect((await buildArtifact(false)).completeness.complete).toBe(false);
  });
});
