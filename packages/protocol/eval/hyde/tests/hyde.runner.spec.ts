import { describe, expect, it } from 'bun:test';

import type { HydeGenerateInput } from '../../../src/shared/hyde/hyde.generator.js';
import type { EmbeddingGenerator } from '../../../src/shared/interfaces/embedder.interface.js';

import { HYDE_CASES } from '../hyde.cases.js';
import { HYDE_CANONICAL_EMBEDDING_PIN, HYDE_CANONICAL_FRAME_GENERATION_VERSION, HYDE_CANONICAL_MODEL_PINS } from '../hyde.policy.js';
import { buildCounterbalancedSchedule, collectHydeEvidence, discovererContextForHydeCase, graphSourceTypeForHydeCase, hydeGraphInputForCase, HydeEvalRunError, RecordingGenerator, sourceIdForHydeCase, type HydeRunExecutionInput } from '../hyde.runner.js';
import type { HydeEvalRunResult } from '../hyde.types.js';

const CLEAN_GIT = {
  revision: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
  revisionWithDirtyMarker: '0123456789abcdef0123456789abcdef01234567',
} as const;

function successfulEmbedder(onBatch?: (vectors: number[][]) => void): EmbeddingGenerator {
  return {
    async generate(text: string | string[]): Promise<number[] | number[][]> {
      if (!Array.isArray(text)) return [1, 0];
      const vectors = text.map((_, index) => [1, index + 1]);
      onBatch?.(vectors);
      return vectors;
    },
  };
}

function runResult(
  input: HydeRunExecutionInput,
  overrides: Partial<HydeEvalRunResult> = {},
): HydeEvalRunResult {
  return {
    caseId: input.case.id,
    mode: input.mode,
    run: input.run,
    allCandidateScores: [],
    ranking: [],
    lensCount: 1,
    returnedDocumentCount: 1,
    generatedDocumentCount: 1,
    overwrittenDocumentCount: 0,
    validatorSubmittedDocumentCount: input.mode === 'frame-v1' ? 1 : 0,
    rejectedCount: input.mode === 'frame-v1' ? 0 : null,
    failedOpenCount: 0,
    documents: [],
    resources: {
      lensInferenceCalls: [{ durationMs: 1, inputCount: 1, outcome: 'completed' }],
      generatorCalls: [{ durationMs: 1, inputCount: 1, outcome: 'completed' }],
      validatorCalls: input.mode === 'frame-v1'
        ? [{ durationMs: 1, inputCount: 1, outcome: 'completed' }]
        : [],
      documentEmbeddingCalls: [{ durationMs: 1, inputCount: 1, outcome: 'completed' }],
    },
    ...overrides,
  };
}

function completedSlotCount(collection: Awaited<ReturnType<typeof collectHydeEvidence>>): number {
  return collection.pairedBlocks.reduce((count, block) =>
    count + Number(block.legacy.status === 'completed') + Number(block.frameV1.status === 'completed'), 0);
}

describe('counterbalanced HyDE collection schedule', () => {
  it('is deterministic, globally hash ordered, input-order stable, and exactly 2/2 per case', () => {
    const caseIds = HYDE_CASES.slice(0, 4).map((c) => c.id);
    const first = buildCounterbalancedSchedule(caseIds);
    const second = buildCounterbalancedSchedule(caseIds);
    const reversedInput = buildCounterbalancedSchedule([...caseIds].reverse());

    expect(first).toEqual(second);
    expect(first).toEqual(reversedInput);
    expect(first.map((entry) => entry.executionOrdinal)).toEqual(
      Array.from({ length: first.length }, (_, index) => index),
    );
    expect(first.map((entry) => entry.caseRunHash)).toEqual(
      [...first.map((entry) => entry.caseRunHash)].sort(),
    );

    for (const caseId of caseIds) {
      const entries = first.filter((entry) => entry.caseId === caseId);
      expect(entries).toHaveLength(4);
      expect(entries.filter((entry) => entry.modeOrder[0] === 'legacy')).toHaveLength(2);
      expect(entries.filter((entry) => entry.modeOrder[0] === 'frame-v1')).toHaveLength(2);
    }
  });
});

describe('collectHydeEvidence', () => {
  it('records the background-only source mapping in provenance and every paired block', async () => {
    const savedIntent = HYDE_CASES.find((c) => c.backgroundSource === 'saved-intent');
    const userContext = HYDE_CASES.find((c) => c.backgroundSource === 'user-context');
    if (!savedIntent || !userContext) throw new Error('Expected both source cohorts');
    expect(graphSourceTypeForHydeCase(savedIntent)).toBe('query');
    expect(graphSourceTypeForHydeCase(userContext)).toBe('context');
    expect(sourceIdForHydeCase(savedIntent)).toBe(`hyde-eval/saved-intent/${savedIntent.id}`);
    expect(sourceIdForHydeCase(userContext)).toBe(`hyde-eval/user-context/${userContext.id}`);
    const savedIntentContext = discovererContextForHydeCase(savedIntent);
    expect(savedIntentContext).toBe([
      ...(savedIntent.profileContext ? [`Context: ${savedIntent.profileContext}`] : []),
      '',
      'Active intents:',
      `- ${savedIntent.sourceText}`,
    ].join('\n'));
    expect(hydeGraphInputForCase(savedIntent, 3)).toMatchObject({
      sourceType: 'query', sourceId: sourceIdForHydeCase(savedIntent), sourceText: savedIntent.sourceText,
      profileContext: savedIntentContext,
    });
    const savedWithoutAuthoredContext = HYDE_CASES.find((candidate) =>
      candidate.backgroundSource === 'saved-intent' && candidate.profileContext === undefined);
    if (!savedWithoutAuthoredContext) throw new Error('Expected a saved-intent case without authored context');
    expect(discovererContextForHydeCase(savedWithoutAuthoredContext)).toBe(
      `\nActive intents:\n- ${savedWithoutAuthoredContext.sourceText}`,
    );
    expect(discovererContextForHydeCase(userContext)).toBeUndefined();
    expect(hydeGraphInputForCase(userContext, 3)).toEqual({
      sourceType: 'context', sourceId: sourceIdForHydeCase(userContext), sourceText: userContext.sourceText,
      maxLenses: 3, forceRegenerate: true,
    });

    const collection = await collectHydeEvidence({
      selectedCaseIds: [savedIntent.id, userContext.id],
      embedder: successfulEmbedder(),
      git: CLEAN_GIT,
      runExecutor: async (input) => runResult(input),
    });
    expect(collection.provenance.backgroundSourceGraphMapping).toEqual([
      { backgroundSource: 'saved-intent', graphSourceType: 'query' },
      { backgroundSource: 'user-context', graphSourceType: 'context' },
    ]);
    expect(collection.pairedBlocks.filter((block) => block.caseId === savedIntent.id)
      .every((block) => block.backgroundSource === 'saved-intent' && block.graphSourceType === 'query')).toBeTrue();
    expect(collection.pairedBlocks.filter((block) => block.caseId === userContext.id)
      .every((block) => block.backgroundSource === 'user-context' && block.graphSourceType === 'context')).toBeTrue();
  });

  it('embeds candidates once per case and reuses the same vector objects in both modes and all runs', async () => {
    const selected = HYDE_CASES.slice(0, 2);
    const embeddedBatches: number[][][] = [];
    const candidatesByCase = new Map<string, HydeRunExecutionInput['candidates']>();
    const firstVectorsByCase = new Map<string, number[]>();
    const calls: Array<{ caseId: string; run: number; mode: string }> = [];

    const collection = await collectHydeEvidence({
      selectedCaseIds: selected.map((c) => c.id),
      embedder: successfulEmbedder((vectors) => embeddedBatches.push(vectors)),
      git: CLEAN_GIT,
      runExecutor: async (input) => {
        calls.push({ caseId: input.case.id, run: input.run, mode: input.mode });
        const priorCandidates = candidatesByCase.get(input.case.id);
        const priorVector = firstVectorsByCase.get(input.case.id);
        if (priorCandidates) {
          if (!priorVector) throw new Error('Missing previously observed vector reference');
          expect(input.candidates).toBe(priorCandidates);
          expect(input.candidates[0]?.embedding).toBe(priorVector);
        } else {
          candidatesByCase.set(input.case.id, input.candidates);
          firstVectorsByCase.set(input.case.id, input.candidates[0]?.embedding ?? []);
        }
        return runResult(input, {
          allCandidateScores: input.candidates.map((candidate) => ({
            candidateId: candidate.id,
            role: candidate.role,
            relevanceGrade: candidate.relevanceGrade,
            corpus: candidate.corpus,
            ...(candidate.hardNegativeOf ? { hardNegativeOf: candidate.hardNegativeOf } : {}),
            score: 0,
            lensMatches: [],
            maxCosine: 0,
            qualifyingMatchCount: 0,
            matchedLensIds: [],
            qualified: false,
          })),
        });
      },
    });

    expect(embeddedBatches).toHaveLength(2);
    expect(collection.candidateEmbeddingSetups).toHaveLength(2);
    expect(collection.candidateEmbeddingSetups.every((setup) => setup.status === 'completed')).toBeTrue();
    expect(collection.pairedBlocks).toHaveLength(8);
    expect(calls).toHaveLength(16);
    expect(calls).toEqual(collection.pairedBlocks.flatMap((block) =>
      block.modeOrder.map((mode) => ({ caseId: block.caseId, run: block.run, mode }))));
    for (const block of collection.pairedBlocks) {
      const expectedCandidateCount = selected.find(
        (candidate) => candidate.id === block.caseId,
      )?.candidates.length;
      expect(expectedCandidateCount).toBeDefined();
      if (block.legacy.status === 'completed') {
        expect(block.legacy.result.allCandidateScores).toHaveLength(expectedCandidateCount ?? 0);
      }
      if (block.frameV1.status === 'completed') {
        expect(block.frameV1.result.allCandidateScores).toHaveLength(expectedCandidateCount ?? 0);
      }
    }
  });

  it('records a failed mode slot and continues without retrying it', async () => {
    const caseId = HYDE_CASES[0].id;
    const schedule = buildCounterbalancedSchedule([caseId]);
    const failed = schedule[0];
    const calls: Array<{ run: number; mode: string }> = [];

    const collection = await collectHydeEvidence({
      selectedCaseIds: [caseId],
      embedder: successfulEmbedder(),
      git: CLEAN_GIT,
      runExecutor: async (input) => {
        calls.push({ run: input.run, mode: input.mode });
        if (input.run === failed.run && input.mode === failed.modeOrder[0]) {
          throw new Error('provider exploded apiKey=supersecretvalue\nstack line');
        }
        return runResult(input);
      },
    });

    expect(calls).toHaveLength(8);
    expect(collection.pairedBlocks).toHaveLength(4);
    expect(completedSlotCount(collection)).toBe(7);
    const failedBlock = collection.pairedBlocks.find((block) => block.run === failed.run);
    const failedSlot = failed.modeOrder[0] === 'legacy' ? failedBlock?.legacy : failedBlock?.frameV1;
    expect(failedSlot?.status).toBe('failed');
    if (failedSlot?.status === 'failed') {
      expect(failedSlot.failure).toMatchObject({ code: 'graph_error', stage: 'graph', retryable: false });
      expect(failedSlot.failure.message).not.toContain('\n');
      expect(failedSlot.failure.message).not.toContain('supersecretvalue');
      expect(failedSlot.failure).not.toHaveProperty('stack');
    }
    expect(collection.canonicality.reasons).toContain('paired evidence contains explicit failed slots');
  });

  it('retains typed failed-run wrapper resources collected before the throw', async () => {
    const caseId = HYDE_CASES[0].id;
    let failedOnce = false;
    const collection = await collectHydeEvidence({
      selectedCaseIds: [caseId],
      embedder: successfulEmbedder(),
      git: CLEAN_GIT,
      runExecutor: async (input) => {
        if (!failedOnce) {
          failedOnce = true;
          throw new HydeEvalRunError('generation', new Error('generation failed'), {
            lensInferenceCalls: [{ durationMs: 1, inputCount: 1, outcome: 'completed' }],
            generatorCalls: [{ durationMs: 2, inputCount: 1, outcome: 'threw' }],
            validatorCalls: [],
            documentEmbeddingCalls: [],
          });
        }
        return runResult(input);
      },
    });
    const failedSlot = collection.pairedBlocks.flatMap((block) => [block.legacy, block.frameV1])
      .find((slot) => slot.status === 'failed');
    expect(failedSlot?.status).toBe('failed');
    if (failedSlot?.status !== 'failed') throw new Error('Expected failed slot');
    expect(failedSlot.failure).toMatchObject({ stage: 'generation', code: 'generation_error' });
    expect(failedSlot.resources?.generatorCalls).toEqual([
      { durationMs: 2, inputCount: 1, outcome: 'threw' },
    ]);
  });

  it('turns a candidate-embedding failure into every explicit pair slot and continues other cases', async () => {
    const selected = HYDE_CASES.slice(0, 2);
    let embeddingCalls = 0;
    let executorCalls = 0;
    const embedder: EmbeddingGenerator = {
      async generate(text: string | string[]): Promise<number[] | number[][]> {
        embeddingCalls += 1;
        if (embeddingCalls === 1) throw new Error('candidate embedding unavailable');
        if (!Array.isArray(text)) return [1, 0];
        return text.map((_, index) => [1, index + 1]);
      },
    };

    const collection = await collectHydeEvidence({
      selectedCaseIds: selected.map((c) => c.id),
      embedder,
      git: CLEAN_GIT,
      runExecutor: async (input) => {
        executorCalls += 1;
        return runResult(input);
      },
    });

    expect(embeddingCalls).toBe(2);
    expect(executorCalls).toBe(8);
    expect(collection.pairedBlocks).toHaveLength(8);
    const failedCaseBlocks = collection.pairedBlocks.filter((block) => block.caseId === selected[0].id);
    expect(failedCaseBlocks).toHaveLength(4);
    for (const block of failedCaseBlocks) {
      expect(block.legacy.status).toBe('failed');
      expect(block.frameV1.status).toBe('failed');
      if (block.legacy.status === 'failed') expect(block.legacy.failure.stage).toBe('embedding');
      if (block.frameV1.status === 'failed') expect(block.frameV1.failure.stage).toBe('embedding');
    }
    expect(collection.candidateEmbeddingSetups[0]).toMatchObject({
      caseId: selected[0].id,
      status: 'failed',
      inputCount: selected[0].candidates.length,
    });
    expect(collection.pairedBlocks
      .filter((block) => block.caseId === selected[1].id)
      .every((block) => block.legacy.status === 'completed' && block.frameV1.status === 'completed')).toBeTrue();
  });

  it('marks every caller-provided provenance override explicitly noncanonical', async () => {
    const caseId = HYDE_CASES[0].id;
    const collection = await collectHydeEvidence({
      selectedCaseIds: [caseId],
      embedder: successfulEmbedder(),
      runExecutor: async (input) => runResult(input),
      git: CLEAN_GIT,
      models: HYDE_CANONICAL_MODEL_PINS,
      embedding: HYDE_CANONICAL_EMBEDDING_PIN,
      generationVersion: HYDE_CANONICAL_FRAME_GENERATION_VERSION,
    });

    expect(collection.canonicality.reasons).toEqual(expect.arrayContaining([
      'git provenance metadata was caller-provided instead of read from the collection environment',
      'configured primary model provenance was caller-provided instead of read from production model config',
      'configured primary embedding provenance was caller-provided instead of read from production embedding config',
      'generation version provenance was caller-provided instead of read from production HyDE config',
    ]));
  });

  it('marks embedding env overrides and model drift noncanonical against committed pins', async () => {
    const caseId = HYDE_CASES[0].id;
    const previousEmbeddingModel = process.env.EMBEDDING_MODEL;
    process.env.EMBEDDING_MODEL = 'test/drifted-embedding-model';
    try {
      const collection = await collectHydeEvidence({
        selectedCaseIds: [caseId],
        embedder: successfulEmbedder(),
        git: CLEAN_GIT,
        models: {
          lensInferrer: 'test/drifted-lens-model',
          generator: 'google/gemini-2.5-flash',
          validator: 'google/gemini-2.5-flash',
        },
        runExecutor: async (input) => runResult(input),
      });

      expect(collection.provenance.embedding.model).toBe('test/drifted-embedding-model');
      expect(collection.canonicality.reasons).toContain(
        'configured primary model provenance differs from committed canonical pins',
      );
      expect(collection.canonicality.reasons).toContain(
        'configured primary embedding provenance differs from committed canonical pins',
      );
    } finally {
      if (previousEmbeddingModel === undefined) delete process.env.EMBEDDING_MODEL;
      else process.env.EMBEDDING_MODEL = previousEmbeddingModel;
    }
  });

  it('awaits every concurrent recording-generator call without leaking a rejection', async () => {
    let releaseSlow: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const generator = new RecordingGenerator({
      async generate(input: HydeGenerateInput) {
        if (input.lens === 'fast-failure') throw new Error('synthetic failure');
        await slow;
        return { text: 'slow result' };
      },
    });
    const base = { sourceText: 'source', corpus: 'intents' as const };
    const failed = generator.generate({ ...base, lens: 'fast-failure' });
    const pending = generator.generate({ ...base, lens: 'slow-success' });
    await expect(failed).rejects.toThrow('synthetic failure');
    let settled = false;
    const drain = generator.awaitSettled().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBeFalse();
    releaseSlow?.();
    await Promise.all([pending, drain]);
    expect(generator.calls).toHaveLength(2);
    expect(generator.calls.map((call) => call.timing.outcome).sort()).toEqual(['completed', 'threw']);
  });

  it('keeps a production-style validator failed-open result as a completed collection slot', async () => {
    const caseId = HYDE_CASES[0].id;
    const collection = await collectHydeEvidence({
      selectedCaseIds: [caseId],
      embedder: successfulEmbedder(),
      git: CLEAN_GIT,
      runExecutor: async (input) => input.mode === 'frame-v1'
        ? runResult(input, {
          failedOpenCount: 1,
          documents: [{
            lens: 'source-grounded lens',
            corpus: 'intents',
            text: 'Generated text retained after validator exception.',
            mapStatus: 'submitted',
            validationStatus: 'failed_open',
            failedOpenReason: 'validator_error',
            returned: true,
          }],
          resources: {
            lensInferenceCalls: [{ durationMs: 1, inputCount: 1, outcome: 'completed' }],
            generatorCalls: [{ durationMs: 1, inputCount: 1, outcome: 'completed' }],
            validatorCalls: [{ durationMs: 1, inputCount: 1, outcome: 'threw' }],
            documentEmbeddingCalls: [{ durationMs: 1, inputCount: 1, outcome: 'completed' }],
          },
        })
        : runResult(input),
    });

    const frameSlots = collection.pairedBlocks.map((block) => block.frameV1);
    expect(frameSlots.every((slot) => slot.status === 'completed')).toBeTrue();
    expect(frameSlots.every((slot) => slot.status === 'completed' && slot.result.failedOpenCount === 1)).toBeTrue();
    expect(collection.canonicality.reasons).not.toContain('paired evidence contains explicit failed slots');
  });
});
