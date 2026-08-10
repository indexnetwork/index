import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { AB_EXIT_COMPARISON, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_EXIT_PREFLIGHT_REFUSED, AB_EXIT_SPENT_WITHOUT_ARTIFACT, AbSpentRunError, HistoricalQualitySpentRunError, abAttestationRefusal, abUsage, classifyAbParentFailure, describeAbFailure } from '../discovery.contract';
import { AbGateError } from '../discovery.gate';

const CLI_DIR = path.resolve(import.meta.dir, '..');
const BOOTSTRAP = path.resolve(CLI_DIR, 'discovery.ts');

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
    //
    // The three tolerances are what an import a linter would not flag can
    // actually look like, each of which used to slip past this guard entirely:
    // `^\s*` because leading whitespace is legal (a top-level import is not
    // required to sit in column 0), `import\s*` because the quote may follow
    // `import` with no space at all, and no trailing semicolon at all, because
    // `eslint.config.mjs` sets no `semi` rule — so `import './main'` would have
    // loaded the runtime with this test still green.
    //
    // The bare form is tried *first*, and only that ordering makes the
    // semicolon optional safely: `[^;]` spans newlines, so against an
    // unterminated `import './main'` the `from` alternative would otherwise run
    // on into the *next* statement's `from './plan'` and report that specifier
    // instead — swallowing the very import this test exists to catch. The
    // lookahead keeps the quotes in the shared tail so both alternatives share
    // one capture group, and falls through to the `from` form for everything
    // that is not a bare side-effect import.
    for (const match of source.matchAll(/^\s*(?:import\s*(?=['"])|(?:import|export)\b[^;]*?\bfrom\s+)['"]([^'"]+)['"]/gm)) {
      const specifier = match[1]!;
      if (specifier.startsWith('.')) queue.push(path.resolve(path.dirname(file), `${specifier}.ts`));
      else packages.add(specifier);
    }
  }
  return { files: [...seen], packages: [...packages] };
}

describe('the discovery bootstrap import closure', () => {
  it('still reaches nothing that can compose a database', async () => {
    const { files, packages } = await staticImportClosure(BOOTSTRAP);
    // Every static dependency is either local CLI code or a node builtin.
    expect(packages.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
    expect(packages).not.toContain('@indexnetwork/protocol');
    expect(packages.filter((specifier) => specifier.includes('drizzle'))).toEqual([]);
    expect(files.map((file) => path.basename(file))).not.toContain('discovery.main.ts');
    expect(files.map((file) => path.basename(file)).sort()).toContain('discovery.contract.ts');
  });

  it('reaches the runtime only through a dynamic import, and prints no error text', async () => {
    const source = await readFile(BOOTSTRAP, 'utf8');
    expect(source).toContain("await import('./discovery.main')");
    expect(source).not.toContain('error.message');
  });
});

describe('discovery --help', () => {
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

  it('states the manifest shape and v2 projection compatibility, so an operator can build one from the help alone', () => {
    expect(usage).toContain('DISCOVERY_TARGETS');
    expect(usage).toContain('"sideId":"a"');
    expect(usage).toContain('"baseBranchId":"br-..."');
    expect(usage).toContain('strict version-2 historical-quality manifest');
    expect(usage).toContain('projects only its two child targets');
  });

  it('states every flag', () => {
    for (const flag of ['--case', '--runs', '--a KEY=VALUE', '--b KEY=VALUE', '--report <path>', '--force']) {
      expect(usage).toContain(flag);
    }
  });

  /**
   * Naming the flag is not stating it: an operator reading `--report <path>`
   * cannot tell what a relative path resolves against, nor that the overwrite
   * consent they already know about still applies to a path they chose.
   */
  it('states what a relative --report resolves against and that overwriting it still needs --force', () => {
    expect(usage).toContain('resolved against the working directory this command');
    expect(usage).toContain('An existing file is replaced only with --force');
    expect(usage).toContain('existing directory is refused before anything runs');
  });

  it('states the reset-from-base behaviour and the no-baseline property', () => {
    expect(usage).toContain('resets the attested');
    expect(usage).toContain('eval-discovery-base');
    expect(usage).toContain('never reads, writes or compares a baseline');
  });

  it('says which branches each shape resets, since one of them costs half as much', () => {
    // The reason an operator picks --env is that it resets one branch and runs
    // one child. If the help text only described the pair, the cheaper shape
    // would be invisible.
    expect(usage).toContain('Exactly one of --env or --a/--b');
    expect(usage).toContain('--env KEY=VALUE');
    expect(usage).toContain('eval-ab-a alone with --env');
    expect(usage).toContain('Neither\nrule applies to --env');
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
    const refusal = new AbGateError('Refusing to mutate: set DISCOVERY_CONFIRM=1');
    expect(classifyAbParentFailure(null, refusal)).toBe(refusal);
    expect(describeAbFailure(classifyAbParentFailure(null, refusal))).toEqual({
      exitCode: AB_EXIT_PREFLIGHT_REFUSED,
      message: 'Refusing to mutate: set DISCOVERY_CONFIRM=1',
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
    const runPath = '/repo/eval/discovery/runs/2026-08-04T00-00-00-000Z.json';
    const report = describeAbFailure(classifyAbParentFailure('written', new Error('EBUSY: rm /tmp/discovery-x'), { artifactPath: runPath }));
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.message).toContain(runPath);
    expect(report.message).toContain('after the run artifact was written');
    expect(report.message).toContain('The artifact on disk is real');
    expect(report.message).not.toContain('nothing of this run survives');
    expect(report.message).not.toContain('No run report was written');
  });

  /**
   * `runAbChild` writes its output and exits 0 even when every slot failed, so
   * both sides can complete with `runs: 0` everywhere and the artifact still be
   * written. Attempts were certainly made; a paid run is not something this
   * stage can assert, so it hedges like every other stage.
   */
  it('hedges the spend at the written stage, since both sides can complete having scored nothing', () => {
    const report = describeAbFailure(classifyAbParentFailure('written', new Error('EBUSY'), { artifactPath: '/repo/runs/x.json' }));
    expect(report.message).toContain('a live run may have been spent');
    expect(report.message).not.toContain('a live run was spent');
  });

  it('still reports the written stage honestly when no path was recorded', () => {
    const message = new AbSpentRunError('written').message;
    expect(message).toContain('after the run artifact was written:');
    expect(message).not.toContain('undefined');
  });

  it('reports a failure after a side was spawned as a spend with no run report and no verdict', () => {
    const classified = classifyAbParentFailure('spawned', new Error('child died'));
    const report = describeAbFailure(classified);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.exitCode).not.toBe(AB_EXIT_PREFLIGHT_REFUSED);
    expect(report.message).toContain('after spawning a side');
    expect(report.message).toContain('No run report was written');
    expect(report.message).toContain('there is no verdict');
  });

  /**
   * Both sides run in parallel, so side a can finish and write its child
   * artifact while side b times out. The parent's `finally` then calls
   * `finalizeAbChildArtifacts(dir, false)`, which retains that directory and
   * prints what is in it - and this message is printed immediately after it.
   * "Nothing of this run survives" would deny, in the same console, the scored
   * slots the harness had just named.
   */
  it('does not deny the child artifacts a failed run keeps, which the harness itself has just named', () => {
    const report = describeAbFailure(classifyAbParentFailure('spawned', new Error('child b timed out')));
    expect(report.message).not.toContain('nothing of this run survives');
    expect(report.message).not.toContain('No artifact was written');
    expect(report.message).toContain('any child artifact this run kept is named above');
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
    expect(report.message).toContain('the A/B branches (eval-ab-a, eval-ab-b) were reset');
    expect(report.message).toContain('there is no verdict');
  });

  it('names one branch and one child after a single run, because two would be false', () => {
    // A single run never opens eval-ab-b. Reporting "both A/B branches were
    // reset" would send an operator to inspect a branch this run did not touch,
    // and would double the spend they think they lost.
    const report = describeAbFailure(
      classifyAbParentFailure('spawned', new Error('child exited with code 2'), { shape: 'single' }),
    );
    expect(report.message).toContain('the A/B branch eval-ab-a was reset');
    expect(report.message).not.toContain('eval-ab-b');
    expect(report.message).not.toContain('both');
    expect(report.message).toContain('pays for the whole run again');
  });

  it('assumes a pair when the shape is unknown, overstating rather than understating', () => {
    // The default has to fail in the safe direction: claiming more was touched
    // sends an operator to check a clean branch, where the reverse would tell
    // them a dirty branch was untouched.
    const unknown = classifyAbParentFailure('reset', new Error('boom')) as AbSpentRunError;
    expect(unknown.shape).toBe('pair');
    expect(unknown.message).toContain('eval-ab-b');
  });

  it('reports every stage truthfully for a single run', () => {
    // Each stage authors its own sentence, so each needs its own check: a stage
    // that forgot the shape would claim two branches at exactly the moment an
    // operator is deciding what to go and clean up.
    for (const stage of ['resetting', 'reset', 'spawned', 'written'] as const) {
      const message = (classifyAbParentFailure(stage, new Error('boom'), { shape: 'single' }) as AbSpentRunError).message;
      expect(message, `${stage} names eval-ab-b`).not.toContain('eval-ab-b');
      expect(message, `${stage} claims both branches`).not.toContain('both branches');
      expect(message, `${stage} omits the branch it did touch`).toContain('eval-ab-a');
    }
  });

  it('keeps the original failure as a cause without ever printing it', () => {
    const cause = new Error('postgresql://user:hunter2secret@ep-a.neon.tech/protocol_eval refused');
    const classified = classifyAbParentFailure('spawned', cause) as AbSpentRunError;
    expect(classified.cause).toBe(cause);
    expect(classified.stage).toBe('spawned');
    expect(describeAbFailure(classified).message).not.toContain('hunter2secret');
  });

  it('reports historical primary and artifact-write failures as separate opaque classes at exit 4', () => {
    const cause = new Error('Authorization: Bearer raw-secret');
    const failure = new HistoricalQualitySpentRunError(
      'spawned',
      'supervisor-timeout',
      'artifact-write-failure',
      { shape: 'single', cause },
    );
    const report = describeAbFailure(failure);
    expect(report.exitCode).toBe(AB_EXIT_SPENT_WITHOUT_ARTIFACT);
    expect(report.message).toContain('supervisor-timeout');
    expect(report.message).toContain('artifact-write-failure');
    expect(report.message).not.toContain('raw-secret');
    expect(failure.cause).toBe(cause);
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
    const report = describeAbFailure(new Error('EBUSY writing /tmp/discovery-x/a.json'), 'child');
    expect(report.exitCode).toBe(AB_EXIT_PREFLIGHT_REFUSED);
    expect(report.message).toContain('A child makes no claim about what this run cost');
    expect(report.message).toContain("the parent's exit code is the one to act on");
    for (const claim of ['nothing was spent', 'no run was spent', 'no branch was mutated', 'before anything was reset']) {
      expect(report.message).not.toContain(claim);
    }
    expect(report.message).not.toContain('EBUSY');
  });

  it('prints a gate refusal verbatim in a child too, since a refusal names only variables', () => {
    const refusal = new AbGateError('Refusing to mutate: DISCOVERY_SIDE_BRANCH must be exactly eval-ab-a for side a');
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
    expect(refusal.message).toContain('DISCOVERY_TARGETS was not attested');
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
