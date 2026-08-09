import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { runDiscoveryBootstrap, type DiscoveryBootstrapDependencies } from '../discovery';
import { HISTORICAL_QUALITY_APPROVED_CASE_IDS, HISTORICAL_QUALITY_PR_A_REFUSAL, formatHistoricalQualityCost, historicalQualityCost, historicalQualityUsage, parseHistoricalQualityArgs, runHistoricalQualityPrARefusal } from '../discovery-quality.contract';

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
      'PR A performs no base verification; pre-reset read-only base verification is delivered by PR B.',
    ].join('\n'));
    expect(formatHistoricalQualityCost(three)).toContain('5 cases x 2 triggers x 3 repetitions = 30 graph invocations and 30 evaluator calls.');
  });

  it.each([
    [['--historical-quality', '--a', 'X=1', '--b', 'X=2'], /does not accept --a or --b/],
    [['--historical-quality', '--env', 'X=1', '--a', 'X=2'], /does not accept --a or --b/],
    [['--historical-quality'], /--env KEY=VALUE is required/],
    [['--historical-quality', '--env', 'X=1', '--env', 'Y=2'], /exactly one --env/],
    [['--historical-quality', '--env', 'X'], /--env expects KEY=VALUE/],
    [['--historical-quality', '--env', 'X=1', '--update-baseline'], /does not read, write, or update a baseline/],
    [['--historical-quality', '--env', 'X=1', '--baseline', 'old.json'], /does not read, write, or update a baseline/],
    [['--historical-quality', '--env', 'X=1', '--trigger', 'other'], /--trigger must be intent or enrichment/],
    [['--historical-quality', '--env', 'X=1', '--trigger', 'intent', '--trigger', 'intent'], /same trigger twice/],
    [['--historical-quality', '--env', 'X=1', '--case', HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]!, '--case', HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]!], /same case twice/],
    [['--historical-quality', '--env', 'X=1', '--case', 'historical/not-approved'], /not an approved historical quality case/],
    [['--historical-quality', '--env', 'X=1', '--runs', '0'], /positive integer/],
    [['--historical-quality', '--env', 'X=1', '--runs', '201', '--case', HISTORICAL_QUALITY_APPROVED_CASE_IDS[0]!, '--trigger', 'intent'], /201 graph invocations exceeds hard cap 200/],
    [['--historical-quality', '--env', 'X=1', '--mystery'], /Unknown historical quality flag: --mystery/],
  ])('refuses invalid quality argv %p', (args, message) => {
    expect(() => parseHistoricalQualityArgs(args)).toThrow(message);
  });
});

describe('historical quality provider-free contract', () => {
  it('documents every quality flag and the PR A/PR B safety boundary', () => {
    const usage = historicalQualityUsage();
    for (const flag of ['--historical-quality', '--case', '--trigger', '--runs', '--env', '--report', '--force']) {
      expect(usage).toContain(flag);
    }
    expect(usage).toContain('restore before every slot');
    expect(usage).toContain('one attempt');
    expect(usage).toContain('no subset verdict');
    expect(usage).toContain('PR A performs no base verification; pre-reset read-only base verification is delivered by PR B.');
    expect(usage).not.toContain('PR A verifies');
    expect(usage).not.toContain('PR A resets');
  });

  it('prints cost then the fixed classified PR A refusal', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const request = parseHistoricalQualityArgs([...fullArgs, '--runs', '1']);
    expect(runHistoricalQualityPrARefusal(request, {
      log: (message?: unknown) => stdout.push(String(message)),
      error: (message?: unknown) => stderr.push(String(message)),
    })).toBe(2);
    expect(stdout).toEqual([formatHistoricalQualityCost(request)]);
    expect(stderr).toEqual([HISTORICAL_QUALITY_PR_A_REFUSAL]);
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

  it('refuses a non-help quality request before the legacy gate, manifest, Neon, or runtime', async () => {
    const request = parseHistoricalQualityArgs([...fullArgs, '--runs', '1']);
    const result = await spawn([...fullArgs, '--runs', '1']);
    expect(result).toEqual({
      stdout: `${formatHistoricalQualityCost(request)}\n`,
      stderr: `${HISTORICAL_QUALITY_PR_A_REFUSAL}\n`,
      exitCode: 2,
    });
  }, 30_000);

  it('refuses through the production bootstrap seam before every gate and runtime operation', async () => {
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
    };
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

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([formatHistoricalQualityCost(request)]);
    expect(stderr).toEqual([HISTORICAL_QUALITY_PR_A_REFUSAL]);
    expect(calls).toEqual({
      confirmation: 0,
      manifestParsing: 0,
      neonAttestation: 0,
      neonNetwork: 0,
      databaseComposition: 0,
      providerComposition: 0,
      redisComposition: 0,
      graphComposition: 0,
      dynamicRuntimeImport: 0,
    });
  });
});
