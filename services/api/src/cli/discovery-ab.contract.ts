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
 * 2 — for a *parent* run: refused before anything happened — the gate, the
 * arguments, the manifest or the attestation. No branch was reset, no child was
 * spawned, no provider call was made. Conclude: fix what the message names and
 * re-run; you have lost nothing but the seconds it took to refuse.
 *
 * A `--side` child also exits 2 for failures that are *not* pre-flight, because
 * a child cannot know what the run as a whole cost — it did not reset the
 * branches and did not start the other side. That is why a child's message
 * makes no cost claim and why its exit code is consumed by the parent's
 * supervision rather than read by an operator.
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
 * 4 — failed *after* the branches began being reset and/or a side was spawned.
 * Conclude: this run mutated the A/B branches and may have spent a live run
 * (provider calls, graph writes, wall-clock hours). Usually nothing of it
 * survives and re-running costs that again; the one exception is a failure that
 * lands *after* the run report was saved, whose message names the artifact on
 * disk. The code stays 4 there because the run did not complete — what the
 * message says, not the code, is what tells an operator whether anything
 * survived. This is the code that keeps a forty-minute loss from looking like a
 * refusal.
 */
export const AB_EXIT_SPENT_WITHOUT_ARTIFACT = 4;

/**
 * How far a parent run got before it failed. `null` — the fifth case — is
 * pre-flight, and is deliberately not a member: it is the absence of any
 * mutation, not a stage of one.
 *
 * `'resetting'` and `'reset'` are separate stages because the difference
 * between them is a claim the operator cannot check: inside the loop, one
 * branch may have been overwritten and the other never touched, and a refused
 * restore is the most likely post-attestation failure there is. Only the
 * completed loop licenses "both branches were overwritten".
 */
export type AbRunStage = 'resetting' | 'reset' | 'spawned' | 'written';

/**
 * What a failure at each stage may truthfully assert.
 *
 * Every clause here has to hold in *every* situation that can reach it. Where
 * the stage cannot distinguish two situations — a restore that failed on side a
 * versus one that failed on side b — the message hedges rather than reporting
 * the common case as fact.
 */
function abSpentMessage(stage: AbRunStage, artifactPath?: string): string {
  switch (stage) {
    case 'resetting':
      return `Discovery A/B failed while resetting the A/B branches (${AB_BRANCH_NAMES.a}, ${AB_BRANCH_NAMES.b}) `
        + `from ${AB_BASE_BRANCH}: one or both branches may have been overwritten — the reset was still in `
        + 'progress, so this run cannot say which. No side was spawned, no run was spent, and no artifact was '
        + 'written. Treat both branches as dirty; the next run resets them again.';
    case 'reset':
      return `Discovery A/B failed after resetting the A/B branches (${AB_BRANCH_NAMES.a}, ${AB_BRANCH_NAMES.b}) `
        + `from ${AB_BASE_BRANCH} and before spawning any side: both branches were overwritten, no run was spent, `
        + 'and no artifact was written.';
    case 'spawned':
      // "may already be gone", not "are gone": the stage is set the moment a
      // side process exists, and a side that died at its own gate spent
      // nothing. What it did spend is bounded only by how far it got, which
      // this process cannot see.
      return 'Discovery A/B failed after spawning a side: both A/B branches were reset and at least one side '
        + 'process was started, so provider spend and wall-clock time may already be gone. No artifact was '
        + 'written and there is no verdict — nothing of this run survives, and re-running pays for the whole '
        + 'comparison again.';
    case 'written':
      return 'Discovery A/B failed after the run artifact was written'
        + `${artifactPath === undefined ? '' : ` (${artifactPath})`}: both A/B branches were reset and a live run `
        + 'was spent, and the failure came after the artifact was saved. The artifact on disk is real — read it '
        + 'before re-running, which costs the same again.';
  }
}

/** What a spend report knows beyond the stage. */
export interface AbSpentRunDetail {
  /** The run report's path, known only once it has been written. */
  artifactPath?: string;
}

/**
 * A failure that happened after this run began mutating or spending.
 *
 * Its message is authored here from the stage (and, at `'written'`, the path
 * this harness itself chose) and never from the underlying error, which may
 * carry a `DATABASE_URL` password or a control-plane response body. The
 * original is kept as `cause` for anyone holding the error rather than printing
 * it.
 */
export class AbSpentRunError extends Error {
  readonly stage: AbRunStage;
  readonly artifactPath?: string;

  constructor(stage: AbRunStage, options?: ErrorOptions & AbSpentRunDetail) {
    super(abSpentMessage(stage, options?.artifactPath), options);
    this.name = 'AbSpentRunError';
    this.stage = stage;
    if (options?.artifactPath !== undefined) this.artifactPath = options.artifactPath;
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
export function classifyAbParentFailure(stage: AbRunStage | null, error: unknown, detail?: AbSpentRunDetail): unknown {
  return stage === null ? error : new AbSpentRunError(stage, { cause: error, ...detail });
}

export interface AbFailureReport { exitCode: number; message: string }

/**
 * Which invocation is reporting. A parent owns the run-level cost report; a
 * child owns nothing but its own outcome.
 */
export type AbInvocationRole = 'parent' | 'child';

/**
 * What to print and what to exit with, for any failure reaching the bootstrap.
 *
 * Only messages authored in this codebase are printed. Gate refusals name
 * environment variables; spend reports name stages. Everything else prints a
 * fixed line, because provider, database and control-plane errors can carry
 * credentials and response bodies.
 *
 * The fixed line depends on who is printing it. In a parent, an unclassified
 * failure really did escape before the first reset — `withAbSpendAccounting`
 * wraps everything after it — so "nothing was mutated or spent" is true. In a
 * `--side` child it is not: a child runs the graph, writes to its branch and
 * pays providers, and any failure after that (the child-artifact write, closing
 * its resources, assembling its evidence) reaches this same fallback. So a
 * child says only that it failed, and leaves every cost claim to the parent,
 * which is the process that knows.
 */
export function describeAbFailure(error: unknown, role: AbInvocationRole = 'parent'): AbFailureReport {
  if (error instanceof AbSpentRunError) {
    return { exitCode: AB_EXIT_SPENT_WITHOUT_ARTIFACT, message: error.message };
  }
  if (error instanceof AbGateError) {
    return { exitCode: AB_EXIT_PREFLIGHT_REFUSED, message: error.message };
  }
  return {
    exitCode: AB_EXIT_PREFLIGHT_REFUSED,
    message: role === 'child'
      ? 'Discovery A/B side process failed. A child makes no claim about what this run cost: whether the '
        + 'branches were reset, a side was spawned or a live run was spent is reported by the parent '
        + "invocation, and the parent's exit code is the one to act on."
      : 'Discovery A/B command failed before anything was reset or spawned: '
        + 'no branch was mutated and no run was spent.',
  };
}

/**
 * The refusal printed when the two targets cannot be attested, authored for
 * whichever invocation is refusing.
 *
 * The same attestation runs in the parent and in every child, and the two are
 * at different points in the run. "Nothing was reset and nothing was spawned"
 * is true of a parent refusing before its first reset; a child attests *after*
 * the parent has already reset both branches and spawned it, so the same
 * sentence printed from a child is simply false. A child speaks only for
 * itself.
 *
 * The underlying control-plane error is never included: it reaches the caller
 * through `response.json()`, whose parse failures can quote response text. It
 * is kept as `cause` for anyone holding the error rather than printing it.
 */
export function abAttestationRefusal(role: AbInvocationRole, options?: ErrorOptions): AbGateError {
  return new AbGateError(
    'Refusing to run: DISCOVERY_AB_TARGETS was not attested as the two designated A/B branches '
    + `(${AB_BRANCH_NAMES.a}, ${AB_BRANCH_NAMES.b}) parented on ${AB_BASE_BRANCH}. `
    + (role === 'child'
      ? 'This side did not run; what the run reset or spawned is reported by the parent invocation.'
      : 'Nothing was reset and nothing was spawned.'),
    options,
  );
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
    'Exit codes, for the parent invocation an operator runs (a --side child\'s code',
    "is consumed by the parent's supervision, which reports the run-level code):",
    `  ${AB_EXIT_COMPARISON}   Both sides completed; the artifact holds the comparison.`,
    `  ${AB_EXIT_PREFLIGHT_REFUSED}   Refused before anything ran (gate, arguments, manifest, attestation).`,
    '      Nothing was reset, nothing was spawned, nothing was spent.',
    `  ${AB_EXIT_INSUFFICIENT_EVIDENCE}   The artifact was written but a side did not score every slot, so there is no`,
    '      verdict. The run was spent and the artifact on disk is real.',
    `  ${AB_EXIT_SPENT_WITHOUT_ARTIFACT}   Failed after the branches began being reset and/or a side was spawned. The`,
    '      branches were mutated and a live run may have been spent; the message says what',
    '      was overwritten and whether an artifact survived.',
  ].join('\n');
}
