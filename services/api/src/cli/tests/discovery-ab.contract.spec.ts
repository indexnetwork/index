import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { AB_EXIT_COMPARISON, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_EXIT_PREFLIGHT_REFUSED, AB_EXIT_SPENT_WITHOUT_ARTIFACT, AbSpentRunError, abUsage, classifyAbParentFailure, describeAbFailure } from '../discovery-ab.contract';
import { AbGateError } from '../discovery-ab.gate';

const CLI_DIR = path.resolve(import.meta.dir, '..');
const BOOTSTRAP = path.resolve(CLI_DIR, 'discovery-ab.ts');

/**
 * The bootstrap's whole reason to exist is an import-ordering property: nothing
 * that can compose a database may be *statically* reachable from it, or the
 * graph would load before the branches were attested. So the closure is walked
 * for real rather than asserted on one file's text — moving the help text into
 * a shared module is exactly the kind of change that could have broken it.
 */
async function staticImportClosure(entry: string): Promise<{ files: string[]; packages: string[] }> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    // Static `import`/`export ... from` only: a dynamic `await import(...)` has
    // no `from` clause, and deferring the runtime behind one is the point.
    for (const match of source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+'([^']+)';/gm)) {
      const specifier = match[1]!;
      if (specifier.startsWith('.')) queue.push(path.resolve(path.dirname(file), `${specifier}.ts`));
      else packages.add(specifier);
    }
  }
  return { files: [...seen], packages: [...packages] };
}

describe('the discovery A/B bootstrap import closure', () => {
  it('still reaches nothing that can compose a database', async () => {
    const { files, packages } = await staticImportClosure(BOOTSTRAP);
    // Every static dependency is either local CLI code or a node builtin.
    expect(packages.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
    expect(packages).not.toContain('@indexnetwork/protocol');
    expect(packages.filter((specifier) => specifier.includes('drizzle'))).toEqual([]);
    expect(files.map((file) => path.basename(file))).not.toContain('discovery-ab.main.ts');
    expect(files.map((file) => path.basename(file)).sort()).toContain('discovery-ab.contract.ts');
  });

  it('reaches the runtime only through a dynamic import, and prints no error text', async () => {
    const source = await readFile(BOOTSTRAP, 'utf8');
    expect(source).toContain("await import('./discovery-ab.main')");
    expect(source).not.toContain('error.message');
  });
});

describe('discovery-ab --help', () => {
  /**
   * Run with `env: {}`: the help text exists to tell an operator what this
   * command requires, so needing any of it first would make it useless.
   */
  const runHelp = async (flag: string) => {
    const child = Bun.spawn({
      cmd: [process.execPath, BOOTSTRAP, flag],
      env: {},
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode };
  };

  it('prints the full contract and exits 0 with no environment at all', async () => {
    const { stdout, stderr, exitCode } = await runHelp('--help');
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    // The whole contract, not a summary telling the operator to run --help.
    expect(stdout).toBe(`${abUsage()}\n`);
    expect(stdout).not.toContain('for the full contract');
  }, 30_000);

  it('answers -h the same way', async () => {
    const { stdout, exitCode } = await runHelp('-h');
    expect(exitCode).toBe(0);
    expect(stdout).toBe(`${abUsage()}\n`);
  }, 30_000);
});

describe('abUsage', () => {
  const usage = abUsage();

  it('states the manifest shape, so an operator can build one from the help alone', () => {
    expect(usage).toContain('DISCOVERY_AB_TARGETS');
    expect(usage).toContain('"sideId":"a"');
    expect(usage).toContain('"baseBranchId":"br-..."');
  });

  it('states every flag', () => {
    for (const flag of ['--case', '--runs', '--a KEY=VALUE', '--b KEY=VALUE', '--force']) {
      expect(usage).toContain(flag);
    }
  });

  it('states the reset-from-base behaviour and the no-baseline property', () => {
    expect(usage).toContain('resets both attested');
    expect(usage).toContain('eval-discovery-base');
    expect(usage).toContain('never reads, writes or compares a baseline');
  });

  it('states what each exit code means, since two of them are failures with very different costs', () => {
    expect(usage).toContain('Exit codes:');
    for (const code of [AB_EXIT_COMPARISON, AB_EXIT_PREFLIGHT_REFUSED, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_EXIT_SPENT_WITHOUT_ARTIFACT]) {
      expect(usage).toContain(`\n  ${code}   `);
    }
    expect(usage).toContain('nothing was spent');
    expect(usage).toContain('may have been spent');
  });
});

describe('exit codes', () => {
  it('gives every outcome its own code', () => {
    const codes = [AB_EXIT_COMPARISON, AB_EXIT_PREFLIGHT_REFUSED, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_EXIT_SPENT_WITHOUT_ARTIFACT];
    expect(new Set(codes).size).toBe(codes.length);
    expect(AB_EXIT_COMPARISON).toBe(0);
    // 3 is the shared eval CLI's EVAL_EXIT_INSUFFICIENT_EVIDENCE, restated here.
    expect(AB_EXIT_INSUFFICIENT_EVIDENCE).toBe(3);
  });
});

describe('classifyAbParentFailure', () => {
  it('leaves a pre-flight failure exactly as it was, because its own message is the useful one', () => {
    const refusal = new AbGateError('Refusing to mutate: set DISCOVERY_AB_CONFIRM=1');
    expect(classifyAbParentFailure(null, refusal)).toBe(refusal);
    expect(describeAbFailure(classifyAbParentFailure(null, refusal))).toEqual({
      exitCode: AB_EXIT_PREFLIGHT_REFUSED,
      message: 'Refusing to mutate: set DISCOVERY_AB_CONFIRM=1',
    });
  });

  it('reports a failure after the resets as branches overwritten and nothing spent', () => {
    const classified = classifyAbParentFailure('reset', new Error('neon restore blew up'));
    expect(classified).toBeInstanceOf(AbSpentRunError);
    const report = describeAbFailure(classified);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.message).toContain('after resetting the A/B branches');
    expect(report.message).toContain('no run was spent');
    expect(report.message).toContain('no artifact was written');
  });

  it('reports a failure after a side was spawned as a spend with nothing to show for it', () => {
    const classified = classifyAbParentFailure('spawned', new Error('child died'));
    const report = describeAbFailure(classified);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.exitCode).not.toBe(AB_EXIT_PREFLIGHT_REFUSED);
    expect(report.message).toContain('after spawning a side');
    expect(report.message).toContain('provider spend and wall-clock time are gone');
    expect(report.message).toContain('No artifact was written');
  });

  it('keeps the original failure as a cause without ever printing it', () => {
    const cause = new Error('postgresql://user:hunter2secret@ep-a.neon.tech/protocol_eval refused');
    const classified = classifyAbParentFailure('spawned', cause) as AbSpentRunError;
    expect(classified.cause).toBe(cause);
    expect(classified.stage).toBe('spawned');
    expect(describeAbFailure(classified).message).not.toContain('hunter2secret');
  });
});

describe('describeAbFailure', () => {
  it('prints a gate refusal verbatim, since it names only environment variables', () => {
    expect(describeAbFailure(new AbGateError('Refusing to run: NEON_API_KEY is required'))).toEqual({
      exitCode: AB_EXIT_PREFLIGHT_REFUSED,
      message: 'Refusing to run: NEON_API_KEY is required',
    });
  });

  it('reports an unclassified failure as pre-flight, and says so rather than staying silent about cost', () => {
    const report = describeAbFailure(new Error('postgresql://user:hunter2secret@ep-a.neon.tech/protocol_eval refused'));
    expect(report.exitCode).toBe(AB_EXIT_PREFLIGHT_REFUSED);
    expect(report.message).toContain('no branch was mutated and no run was spent');
    expect(report.message).not.toContain('hunter2secret');
  });

  it('classifies a thrown non-error too, rather than crashing the reporter', () => {
    expect(describeAbFailure('something went wrong').exitCode).toBe(AB_EXIT_PREFLIGHT_REFUSED);
  });
});
