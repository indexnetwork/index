import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import { HydeGraphFactory } from '@indexnetwork/protocol';

import { HistoricalQualityChildOutputSchema } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.child-output.js';
import { HISTORICAL_SHARED_POOL_PLAN } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.js';
import { fingerprintCanonicalJson, HistoricalQualityExecutionRunSchema, HistoricalQualityTransportRowSchema } from '../../../../../packages/protocol/eval/shared/index.js';
import { buildEnrichmentDiscoveryTrigger, buildIntentDiscoveryTrigger } from '../../queues/opportunity/discovery-trigger.builders';

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

type Task7Runtime = {
  executeHistoricalQualitySlot(input: {
    dispatch: HistoricalQualitySlotDispatch;
    configuration: Readonly<Record<string, string>>;
    dependencies: {
      verifyRestoredState(input: unknown): Promise<unknown>;
      invokeGraph(input: unknown, options: { signal: AbortSignal }): Promise<unknown>;
      withEnvironment?<T>(configuration: Readonly<Record<string, string>>, run: () => Promise<T>): Promise<T>;
    };
  }): Promise<unknown>;
  projectHistoricalQualityGraphResult(input: { dispatch: HistoricalQualitySlotDispatch; result: unknown }): Promise<unknown>;
  parseProjectedHistoricalQualityChildOutput(value: unknown): unknown;
};

const qualityCase = HISTORICAL_SHARED_POOL_PLAN.cases[0]!;
const sourceParticipant = HISTORICAL_SHARED_POOL_PLAN.participants.find((row) => row.participantId === qualityCase.sourceParticipantId)!;
const targetCandidate = qualityCase.candidates.find((row) => row.role === 'target')!;
const targetParticipant = HISTORICAL_SHARED_POOL_PLAN.participants.find((row) => row.participantId === targetCandidate.participantId)!;
const expectedSourceIntent = HISTORICAL_SHARED_POOL_PLAN.seedProjection.intents.find((row) => row.id === sourceParticipant.intentId)!;

function qualityDispatch(trigger: 'intent' | 'enrichment'): HistoricalQualitySlotDispatch {
  const identity = {
    caseId: qualityCase.caseId,
    trigger,
    repetition: 0,
    selectedSide: 'a',
    configurationFingerprint: fullFingerprint,
  } as const;
  return { ...dispatch, slotId: `hq-slot-${fingerprintCanonicalJson(identity)}` };
}

function successfulGraphResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidates: [{
      candidateUserId: targetParticipant.userId,
      candidateIntentId: targetParticipant.intentId,
      networkId: HISTORICAL_SHARED_POOL_PLAN.network.id,
      similarity: 0.91,
      lens: 'raw model lens must not escape',
      candidatePayload: 'raw fixture/model text must not escape',
    }],
    trace: [{
      node: 'candidate',
      detail: 'raw evaluator narration must not escape',
      data: {
        userId: targetParticipant.userId,
        score: 88,
        reasoning: 'provider reasoning must not escape',
        model: 'provider/model-must-not-escape',
      },
    }],
    evaluatedOpportunities: [{
      score: 88,
      reasoning: 'final reason must not escape',
      actors: [
        { userId: sourceParticipant.userId, networkId: HISTORICAL_SHARED_POOL_PLAN.network.id },
        { userId: targetParticipant.userId, networkId: HISTORICAL_SHARED_POOL_PLAN.network.id },
      ],
    }],
    ...overrides,
  };
}

async function task7Runtime(): Promise<Task7Runtime> {
  return await import('../discovery-quality.child') as unknown as Task7Runtime;
}

function exactRestoredIntent(): Record<string, unknown> {
  return {
    id: expectedSourceIntent.id,
    userId: expectedSourceIntent.userId,
    payload: expectedSourceIntent.text,
    summary: expectedSourceIntent.text,
    sourceType: 'discovery_form',
    sourceId: expectedSourceIntent.userId,
    status: 'ACTIVE',
    isIncognito: false,
    archivedAt: null,
    embedding: undefined,
  };
}

describe('historical quality Task 7 execution contract', () => {
  it('uses the exact intent builder, audited persisted query, parsed child configuration, and one strict attempt', async () => {
    const runtime = await task7Runtime();
    expect(runtime.executeHistoricalQualitySlot).toBeFunction();
    expect(runtime.projectHistoricalQualityGraphResult).toBeFunction();
    const slotDispatch = qualityDispatch('intent');
    const configuration = Object.freeze({ DISCOVERY_ALLOWED_TYPES: 'intent', NEGOTIATOR_STANCE: 'parsed-child' });
    const events: string[] = [];
    let trigger: unknown;
    let configured: Readonly<Record<string, string>> | undefined;
    const output = await runtime.executeHistoricalQualitySlot({
      dispatch: slotDispatch,
      configuration,
      dependencies: {
        verifyRestoredState: async (expected) => {
          events.push('verify-restored');
          const serialized = JSON.stringify(expected);
          expect(serialized).toContain(sourceParticipant.userId);
          expect(serialized).toContain(sourceParticipant.intentId);
          expect(serialized).toContain(sourceParticipant.contextId);
          for (const premiseId of sourceParticipant.premiseIds) expect(serialized).toContain(premiseId);
          expect(serialized).toContain(HISTORICAL_SHARED_POOL_PLAN.network.id);
          expect(serialized).toContain(HISTORICAL_SHARED_POOL_PLAN.corpusVersion);
          return exactRestoredIntent();
        },
        withEnvironment: async (received, run) => {
          events.push('environment');
          configured = received;
          expect(received).toBe(configuration);
          expect(received).toEqual({ DISCOVERY_ALLOWED_TYPES: 'intent', NEGOTIATOR_STANCE: 'parsed-child' });
          return run();
        },
        invokeGraph: async (input, options) => {
          events.push('graph');
          trigger = input;
          expect(options.signal).toBeInstanceOf(AbortSignal);
          return successfulGraphResult();
        },
      },
    }) as ReturnType<typeof HistoricalQualityChildOutputSchema.parse>;

    expect(configured).toBe(configuration);
    expect(events).toEqual(['verify-restored', 'environment', 'graph']);
    expect(trigger).toEqual(buildIntentDiscoveryTrigger({
      userId: sourceParticipant.userId,
      searchQuery: expectedSourceIntent.text,
      networkIds: [HISTORICAL_SHARED_POOL_PLAN.network.id],
      triggerIntentId: sourceParticipant.intentId,
    }));
    expect(HistoricalQualityChildOutputSchema.safeParse(output).success).toBeTrue();
    expect(HistoricalQualityTransportRowSchema.safeParse(output.transportRow).success).toBeTrue();
    expect(HistoricalQualityExecutionRunSchema.safeParse(output.executionRun).success).toBeTrue();
    expect(output.transportRow.participantMetrics).toHaveLength(24);
    expect(output.transportRow.participantMetrics.map((metric) => metric.participantId))
      .toEqual([...qualityCase.candidates.map((candidate) => candidate.participantId)].sort());
    expect(output.executionRun).toMatchObject({ outcome: 'success', recovered: false, runIndex: 0 });
    expect(output.executionRun.attempts).toHaveLength(1);
    expect(output.executionRun.attempts[0]).toMatchObject({ outcome: 'success', retryable: false, backoffMs: 0 });
    const serialized = JSON.stringify(output);
    for (const sentinel of [
      'raw model lens', 'raw fixture/model text', 'raw evaluator narration',
      'provider reasoning', 'provider/model-must-not-escape', 'final reason',
    ]) expect(serialized).not.toContain(sentinel);
  });

  it('uses the exact enrichment builder without query or trigger intent and never imports queue jobs', async () => {
    const runtime = await task7Runtime();
    let trigger: unknown;
    const output = await runtime.executeHistoricalQualitySlot({
      dispatch: qualityDispatch('enrichment'),
      configuration: Object.freeze({ DISCOVERY_ALLOWED_TYPES: 'intent' }),
      dependencies: {
        verifyRestoredState: async () => exactRestoredIntent(),
        invokeGraph: async (input) => { trigger = input; return successfulGraphResult(); },
      },
    }) as ReturnType<typeof HistoricalQualityChildOutputSchema.parse>;
    expect(trigger).toEqual(buildEnrichmentDiscoveryTrigger({
      userId: sourceParticipant.userId,
      networkId: HISTORICAL_SHARED_POOL_PLAN.network.id,
    }));
    expect(trigger).not.toHaveProperty('searchQuery');
    expect(trigger).not.toHaveProperty('triggerIntentId');
    expect(output.transportRow.trigger).toBe('enrichment');

    const source = await readFile(new URL('../discovery-quality.child.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from-[^'"\n]*\.queue|\.queue['"]/);
    expect(source).not.toMatch(/maybeMine|narrat|addJob|callback/i);
  });

  it('rejects unknown/source candidates, unplanned evidence, nonfinite values, duplicate finals, and finals absent from retrieval', async () => {
    const runtime = await task7Runtime();
    const base = successfulGraphResult();
    const final = (base.evaluatedOpportunities as unknown[])[0]!;
    const mutations: Array<[string, Record<string, unknown>]> = [
      ['unknown user', successfulGraphResult({ candidates: [{ ...(base.candidates as Record<string, unknown>[])[0], candidateUserId: 'unknown-user' }] })],
      ['source candidate', successfulGraphResult({ candidates: [{ ...(base.candidates as Record<string, unknown>[])[0], candidateUserId: sourceParticipant.userId }] })],
      ['unplanned evidence', successfulGraphResult({ candidates: [{ ...(base.candidates as Record<string, unknown>[])[0], candidateIntentId: 'unplanned-intent' }] })],
      ['nonfinite similarity', successfulGraphResult({ candidates: [{ ...(base.candidates as Record<string, unknown>[])[0], similarity: Number.NaN }] })],
      ['nonfinite evaluator score', successfulGraphResult({ trace: [{ node: 'candidate', data: { userId: targetParticipant.userId, score: Number.POSITIVE_INFINITY } }] })],
      ['duplicate final', successfulGraphResult({ evaluatedOpportunities: [final, structuredClone(final)] })],
      ['final without retrieval', successfulGraphResult({ candidates: [] })],
    ];
    for (const [label, result] of mutations) {
      await expect(runtime.projectHistoricalQualityGraphResult({ dispatch: qualityDispatch('intent'), result }), label).rejects.toThrow();
    }
  });

  it('turns restored-state or provider failure into one sanitized terminal failure without retry', async () => {
    const runtime = await task7Runtime();
    let graphCalls = 0;
    const output = await runtime.executeHistoricalQualitySlot({
      dispatch: qualityDispatch('intent'),
      configuration: Object.freeze({ DISCOVERY_ALLOWED_TYPES: 'intent' }),
      dependencies: {
        verifyRestoredState: async () => { throw new Error('Authorization: Bearer raw-provider-secret fixture prose https://secret.example/reason'); },
        invokeGraph: async () => { graphCalls += 1; return successfulGraphResult(); },
      },
    }) as ReturnType<typeof HistoricalQualityChildOutputSchema.parse>;
    expect(graphCalls).toBe(0);
    expect(output.transportRow.completed).toBeFalse();
    expect(output.transportRow.stageFunnel).toBeNull();
    expect(output.transportRow.participantMetrics).toHaveLength(24);
    expect(output.transportRow.participantMetrics.every((metric) => metric.failureStage === 'execution')).toBeTrue();
    expect(output.executionRun).toMatchObject({ outcome: 'failed', recovered: false });
    expect(output.executionRun.attempts).toHaveLength(1);
    expect(output.executionRun.attempts[0]).toMatchObject({ outcome: 'failure', retryable: false, backoffMs: 0 });
    const serialized = JSON.stringify(output);
    for (const sentinel of ['raw-provider-secret', 'fixture prose', 'secret.example', '/reason', 'Bearer']) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('rejects retry/recovery mutations and cross-inconsistent completion through the canonical output boundary', async () => {
    const runtime = await task7Runtime();
    const valid = await runtime.executeHistoricalQualitySlot({
      dispatch: qualityDispatch('intent'),
      configuration: Object.freeze({ DISCOVERY_ALLOWED_TYPES: 'intent' }),
      dependencies: {
        verifyRestoredState: async () => exactRestoredIntent(),
        invokeGraph: async () => successfulGraphResult(),
      },
    }) as ReturnType<typeof HistoricalQualityChildOutputSchema.parse>;
    expect(runtime.parseProjectedHistoricalQualityChildOutput(valid)).toEqual(valid);

    const mutations: Array<[string, (value: typeof valid) => void]> = [
      ['second attempt', (value) => { value.executionRun.attempts.push(structuredClone(value.executionRun.attempts[0]!)); }],
      ['recovered', (value) => { value.executionRun.recovered = true; }],
      ['retryable', (value) => { value.executionRun.attempts[0]!.retryable = true; }],
      ['backoff', (value) => { value.executionRun.attempts[0]!.backoffMs = 1; }],
      ['completed with failed attempt', (value) => {
        value.executionRun.outcome = 'failed';
        value.executionRun.attempts[0]!.outcome = 'failure';
        value.executionRun.attempts[0]!.error = { class: 'historical_quality_execution_error', message: 'Historical quality slot execution failed' };
      }],
      ['failed with success attempt', (value) => { value.transportRow.completed = false; }],
    ];
    for (const [label, mutate] of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      expect(() => runtime.parseProjectedHistoricalQualityChildOutput(value), label).toThrow();
    }
  });
});

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
