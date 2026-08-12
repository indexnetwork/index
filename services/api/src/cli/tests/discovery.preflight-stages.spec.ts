import { describe, expect, it } from 'bun:test';

import { AbChildStageError, describeAbFailure, type AbChildFailureStage } from '../discovery.contract';
import { assertAbRuntimePrerequisites } from '../discovery.gate';
import { runAbChild, runAbChildInvocation, runAbChildResourceCleanup, runAbChildStages, type AbChildMainDependencies } from '../discovery.main';
import { runDiscoveryBootstrap, type DiscoveryBootstrapDependencies } from '../discovery';

const manifest = {
  projectId: 'synthetic-project',
  baseBranchId: 'synthetic-base',
  targets: [
    { sideId: 'a' as const, branchId: 'synthetic-a', endpointId: 'synthetic-ea', databaseUrl: 'postgres://user:password@a.neon.tech/protocol_eval' },
    { sideId: 'b' as const, branchId: 'synthetic-b', endpointId: 'synthetic-eb', databaseUrl: 'postgres://user:password@b.neon.tech/protocol_eval' },
  ] as const,
};

function confirmedEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DISCOVERY_CONFIRM: '1',
    TEST_DATABASE_SAFE: '1',
    NEON_API_KEY: 'synthetic-neon-key',
    DISCOVERY_TARGETS: '{synthetic-manifest}',
    OPENROUTER_API_KEY: 'synthetic-provider-key',
    REDIS_URL: 'redis://synthetic.invalid:6379',
    ...overrides,
  };
}

function bootstrapDependencies(calls: string[]): DiscoveryBootstrapDependencies {
  return {
    assertConfirmation: () => { calls.push('confirmation'); },
    assertRuntimePrerequisites: (environment) => {
      calls.push('runtime-prerequisites');
      assertAbRuntimePrerequisites(environment);
    },
    parseManifest: () => { calls.push('manifest'); return manifest; },
    attestTargets: async () => { calls.push('attestation'); },
    importRuntime: async () => {
      calls.push('runtime-import');
      return { main: async () => { calls.push('runtime-main'); } };
    },
  };
}

describe('direct discovery runtime prerequisite preflight', () => {
  it.each([
    ['missing provider', { OPENROUTER_API_KEY: undefined }],
    ['blank provider', { OPENROUTER_API_KEY: '   ' }],
    ['missing Redis', { REDIS_URL: undefined }],
    ['ambiguous Redis', { REDIS_HOST: 'cache.invalid', REDIS_PORT: '6379', REDIS_PASSWORD: 'synthetic-password', REDIS_DB: '0' }],
    ['partial Redis', { REDIS_URL: undefined, REDIS_HOST: 'cache.invalid', REDIS_PORT: '6379' }],
  ])('refuses %s before manifest, attestation, import, reset, or spawn', async (_label, overrides) => {
    const calls: string[] = [];
    const environment = confirmedEnvironment(overrides);
    const thrown = await runDiscoveryBootstrap(
      ['--env', 'DISCOVERY_ALLOWED_TYPES=intent'],
      environment,
      { log: () => {}, error: () => {} },
      bootstrapDependencies(calls),
    ).catch((error: unknown) => error);

    const report = describeAbFailure(thrown);
    expect(report.exitCode).toBe(2);
    expect(report.message).toMatch(/OPENROUTER_API_KEY|REDIS_URL|REDIS_HOST\/REDIS_PORT\/REDIS_PASSWORD\/REDIS_DB/);
    expect(report.message).not.toContain('synthetic-provider-key');
    expect(report.message).not.toContain('synthetic-password');
    expect(calls).toEqual(['confirmation', 'runtime-prerequisites']);
  });

  it('accepts the URL Redis form and advances only to the mocked attestation boundary', async () => {
    const calls: string[] = [];
    const dependencies = bootstrapDependencies(calls);
    dependencies.attestTargets = async () => {
      calls.push('attestation');
      throw new Error('raw-attestation-secret-sentinel');
    };

    await expect(runDiscoveryBootstrap(
      ['--env', 'DISCOVERY_ALLOWED_TYPES=intent'],
      confirmedEnvironment(),
      { log: () => {}, error: () => {} },
      dependencies,
    )).rejects.toThrow('raw-attestation-secret-sentinel');
    expect(calls).toEqual(['confirmation', 'runtime-prerequisites', 'manifest', 'attestation']);
  });

  it('accepts the complete split Redis form and advances only to the mocked runtime boundary', async () => {
    const calls: string[] = [];
    const dependencies = bootstrapDependencies(calls);
    dependencies.importRuntime = async () => {
      calls.push('runtime-import');
      throw new Error('raw-import-secret-sentinel');
    };
    const environment = confirmedEnvironment({
      REDIS_URL: undefined,
      REDIS_HOST: 'cache.invalid',
      REDIS_PORT: '6379',
      REDIS_PASSWORD: 'synthetic-password',
      REDIS_DB: '0',
    });

    await expect(runDiscoveryBootstrap(
      ['--env', 'DISCOVERY_ALLOWED_TYPES=intent'],
      environment,
      { log: () => {}, error: () => {} },
      dependencies,
    )).rejects.toThrow('raw-import-secret-sentinel');
    expect(calls).toEqual(['confirmation', 'runtime-prerequisites', 'manifest', 'attestation', 'runtime-import']);
  });
});

describe('production child stage wiring', () => {
  const childArgs = [
    '--side', 'a', '--child-output', '/tmp/synthetic-child-output.json',
    '--env', 'DISCOVERY_ALLOWED_TYPES=intent', '--runs', '1',
  ];
  const childEnvironment = confirmedEnvironment({
    DATABASE_URL: `${manifest.targets[0].databaseUrl}?sslmode=require`,
    DISCOVERY_SIDE_BRANCH: 'eval-ab-a',
    DISCOVERY_TARGETS: JSON.stringify(manifest),
  });

  it('classifies the first production matrix loader as dependency initialization', async () => {
    const sentinel = 'raw-first-matrix-loader-secret-sentinel';
    const calls: string[] = [];
    const stages: AbChildFailureStage[] = [];
    const dependencies: AbChildMainDependencies = {
      loadMatrixEval: async () => {
        calls.push('matrix-loader');
        throw new Error(sentinel);
      },
      runChild: runAbChild,
      observeStage: (stage) => { stages.push(stage); },
    };

    const thrown = await runAbChildInvocation(childArgs, childEnvironment, dependencies)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AbChildStageError);
    expect((thrown as AbChildStageError).stage).toBe('dependency-initialization');
    const report = describeAbFailure(thrown, 'child');
    expect(report).toEqual({
      exitCode: 2,
      message: 'Discovery side process failed at stage dependency-initialization. The parent invocation remains authoritative for mutation and spend uncertainty.',
    });
    expect(report.message).not.toContain(sentinel);
    expect(calls).toEqual(['matrix-loader']);
    expect(stages).toEqual(['dependency-initialization']);
  });

  it('keeps argument and environment refusals outside operational stage classification', async () => {
    const calls: string[] = [];
    const dependencies: AbChildMainDependencies = {
      loadMatrixEval: async () => { calls.push('matrix-loader'); throw new Error('must not load'); },
      runChild: runAbChild,
      observeStage: (stage) => { calls.push(stage); },
    };

    const badArgs = await runAbChildInvocation(['--side', 'a'], childEnvironment, dependencies)
      .catch((error: unknown) => error);
    expect(badArgs).not.toBeInstanceOf(AbChildStageError);
    expect(describeAbFailure(badArgs, 'child').message).not.toContain('stage ');

    const badEnvironment = await runAbChildInvocation(
      childArgs,
      { ...childEnvironment, DATABASE_URL: 'postgres://user:password@not-neon.invalid/protocol_eval' },
      dependencies,
    ).catch((error: unknown) => error);
    expect(badEnvironment).not.toBeInstanceOf(AbChildStageError);
    expect(describeAbFailure(badEnvironment, 'child')).toMatchObject({ exitCode: 2 });
    expect(calls).toEqual([]);
  });
});

describe('sanitized discovery child stages', () => {
  const stages: AbChildFailureStage[] = [
    'dependency-initialization',
    'base-verification',
    'run-execution',
    'artifact-write',
  ];

  it.each(stages)('classifies %s without leaking the cause or running later stages', async (failingStage) => {
    const calls: AbChildFailureStage[] = [];
    const sentinel = `raw-secret-sentinel-${failingStage}`;
    const operation = async <T>(stage: AbChildFailureStage, value: T): Promise<T> => {
      calls.push(stage);
      if (stage === failingStage) throw new Error(sentinel);
      return value;
    };

    const thrown = await runAbChildStages({
      initializeDependencies: async () => operation('dependency-initialization', { synthetic: true }),
      verifyBase: async () => { await operation('base-verification', undefined); },
      executeRun: async () => operation('run-execution', { slots: [], execution: { policy: 'strict' as const, runs: [] } }),
      writeArtifact: async () => { await operation('artifact-write', undefined); },
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AbChildStageError);
    expect((thrown as AbChildStageError).stage).toBe(failingStage);
    expect((thrown as Error).message).not.toContain(sentinel);
    const report = describeAbFailure(thrown, 'child');
    expect(report).toEqual({
      exitCode: 2,
      message: `Discovery side process failed at stage ${failingStage}. The parent invocation remains authoritative for mutation and spend uncertainty.`,
    });
    expect(report.message).not.toContain(sentinel);
    expect(calls).toEqual(stages.slice(0, stages.indexOf(failingStage) + 1));
  });

  it('classifies resource cleanup without leaking its cause', async () => {
    const sentinel = 'raw-resource-cleanup-secret-sentinel';
    const thrown = await runAbChildResourceCleanup(async () => {
      throw new Error(sentinel);
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AbChildStageError);
    expect((thrown as AbChildStageError).stage).toBe('resource-cleanup');
    const report = describeAbFailure(thrown, 'child');
    expect(report).toEqual({
      exitCode: 2,
      message: 'Discovery side process failed at stage resource-cleanup. The parent invocation remains authoritative for mutation and spend uncertainty.',
    });
    expect(report.message).not.toContain(sentinel);
  });

  it('keeps side-B SIGTERM fail-fast behavior while preserving side A as the classified first failure', async () => {
    let sideBStarted = false;
    let sideBSignal: NodeJS.Signals | undefined;
    let sideBExit: number | undefined;
    let releaseSideA!: () => void;
    const sideAReady = new Promise<void>((resolve) => { releaseSideA = resolve; });
    let releaseSideB!: () => void;
    const sideBTerminated = new Promise<void>((resolve) => { releaseSideB = resolve; });
    const sideBProcess = {
      kill(signal?: NodeJS.Signals) {
        sideBSignal = signal;
        sideBExit = signal === 'SIGTERM' ? 143 : undefined;
        releaseSideB();
      },
    };

    const { runBoundedChildTasks } = await import('../discovery-env-matrix.main');
    const thrown = await runBoundedChildTasks({
      items: ['a', 'b'] as const,
      concurrency: 2,
      onFailure: () => sideBProcess.kill('SIGTERM'),
      task: async (side) => {
        if (side === 'b') {
          sideBStarted = true;
          releaseSideA();
          await sideBTerminated;
          throw new Error('side-b-exit-143-secret-sentinel');
        }
        await sideAReady;
        throw new AbChildStageError('dependency-initialization', { cause: new Error('side-a-secret-sentinel') });
      },
    }).catch((error: unknown) => error);

    expect(sideBStarted).toBe(true);
    expect(sideBSignal).toBe('SIGTERM');
    expect(sideBExit).toBe(143);
    expect(thrown).toBeInstanceOf(AbChildStageError);
    const report = describeAbFailure(thrown, 'child');
    expect(report.exitCode).toBe(2);
    expect(report.message).toContain('dependency-initialization');
    expect(report.message).not.toContain('side-a-secret-sentinel');
    expect(report.message).not.toContain('side-b-exit-143-secret-sentinel');
  });
});
