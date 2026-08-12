/**
 * The discovery harness's operator-facing contract: what the command
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
 *    process exit code and cannot import `discovery.main.ts` (that module
 *    reaches `@indexnetwork/protocol` on its first import), so the codes and
 *    the classification that picks between them have to live somewhere both
 *    halves can reach.
 *
 * The codes below describe a *parent* invocation, which is the one an operator
 * runs. A `--side` child's exit code is consumed by the parent's supervision,
 * which then reports the run-level code for the whole comparison.
 */
import { AB_BRANCH_NAMES } from './discovery.neon';
import { AbGateError } from './discovery.gate';

/** The protected branch this run's target branches are reset from before every run. */
export const AB_BASE_BRANCH = 'eval-discovery-base';
/** Three repetitions per side; one observation per case cannot separate a difference from noise. */
export const AB_DEFAULT_REPETITIONS = 3;
/**
 * A ceiling on `--runs`, because a mistyped one costs real money and hours: at
 * the observed ~52s per invocation, ten repetitions over the full five-case
 * corpus is already 100 graph invocations (5 cases x 10 repetitions x 2 sides).
 * Nothing above this is a considered choice.
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
 * 2 — the dedicated historical-quality request is safely refused in PR A
 * before confirmation, manifest parsing, attestation, provider access, or any
 * runtime import. This names the PR A execution refusal without changing the
 * legacy pre-flight meaning of the same process exit code.
 */
export const HISTORICAL_QUALITY_EXIT_PR_A_REFUSAL = 2;
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
 * (provider calls, graph writes, wall-clock hours). Re-running costs that again,
 * and what (if anything) survived is named by the message: the run report, when
 * the failure landed *after* it was saved, or the child artifacts a failed run
 * kept. The code stays 4 in both cases because the run did not complete — what
 * the message says, not the code, is what tells an operator whether anything
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
 * The branches a run of this shape resets, named for a message.
 *
 * A single run touches only `eval-ab-a`. Saying "the A/B branches
 * (eval-ab-a, eval-ab-b)" after a single run would send an operator to check a
 * branch this run never opened, and would overstate the damage of a failure —
 * the exact class of false claim these messages exist to avoid.
 */
function abBranchPhrase(shape: AbRunShape): string {
  return shape === 'single'
    ? `the A/B branch ${AB_BRANCH_NAMES.a}`
    : `the A/B branches (${AB_BRANCH_NAMES.a}, ${AB_BRANCH_NAMES.b})`;
}

/**
 * What a failure at each stage may truthfully assert.
 *
 * Every clause here has to hold in *every* situation that can reach it. Where
 * the stage cannot distinguish two situations — a restore that failed on side a
 * versus one that failed on side b — the message hedges rather than reporting
 * the common case as fact.
 *
 * The shape is threaded through for the same reason: a single run resets one
 * branch and spawns one child, so every plural claim below would be false for
 * it.
 */
function abSpentMessage(stage: AbRunStage, shape: AbRunShape, artifactPath?: string): string {
  const branches = abBranchPhrase(shape);
  const single = shape === 'single';
  switch (stage) {
    case 'resetting':
      return `Discovery failed while resetting ${branches} `
        + `from ${AB_BASE_BRANCH}: ${single ? 'the branch' : 'one or both branches'} may have been overwritten — `
        + 'the reset was still in progress, so this run cannot say '
        + `${single ? 'whether it completed' : 'which'}. No side was spawned, no run was spent, and no artifact was `
        + `written. Treat ${single ? 'the branch' : 'both branches'} as dirty; the next run resets `
        + `${single ? 'it' : 'them'} again.`;
    case 'reset':
      return `Discovery failed after resetting ${branches} `
        + `from ${AB_BASE_BRANCH} and before spawning any side: `
        + `${single ? 'the branch was' : 'both branches were'} overwritten, no run was spent, `
        + 'and no artifact was written.';
    case 'spawned':
      // "may already be gone", not "are gone": the stage is set the moment a
      // side process exists, and a side that died at its own gate spent
      // nothing. What it did spend is bounded only by how far it got, which
      // this process cannot see.
      //
      // And it cannot say nothing survived. One side can finish and write its
      // child artifact while the other times out, and
      // `finalizeAbChildArtifacts` — which runs in the parent's `finally`,
      // before this message is printed — keeps that directory and names what is
      // in it precisely so the scored slots can be read. What is certainly lost
      // is the run report and the verdict, so that is what this says.
      return `Discovery failed after spawning a side: ${branches} `
        + `${single ? 'was' : 'were'} reset and ${single ? 'the side process was' : 'at least one side process was'} `
        + 'started, so provider spend and wall-clock time may already be gone. No run report was '
        + 'written and there is no verdict — any child artifact this run kept is named above — and re-running '
        + `pays for the whole ${single ? 'run' : 'comparison'} again.`;
    case 'written':
      // "may have been spent", like every other stage: a child writes its output
      // and exits 0 even when every one of its slots failed, so both sides can
      // complete with nothing scored. Attempts were certainly made; a paid run
      // is not something this stage can assert.
      return 'Discovery failed after the run artifact was written'
        + `${artifactPath === undefined ? '' : ` (${artifactPath})`}: ${branches} `
        + `${single ? 'was' : 'were'} reset and a live run `
        + 'may have been spent, and the failure came after the artifact was saved. The artifact on disk is real — '
        + 'read it before re-running, which costs the same again.';
  }
}

/**
 * Whether this run measures one configuration or compares two.
 *
 * Known before the first reset and carried into every cost message, because
 * "both branches were reset" is the sort of claim an operator acts on — by
 * going to look at a branch, or by assuming twice the spend.
 */
export type AbRunShape = 'single' | 'pair';

/** What a spend report knows beyond the stage. */
export interface AbSpentRunDetail {
  /** The run report's path, known only once it has been written. */
  artifactPath?: string;
  /** How many branches and children the failed run involved. Defaults to a pair. */
  shape?: AbRunShape;
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
  readonly shape: AbRunShape;
  readonly artifactPath?: string;

  constructor(stage: AbRunStage, options?: ErrorOptions & AbSpentRunDetail) {
    // A pair is the safe default for an unknown shape: it claims *more* was
    // touched than may have been, which sends an operator to check a clean
    // branch. The reverse default would tell them a dirty branch was untouched.
    const shape: AbRunShape = options?.shape ?? 'pair';
    super(abSpentMessage(stage, shape, options?.artifactPath), options);
    this.name = 'AbSpentRunError';
    this.stage = stage;
    this.shape = shape;
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
      ? 'Discovery side process failed. A child makes no claim about what this run cost: whether the '
        + 'branches were reset, a side was spawned or a live run was spent is reported by the parent '
        + "invocation, and the parent's exit code is the one to act on."
      : 'Discovery command failed before anything was reset or spawned: '
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
 * the parent has already reset this run's target branches and spawned it, so the same
 * sentence printed from a child is simply false. A child speaks only for
 * itself.
 *
 * The underlying control-plane error is never included: it reaches the caller
 * through `response.json()`, whose parse failures can quote response text. It
 * is kept as `cause` for anyone holding the error rather than printing it.
 */
export function abAttestationRefusal(role: AbInvocationRole, options?: ErrorOptions): AbGateError {
  return new AbGateError(
    'Refusing to run: DISCOVERY_TARGETS was not attested as the two designated A/B branches '
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
    'Discovery eval',
    '',
    'Runs the real discovery graph under one operator-chosen environment',
    'configuration, or under two over the same cases for a comparison. It',
    'never reads, writes or compares a baseline: arbitrary configurations have',
    'none, so the scorecard (or the pair) is the result.',
    '',
    'Required operator attestation:',
    '  DISCOVERY_CONFIRM=1',
    '  TEST_DATABASE_SAFE=1',
    '  NEON_API_KEY=<neon api key>',
    `  DISCOVERY_TARGETS='${manifest}'`,
    '',
    'This command never creates or deletes Neon branches. It resets the attested',
    `branch of every side it runs from ${AB_BASE_BRANCH} before it spawns anything:`,
    `${AB_BRANCH_NAMES.a} alone with --env, and both (${AB_BRANCH_NAMES.a}, ${AB_BRANCH_NAMES.b}) with --a/--b.`,
    '',
    'Exactly one of --env or --a/--b. Selection is shared by both sides;',
    'configuration is not:',
    '  --case <id>       Restrict to one case. Repeatable. Default: the full corpus.',
    `  --runs <n>        Repetitions per side (default ${AB_DEFAULT_REPETITIONS}, maximum ${AB_MAX_REPETITIONS}).`,
    '  --env KEY=VALUE   A flag for a single-configuration run. Repeatable.',
    '  --a KEY=VALUE     A flag for side a of a comparison. Repeatable.',
    '  --b KEY=VALUE     A flag for side b of a comparison. Repeatable.',
    '  --report <path>   Write the run artifact here. Given at most once. A relative',
    '                    path is resolved against the working directory this command',
    '                    was invoked from, not against eval/discovery/runs.',
    '                    An existing file is replaced only with --force, and an',
    '                    existing directory is refused before anything runs.',
    '                    Default: a timestamped file under eval/discovery/runs.',
    '  --force           Consent to replacing an existing run artifact.',
    '',
    'A comparison requires both sides to state the same keys with differing values;',
    'identical or asymmetric configurations are refused before any spend. Neither',
    'rule applies to --env, which has no second side to differ from.',
    '',
    'Exit codes, for the parent invocation an operator runs (a --side child\'s code',
    "is consumed by the parent's supervision, which reports the run-level code):",
    `  ${AB_EXIT_COMPARISON}   Every side completed; the artifact holds the scorecard or the comparison.`,
    `  ${AB_EXIT_PREFLIGHT_REFUSED}   Refused before anything ran (gate, arguments, manifest, attestation).`,
    '      Nothing was reset, nothing was spawned, nothing was spent.',
    `  ${AB_EXIT_INSUFFICIENT_EVIDENCE}   The artifact was written but a side did not score every slot, so there is no`,
    '      verdict. The run was spent and the artifact on disk is real.',
    `  ${AB_EXIT_SPENT_WITHOUT_ARTIFACT}   Failed after a branch began being reset and/or a side was spawned. The`,
    '      branch or branches this run uses were mutated and a live run may have been spent;',
    '      the message names what was overwritten and whether an artifact survived.',
  ].join('\n');
}
