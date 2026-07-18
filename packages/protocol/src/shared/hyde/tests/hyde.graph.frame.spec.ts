import { describe, expect, it } from 'bun:test';

import { computeHydeSourceTextHash, selectHydeDocumentsForGeneration } from '../hyde.documents.js';
import { HydeGraphFactory, type HydeGeneratorLike, type HydeLensInferrerLike, type HydeValidatorLike } from '../hyde.graph.js';
import type { HydeCache } from '../../interfaces/cache.interface.js';
import type { CreateHydeDocumentData, HydeDocument, HydeGraphDatabase } from '../../interfaces/database.interface.js';
import type { EmbeddingGenerator } from '../../interfaces/embedder.interface.js';
import { requestContext } from '../../observability/request-context.js';

const sourceFrame = {
  sourceRoles: [{ role: 'founder', evidence: 'founder' }],
  counterpartRoles: [{ role: 'investor', evidence: 'funding' }],
  hardConstraints: [],
  namedEntities: [],
  domainVocabulary: [{ term: 'climate', evidence: 'climate' }],
};

const lenses = [
  { label: 'climate investor', corpus: 'profiles' as const, reasoning: 'capital' },
  { label: 'funding climate companies', corpus: 'intents' as const, reasoning: 'reciprocal goal' },
];

class MemoryCache implements HydeCache {
  readonly values = new Map<string, unknown>();
  readonly gets: string[] = [];
  readonly sets: string[] = [];

  async get<T>(key: string): Promise<T | null> {
    this.gets.push(key);
    return (this.values.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.sets.push(key);
    this.values.set(key, value);
  }
  async delete(key: string): Promise<boolean> { return this.values.delete(key); }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

function makeHarness(overrides: {
  selectedLenses?: typeof lenses;
  validator: HydeValidatorLike;
  cache?: MemoryCache;
  stored?: Map<string, HydeDocument>;
}) {
  const cache = overrides.cache ?? new MemoryCache();
  const saved: CreateHydeDocumentData[] = [];
  const stored = overrides.stored ?? new Map<string, HydeDocument>();
  const embedCalls: string[][] = [];
  let generatorCalls = 0;

  const database = {
    async getHydeDocument(_sourceType: string, _sourceId: string, strategy: string) {
      return stored.get(strategy) ?? null;
    },
    async getHydeDocumentsForSource() { return []; },
    async saveHydeDocument(data: CreateHydeDocumentData) {
      saved.push(data);
      const row: HydeDocument = {
        id: `row-${saved.length}`,
        sourceType: data.sourceType,
        sourceId: data.sourceId ?? null,
        sourceText: data.sourceText ?? null,
        strategy: data.strategy,
        targetCorpus: data.targetCorpus,
        hydeText: data.hydeText,
        hydeEmbedding: data.hydeEmbedding,
        context: data.context ?? null,
        createdAt: new Date(0),
        expiresAt: data.expiresAt ?? null,
      };
      stored.set(data.strategy, row);
      return row;
    },
    async getIntent() { return null; },
  } as unknown as HydeGraphDatabase;

  const embedder: EmbeddingGenerator = {
    async generate(text) {
      const texts = Array.isArray(text) ? text : [text];
      embedCalls.push(texts);
      const vectors = texts.map((_, index) => [index + 1, index + 2]);
      return Array.isArray(text) ? vectors : vectors[0] ?? [];
    },
  };

  const inferrer: HydeLensInferrerLike = {
    async infer(input) {
      expect(input.frameConstrained).toBe(true);
      return { lenses: overrides.selectedLenses ?? lenses, sourceFrame };
    },
  };
  const generator: HydeGeneratorLike = {
    async generate(input) {
      generatorCalls += 1;
      expect(input.sourceFrame).toEqual(sourceFrame);
      return { text: `generated ${input.lens}` };
    },
  };

  const graph = new HydeGraphFactory(database, embedder, cache, inferrer, generator, {
    mode: 'frame-v1',
    validator: overrides.validator,
  }).createGraph();

  return { graph, cache, saved, stored, embedCalls, get generatorCalls() { return generatorCalls; } };
}

async function invoke(
  graph: ReturnType<HydeGraphFactory['createGraph']>,
  sourceText = 'climate founder seeking funding',
) {
  return graph.invoke({
    sourceType: 'intent' as const,
    sourceId: 'intent-1',
    sourceText,
  });
}

describe('HyDE frame-v1 graph validation', () => {
  it('partially rejects invalid docs before embedding, output, cache, and DB', async () => {
    const validator: HydeValidatorLike = {
      async validate(input) {
        expect(Object.keys(input.documents)).toHaveLength(2);
        return {
          verdicts: Object.entries(input.documents).map(([key, doc]) => {
            expect('lens' in doc).toBe(false);
            const valid = doc.corpus === 'profiles';
            return {
              key,
              valid,
              unsupportedNamedEntities: valid ? [] : ['InventedCo'],
              unsupportedHardConstraints: [],
              reasoning: valid ? 'Grounded.' : 'Invented proper noun.',
            };
          }),
        };
      },
    };
    const harness = makeHarness({ validator });
    const events: Array<Record<string, unknown>> = [];
    const result = await requestContext.run({
      traceEmitter: (event) => events.push(event as unknown as Record<string, unknown>),
    }, () => invoke(harness.graph));

    expect(Object.keys(result.hydeDocuments)).toEqual(['climate investor']);
    expect(result.hydeDocuments['climate investor']?.validationStatus).toBe('valid');
    expect(harness.embedCalls).toEqual([['generated climate investor']]);
    expect(harness.cache.sets).toHaveLength(1);
    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]?.strategy.startsWith('frame-v1:')).toBe(true);
    expect(harness.saved[0]?.context).toEqual({
      hydeGenerationVersion: 'frame-v1',
      lensLabel: 'climate investor',
      validationStatus: 'valid',
      frameFingerprint: expect.any(String),
      sourceTextHash: computeHydeSourceTextHash('climate founder seeking funding'),
      generatedAt: expect.any(String),
    });
    expect(result.hydeDocuments['climate investor']?.generatedAt).toBe(harness.saved[0]?.context?.generatedAt);
    expect(events.find((event) => event.type === 'agent_end' && event.name === 'hyde-validator')?.summary)
      .toBe('1 valid, 1 rejected, 0 failed open');
  });

  it('does not call the embedder or persist when all generated docs are rejected', async () => {
    const harness = makeHarness({
      validator: {
        async validate(input) {
          return { verdicts: Object.keys(input.documents).map((key) => ({
            key,
            valid: false,
            unsupportedNamedEntities: [],
            unsupportedHardConstraints: ['invented deadline'],
            reasoning: 'Unsupported hard constraint.',
          })) };
        },
      },
    });
    const result = await invoke(harness.graph);

    expect(result.hydeDocuments).toEqual({});
    expect(result.hydeEmbeddings).toEqual({});
    expect(harness.embedCalls).toEqual([]);
    expect(harness.cache.sets).toEqual([]);
    expect(harness.saved).toEqual([]);
  });

  it('fails open for retrieval on validator infrastructure failure but never persists', async () => {
    const harness = makeHarness({
      validator: { async validate() { throw new Error('validator unavailable'); } },
    });
    const result = await invoke(harness.graph);

    expect(Object.keys(result.hydeDocuments)).toHaveLength(2);
    expect(Object.values(result.hydeDocuments).every((doc) => doc.validationStatus === 'failed_open')).toBe(true);
    expect(harness.embedCalls).toHaveLength(1);
    expect(harness.cache.sets).toEqual([]);
    expect(harness.saved).toEqual([]);
  });

  it('fails open per affected doc for duplicate and missing verdicts without persistence', async () => {
    const harness = makeHarness({
      validator: {
        async validate(input) {
          const firstKey = Object.keys(input.documents)[0]!;
          const verdict = { key: firstKey, valid: true, unsupportedNamedEntities: [], unsupportedHardConstraints: [], reasoning: 'Grounded.' };
          return { verdicts: [verdict, verdict] };
        },
      },
    });
    const events: Array<Record<string, unknown>> = [];
    const result = await requestContext.run({
      traceEmitter: (event) => events.push(event as unknown as Record<string, unknown>),
    }, () => invoke(harness.graph));

    expect(Object.values(result.hydeDocuments).map((doc) => doc.validationStatus)).toEqual(['failed_open', 'failed_open']);
    expect(harness.cache.sets).toEqual([]);
    expect(harness.saved).toEqual([]);
    expect(events.find((event) => event.type === 'agent_end' && event.name === 'hyde-validator')?.summary)
      .toBe('0 valid, 0 rejected, 2 failed open');
  });

  it('fails open when invalid verdicts name no unsupported entity or hard constraint', async () => {
    const harness = makeHarness({
      validator: {
        async validate(input) {
          return { verdicts: Object.keys(input.documents).map((key) => ({
            key,
            valid: false,
            unsupportedNamedEntities: [],
            unsupportedHardConstraints: [],
            reasoning: 'Rejected for an out-of-scope stylistic reason.',
          })) };
        },
      },
    });
    const result = await invoke(harness.graph);

    expect(Object.values(result.hydeDocuments).every((doc) => doc.validationStatus === 'failed_open')).toBe(true);
    expect(harness.embedCalls).toHaveLength(1);
    expect(harness.cache.sets).toEqual([]);
    expect(harness.saved).toEqual([]);
  });

  it('records content-free validator traces and timing metadata', async () => {
    const harness = makeHarness({
      validator: {
        async validate(input) {
          return { verdicts: Object.keys(input.documents).map((key) => ({
            key,
            valid: true,
            unsupportedNamedEntities: [],
            unsupportedHardConstraints: [],
            reasoning: 'Grounded.',
          })) };
        },
      },
    });
    const events: Array<Record<string, unknown>> = [];
    const result = await requestContext.run({
      traceEmitter: (event) => events.push(event as unknown as Record<string, unknown>),
    }, () => invoke(harness.graph));

    const validatorEvents = events.filter((event) => event.name === 'hyde-validator');
    expect(validatorEvents.map((event) => event.type)).toEqual(['agent_start', 'agent_end']);
    expect(JSON.stringify(validatorEvents)).not.toContain('climate founder seeking funding');
    expect(JSON.stringify(validatorEvents)).not.toContain('generated climate investor');
    expect(JSON.stringify(validatorEvents)).not.toContain('climate investor');
    expect(validatorEvents[1]?.summary).toBe('2 valid, 0 rejected, 0 failed open');
    expect(result.agentTimings.some((timing) => timing.name === 'hyde.validator')).toBe(true);
  });
});

describe('HyDE cache and DB isolation', () => {
  it('keeps legacy data untouched, namespaces frame-v1, and bypasses validation for validated cache hits', async () => {
    const cache = new MemoryCache();
    const stored = new Map<string, HydeDocument>();
    const databaseSaved: CreateHydeDocumentData[] = [];
    let generationCalls = 0;
    let validationCalls = 0;
    let embedCalls = 0;

    const database = {
      async getHydeDocument(_type: string, _id: string, strategy: string) { return stored.get(strategy) ?? null; },
      async getHydeDocumentsForSource() { return []; },
      async saveHydeDocument(data: CreateHydeDocumentData) {
        databaseSaved.push(data);
        const row = { id: data.strategy, sourceType: data.sourceType, sourceId: data.sourceId ?? null, sourceText: null, strategy: data.strategy, targetCorpus: data.targetCorpus, hydeText: data.hydeText, hydeEmbedding: data.hydeEmbedding, context: data.context ?? null, createdAt: new Date(0), expiresAt: null } as HydeDocument;
        stored.set(data.strategy, row);
        return row;
      },
      async getIntent() { return null; },
    } as unknown as HydeGraphDatabase;
    const embedder: EmbeddingGenerator = {
      async generate(text) {
        embedCalls += 1;
        return Array.isArray(text) ? text.map(() => [1, 2]) : [1, 2];
      },
    };
    const inferrer: HydeLensInferrerLike = {
      async infer(input) {
        return {
          lenses: [lenses[0]],
          ...(input.frameConstrained ? { sourceFrame } : {}),
        };
      },
    };
    const generator: HydeGeneratorLike = {
      async generate(input) { generationCalls += 1; return { text: `${input.sourceFrame ? 'frame' : 'legacy'} output` }; },
    };
    const validator: HydeValidatorLike = {
      async validate(input) {
        validationCalls += 1;
        return { verdicts: Object.keys(input.documents).map((key) => ({ key, valid: true, unsupportedNamedEntities: [], unsupportedHardConstraints: [], reasoning: 'Grounded.' })) };
      },
    };
    const graphInput = { sourceType: 'intent' as const, sourceId: 'intent-1', sourceText: 'climate founder seeking funding' };

    const legacyGraph = new HydeGraphFactory(database, embedder, cache, inferrer, generator, { mode: 'legacy' }).createGraph();
    const legacyTrace: string[] = [];
    const legacy = await requestContext.run({
      traceEmitter: (event) => {
        if ('name' in event) legacyTrace.push(`${event.type}:${event.name}`);
      },
    }, () => legacyGraph.invoke(graphInput));
    const legacyKey = cache.sets[0]!;
    const legacyStrategy = databaseSaved[0]!.strategy;
    expect(legacyKey).toBe('hyde:intent:intent-1:db44edbe924a1926');
    expect(legacyStrategy).toBe('db44edbe924a1926');
    expect(legacyTrace).toEqual([
      'agent_start:lens-inferrer',
      'agent_end:lens-inferrer',
      'agent_start:hyde-generator',
      'agent_end:hyde-generator',
    ]);
    expect(legacy.agentTimings.some((timing) => timing.name === 'hyde.validator')).toBe(false);

    const frameGraph = new HydeGraphFactory(database, embedder, cache, inferrer, generator, { mode: 'frame-v1', validator }).createGraph();
    const frame = await frameGraph.invoke(graphInput);
    const frameKey = cache.sets.find((key) => key.startsWith('hyde:frame-v1:'))!;
    expect(frameKey).toMatch(/^hyde:frame-v1:intent:intent-1:/);
    expect(frame.hydeDocuments['climate investor']?.hydeText).toBe('frame output');
    expect(validationCalls).toBe(1);

    const frameCached = await frameGraph.invoke(graphInput);
    expect(frameCached.hydeDocuments['climate investor']?.origin).toBe('cache');
    expect(frameCached.hydeDocuments['climate investor']?.generatedAt)
      .toBe(frame.hydeDocuments['climate investor']?.generatedAt);
    expect(validationCalls).toBe(1);
    expect(generationCalls).toBe(2);
    expect(embedCalls).toBe(2);

    cache.values.delete(frameKey);
    const frameFromDb = await frameGraph.invoke(graphInput);
    expect(frameFromDb.hydeDocuments['climate investor']?.origin).toBe('db');
    expect(frameFromDb.hydeDocuments['climate investor']?.generatedAt)
      .toBe(frame.hydeDocuments['climate investor']?.generatedAt);
    expect(validationCalls).toBe(1);
    expect(generationCalls).toBe(2);

    const rolledBack = await legacyGraph.invoke(graphInput);
    expect(rolledBack.hydeDocuments['climate investor']?.hydeText).toBe(legacy.hydeDocuments['climate investor']?.hydeText);
    expect(generationCalls).toBe(2);
    expect(cache.values.has(legacyKey)).toBe(true);
    expect(cache.values.has(frameKey)).toBe(true);
    expect(databaseSaved.some((data) => data.strategy.startsWith('frame-v1:') && data.context?.validationStatus === 'valid')).toBe(true);
  });

  it('assigns one generation marker to retained cache hits and newly generated docs', async () => {
    const harness = makeHarness({
      validator: {
        async validate(input) {
          return { verdicts: Object.keys(input.documents).map((key) => ({
            key,
            valid: true,
            unsupportedNamedEntities: [],
            unsupportedHardConstraints: [],
            reasoning: 'Grounded.',
          })) };
        },
      },
    });
    const sourceText = 'climate founder seeking funding';
    await invoke(harness.graph, sourceText);

    const [, newerCacheKey] = [...harness.cache.values.keys()];
    const newerCached = harness.cache.values.get(newerCacheKey!) as { generatedAt?: string };
    const newerMarker = new Date(Date.parse(newerCached.generatedAt!) + 1).toISOString();
    harness.cache.values.set(newerCacheKey!, { ...newerCached, generatedAt: newerMarker });
    const savedBeforeMixedRun = harness.saved.length;

    await invoke(harness.graph, sourceText);
    const mixedRunWrites = harness.saved.slice(savedBeforeMixedRun);
    const markers = mixedRunWrites.map((row) => row.context?.generatedAt);

    expect(harness.generatorCalls).toBe(3);
    expect(mixedRunWrites).toHaveLength(2);
    expect(new Set(markers).size).toBe(1);
    expect(markers[0]).toEqual(expect.any(String));
    expect(selectHydeDocumentsForGeneration(
      [...harness.stored.values()],
      'frame-v1',
      sourceText,
    )).toHaveLength(2);
  });

  it('does not reuse frame-v1 DB rows without the current frame fingerprint', async () => {
    const harness = makeHarness({
      validator: {
        async validate(input) {
          return { verdicts: Object.keys(input.documents).map((key) => ({
            key,
            valid: true,
            unsupportedNamedEntities: [],
            unsupportedHardConstraints: [],
            reasoning: 'Grounded.',
          })) };
        },
      },
    });

    await invoke(harness.graph);
    for (const [strategy, row] of harness.stored) {
      harness.stored.set(strategy, {
        ...row,
        context: row.context ? { ...row.context, frameFingerprint: undefined } : null,
      });
    }
    harness.cache.values.clear();
    await invoke(harness.graph);

    expect(harness.generatorCalls).toBe(4);
    expect(harness.saved).toHaveLength(4);
  });

  it('keeps stable DB strategies while replacing source-bound frame metadata after source edits', async () => {
    const harness = makeHarness({
      validator: {
        async validate(input) {
          return { verdicts: Object.keys(input.documents).map((key) => ({
            key,
            valid: true,
            unsupportedNamedEntities: [],
            unsupportedHardConstraints: [],
            reasoning: 'Grounded.',
          })) };
        },
      },
    });

    const firstSourceText = 'climate founder seeking funding';
    const secondSourceText = 'climate founder still seeking funding';
    const first = await invoke(harness.graph, firstSourceText);
    const firstSaved = harness.saved.slice(0, 2);
    harness.cache.values.clear();
    const second = await invoke(harness.graph, secondSourceText);
    const secondSaved = harness.saved.slice(2, 4);

    expect(first.hydeDocuments['climate investor']?.targetCorpus).toBe('profiles');
    expect(second.hydeDocuments['climate investor']?.targetCorpus).toBe('profiles');
    expect(harness.generatorCalls).toBe(4);
    expect(harness.saved).toHaveLength(4);
    expect(firstSaved.map((doc) => doc.strategy).sort())
      .toEqual(secondSaved.map((doc) => doc.strategy).sort());
    expect(firstSaved.every((doc) => /^frame-v1:[a-f0-9]{16}$/.test(doc.strategy))).toBe(true);

    const firstFingerprint = firstSaved[0]?.context?.frameFingerprint;
    const secondFingerprint = secondSaved[0]?.context?.frameFingerprint;
    expect(firstFingerprint).toEqual(expect.any(String));
    expect(secondFingerprint).toEqual(expect.any(String));
    expect(secondFingerprint).not.toBe(firstFingerprint);
    expect(firstSaved.every((doc) => doc.context?.sourceTextHash === computeHydeSourceTextHash(firstSourceText))).toBe(true);
    expect(secondSaved.every((doc) => doc.context?.sourceTextHash === computeHydeSourceTextHash(secondSourceText))).toBe(true);
    expect(new Set(firstSaved.map((doc) => doc.context?.generatedAt)).size).toBe(1);
    expect(new Set(secondSaved.map((doc) => doc.context?.generatedAt)).size).toBe(1);
    expect(secondSaved[0]?.context?.generatedAt).not.toBe(firstSaved[0]?.context?.generatedAt);
  });
});
