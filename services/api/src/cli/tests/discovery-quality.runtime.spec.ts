import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'bun:test';

import { HISTORICAL_QUALITY_APPROVED_CASE_IDS, type HistoricalQualityRequest } from '../discovery-quality.contract';
import { HISTORICAL_QUALITY_RUNTIME_CORE_KEYS, HISTORICAL_QUALITY_RUNTIME_MODEL_KEYS, buildHistoricalQualityChildEnvironment, parseHistoricalQualityRuntimeEnvironment } from '../discovery-quality.environment';
import { HISTORICAL_QUALITY_SCORING_POLICY_VERSION, resolveHistoricalQualityConfiguration, runHistoricalQualityRuntime, type HistoricalQualityRuntimeDeps, type VerifiedHistoricalQualityBase } from '../discovery-quality.runtime';
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

function runtimeDeps(input: { verifierFailure?: Error; slots?: number } = {}) {
  const calls: string[] = [];
  let active = false;
  const argv: string[][] = [];
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
    spawnSlot: async ({ dispatch, environment }) => {
      expect(active).toBe(false);
      active = true;
      calls.push('spawn');
      argv.push([
        dispatch.runId,
        dispatch.slotId,
        dispatch.configurationId,
        dispatch.configurationFingerprint,
        dispatch.childEnvironmentFingerprint,
        dispatch.outputPath,
      ]);
      expect(environment).not.toHaveProperty('HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT');
      await Promise.resolve();
      active = false;
      return { slotId: dispatch.slotId, configurationId: 'a' };
    },
    validateSlotOutput: async (slot, _dispatch, output) => {
      expect(active).toBe(false);
      calls.push('validate');
      expect((output as { slotId: string }).slotId).toBe(slot.slotId);
      return output as never;
    },
  };
  return { calls, argv, deps };
}

describe('historical quality runtime acceptance order', () => {
  it('attests, verifies and closes, resolves and plans, then restores/spawns/validates every slot serially', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { calls, argv, deps } = runtimeDeps();
    const tenSlots: HistoricalQualityRequest = { ...request, caseIds: [...HISTORICAL_QUALITY_APPROVED_CASE_IDS], triggers: ['intent', 'enrichment'] };
    const result = await runHistoricalQualityRuntime(tenSlots, deps);
    expect(result.outputs).toHaveLength(10);
    expect(calls).toEqual([
      'child-preflight', 'attest', 'verify', 'verifier-closed',
      ...Array.from({ length: 10 }, () => ['restore', 'spawn', 'validate']).flat(),
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

  it('dispatches distinct recomputed full-config and canonical child-env fingerprints', async () => {
    Object.assign(process.env, requiredParentEnvironment());
    const { deps } = runtimeDeps();
    let observed: { full: string; childEnv: string; json: string } | undefined;
    deps.spawnSlot = async ({ dispatch, environment }) => {
      observed = {
        full: dispatch.configurationFingerprint,
        childEnv: dispatch.childEnvironmentFingerprint,
        json: environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON,
      };
      return { slotId: dispatch.slotId, configurationId: 'a' };
    };
    await runHistoricalQualityRuntime(request, deps);
    const resolved = await resolveHistoricalQualityConfiguration({
      request,
      verifiedBase,
      environment: process.env,
    });
    expect(observed?.childEnv).toBe(digest(observed!.json));
    expect(observed?.full).toBe(digest(canonicalJson(resolved)));
    expect(observed?.full).not.toBe(observed?.childEnv);
  });
});
