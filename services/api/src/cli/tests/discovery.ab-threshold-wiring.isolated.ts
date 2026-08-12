import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import type { HistoricalMatrixFixture } from '../discovery-env-matrix.shared';

const constructorThresholds: unknown[] = [];
const projectionThresholds: number[] = [];

const fixtureCase: HistoricalMatrixFixture = {
  id: 'historical/threshold-case',
  description: 'threshold case',
  networkContext: 'network context',
  sourceUserId: 'source-user',
  expectedUserId: 'candidate-user',
  excludedUserIds: [],
  participants: [
    {
      id: 'source-user',
      profileText: 'source profile',
      location: 'source city',
      interests: [],
      skills: [],
      intent: { text: 'source intent' },
    },
    {
      id: 'candidate-user',
      profileText: 'candidate profile',
      location: 'candidate city',
      interests: [],
      skills: [],
      intent: { text: 'candidate intent' },
    },
  ],
};

mock.module('../discovery-env-matrix.main', () => ({
  ATTEMPT_TIMEOUT_MS: 1_000,
  MatrixExecutionError: class MatrixExecutionError extends Error {
    classification: string;

    constructor(classification: string) {
      super(classification);
      this.classification = classification;
    }
  },
  awaitMatrixChildProcess: async () => {
    throw new Error('not used in this test');
  },
  buildMatrixArtifactEvidence: (slots: unknown, execution: unknown) => ({ slots, execution }),
  closeChildResources: async () => undefined,
  collectCandidates: () => [{ id: 'candidate-user', retrievalRank: 1, evidenceTypes: ['intent'], evidenceIds: {} }],
  collectEvaluatorTraces: () => [],
  composeCaseRuntime: async () => ({ sourceUserId: 'source-user', networkId: 'network-1', triggerIntentId: 'intent-1' }),
  createChildDependencies: async (thresholdOverrides?: unknown) => {
    constructorThresholds.push(thresholdOverrides);
    return {
      opportunityGraph: {
        invoke: async () => ({
          candidates: [{ candidateUserId: 'candidate-user', evidence: [{ kind: 'query_intent' }] }],
          evaluatedOpportunities: [{ score: 40, actors: [{ userId: 'source-user' }, { userId: 'candidate-user' }] }],
        }),
      },
    };
  },
  databaseCase: (matrixCase: HistoricalMatrixFixture) => matrixCase,
  discoveryChildThresholdOverrides: () => ({ evaluatorMinScore: Number(process.env.DISCOVERY_EVALUATOR_MIN_SCORE ?? '50') }),
  loadJudge: async () => async () => undefined,
  loadMatrixEval: async () => ({
    HISTORICAL_MATRIX_CASES: [fixtureCase],
    scoreMatrixSlot: async ({ candidates, rowId, repetition }: { candidates: Array<unknown>; rowId: 'a' | 'b'; repetition: number }) => ({
      rowId,
      rule: rowId,
      repetition,
      runs: 1,
      passes: candidates.length,
      passRate: candidates.length,
      flaky: false,
    }),
    buildExecutionEvidence: () => ({ complete: true }),
    executeRuns: async (
      run: ({ runIndex, signal }: { runIndex: number; signal: AbortSignal }) => Promise<unknown>,
      count: number,
    ) => {
      const runs: Array<{ output: unknown }> = [];
      for (let runIndex = 0; runIndex < count; runIndex += 1) {
        runs.push({ output: await run({ runIndex, signal: new AbortController().signal }) });
      }
      return { runs };
    },
  }),
  projectFinalCandidates: (_result: Record<string, unknown>, _rawCandidates: unknown[], _sourceUserId: string, minScore: number) => {
    projectionThresholds.push(minScore);
    return minScore <= 40 ? [{ id: 'candidate-user', finalRank: 1, evidenceTypes: ['intent'], evidenceIds: {} }] : [];
  },
  resolveFixtureTriggerIntent: () => 'intent-1',
  runBoundedChildTasks: async () => {
    throw new Error('not used in this test');
  },
  runMatrixBoundary: async (_classification: string, operation: () => Promise<unknown>) => operation(),
  runWithChildCleanup: async <T>(operation: () => Promise<T>) => operation(),
  sanitizeMatrixError: () => 'internal_error',
}));

mock.module('../discovery-env-matrix-base.main', () => ({
  expectedBaseMetadata: async () => ({ fixtureCorpusVersion: 'historical-matrix-v2' }),
  verifyProtectedBase: async () => undefined,
  verifyBaseFixtureIntegrity: async () => undefined,
}));

mock.module('../../lib/drizzle/drizzle', () => ({ default: {}, closeDb: async () => undefined }));
mock.module('../../schemas/database.schema', () => ({}));

const { runAbChild } = await import('../discovery.main');

afterAll(() => mock.restore());

beforeEach(() => {
  constructorThresholds.length = 0;
  projectionThresholds.length = 0;
  delete process.env.DISCOVERY_EVALUATOR_MIN_SCORE;
});

async function runChildWithThreshold(rawThreshold: string): Promise<{ slots: Array<{ passes: number }> }> {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'discovery-ab-threshold-'));
  const outputPath = path.join(outputDir, 'child-output.json');
  try {
    await runAbChild('a', [{
      matrixCase: fixtureCase,
      side: { id: 'a', config: { DISCOVERY_EVALUATOR_MIN_SCORE: rawThreshold } },
      repetition: 0,
    }], outputPath);
    return JSON.parse(await readFile(outputPath, 'utf8')) as { slots: Array<{ passes: number }> };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

describe('runAbChild threshold wiring', () => {
  it('uses the side-derived evaluator threshold for both child construction and final A/B projection', async () => {
    const output = await runChildWithThreshold('37.5');

    expect(constructorThresholds).toEqual([{ evaluatorMinScore: 37.5 }]);
    expect(projectionThresholds).toEqual([37.5]);
    expect(output.slots[0]?.passes).toBe(1);
  });

  it('still excludes a score-40 evaluated opportunity when the side threshold is 50', async () => {
    const output = await runChildWithThreshold('50');

    expect(constructorThresholds).toEqual([{ evaluatorMinScore: 50 }]);
    expect(projectionThresholds).toEqual([50]);
    expect(output.slots[0]?.passes).toBe(0);
  });
});
