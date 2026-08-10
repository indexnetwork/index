import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'bun:test';

import { HISTORICAL_QUALITY_APPROVED_CASE_IDS, type HistoricalQualityRequest } from '../discovery-quality.contract';
import { makeHistoricalQualityArtifact } from '../../../../../packages/protocol/eval/shared/tests/artifact.fixtures.js';
import { HistoricalQualityChildOutputSchema } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.child-output.js';
import { DISCOVERY_ENV_KEYS } from '../discovery.flags';
import { HISTORICAL_QUALITY_RUNTIME_CORE_KEYS, HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS, buildHistoricalQualityChildEnvironment, parseHistoricalQualityRuntimeEnvironment } from '../discovery-quality.environment';
import { HISTORICAL_QUALITY_SCORING_POLICY_VERSION, HistoricalQualitySlotOperationalError, historicalQualityChildResolvedProjection, resolveHistoricalQualityConfiguration, runHistoricalQualityRuntime, type HistoricalQualityRuntimeDeps, type VerifiedHistoricalQualityBase } from '../discovery-quality.runtime';
import { HistoricalQualitySpentRunError, describeAbFailure } from '../discovery.contract';
import { embeddingConfigurationFingerprint } from '../../lib/embedding/embedding.identity';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};
const providerFingerprint = digest('stable-provider-account');
const verifiedEmbedding = {
  provider: 'openrouter',
  model: 'openai/text-embedding-3-large',
  dimensions: 2000,
};
const verifiedBase: VerifiedHistoricalQualityBase = {
  version: 1,
  embedding: {
    ...verifiedEmbedding,
    configurationFingerprint: embeddingConfigurationFingerprint(verifiedEmbedding),
  },
  corpusVersion: 'historical-shared-pool-v1',
};
const request: HistoricalQualityRequest = {
  caseIds: [HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]!],
  triggers: ['intent'],
  repetitions: 1,
  configuration: { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } },
  force: false,
};

const requiredParentEnvironment = (): Record<string, string> => ({
  DISCOVERY_TARGETS: 'manifest-secret-sentinel',
  NEON_API_KEY: 'neon-secret-sentinel',
  DISCOVERY_CONFIRM: '1',
  TEST_DATABASE_SAFE: '1',
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'openrouter-secret-sentinel',
  REDIS_URL: 'redis://redis-secret-sentinel@example.invalid',
  HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT: providerFingerprint,
});

const saved = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  process.exitCode = 0;
});

describe('historical quality child environment', () => {
  it('copies exactly required core keys, every defined model key, one Redis form, and canonical non-model config', () => {
    const parent = {
      ...requiredParentEnvironment(),
      ...Object.fromEntries(HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS.map((key) => [key, `${key}-value`])),
      DATABASE_URL: 'database-secret-sentinel',
      PATH: '/secret/path',
      HOME: '/secret/home',
      AWS_SECRET_ACCESS_KEY: 'aws-secret-sentinel',
      SENTRY_DSN: 'sentry-secret-sentinel',
      INVENTED_SECRET: 'invented-secret-sentinel',
    };
    parent.CHAT_MODEL = 'google/gemini-2.5-flash';
    parent.CHAT_REASONING_EFFORT = 'low';
    parent.EVAL_MODEL_OVERRIDES = '{}';
    const environment = buildHistoricalQualityChildEnvironment({
      parentEnvironment: parent,
      sanitizedConfiguration: { DISCOVERY_ALLOWED_TYPES: 'intent', CHAT_MODEL: 'anthropic/claude-sonnet-4' },
    });

    expect(HISTORICAL_QUALITY_RUNTIME_CORE_KEYS.every((key) => environment[key] === parent[key])).toBe(true);
    expect(HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS.every((key) => environment[key] !== undefined)).toBe(true);
    expect(environment.CHAT_MODEL).toBe('anthropic/claude-sonnet-4');
    expect(JSON.parse(environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON)).toEqual({ DISCOVERY_ALLOWED_TYPES: 'intent' });
    expect(environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT).toBe(
      digest(environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON),
    );
    expect(Object.keys(environment).sort()).toEqual([
      ...HISTORICAL_QUALITY_RUNTIME_CORE_KEYS,
      ...HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS,
      'REDIS_URL',
      'DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON',
      'DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT',
    ].sort());
    for (const forbidden of ['DATABASE_URL', 'PATH', 'HOME', 'AWS_SECRET_ACCESS_KEY', 'SENTRY_DSN', 'INVENTED_SECRET', 'HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT']) {
      expect(environment).not.toHaveProperty(forbidden);
    }
    const serializedConfig = environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON;
    for (const sentinel of ['manifest-secret-sentinel', 'neon-secret-sentinel', 'openrouter-secret-sentinel', 'redis-secret-sentinel', 'database-secret-sentinel', 'aws-secret-sentinel', 'sentry-secret-sentinel', 'invented-secret-sentinel', providerFingerprint]) {
      expect(serializedConfig).not.toContain(sentinel);
    }
  });

  it('accepts the complete split Redis form', () => {
    const parent = requiredParentEnvironment();
    delete parent.REDIS_URL;
    Object.assign(parent, { REDIS_HOST: 'cache', REDIS_PORT: '6379', REDIS_PASSWORD: 'password-secret', REDIS_DB: '4' });
    expect(parseHistoricalQualityRuntimeEnvironment(parent)).toMatchObject({ REDIS_HOST: 'cache', REDIS_PORT: '6379', REDIS_PASSWORD: 'password-secret', REDIS_DB: '4' });
  });

  it.each([
    ['own nonblank', { DATABASE_URL: 'postgres://parent:secret@wrong.example/production' }],
    ['own blank', { DATABASE_URL: '' }],
    ['inherited nonblank', Object.create({ DATABASE_URL: 'postgres://parent:secret@wrong.example/production' }) as Record<string, string>],
    ['inherited blank', Object.create({ DATABASE_URL: '' }) as Record<string, string>],
  ] as const)('rejects an %s DATABASE_URL instead of projecting around it', (_label, supplied) => {
    expect(() => parseHistoricalQualityRuntimeEnvironment(Object.assign(supplied, requiredParentEnvironment())))
      .toThrow(/DATABASE_URL/);
  });

  it.each([
    ['missing Redis', {}, /exactly one Redis configuration/],
    ['ambiguous Redis', { REDIS_URL: 'redis://x', REDIS_HOST: 'x', REDIS_PORT: '1', REDIS_PASSWORD: 'p', REDIS_DB: '0' }, /exactly one Redis configuration/],
    ['partial Redis', { REDIS_HOST: 'x', REDIS_PORT: '1' }, /complete REDIS_HOST/],
    ['missing gate', { REDIS_URL: 'redis://x', DISCOVERY_CONFIRM: '0' }, /DISCOVERY_CONFIRM must equal 1/],
  ])('refuses %s', (_label, overrides, expected) => {
    expect(() => parseHistoricalQualityRuntimeEnvironment({ ...requiredParentEnvironment(), REDIS_URL: undefined, ...overrides })).toThrow(expected);
  });
});

describe('historical quality production configuration resolver', () => {
  it('moves model carriers into the canonical all-agent model map and binds fixed identities', async () => {
    const resolved = await resolveHistoricalQualityConfiguration({
      request: {
        ...request,
        configuration: { id: 'a', config: { EVAL_MODEL_OVERRIDES: '{"opportunityEvaluator":"model/selected"}' } },
      },
      verifiedBase,
      environment: {
        ...requiredParentEnvironment(),
        CHAT_MODEL: 'chat/parent',
        SMARTEST_VERIFIER_MODEL: 'judge/model',
      },
    });
    expect(resolved.models).toMatchObject({ chat: 'chat/parent', opportunityEvaluator: 'model/selected' });
    expect(resolved.env).toEqual({});
    expect(resolved.fixed).toMatchObject({
      judgeModelId: 'judge/model',
      embeddingModelId: verifiedBase.embedding.model,
      corpusVersion: verifiedBase.corpusVersion,
      providerAccountFingerprint: providerFingerprint,
    });
    expect(resolved.fixed.scoringPolicyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(HISTORICAL_QUALITY_SCORING_POLICY_VERSION).toBe('historical-quality-v1');
  });

  it.each(['ABC', 'a'.repeat(63), 'a'.repeat(65), ''])('refuses invalid parent-only provider fingerprint %p', async (fingerprint) => {
    await expect(resolveHistoricalQualityConfiguration({
      request,
      verifiedBase,
      environment: { ...requiredParentEnvironment(), HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT: fingerprint },
    })).rejects.toThrow(/lowercase 64-hex/);
  });
});

function terminalOutput(slot: { slotId: string; caseId: string; trigger: 'intent' | 'enrichment'; repetition: number }, dispatch: { runId: string; configurationFingerprint: string }, completed = true) {
  const fixture = makeHistoricalQualityArtifact({ emittedSlots: 1, requestedSlots: 1, ...(completed ? {} : { failedSlot: 0 }) });
  const sourceRow = fixture.payload.cases[0]!;
  const transportCaseId = `${encodeURIComponent(slot.caseId)}/${slot.trigger}/r${slot.repetition + 1}`;
  const executionRun = structuredClone(fixture.execution.runs[0]!);
  executionRun.caseId = transportCaseId;
  executionRun.runId = `${encodeURIComponent(transportCaseId)}::run:1`;
  executionRun.attempts[0]!.runId = executionRun.runId;
  executionRun.attempts[0]!.attemptId = `${executionRun.runId}::attempt:1`;
  return HistoricalQualityChildOutputSchema.parse({
    schemaVersion: 1,
    runId: dispatch.runId,
    slotId: slot.slotId,
    configurationId: 'a',
    transportRow: {
      kind: 'historical-quality-pilot',
      logicalCaseId: slot.caseId,
      trigger: slot.trigger,
      repetition: slot.repetition,
      configurationFingerprint: dispatch.configurationFingerprint,
      completed,
      participantMetrics: sourceRow.participantMetrics,
      stageFunnel: sourceRow.stageFunnel,
    },
    executionRun,
  });
}

function runtimeDeps(input: { verifierFailure?: Error; failedSlots?: Set<number> } = {}) {
  const calls: string[] = [];
  let active = false;
  let slotIndex = 0;
  const argv: string[][] = [];
  const written: Array<{ path: string; artifact: unknown }> = [];
  const logs: string[] = [];
  const deps: HistoricalQualityRuntimeDeps = {
    preflightChildRuntime: async () => { calls.push('child-preflight'); },
    attest: async () => {
      calls.push('attest');
      return {
        version: 2, projectId: 'project', baseBranchId: 'base',
        baseReadReplica: { endpointId: 'replica', databaseUrl: 'postgresql://user:replica-secret@replica.neon.tech/protocol_eval' },
        targets: [
          { sideId: 'a', branchId: 'branch-a', endpointId: 'endpoint-a', databaseUrl: 'postgresql://user:a-secret@a.neon.tech/protocol_eval' },
          { sideId: 'b', branchId: 'branch-b', endpointId: 'endpoint-b', databaseUrl: 'postgresql://user:b-secret@b.neon.tech/protocol_eval' },
        ],
      } as never;
    },
    verifyBase: async () => {
      calls.push('verify');
      if (input.verifierFailure) throw input.verifierFailure;
      calls.push('verifier-closed');
      return verifiedBase;
    },
    restoreSelectedChild: async (manifest) => {
      expect(manifest.targets[0]!.sideId).toBe('a');
      expect(active).toBe(false);
      calls.push('restore');
    },
    spawnSlot: async ({ dispatch, environment, markSpawned }) => {
      expect(active).toBe(false);
      active = true;
      calls.push('spawn');
      markSpawned();
      argv.push([
        dispatch.runId,
        dispatch.slotId,
        dispatch.configurationId,
        dispatch.configurationFingerprint,
        dispatch.childEnvironmentFingerprint,
        dispatch.childResolvedConfigurationFingerprint,
        dispatch.outputPath,
      ]);
      expect(environment).not.toHaveProperty('HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT');
      await Promise.resolve();
      active = false;
      return { slotId: dispatch.slotId, configurationId: 'a' };
    },
    validateSlotOutput: async (slot, dispatch, output, forbiddenValues) => {
      expect(active).toBe(false);
      calls.push('validate');
      expect((output as { slotId: string }).slotId).toBe(slot.slotId);
      expect(forbiddenValues).toEqual(expect.arrayContaining(['manifest-secret-sentinel', 'neon-secret-sentinel', 'openrouter-secret-sentinel', 'redis://redis-secret-sentinel@example.invalid', 'replica-secret', 'a-secret', 'b-secret', providerFingerprint]));
      const completed = !input.failedSlots?.has(slotIndex++);
      return terminalOutput(slot, dispatch, completed);
    },
    prepareArtifactWrite: async () => { calls.push('prepare-write'); },
    artifactWriter: async (reportPath, artifact) => { calls.push('write'); written.push({ path: reportPath, artifact }); },
    log: (message) => { logs.push(message); },
  };
  return { calls, argv, written, logs, deps };
}

describe('historical quality runtime acceptance order', () => {
  it('refuses parallel evaluator configuration before preflight, attestation, restore, or spend without narrowing the generic allowlist', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { calls, deps } = runtimeDeps();
    await expect(runHistoricalQualityRuntime({
      ...request,
      configuration: { id: 'a', config: { RUN_OPPORTUNITY_EVAL_IN_PARALLEL: 'true' } },
    }, deps)).rejects.toThrow(/parallel opportunity evaluation/i);
    expect(calls).toEqual([]);
    expect(DISCOVERY_ENV_KEYS).toContain('RUN_OPPORTUNITY_EVAL_IN_PARALLEL');
  });

  it.each([undefined, 'false'] as const)('accepts serial evaluator configuration %p with exactly one child slot', async (value) => {
    Object.assign(process.env, requiredParentEnvironment());
    const { calls, deps } = runtimeDeps();
    const result = await runHistoricalQualityRuntime({
      ...request,
      configuration: {
        id: 'a',
        config: value === undefined ? {} : { RUN_OPPORTUNITY_EVAL_IN_PARALLEL: value },
      },
    }, deps);
    expect(result.outputs).toHaveLength(1);
    expect(calls.filter((call) => call === 'restore')).toHaveLength(1);
    expect(calls.filter((call) => call === 'spawn')).toHaveLength(1);
  });

  it('attests, verifies and closes, resolves and plans, then restores/spawns/validates every slot serially', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { calls, argv, deps } = runtimeDeps();
    const tenSlots: HistoricalQualityRequest = { ...request, caseIds: [...HISTORICAL_QUALITY_APPROVED_CASE_IDS], triggers: ['intent', 'enrichment'] };
    const result = await runHistoricalQualityRuntime(tenSlots, deps);
    expect(result.outputs).toHaveLength(10);
    expect(calls).toEqual([
      'child-preflight', 'attest', 'verify', 'verifier-closed', 'prepare-write',
      ...Array.from({ length: 10 }, () => ['restore', 'spawn', 'validate']).flat(),
      'write',
    ]);
    expect(argv.flat().join(' ')).not.toContain('DISCOVERY_ALLOWED_TYPES');
    for (const sentinel of ['manifest-secret-sentinel', 'neon-secret-sentinel', 'openrouter-secret-sentinel', 'redis-secret-sentinel', providerFingerprint]) {
      expect(argv.flat().join(' ')).not.toContain(sentinel);
    }
  });

  it('performs no destructive or provider work when the fresh verifier fails', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const failure = new Error('sanitized verifier failure');
    const { calls, deps } = runtimeDeps({ verifierFailure: failure });
    await expect(runHistoricalQualityRuntime(request, deps)).rejects.toBe(failure);
    expect(calls).toEqual(['child-preflight', 'attest', 'verify']);
  });

  it('validates the minimal child environment before the first destructive restore', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    delete process.env.REDIS_URL;
    const { calls, deps } = runtimeDeps();
    await expect(runHistoricalQualityRuntime(request, deps)).rejects.toThrow();
    expect(calls).toEqual(['child-preflight', 'attest', 'verify', 'verifier-closed']);
  });

  it('performs zero attest, verifier, restore, or spawn work when the child runtime is unavailable', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { calls, deps } = runtimeDeps();
    deps.preflightChildRuntime = async () => {
      calls.push('child-preflight');
      throw new Error('Historical quality child runtime is unavailable');
    };
    await expect(runHistoricalQualityRuntime(request, deps)).rejects.toThrow(/child runtime is unavailable/);
    expect(calls).toEqual(['child-preflight']);
  });

  it('rejects arbitrary or extra verifier embedding identity metadata before the first restore', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    for (const invalidBase of [
      { ...verifiedBase, embedding: { ...verifiedBase.embedding, configurationFingerprint: 'b'.repeat(64) } },
      { ...verifiedBase, embedding: { ...verifiedBase.embedding, secret: 'must-not-pass' } },
    ]) {
      const { calls, deps } = runtimeDeps();
      deps.verifyBase = async () => {
        calls.push('verify');
        calls.push('verifier-closed');
        return invalidBase as never;
      };
      await expect(runHistoricalQualityRuntime(request, deps)).rejects.toThrow(/invalid metadata/);
      expect(calls).toEqual(['child-preflight', 'attest', 'verify', 'verifier-closed']);
    }
  });

  it('refuses a runtime embedding mismatch before the first restore', async () => {
    Object.assign(process.env, requiredParentEnvironment(), { EMBEDDING_MODEL: 'other/model', EMBEDDING_DIMENSIONS: '2000' });
    const { calls, deps } = runtimeDeps();
    await expect(runHistoricalQualityRuntime(request, deps)).rejects.toThrow(/embedding identity/);
    expect(calls).toEqual(['child-preflight', 'attest', 'verify', 'verifier-closed']);
  });

  it('dispatches distinct full, child-resolved, and child-environment fingerprints without the provider digest', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { deps } = runtimeDeps();
    let observed: { full: string; childResolved: string; childEnv: string; json: string; argv: string } | undefined;
    deps.spawnSlot = async ({ dispatch, environment }) => {
      observed = {
        full: dispatch.configurationFingerprint,
        childResolved: dispatch.childResolvedConfigurationFingerprint,
        childEnv: dispatch.childEnvironmentFingerprint,
        json: environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON,
        argv: JSON.stringify(dispatch),
      };
      return { slotId: dispatch.slotId, configurationId: 'a' };
    };
    await runHistoricalQualityRuntime(request, deps);
    const resolved = await resolveHistoricalQualityConfiguration({
      request,
      verifiedBase,
      environment: process.env,
    });
    const childProjection = historicalQualityChildResolvedProjection(resolved);
    expect(observed?.childEnv).toBe(digest(observed!.json));
    expect(observed?.full).toBe(digest(canonicalJson(resolved)));
    expect(observed?.childResolved).toBe(digest(canonicalJson(childProjection)));
    expect(new Set([observed?.full, observed?.childResolved, observed?.childEnv])).toHaveLength(3);
    expect(observed?.argv).not.toContain(providerFingerprint);
    expect(JSON.stringify(childProjection)).not.toContain(providerFingerprint);
  });

  it('binds every child-verifiable resolved field while excluding only provider account identity', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const resolved = await resolveHistoricalQualityConfiguration({ request, verifiedBase, environment: process.env });
    const projection = historicalQualityChildResolvedProjection(resolved);
    expect(Object.keys(projection.fixed).sort()).toEqual([
      'corpusVersion', 'embeddingModelId', 'judgeModelId', 'scoringPolicyFingerprint',
    ]);
    const baseFingerprint = digest(canonicalJson(projection));
    const mutations = [
      { ...projection, models: { ...projection.models, opportunity: 'mutated/model' } },
      { ...projection, env: { ...projection.env, DISCOVERY_ALLOWED_TYPES: 'profile' } },
      { ...projection, fixed: { ...projection.fixed, judgeModelId: 'mutated/judge' } },
      { ...projection, fixed: { ...projection.fixed, embeddingModelId: 'mutated/embedding' } },
      { ...projection, fixed: { ...projection.fixed, corpusVersion: 'mutated-corpus' } },
      { ...projection, fixed: { ...projection.fixed, scoringPolicyFingerprint: 'f'.repeat(64) } },
    ];
    for (const mutation of mutations) expect(digest(canonicalJson(mutation))).not.toBe(baseFingerprint);
  });

  it('writes a complete V2 report and exposes a quality summary only after every exact slot is handled', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { deps, written, calls, logs } = runtimeDeps();
    const result = await runHistoricalQualityRuntime({ ...request, reportPath: '/tmp/quality-complete.json' }, deps);
    expect(result.exitCode).toBe(0);
    expect(result.qualitySummary.qualityVerdictAvailable).toBeTrue();
    expect(result.artifact.measurement.qualityVerdictAvailable).toBeTrue();
    expect(written).toHaveLength(1);
    expect(calls.at(-1)).toBe('write');
    expect(logs).toContain('Historical quality artifact written: /tmp/quality-complete.json');
    expect(logs.some((line) => line.startsWith('Historical quality summary: '))).toBeTrue();
  });

  it('continues scheduling terminal failed slots, writes all rows, then prints exact no-verdict and exits 3', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { deps, written, logs, calls } = runtimeDeps({ failedSlots: new Set([0]) });
    const twoSlots = { ...request, triggers: ['intent', 'enrichment'] as const };
    const result = await runHistoricalQualityRuntime(twoSlots, deps);
    expect(calls.filter((call) => call === 'spawn')).toHaveLength(2);
    expect(result.exitCode).toBe(3);
    expect(result.qualitySummary).toMatchObject({ qualityVerdictAvailable: false, groups: null });
    expect(result.artifact.payload.cases).toHaveLength(2);
    expect(written).toHaveLength(1);
    expect(logs).toContain('no quality verdict');
  });

  it('stops after an operational restore failure, writes accepted rows best-effort, and retains exit 4', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { deps, written, calls } = runtimeDeps();
    let restores = 0;
    deps.restoreSelectedChild = async () => {
      calls.push('restore');
      if (restores++ === 1) throw new Error('postgres://user:secret@example.invalid/raw');
    };
    const twoSlots = { ...request, triggers: ['intent', 'enrichment'] as const };
    const thrown = await runHistoricalQualityRuntime(twoSlots, deps).catch((error) => error);
    expect(thrown).toBeInstanceOf(HistoricalQualitySpentRunError);
    expect(describeAbFailure(thrown).exitCode).toBe(4);
    expect(calls.filter((call) => call === 'spawn')).toHaveLength(1);
    expect(written).toHaveLength(1);
    const artifact = written[0]!.artifact as {
      payload: { cases: unknown[] };
      selection: { filters: Record<string, string> };
    };
    expect(artifact.payload.cases).toHaveLength(1);
    expect(artifact.selection.filters.operationalFailureClass).toBe('restore-failure');
    const report = describeAbFailure(thrown);
    expect(report.message).toContain('Diagnostic unavailable-verdict report written:');
    expect(report.message).not.toContain('No run report was written');
    expect(report.message).not.toContain('secret');
  });

  it.each([
    'spawn-failure',
    'supervisor-timeout',
    'missing-child-output',
    'malformed-child-output',
  ] as const)('best-effort writes a sanitized diagnostic for operational class %s', async (failureClass) => {
    Object.assign(process.env, requiredParentEnvironment());
    const { deps, written } = runtimeDeps();
    if (failureClass === 'malformed-child-output') {
      deps.validateSlotOutput = async () => { throw new Error('raw malformed detail'); };
    } else {
      deps.spawnSlot = async ({ markSpawned }) => {
        if (failureClass !== 'spawn-failure') markSpawned();
        throw new HistoricalQualitySlotOperationalError(failureClass);
      };
    }
    const thrown = await runHistoricalQualityRuntime(request, deps).catch((error) => error);
    expect(describeAbFailure(thrown).exitCode).toBe(4);
    expect(written).toHaveLength(1);
    const artifact = written[0]!.artifact as { selection: { filters: Record<string, string> } };
    expect(artifact.selection.filters.operationalFailureClass).toBe(failureClass);
  });

  it('classifies supervisor timeout separately and never converts writer failure into exit 3', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { deps } = runtimeDeps();
    deps.spawnSlot = async ({ markSpawned }) => {
      markSpawned();
      throw new HistoricalQualitySlotOperationalError('supervisor-timeout');
    };
    deps.artifactWriter = async () => { throw new Error('Authorization: Bearer writer-secret'); };
    const thrown = await runHistoricalQualityRuntime(request, deps).catch((error) => error);
    expect(thrown).toBeInstanceOf(HistoricalQualitySpentRunError);
    const report = describeAbFailure(thrown);
    expect(report.exitCode).toBe(4);
    expect(report.message).toContain('supervisor-timeout');
    expect(report.message).toContain('artifact-write-failure');
    expect(report.message).not.toContain('writer-secret');
  });

  it('reports an unavailable writer separately without masking the primary malformed-output class', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { deps } = runtimeDeps();
    deps.validateSlotOutput = async () => { throw new Error('raw malformed secret'); };
    delete deps.artifactWriter;
    const thrown = await runHistoricalQualityRuntime(request, deps).catch((error) => error);
    const report = describeAbFailure(thrown);
    expect(report.exitCode).toBe(4);
    expect(report.message).toContain('malformed-child-output');
    expect(report.message).toContain('artifact-writer-unavailable');
    expect(report.message).not.toContain('raw malformed secret');
  });
});
