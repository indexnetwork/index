import { describe, expect, it } from 'bun:test';

import type { HistoricalQualityRequest } from '../discovery-quality.contract';

interface HistoricalQualityRuntimeDependencies {
  attest(): Promise<typeof attested>;
  verifyProtectedBase(): Promise<void>;
  closeVerifier(): Promise<void>;
  restoreTarget(): Promise<void>;
  constructChildDependencies(): Promise<{ kind: string }>;
  spawnChild(): Promise<{ kind: string }>;
  validateChildOutput(): Promise<{ kind: string }>;
}

type HistoricalQualityRuntime = (
  request: HistoricalQualityRequest,
  dependencies: HistoricalQualityRuntimeDependencies,
) => Promise<unknown>;

const RUNTIME_MODULE_SPECIFIER = '../discovery-quality.runtime';

function isMissingRuntimeModule(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof error.message === 'string'
    && error.message.startsWith(`Cannot find module '${RUNTIME_MODULE_SPECIFIER}' `);
}

async function loadRuntime(): Promise<HistoricalQualityRuntime | undefined> {
  try {
    const runtime = await import(RUNTIME_MODULE_SPECIFIER);
    return runtime.runHistoricalQualityRuntime as HistoricalQualityRuntime | undefined;
  } catch (error) {
    if (isMissingRuntimeModule(error)) return undefined;
    throw error;
  }
}

const request: HistoricalQualityRequest = {
  caseIds: ['historical/builder-and-operator'],
  triggers: ['intent'],
  repetitions: 1,
  configuration: { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent' } },
  force: false,
};

const attested = {
  projectId: 'project-audit',
  baseBranchId: 'branch-base',
  target: {
    sideId: 'a' as const,
    branchId: 'branch-a',
    endpointId: 'endpoint-a',
    databaseUrl: 'postgres://audit.invalid/protocol_eval',
  },
};

function instrumentRuntime(options: { verifierFailure?: Error } = {}) {
  const calls: string[] = [];
  const counts = {
    reset: 0,
    spawn: 0,
    dependencyConstruction: 0,
  };
  const dependencies: HistoricalQualityRuntimeDependencies = {
    attest: async () => {
      calls.push('attest');
      return attested;
    },
    verifyProtectedBase: async () => {
      calls.push('verifier');
      if (options.verifierFailure) throw options.verifierFailure;
    },
    closeVerifier: async () => {
      calls.push('close');
    },
    restoreTarget: async () => {
      counts.reset += 1;
      calls.push('restore');
    },
    constructChildDependencies: async () => {
      counts.dependencyConstruction += 1;
      calls.push('construct');
      return { kind: 'quality-child-dependencies' };
    },
    spawnChild: async () => {
      counts.spawn += 1;
      calls.push('spawn');
      return { kind: 'quality-child-output' };
    },
    validateChildOutput: async () => {
      calls.push('validate');
      return { kind: 'validated-quality-output' };
    },
  };
  return { calls, counts, dependencies };
}

describe('historical quality runtime acceptance order', () => {
  it('runs attest → verifier → close → restore → spawn → validate', async () => {
    const { calls, dependencies } = instrumentRuntime();
    const runHistoricalQualityRuntime = await loadRuntime();

    expect(runHistoricalQualityRuntime).toBeFunction();
    await runHistoricalQualityRuntime!(request, dependencies);

    expect(calls.filter((call) => call !== 'construct')).toEqual([
      'attest',
      'verifier',
      'close',
      'restore',
      'spawn',
      'validate',
    ]);
    expect(calls).toEqual([
      'attest',
      'verifier',
      'close',
      'restore',
      'construct',
      'spawn',
      'validate',
    ]);
  });

  it('closes verifier resources but never resets, spawns, or constructs child dependencies after verifier failure', async () => {
    const verifierFailure = new Error('protected base verifier refused');
    const { calls, counts, dependencies } = instrumentRuntime({ verifierFailure });
    const runHistoricalQualityRuntime = await loadRuntime();

    expect(runHistoricalQualityRuntime).toBeFunction();
    await expect(runHistoricalQualityRuntime!(request, dependencies)).rejects.toBe(verifierFailure);

    expect(calls).toEqual(['attest', 'verifier', 'close']);
    expect(counts).toEqual({ reset: 0, spawn: 0, dependencyConstruction: 0 });
  });
});
