import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { HydeGraphFactory } from '@indexnetwork/protocol';

import { HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION, HistoricalQualityChildConfigurationSchema, HistoricalQualitySlotDispatchSchema, parseHistoricalQualityChildConfiguration, parseHistoricalQualitySlotDispatch, preflightHistoricalQualityChildRuntime, reattestExactSelectedChild, reconcileHistoricalQualityChildEmbedding, runHistoricalQualityChild, type HistoricalQualityChildDeps, type HistoricalQualitySlotDispatch } from '../discovery-quality.child';
import { NamespacedHydeCache } from '../discovery-quality.cache';
import { embeddingConfigurationFingerprint } from '../../lib/embedding/embedding.identity';
import { loadAvailableHistoricalQualityChildRuntime } from '../discovery-quality.child-loader';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const fullFingerprint = 'a'.repeat(64);
const configurationJson = JSON.stringify({ DISCOVERY_ALLOWED_TYPES: 'intent' });
const childFingerprint = sha(configurationJson);
const databaseUrl = 'postgres://user:password@ep-a.neon.tech/protocol_eval';

const dispatch: HistoricalQualitySlotDispatch = {
  runId: `hq-run-${'1'.repeat(32)}`,
  slotId: `hq-slot-${'2'.repeat(64)}`,
  configurationId: 'a',
  configurationFingerprint: fullFingerprint,
  childEnvironmentFingerprint: childFingerprint,
  childResolvedConfigurationFingerprint: 'c'.repeat(64),
  outputPath: '/tmp/historical-quality-output.json',
};

const childEnvironment = Object.freeze({
  DISCOVERY_TARGETS: JSON.stringify({
    version: 2,
    projectId: 'project-1',
    baseBranchId: 'branch-base',
    baseReadReplica: {
      endpointId: 'endpoint-replica',
      databaseUrl: 'postgres://user:password@ep-replica.neon.tech/protocol_eval',
    },
    targets: [
      { sideId: 'a', branchId: 'branch-a', endpointId: 'endpoint-a', databaseUrl },
      { sideId: 'b', branchId: 'branch-b', endpointId: 'endpoint-b', databaseUrl: 'postgres://user:password@ep-b.neon.tech/protocol_eval' },
    ],
  }),
  NEON_API_KEY: 'neon-test-key',
  DISCOVERY_CONFIRM: '1',
  TEST_DATABASE_SAFE: '1',
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'openrouter-test-key',
  OPENROUTER_BASE_URL: 'https://openrouter.example/api',
  EMBEDDING_MODEL: 'openai/text-embedding-3-large',
  EMBEDDING_DIMENSIONS: '2000',
  REDIS_URL: 'redis://user:password@redis.example:6379',
  DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON: configurationJson,
  DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT: childFingerprint,
});

const verifiedEmbedding = Object.freeze({
  provider: 'openrouter',
  model: 'openai/text-embedding-3-large',
  dimensions: 2000,
});
const verifiedBase = Object.freeze({
  version: 1 as const,
  embedding: Object.freeze({
    ...verifiedEmbedding,
    configurationFingerprint: embeddingConfigurationFingerprint(verifiedEmbedding),
  }),
  corpusVersion: 'historical-shared-pool-v1',
});

const output = {
  schemaVersion: 1 as const,
  runId: dispatch.runId,
  slotId: dispatch.slotId,
  configurationId: 'a' as const,
  transportRow: {},
  executionRun: {},
} as never;

function dependencies(events: string[] = []): HistoricalQualityChildDeps {
  return {
    environment: childEnvironment,
    reattestSelectedChild: async () => {
      events.push('attest');
      return { target: { sideId: 'a', branchId: 'branch-a', endpointId: 'endpoint-a', databaseUrl } };
    },
    openVerifier: async (selectedUrl) => {
      events.push(`open:${selectedUrl}`);
      return { db: {} as never, close: async () => { events.push('verifier-close'); } };
    },
    verifyPublishedState: async () => {
      events.push('verify');
      return verifiedBase;
    },
    resolveChildResolvedConfigurationFingerprint: async ({ configuration, runtimeEnvironment, base }) => {
      events.push('resolve');
      expect(configuration).toEqual({ DISCOVERY_ALLOWED_TYPES: 'intent' });
      expect(runtimeEnvironment.DATABASE_URL).toBeUndefined();
      expect(runtimeEnvironment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(runtimeEnvironment.INVENTED_PARENT_VALUE).toBeUndefined();
      expect(runtimeEnvironment).toMatchObject({
        DISCOVERY_TARGETS: childEnvironment.DISCOVERY_TARGETS,
        NEON_API_KEY: childEnvironment.NEON_API_KEY,
        OPENROUTER_API_KEY: childEnvironment.OPENROUTER_API_KEY,
        REDIS_URL: childEnvironment.REDIS_URL,
      });
      expect(base).toBe(verifiedBase);
      return dispatch.childResolvedConfigurationFingerprint;
    },
    createDependencies: async ({ selectedDatabaseUrl, cache }, resources) => {
      events.push('create');
      expect(selectedDatabaseUrl).toBe(databaseUrl);
      expect(cache).toBeInstanceOf(NamespacedHydeCache);
      resources.add({
        kind: 'database',
        close: async () => { events.push('database-close'); },
      });
      return {};
    },
    executeSlot: async () => {
      events.push('execute');
      return output;
    },
    createCache: (seed, resources) => {
      events.push('cache-construct');
      resources.add({
        kind: 'cache',
        close: async () => { events.push('cache-close'); },
      });
      return new NamespacedHydeCache({
        get: async () => null,
        set: async () => {},
        delete: async () => false,
        exists: async () => false,
      }, seed);
    },
  };
}

describe('historical quality child contract', () => {
  it('exports the exact version expected by the Task 5 loader', async () => {
    expect(HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION).toBe(1);
    await expect(loadAvailableHistoricalQualityChildRuntime({})).resolves.toMatchObject({
      contractVersion: HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION,
    });
  });

  it('strictly parses opaque argv with separate full and child-environment fingerprints', () => {
    const args = [
      '--historical-quality-child',
      '--run-id', dispatch.runId,
      '--slot-id', dispatch.slotId,
      '--configuration-id', 'a',
      '--configuration-fingerprint', dispatch.configurationFingerprint,
      '--child-environment-fingerprint', dispatch.childEnvironmentFingerprint,
      '--child-resolved-configuration-fingerprint', dispatch.childResolvedConfigurationFingerprint,
      '--child-output', dispatch.outputPath,
    ];
    expect(parseHistoricalQualitySlotDispatch(args)).toEqual(dispatch);
    expect(args.join(' ')).not.toContain('DISCOVERY_ALLOWED_TYPES');
    expect(args.join(' ')).not.toContain('intent');
  });

  it('rejects dispatch extras, malformed slots, and a missing separate fingerprint', () => {
    expect(() => HistoricalQualitySlotDispatchSchema.parse({ ...dispatch, extra: true })).toThrow();
    expect(() => HistoricalQualitySlotDispatchSchema.parse({ ...dispatch, slotId: 'wrong-slot' })).toThrow();
    expect(() => parseHistoricalQualitySlotDispatch([
      '--historical-quality-child', '--run-id', dispatch.runId, '--slot-id', dispatch.slotId,
      '--configuration-id', 'a', '--configuration-fingerprint', fullFingerprint,
      '--child-output', dispatch.outputPath,
    ])).toThrow(/child-environment-fingerprint/);
  });
});

describe('parseHistoricalQualityChildConfiguration', () => {
  it('round-trips allowed JSON in canonical key order and makes ordering digest-invariant', () => {
    const leftRaw = '{"NEGOTIATOR_STANCE":"skeptic","DISCOVERY_ALLOWED_TYPES":"intent"}';
    const rightRaw = '{"DISCOVERY_ALLOWED_TYPES":"intent","NEGOTIATOR_STANCE":"skeptic"}';
    const canonical = JSON.stringify({ DISCOVERY_ALLOWED_TYPES: 'intent', NEGOTIATOR_STANCE: 'skeptic' });
    const expectedFingerprint = sha(canonical);
    expect(parseHistoricalQualityChildConfiguration({ raw: leftRaw, expectedFingerprint })).toEqual(JSON.parse(canonical));
    expect(parseHistoricalQualityChildConfiguration({ raw: rightRaw, expectedFingerprint })).toEqual(JSON.parse(canonical));
  });

  it('rejects malformed, non-string, unknown, credential, secret-like, and mismatched values', () => {
    const refused: Array<[string | undefined, string]> = [
      [undefined, 'required'],
      ['{', 'valid JSON'],
      ['{"DISCOVERY_ALLOWED_TYPES":1}', 'string'],
      ['{"INVENTED_FLAG":"x"}', 'not readable'],
      ['{"OPENROUTER_API_KEY":"sk-attacker"}', 'credential'],
      ['{"CHAT_MODEL":"sk-live-secret-token"}', 'credential-like'],
      ['{"CHAT_MODEL":"https://attacker.example/model"}', 'credential-like'],
    ];
    for (const [raw, message] of refused) {
      expect(() => parseHistoricalQualityChildConfiguration({ raw, expectedFingerprint: sha(raw ?? '') })).toThrow(new RegExp(message, 'i'));
    }
    expect(() => parseHistoricalQualityChildConfiguration({ raw: configurationJson, expectedFingerprint: 'f'.repeat(64) }))
      .toThrow(/fingerprint/);
  });

  it('keeps the exported schema strict about string records', () => {
    expect(HistoricalQualityChildConfigurationSchema.parse({ DISCOVERY_ALLOWED_TYPES: 'intent' }))
      .toEqual({ DISCOVERY_ALLOWED_TYPES: 'intent' });
    expect(() => HistoricalQualityChildConfigurationSchema.parse({ DISCOVERY_ALLOWED_TYPES: null })).toThrow();
  });
});

describe('runHistoricalQualityChild ordering and cleanup', () => {
  it('verifies and closes the verifier before resolving the full planner fingerprint and constructing dependencies', async () => {
    const events: string[] = [];
    await expect(runHistoricalQualityChild(dispatch, dependencies(events))).resolves.toBe(output);
    expect(events).toEqual([
      'attest', `open:${databaseUrl}`, 'verify', 'verifier-close',
      'resolve', 'cache-construct', 'create', 'execute', 'database-close', 'cache-close',
    ]);
  });

  it('rejects child-config fingerprint mismatch before attestation or dependency construction', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.environment = { ...childEnvironment, DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT: 'f'.repeat(64) } as never;
    await expect(runHistoricalQualityChild(dispatch, deps)).rejects.toThrow(/fingerprint/);
    expect(events).toEqual([]);
  });

  it.each([
    ['own nonblank', 'postgres://parent:secret@wrong.example/production', false],
    ['own blank', '', false],
    ['inherited nonblank', 'postgres://parent:secret@wrong.example/production', true],
    ['inherited blank', '', true],
  ] as const)('rejects an %s DATABASE_URL before attestation or dependency construction', async (_label, suppliedUrl, inherited) => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.environment = inherited
      ? Object.assign(Object.create({ DATABASE_URL: suppliedUrl }) as Record<string, string>, childEnvironment)
      : { ...childEnvironment, DATABASE_URL: suppliedUrl };
    await expect(runHistoricalQualityChild(dispatch, deps)).rejects.toThrow(/DATABASE_URL/);
    expect(events).toEqual([]);
  });

  it('closes the verifier and constructs nothing when exact published state is stale', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.verifyPublishedState = async () => { events.push('verify'); throw new Error('stale metadata'); };
    await expect(runHistoricalQualityChild(dispatch, deps)).rejects.toThrow('stale metadata');
    expect(events).toEqual(['attest', `open:${databaseUrl}`, 'verify', 'verifier-close']);
  });

  it('rejects a full planner fingerprint mismatch after verifier close and before construction', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.resolveChildResolvedConfigurationFingerprint = async () => { events.push('resolve'); return 'd'.repeat(64); };
    await expect(runHistoricalQualityChild(dispatch, deps)).rejects.toThrow(/child-resolved configuration fingerprint/);
    expect(events).toEqual(['attest', `open:${databaseUrl}`, 'verify', 'verifier-close', 'resolve']);
  });

  it('closes only an acquired cache handle when cache construction fails and never starts dependency imports', async () => {
    const events: string[] = [];
    const primary = new Error('cache constructor failed');
    const deps = dependencies(events);
    deps.createCache = (_seed, resources) => {
      events.push('cache-import');
      resources.add({ kind: 'cache', close: async () => { events.push('cache-close'); } });
      events.push('cache-constructor');
      throw primary;
    };
    deps.createDependencies = async () => {
      events.push('unauthorized-database-import');
      throw new Error('must not construct a database');
    };
    await expect(runHistoricalQualityChild(dispatch, deps)).rejects.toBe(primary);
    expect(events.slice(-3)).toEqual(['cache-import', 'cache-constructor', 'cache-close']);
    expect(events).not.toContain('unauthorized-database-import');
  });

  it.each([
    ['before database acquisition', false, ['cache-close']],
    ['after database acquisition', true, ['database-close', 'cache-close']],
  ] as const)('closes exactly resources acquired %s when dependency construction fails', async (_label, acquireDatabase, expectedCloses) => {
    const events: string[] = [];
    const primary = new Error('dependency construction failed');
    const deps = dependencies(events);
    deps.createDependencies = async (_input, resources) => {
      events.push('database-import');
      if (acquireDatabase) {
        resources.add({ kind: 'database', close: async () => { events.push('database-close'); } });
      }
      events.push('provider-constructor');
      throw primary;
    };
    await expect(runHistoricalQualityChild(dispatch, deps)).rejects.toBe(primary);
    expect(events.filter((event) => event === 'database-close' || event === 'cache-close')).toEqual(expectedCloses);
    expect(events.filter((event) => event === 'database-import')).toHaveLength(1);
    expect(events.filter((event) => event === 'provider-constructor')).toHaveLength(1);
  });

  it('continues reverse-order cleanup after one close fails and preserves the primary failure', async () => {
    const events: string[] = [];
    const primary = new Error('graph failed');
    const deps = dependencies(events);
    deps.createDependencies = async (_input, resources) => {
      resources.add({
        kind: 'database',
        close: async () => {
          events.push('database-close');
          throw new Error('postgres://cleanup-user:cleanup-secret@wrong.example/production');
        },
      });
      return {};
    };
    deps.executeSlot = async () => { throw primary; };
    await expect(runHistoricalQualityChild(dispatch, deps)).rejects.toBe(primary);
    expect(events.slice(-2)).toEqual(['database-close', 'cache-close']);
  });

  it('sanitizes a cleanup-only failure after closing every acquired handle', async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.createDependencies = async (_input, resources) => {
      resources.add({
        kind: 'database',
        close: async () => {
          events.push('database-close');
          throw new Error('redis://user:cleanup-secret@wrong.example:6379');
        },
      });
      return {};
    };
    let failure: unknown;
    try {
      await runHistoricalQualityChild(dispatch, deps);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Historical quality child resource cleanup failed');
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure as object))).not.toContain('cleanup-secret');
    expect(events.slice(-2)).toEqual(['database-close', 'cache-close']);
  });
});

describe('runtime environment, embedding, and exact selected-child attestation', () => {
  it('rejects DATABASE_URL from a complete child handoff during preflight', async () => {
    await expect(preflightHistoricalQualityChildRuntime({
      ...childEnvironment,
      DATABASE_URL: 'postgres://parent:secret@wrong.example/prod',
      AWS_SECRET_ACCESS_KEY: 'parent-secret',
      INVENTED_PARENT_VALUE: 'parent-value',
    })).rejects.toThrow(/DATABASE_URL/);
  });

  it('reconciles the exact verified embedding identity and rejects drift', () => {
    expect(reconcileHistoricalQualityChildEmbedding(verifiedBase, childEnvironment)).toEqual({
      model: 'openai/text-embedding-3-large', dimensions: 2000,
    });
    expect(() => reconcileHistoricalQualityChildEmbedding(verifiedBase, { ...childEnvironment, EMBEDDING_MODEL: 'other/model' }))
      .toThrow(/embedding identity/);
  });

  it('re-attests exact side a branch and URL/endpoint binding with fakes only', async () => {
    const result = await reattestExactSelectedChild({
      manifest: childEnvironment.DISCOVERY_TARGETS,
      neonApiKey: 'fake-key',
      dispatch,
      controlPlane: {
        getBranch: async (_projectId, branchId) => branchId === 'branch-base'
          ? { id: 'branch-base', name: 'eval-discovery-base', primary: false }
          : { id: 'branch-a', name: 'eval-ab-a', parentId: 'branch-base', primary: false },
        listEndpoints: async (_projectId, branchId) => branchId === 'branch-a'
          ? [{ id: 'endpoint-a', branchId: 'branch-a', host: 'ep-a.neon.tech', type: 'read_write' as const }]
          : [],
      },
    });
    expect(result.target.databaseUrl).toBe(databaseUrl);
  });

  it('rejects wrong branch and endpoint URL binding', async () => {
    for (const mutation of ['branch', 'url'] as const) {
      await expect(reattestExactSelectedChild({
        manifest: childEnvironment.DISCOVERY_TARGETS,
        neonApiKey: 'fake-key',
        dispatch,
        controlPlane: {
          getBranch: async (_projectId, branchId) => branchId === 'branch-base'
            ? { id: 'branch-base', name: 'eval-discovery-base', primary: false }
            : { id: 'branch-a', name: mutation === 'branch' ? 'wrong-branch' : 'eval-ab-a', parentId: 'branch-base', primary: false },
          listEndpoints: async () => [{
            id: 'endpoint-a', branchId: 'branch-a',
            host: mutation === 'url' ? 'other.neon.tech' : 'ep-a.neon.tech', type: 'read_write' as const,
          }],
        },
      })).rejects.toThrow(/attestation/);
    }
  });
});

describe('NamespacedHydeCache', () => {
  it('prefixes only get/set/delete/exists without exposing pattern deletion', async () => {
    const calls: Array<[string, string]> = [];
    const inner = {
      get: async (key: string) => { calls.push(['get', key]); return null; },
      set: async (key: string) => { calls.push(['set', key]); },
      delete: async (key: string) => { calls.push(['delete', key]); return true; },
      exists: async (key: string) => { calls.push(['exists', key]); return false; },
      deleteByPattern: async () => { throw new Error('must never be called'); },
    };
    const cache = new NamespacedHydeCache(inner, dispatch);
    await cache.get('hyde:key');
    await cache.set('hyde:key', { value: 1 });
    await cache.delete('hyde:key');
    await cache.exists('hyde:key');
    expect(calls.map(([operation]) => operation)).toEqual(['get', 'set', 'delete', 'exists']);
    expect(new Set(calls.map(([, key]) => key))).toHaveLength(1);
    expect(calls[0]![1]).toMatch(/^historical-quality:v1:[a-f0-9]{64}:hyde:key$/);
    expect('deleteByPattern' in cache).toBe(false);
  });

  it('lets an empty isolated namespace fall back to an approved restored DB document without generation', async () => {
    let generatorCalls = 0;
    const cache = new NamespacedHydeCache({
      get: async () => null,
      set: async () => {},
      delete: async () => false,
      exists: async () => false,
    }, dispatch);
    const graph = new HydeGraphFactory(
      {
        getHydeDocument: async () => ({
          id: 'approved-document', sourceType: 'intent', sourceId: 'intent-1', sourceText: null,
          strategy: 'approved', targetCorpus: 'profiles', hydeText: 'approved restored document',
          hydeEmbedding: [0.25, 0.5], context: null, createdAt: new Date(0), expiresAt: null,
        }),
        getHydeDocumentsForSource: async () => [],
        saveHydeDocument: async (document: unknown) => document,
        getIntent: async () => null,
      } as never,
      { generate: async () => { throw new Error('must not embed'); } } as never,
      cache,
      { infer: async () => ({ lenses: [{ label: 'approved lens', corpus: 'profiles', reasoning: 'approved' }] }) } as never,
      { generate: async () => { generatorCalls += 1; throw new Error('must not generate'); } } as never,
    ).createGraph();

    const result = await graph.invoke({ sourceType: 'intent', sourceId: 'intent-1', sourceText: 'approved source' });
    expect(result.hydeDocuments['approved lens']?.hydeText).toBe('approved restored document');
    expect(generatorCalls).toBe(0);
  });

  it('changes namespace across every seed identity and rejects escaping or unbounded keys', async () => {
    const keys: string[] = [];
    const inner = {
      get: async (key: string) => { keys.push(key); return null; },
      set: async () => {}, delete: async () => false, exists: async () => false,
    };
    const seeds = [
      dispatch,
      { ...dispatch, runId: `hq-run-${'3'.repeat(32)}` },
      { ...dispatch, slotId: `hq-slot-${'4'.repeat(64)}` },
      { ...dispatch, configurationId: 'b' as never },
    ];
    for (const seed of seeds) await new NamespacedHydeCache(inner, seed).get('same');
    expect(new Set(keys)).toHaveLength(seeds.length);
    const cache = new NamespacedHydeCache(inner, dispatch);
    expect(() => cache.get('bad\nkey')).toThrow(/invalid/);
    expect(() => cache.get('x'.repeat(1025))).toThrow(/invalid/);
  });
});
