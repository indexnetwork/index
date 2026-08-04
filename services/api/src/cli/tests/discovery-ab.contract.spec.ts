import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { AB_EXIT_COMPARISON, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_EXIT_PREFLIGHT_REFUSED, AB_EXIT_SPENT_WITHOUT_ARTIFACT, AbSpentRunError, abAttestationRefusal, abUsage, classifyAbParentFailure, describeAbFailure } from '../discovery-ab.contract';
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
    // Every *static* form: `import x from 'y'`, `export ... from "y"`, and the
    // bare side-effect `import 'y'`, which has no `from` clause at all and would
    // load the runtime just as eagerly. Single and double quotes both count.
    // The two alternatives are kept separate rather than making `from` optional,
    // because a lone quoted string is also what `export const X = 'y';` looks
    // like. A dynamic `await import(...)` is matched by neither, and deferring
    // the runtime behind one is the point.
    for (const match of source.matchAll(/^(?:(?:import|export)\b[^;]*?\bfrom\s+|import\s+)['"]([^'"]+)['"]\s*;/gm)) {
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
    expect(usage).toContain('Exit codes, for the parent invocation an operator runs');
    // The codes describe a parent run; a child's code is the parent's to consume.
    expect(usage).toContain("consumed by the parent's supervision");
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

  /**
   * The first restore is the most likely post-attestation failure there is, and
   * when it is refused *nothing* has been overwritten. Claiming both branches
   * were is exactly the kind of false certainty these messages exist to remove.
   */
  it('reports a failure during the resets without claiming both branches were overwritten', () => {
    const report = describeAbFailure(classifyAbParentFailure('resetting', new Error('restore refused with status 500')));
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.message).toContain('while resetting the A/B branches');
    expect(report.message).toContain('one or both branches may have been overwritten');
    expect(report.message).not.toContain('both branches were overwritten');
    // It can still be certain about the two things the stage does fix.
    expect(report.message).toContain('No side was spawned, no run was spent');
    expect(report.message).toContain('no artifact was written');
  });

  it('names the artifact when the failure landed after it was written, rather than saying nothing survived', () => {
    const runPath = '/repo/eval/discovery-ab/runs/2026-08-04T00-00-00-000Z.json';
    const report = describeAbFailure(classifyAbParentFailure('written', new Error('EBUSY: rm /tmp/discovery-ab-x'), { artifactPath: runPath }));
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.message).toContain(runPath);
    expect(report.message).toContain('after the run artifact was written');
    expect(report.message).toContain('The artifact on disk is real');
    expect(report.message).not.toContain('nothing of this run survives');
    expect(report.message).not.toContain('No artifact was written');
  });

  it('still reports the written stage honestly when no path was recorded', () => {
    const message = new AbSpentRunError('written').message;
    expect(message).toContain('after the run artifact was written:');
    expect(message).not.toContain('undefined');
  });

  it('reports a failure after a side was spawned as a spend with nothing to show for it', () => {
    const classified = classifyAbParentFailure('spawned', new Error('child died'));
    const report = describeAbFailure(classified);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.exitCode).not.toBe(AB_EXIT_PREFLIGHT_REFUSED);
    expect(report.message).toContain('after spawning a side');
    expect(report.message).toContain('No artifact was written');
  });

  /**
   * The stage is set the moment a side *process* exists, and a side that died
   * at its own gate spent nothing at all - so the spend can only be hedged.
   */
  it('hedges the spend after a spawn, because a side can die before it costs anything', () => {
    const report = describeAbFailure(classifyAbParentFailure('spawned', new Error('child exited with code 2')));
    expect(report.message).toContain('provider spend and wall-clock time may already be gone');
    expect(report.message).not.toContain('wall-clock time are gone');
    // It is still certain about the two things the stage does fix.
    expect(report.message).toContain('both A/B branches were reset');
    expect(report.message).toContain('nothing of this run survives');
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

  /**
   * A child reaches this same fallback after it has run the graph, written to
   * its branch and paid providers - the child-artifact write, closing its
   * resources, assembling its evidence. The parent's line would be printed into
   * the operator's console in the middle of the loss it denies.
   */
  it('makes no cost claim for a child, which cannot know what the run cost', () => {
    const report = describeAbFailure(new Error('EBUSY writing /tmp/discovery-ab-x/a.json'), 'child');
    expect(report.exitCode).toBe(AB_EXIT_PREFLIGHT_REFUSED);
    expect(report.message).toContain('A child makes no claim about what this run cost');
    expect(report.message).toContain("the parent's exit code is the one to act on");
    for (const claim of ['nothing was spent', 'no run was spent', 'no branch was mutated', 'before anything was reset']) {
      expect(report.message).not.toContain(claim);
    }
    expect(report.message).not.toContain('EBUSY');
  });

  it('prints a gate refusal verbatim in a child too, since a refusal names only variables', () => {
    const refusal = new AbGateError('Refusing to mutate: DISCOVERY_AB_SIDE_BRANCH must be exactly eval-ab-a for side a');
    expect(describeAbFailure(refusal, 'child')).toEqual({
      exitCode: AB_EXIT_PREFLIGHT_REFUSED,
      message: refusal.message,
    });
  });

  it('classifies a thrown non-error too, rather than crashing the reporter', () => {
    expect(describeAbFailure('something went wrong').exitCode).toBe(AB_EXIT_PREFLIGHT_REFUSED);
  });
});

describe('abAttestationRefusal', () => {
  it('names what was refused and what would satisfy it, without the control-plane error', () => {
    const refusal = abAttestationRefusal('parent', { cause: new Error('status 401 for hunter2secret') });
    expect(refusal).toBeInstanceOf(AbGateError);
    expect(refusal.message).toContain('DISCOVERY_AB_TARGETS was not attested');
    expect(refusal.message).toContain('eval-ab-a, eval-ab-b');
    expect(refusal.message).toContain('eval-discovery-base');
    expect(refusal.message).not.toContain('hunter2secret');
    expect(describeAbFailure(refusal)).toEqual({ exitCode: AB_EXIT_PREFLIGHT_REFUSED, message: refusal.message });
  });

  it('claims nothing was reset or spawned only for the parent, which is the one that would know', () => {
    expect(abAttestationRefusal('parent').message).toContain('Nothing was reset and nothing was spawned.');
  });

  /**
   * A child attests after the parent has already reset both branches and
   * spawned it, so the parent's tail printed from a child is false.
   */
  it('speaks only for the side when a child refuses, since by then the parent has reset and spawned', () => {
    const message = abAttestationRefusal('child').message;
    expect(message).toContain('This side did not run');
    expect(message).toContain('reported by the parent invocation');
    expect(message).not.toContain('Nothing was reset');
    expect(message).not.toContain('nothing was spawned');
  });
});
