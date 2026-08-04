/**
 * The discovery A/B harness's operator-facing contract: what the command
 * promises, and what each of its exit codes means.
 *
 * It lives in its own dependency-free module for two reasons, both of them
 * about what an operator can find out and when.
 *
 * 1. **`--help` must be readable without credentials.** The bootstrap refuses
 *    to run without an attested manifest, a Neon key and two confirm variables
 *    — which is exactly what the help text exists to explain. A help text that
 *    could only be printed by someone who already had all of it would be
 *    useless. So the contract lives above the gate, in a module that imports
 *    nothing that can compose a database: the bootstrap prints it before it
 *    reads a single environment variable, and its "attest before importing the
 *    runtime" ordering is untouched.
 * 2. **The exit codes must be visible in one place.** The bootstrap decides the
 *    process exit code and cannot import `discovery-ab.main.ts` (that module
 *    reaches `@indexnetwork/protocol` on its first import), so the codes and
 *    the classification that picks between them have to live somewhere both
 *    halves can reach.
 *
 * The codes below describe a *parent* invocation, which is the one an operator
 * runs. A `--side` child's exit code is consumed by the parent's supervision,
 * which then reports the run-level code for the whole comparison.
 */
import { AB_BRANCH_NAMES } from './discovery-ab.neon';
import { AbGateError } from './discovery-ab.gate';

/** The protected branch both A/B branches are reset from before every run. */
export const AB_BASE_BRANCH = 'eval-discovery-base';
/** Three repetitions per side; one observation per case cannot separate a difference from noise. */
export const AB_DEFAULT_REPETITIONS = 3;
/**
 * A ceiling on `--runs`, because a mistyped one costs real money and hours: at
 * the observed ~52s per invocation, ten repetitions over the full corpus is
 * already 300 graph invocations. Nothing above this is a considered choice.
 */
export const AB_MAX_REPETITIONS = 10;

// ── Exit codes ──────────────────────────────────────────────────────────────
// Four codes, and the operator conclusion each one licenses. The distinction
// that matters most is between 2 and 4: both are failures, but one costs
// nothing and the other costs a live run.

/** 0 — both sides completed and the artifact holds the comparison. */
export const AB_EXIT_COMPARISON = 0;
/**
 * 2 — refused before anything happened: the gate, the arguments, the manifest
 * or the attestation. No branch was reset, no child was spawned, no provider
 * call was made. Conclude: fix what the message names and re-run; you have lost
 * nothing but the seconds it took to refuse.
 */
export const AB_EXIT_PREFLIGHT_REFUSED = 2;
/**
 * 3 — the run finished and the artifact was written, but at least one side did
 * not score every slot it was planned, so there is **no verdict**. Matches
 * `EVAL_EXIT_INSUFFICIENT_EVIDENCE` in the shared eval CLI; restated rather
 * than imported because this package reaches the eval bundle only through the
 * dynamic `loadMatrixEval` seam. Conclude: the run happened and was paid for,
 * the artifact on disk is real, and it does not support a comparison.
 */
export const AB_EXIT_INSUFFICIENT_EVIDENCE = 3;
/**
 * 4 — failed *after* the branches were reset and/or a side was spawned, and no
 * artifact exists. Conclude: this run mutated the A/B branches and may have
 * spent a live run (provider calls, graph writes, wall-clock hours) and nothing
 * of it survives. Re-running costs that again. This is the code that keeps a
 * forty-minute loss from looking like a refusal.
 */
export const AB_EXIT_SPENT_WITHOUT_ARTIFACT = 4;

/**
 * How far a parent run got before it failed. `null` — the third case — is
 * pre-flight, and is deliberately not a member: it is the absence of any
 * mutation, not a stage of one.
 */
export type AbRunStage = 'reset' | 'spawned';

const AB_SPENT_MESSAGES: Record<AbRunStage, string> = {
  reset: `Discovery A/B failed after resetting the A/B branches (${AB_BRANCH_NAMES.a}, ${AB_BRANCH_NAMES.b}) `
    + `from ${AB_BASE_BRANCH} and before spawning any side: both branches were overwritten, no run was spent, `
    + 'and no artifact was written.',
  spawned: 'Discovery A/B failed after spawning a side: both A/B branches were reset and a live run was started, '
    + 'so provider spend and wall-clock time are gone. No artifact was written and there is no verdict — '
    + 'nothing of this run survives, and re-running costs the same again.',
};

/**
 * A failure that happened after this run began mutating or spending.
 *
 * Its message is authored here from the stage alone and never from the
 * underlying error, which may carry a `DATABASE_URL` password or a
 * control-plane response body. The original is kept as `cause` for anyone
 * holding the error rather than printing it.
 */
export class AbSpentRunError extends Error {
  readonly stage: AbRunStage;

  constructor(stage: AbRunStage, options?: ErrorOptions) {
    super(AB_SPENT_MESSAGES[stage], options);
    this.name = 'AbSpentRunError';
    this.stage = stage;
  }
}

/**
 * Classifies a parent failure by how far the run got, so the two halves of the
 * old catch-all can be told apart.
 *
 * A pre-flight failure is returned untouched: its own message (a gate refusal,
 * a bad argument, an unparseable manifest) is what the operator needs, and it
 * costs nothing. Anything after the first reset is rewritten into an
 * `AbSpentRunError`, because the one thing the operator cannot work out from a
 * generic failure is whether they just paid for it.
 */
export function classifyAbParentFailure(stage: AbRunStage | null, error: unknown): unknown {
  return stage === null ? error : new AbSpentRunError(stage, { cause: error });
}

export interface AbFailureReport { exitCode: number; message: string }

/**
 * What to print and what to exit with, for any failure reaching the bootstrap.
 *
 * Only messages authored in this codebase are printed. Gate refusals name
 * environment variables; spend reports name stages. Everything else prints a
 * fixed line, because provider, database and control-plane errors can carry
 * credentials and response bodies.
 */
export function describeAbFailure(error: unknown): AbFailureReport {
  if (error instanceof AbSpentRunError) {
    return { exitCode: AB_EXIT_SPENT_WITHOUT_ARTIFACT, message: error.message };
  }
  if (error instanceof AbGateError) {
    return { exitCode: AB_EXIT_PREFLIGHT_REFUSED, message: error.message };
  }
  return {
    exitCode: AB_EXIT_PREFLIGHT_REFUSED,
    message: 'Discovery A/B command failed before anything was reset or spawned: '
      + 'no branch was mutated and no run was spent.',
  };
}

/**
 * The full contract, printable with no environment, no credentials and no
 * manifest — see this module's header for why that is the whole point.
 */
export function abUsage(): string {
  const manifest = '{"projectId":"...","baseBranchId":"br-...","targets":[{"sideId":"a","branchId":"br-...","endpointId":"ep-...","databaseUrl":"postgres://...neon.tech/protocol_eval"}, ...]}';
  return [
    'Discovery A/B eval',
    '',
    'Runs the real discovery graph twice - once per operator-chosen environment',
    'configuration - over the same cases, and emits one artifact holding both sides.',
    'It never reads, writes or compares a baseline: arbitrary configurations have',
    'none, so the pair is the result.',
    '',
    'Required operator attestation:',
    '  DISCOVERY_AB_CONFIRM=1',
    '  TEST_DATABASE_SAFE=1',
    '  NEON_API_KEY=<neon api key>',
    `  DISCOVERY_AB_TARGETS='${manifest}'`,
    '',
    'This command never creates or deletes Neon branches. It resets both attested',
    `A/B branches (${AB_BRANCH_NAMES.a}, ${AB_BRANCH_NAMES.b}) from ${AB_BASE_BRANCH} before it spawns anything.`,
    '',
    'Selection is shared by both sides; configuration is not:',
    '  --case <id>       Restrict to one case. Repeatable. Default: the full corpus.',
    `  --runs <n>        Repetitions per side (default ${AB_DEFAULT_REPETITIONS}, maximum ${AB_MAX_REPETITIONS}).`,
    '  --a KEY=VALUE     A flag for side a. Repeatable.',
    '  --b KEY=VALUE     A flag for side b. Repeatable.',
    '  --force           Consent to replacing an existing run artifact.',
    '',
    'Both sides must state the same keys with differing values; identical or',
    'asymmetric configurations are refused before any spend.',
    '',
    'Exit codes:',
    `  ${AB_EXIT_COMPARISON}   Both sides completed; the artifact holds the comparison.`,
    `  ${AB_EXIT_PREFLIGHT_REFUSED}   Refused before anything ran (gate, arguments, manifest, attestation).`,
    '      Nothing was reset, nothing was spawned, nothing was spent.',
    `  ${AB_EXIT_INSUFFICIENT_EVIDENCE}   The artifact was written but a side did not score every slot, so there is no`,
    '      verdict. The run was spent and the artifact on disk is real.',
    `  ${AB_EXIT_SPENT_WITHOUT_ARTIFACT}   Failed after the branches were reset and/or a side was spawned, and no artifact`,
    '      was written. The branches were mutated and a live run may have been spent.',
  ].join('\n');
}
