import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { runDiscoveryBootstrap, type DiscoveryBootstrapDependencies } from '../discovery';
import { HISTORICAL_QUALITY_APPROVED_CASE_IDS, formatHistoricalQualityCost, historicalQualityCost, historicalQualityUsage, parseHistoricalQualityArgs, type HistoricalQualityRequest } from '../discovery-quality.contract';

const BOOTSTRAP = path.resolve(import.meta.dir, '../discovery.ts');
const fullArgs = ['--historical-quality', '--env', 'DISCOVERY_ALLOWED_TYPES=intent,profile'] as const;

describe('historical quality argument contract', () => {
  it('parses repeatable triggers, repeated case selectors, report, force, runs, and one environment', () => {
    expect(parseHistoricalQualityArgs([
      '--historical-quality',
      '--case', HISTORICAL_QUALITY_APPROVED_CASE_IDS[2]!,
      '--case', HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]!,
      '--trigger', 'intent',
      '--trigger', 'enrichment',
      '--runs', '1',
      '--env', 'DISCOVERY_ALLOWED_TYPES=intent,profile',
      '--report', 'quality.json',
      '--force',
    ])).toEqual({
      caseIds: [HISTORICAL_QUALITY_APPROVED_CASE_IDS[2], HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]],
      triggers: ['intent', 'enrichment'],
      repetitions: 1,
      configuration: { id: 'a', config: { DISCOVERY_ALLOWED_TYPES: 'intent,profile' } },
      reportPath: 'quality.json',
      force: true,
    });
  });

  it('defaults to all five admitted cases, both triggers, and three repetitions', () => {
    const request = parseHistoricalQualityArgs(fullArgs);
    expect(request.caseIds).toEqual([...HISTORICAL_QUALITY_APPROVED_CASE_IDS]);
    expect(request.triggers).toEqual(['intent', 'enrichment']);
    expect(request.repetitions).toBe(3);
    expect(historicalQualityCost(request)).toEqual({ graphInvocations: 30, evaluatorCalls: 30 });
  });

  it('reports the exact 10 and 30 call arithmetic', () => {
    const one = parseHistoricalQualityArgs([...fullArgs, '--runs', '1']);
    const three = parseHistoricalQualityArgs(fullArgs);
    expect(formatHistoricalQualityCost(one)).toBe([
      'Historical quality cost: 5 cases x 2 triggers x 1 repetition = 10 graph invocations and 10 evaluator calls.',
      'Execution policy: restore before every slot; one attempt and one evaluator call per slot.',
      'Verdict policy: a case or trigger subset produces evidence only; no subset verdict.',
      'Safety order: attest topology; verify the protected base read-only; then restore side a before each serial slot.',
    ].join('\n'));
    expect(formatHistoricalQualityCost(three)).toContain('5 cases x 2 triggers x 3 repetitions = 30 graph invocations and 30 evaluator calls.');
  });

  it.each([
    [['--historical-quality', '--a', 'X=1', '--b', 'X=2'], /does not accept --a or --b/],
    [['--historical-quality', '--env', 'X=1', '--a', 'X=2'], /does not accept --a or --b/],
    [['--historical-quality'], /--env KEY=VALUE is required/],
    [['--historical-quality', '--env', 'X=1', '--env', 'Y=2'], /exactly one --env/],
    [['--historical-quality', '--env', 'X'], /--env expects KEY=VALUE/],
    [['--historical-quality', '--env', 'NOT_READ_BY_DISCOVERY=1'], /not readable by the discovery graph/],
    [['--historical-quality', '--env', 'OPENROUTER_API_KEY=secret'], /is a credential/],
    [['--historical-quality', '--env', 'CHAT_MODEL=   '], /empty value/],
    [['--historical-quality', '--env', 'DISCOVERY_PROFILE_SOURCE=user-context'], /falls back to its default/],
    [['--historical-quality', '--env', 'X=1', '--update-baseline'], /does not read, write, or update a baseline/],
    [['--historical-quality', '--env', 'X=1', '--baseline', 'old.json'], /does not read, write, or update a baseline/],
    [['--historical-quality', '--env', 'X=1', '--trigger', 'other'], /--trigger must be intent or enrichment/],
    [['--historical-quality', '--env', 'X=1', '--trigger', 'intent', '--trigger', 'intent'], /same trigger twice/],
    [['--historical-quality', '--env', 'X=1', '--case', HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]!, '--case', HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]!], /same case twice/],
    [['--historical-quality', '--env', 'X=1', '--case', 'historical/not-approved'], /not an approved historical quality case/],
    [['--historical-quality', '--env', 'X=1', '--runs', '0'], /positive integer/],
    [['--historical-quality', '--env', 'DISCOVERY_ALLOWED_TYPES=intent', '--runs', '201', '--case', HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]!, '--trigger', 'intent'], /201 graph invocations exceeds hard cap 200/],
    [['--historical-quality', '--env', 'X=1', '--mystery'], /Unknown historical quality flag: --mystery/],
  ])('refuses invalid quality argv %p', (args, message) => {
    expect(() => parseHistoricalQualityArgs(args)).toThrow(message);
  });
});

describe('historical quality provider-free preflight contract', () => {
  it('documents every quality flag and the guarded runtime safety boundary', () => {
    const usage = historicalQualityUsage();
    for (const flag of ['--historical-quality', '--case', '--trigger', '--runs', '--env', '--report', '--force']) {
      expect(usage).toContain(flag);
    }
    expect(usage).toContain('restore before every slot');
    expect(usage).toContain('one attempt');
    expect(usage).toContain('no subset verdict');
    expect(usage).toContain('attests topology');
    expect(usage).toContain('verifies the protected base read-only before the first restore');
    expect(usage).not.toContain('runtime is not available');
  });

  const spawn = async (args: readonly string[]) => {
    const child = Bun.spawn({ cmd: [process.execPath, BOOTSTRAP, ...args], env: {}, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  };

  it('answers quality help with an empty environment and no credentials', async () => {
    const result = await spawn(['--historical-quality', '--help']);
    expect(result).toEqual({ stdout: `${historicalQualityUsage()}\n`, stderr: '', exitCode: 0 });
  }, 30_000);

  it('prints cost then refuses an unconfirmed request before manifest or Neon access', async () => {
    const request = parseHistoricalQualityArgs([...fullArgs, '--runs', '1']);
    const result = await spawn([...fullArgs, '--runs', '1']);
    expect(result).toEqual({
      stdout: `${formatHistoricalQualityCost(request)}\n`,
      stderr: 'Refusing to mutate: set DISCOVERY_CONFIRM=1\n',
      exitCode: 2,
    });
  }, 30_000);

  const instrumentBootstrap = () => {
    const calls = {
      confirmation: 0,
      manifestParsing: 0,
      neonAttestation: 0,
      neonNetwork: 0,
      databaseComposition: 0,
      providerComposition: 0,
      redisComposition: 0,
      graphComposition: 0,
      dynamicRuntimeImport: 0,
      qualityRuntimeImport: 0,
      qualityDispatch: 0,
    };
    const dependencies: DiscoveryBootstrapDependencies = {
      assertConfirmation: () => { calls.confirmation += 1; },
      parseManifest: () => {
        calls.manifestParsing += 1;
        throw new Error('manifest parsing must not run');
      },
      attestTargets: async () => {
        calls.neonAttestation += 1;
        calls.neonNetwork += 1;
      },
      importRuntime: async () => {
        calls.dynamicRuntimeImport += 1;
        return {
          main: async () => {
            calls.databaseComposition += 1;
            calls.providerComposition += 1;
            calls.redisComposition += 1;
            calls.graphComposition += 1;
          },
        };
      },
      importQualityRuntime: async () => {
        calls.qualityRuntimeImport += 1;
        return { runHistoricalQualityRuntime: async () => { calls.qualityDispatch += 1; } };
      },
    };
    return { calls, dependencies };
  };

  it('dispatches through the quality seam without touching the legacy gate or runtime', async () => {
    const { calls, dependencies } = instrumentBootstrap();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const request = parseHistoricalQualityArgs([...fullArgs, '--runs', '1']);

    const exitCode = await runDiscoveryBootstrap(
      [...fullArgs, '--runs', '1'],
      {},
      {
        log: (message?: unknown) => stdout.push(String(message)),
        error: (message?: unknown) => stderr.push(String(message)),
      },
      dependencies,
    );

    expect(exitCode).toBeUndefined();
    expect(stdout).toEqual([formatHistoricalQualityCost(request)]);
    expect(stderr).toEqual([]);
    expect(calls).toMatchObject({ qualityRuntimeImport: 1, qualityDispatch: 1 });
    expect(Object.entries(calls).filter(([key]) => !key.startsWith('quality')).map(([, value]) => value)).toEqual(Array(9).fill(0));
  });

  it.each([
    ['unknown key', 'NOT_READ_BY_DISCOVERY=1', /not readable by the discovery graph/],
    ['credential key', 'OPENROUTER_API_KEY=secret', /is a credential/],
    ['blank value', 'CHAT_MODEL=   ', /empty value/],
    ['fallback-inducing value', 'DISCOVERY_PROFILE_SOURCE=user-context', /falls back to its default/],
  ])('rejects an invalid %s before every gate and runtime operation', async (_label, assignment, expected) => {
    const { calls, dependencies } = instrumentBootstrap();

    await expect(runDiscoveryBootstrap(
      ['--historical-quality', '--env', assignment],
      {},
      { log: () => {}, error: () => {} },
      dependencies,
    )).rejects.toThrow(expected);

    expect(Object.values(calls)).toEqual(Array(11).fill(0));
  });
});

describe('historical quality PR B dispatch acceptance', () => {
  it('recognizes a direct quality child before legacy parsing and refuses through the child-runtime seam', async () => {
    const calls: string[] = [];
    const dependencies = {
      assertConfirmation: () => { calls.push('legacy-confirmation'); },
      parseManifest: () => { calls.push('legacy-manifest'); throw new Error('legacy parser must not run'); },
      attestTargets: async () => { calls.push('legacy-attest'); },
      importRuntime: async () => ({ main: async () => { calls.push('legacy-runtime'); } }),
      importQualityChildRuntime: async () => {
        calls.push('quality-child-preflight');
        throw new Error('Historical quality child runtime is unavailable');
      },
    } as DiscoveryBootstrapDependencies & {
      importQualityChildRuntime(): Promise<never>;
    };

    await expect(runDiscoveryBootstrap(
      ['--historical-quality-child', '--run-id', 'run', '--slot-id', 'slot', '--configuration-id', 'a'],
      {},
      { log: () => {}, error: () => {} },
      dependencies,
    )).rejects.toThrow(/child runtime is unavailable/);
    expect(calls).toEqual(['quality-child-preflight']);
  });

  it.each([0, 3] as const)('preserves historical quality runtime exit %i through the top-level bootstrap', async (exitCode) => {
    const previous = process.exitCode;
    process.exitCode = undefined;
    const dependencies: DiscoveryBootstrapDependencies = {
      assertConfirmation: () => { throw new Error('legacy gate must not run'); },
      parseManifest: () => { throw new Error('legacy manifest must not parse'); },
      attestTargets: async () => { throw new Error('legacy attestation must not run'); },
      importRuntime: async () => { throw new Error('legacy runtime must not load'); },
      importQualityRuntime: async () => ({
        runHistoricalQualityRuntime: async () => { process.exitCode = exitCode; },
      }),
    };
    try {
      expect(await runDiscoveryBootstrap(fullArgs, {}, { log: () => {}, error: () => {} }, dependencies)).toBeUndefined();
      expect(Number(process.exitCode)).toBe(exitCode);
    } finally {
      process.exitCode = previous;
    }
  });

  it('passes the parsed request to the dedicated quality runtime instead of legacy A/B', async () => {
    const calls: string[] = [];
    let dispatchedRequest: HistoricalQualityRequest | undefined;
    const dependencies: DiscoveryBootstrapDependencies & {
      importQualityRuntime(): Promise<{
        runHistoricalQualityRuntime(request: HistoricalQualityRequest): Promise<void>;
      }>;
    } = {
      assertConfirmation: () => { calls.push('legacy-confirmation'); },
      parseManifest: () => {
        calls.push('legacy-manifest');
        throw new Error('quality dispatch must not parse the legacy A/B manifest');
      },
      attestTargets: async () => { calls.push('legacy-attest'); },
      importRuntime: async () => {
        calls.push('legacy-runtime-import');
        return { main: async () => { calls.push('legacy-dispatch'); } };
      },
      importQualityRuntime: async () => {
        calls.push('quality-runtime-import');
        return {
          runHistoricalQualityRuntime: async (request) => {
            calls.push('quality-dispatch');
            dispatchedRequest = request;
          },
        };
      },
    };
    const stderr: string[] = [];
    const request: HistoricalQualityRequest = parseHistoricalQualityArgs([...fullArgs, '--runs', '1']);

    const result = await runDiscoveryBootstrap(
      [...fullArgs, '--runs', '1'],
      { DISCOVERY_CONFIRM: '1', TEST_DATABASE_SAFE: '1' },
      { log: () => {}, error: (message?: unknown) => stderr.push(String(message)) },
      dependencies,
    );

    expect(result).toBeUndefined();
    expect(stderr).toEqual([]);
    expect(calls).toEqual(['quality-runtime-import', 'quality-dispatch']);
    expect(dispatchedRequest).toEqual(request);
  });
});
