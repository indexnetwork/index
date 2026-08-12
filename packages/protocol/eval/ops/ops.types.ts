/**
 * Every harness the site can launch.
 *
 * The first four emit the shared scorecard artifact envelope and are scored
 * against a committed baseline. `discovery` emits the same envelope but has
 * no baseline and never will: it measures operator-chosen environment
 * configurations — one on its own, or two against each other when launched with
 * `sides` — and arbitrary configurations have nothing to be a baseline of.
 */
export type OpsHarness = "matching" | "profile" | "premise" | "opportunity" | "discovery";

export type HarnessFlagName =
  | "runs"
  | "case"
  | "rule"
  | "tier"
  | "noJudge"
  | "alpha"
  | "attemptTimeoutMs"
  | "strictEvidence";

/**
 * One end of what a flag value may be, and who refuses a value past it.
 *
 * `heldBy` is not decoration: it decides what the refusal is allowed to SAY.
 * `"harness"` means the engine's own parser refuses the value (matching's
 * `alpha <= 0 || alpha >= 1`, discovery's `--runs must not exceed 10`), so a
 * refusal may tell the operator the harness itself would refuse it. `"site"`
 * means only this site refuses it — RunFlagsSchema's shared ceiling, e.g.
 * `--runs 26`, which every scorecard harness would happily run — so the refusal
 * says the site refuses it and claims nothing about the harness. A message that
 * attributed a site bound to the harness would be false, and an operator who
 * checked would find the harness contradicting it.
 */
export interface FlagBound {
  value: number;
  /** True when the bound itself is refused, as in the engines' `0 < alpha < 1`. */
  exclusive?: boolean;
  heldBy: "harness" | "site";
}

export interface HarnessFlag {
  name: HarnessFlagName;
  /** The literal CLI flag, e.g. "--runs". */
  cli: string;
  kind: "number" | "string" | "boolean";
  /**
   * CONTROL bounds: what the launch form puts on the input's min/max/step. They
   * are inclusive and expressed at `step` resolution because HTML demands both,
   * so they can be NARROWER than what the API accepts — `--alpha` is offered as
   * 0.001..0.999 at step 0.001 while every engine accepts any 0 < alpha < 1.
   *
   * They are not an authority, and nothing refuses a value for being outside
   * them: a control that cannot express a legal value must not make it illegal.
   * `accepts` below is the authority. Control bounds must always be inside it —
   * an input offering a value the API refuses is a bug, pinned by registry.spec.ts.
   */
  min?: number;
  max?: number;
  step?: number;
  /**
   * What the API accepts for this flag on THIS harness, and who holds each end.
   * `RunSpecSchema` enforces it per harness (flagValueIssues, ops.flags.ts) and
   * the launch form refuses the same values from the same function, so the form
   * cannot mark an API-valid value invalid nor offer one the API would refuse.
   *
   * Per harness, because the harnesses do not agree: discovery caps `--runs`
   * at AB_MAX_REPETITIONS (10) where the scorecard harnesses have no ceiling of
   * their own at all and only the site's 25 applies.
   *
   * Absent means the control bounds are also the API bounds, held by the site —
   * the safe default, since a refusal from `flagValueIssues` IS the site
   * refusing. Every numeric flag in HARNESS_REGISTRY declares it explicitly.
   */
  accepts?: { min?: FlagBound; max?: FlagBound };
}

export interface HarnessDescriptor {
  harness: OpsHarness;
  /** Package script name, e.g. "eval:matching". Resolved in `cwd`. */
  script: string;
  /**
   * Repository-relative directory the script is run from. Absent means
   * packages/protocol, where every scorecard harness lives; discovery
   * declares "services/api" because its CLI and script live there.
   */
  cwd?: string;
  flags: readonly HarnessFlag[];
  defaultRuns: number;
  /** Corpus size, used to show workload (cases x runs) before launching. */
  caseCount: number;
  /**
   * The question this harness answers, phrased for a reader who did not write it.
   * Shown wherever the site names the harness, so the four names are never the
   * only explanation on the page.
   */
  question: string;
  /** One sentence on what is actually scored, shown under `question` for context. */
  detail: string;
  /**
   * What a run of this harness DESTROYS, named as a noun phrase, and shown in
   * the launch form's confirmation because that is the last moment anyone can
   * decline it.
   *
   * Sourced here rather than written into the form, because the form branches on
   * SUPPORTS_SIDES rather than on a harness name: a second comparison harness
   * would otherwise inherit this one's claim about Neon, which may not be true
   * of it. Absent means a run destroys nothing outside its own report, which is
   * the case for every scorecard harness, and the confirmation then speaks only
   * of the spend.
   *
   * Keyed by the run's SHAPE, because for a sides-capable harness the two shapes
   * destroy different things: a comparison resets both Neon branches, a single
   * run resets only the one it reads (discovery.main.ts filters `attested`
   * targets to the sides being run). A single string here was quoted verbatim
   * into the confirmation and told an operator launching one configuration that
   * both branches would be reset — the same false claim the engine's own contract
   * was rewritten to eliminate. The launch form reads the shape's own entry
   * (`resets.sides` or `resets.single`) rather than one string for both.
   */
  resets?: HarnessResets;
  /** Model-overridable agents this harness exercises, in pipeline order. */
  agents: readonly string[];
}

/**
 * What a run destroys, by shape. `single` is what one configuration destroys,
 * `sides` what a comparison destroys. A harness that destroys the same thing
 * either way repeats the string rather than leaving a field blank: a missing
 * field would render an empty noun phrase into the confirmation.
 */
export interface HarnessResets {
  single: string;
  sides: string;
}

interface ArtifactRefBase {
  /** base64url of the path relative to eval/. Stable and addressable without a database. */
  id: string;
  harness: OpsHarness;
  kind: "baseline" | "run";
  /** Path relative to eval/. */
  path: string;
  schemaVersion: number;
  createdAt: string;
  models: string[];
  runs: number;
  selection: { fullCorpus: boolean; filters: Record<string, string> };
  git: { revision: string; dirty: boolean | null };
  corpusFingerprint: string;
  configFingerprint: string;
  aggregatePassRate: number;
  caseCount: number;
  /** True only for v2 artifacts that recorded complete execution evidence. */
  complete: boolean | null;
  sizeBytes: number;
  mtimeMs: number;
}

/** An indexed strict historical-quality artifact and its validated slot counts. */
export interface HistoricalQualityArtifactRef extends ArtifactRefBase {
  measurementKind: "historical-quality-pilot";
  qualityCompleteness: {
    requestedSlots: number;
    completedSlots: number;
  };
}

/** A generic scorecard ref. Its JSON wire shape remains discriminator-only. */
export interface GenericArtifactRef extends ArtifactRefBase {
  measurementKind: null;
  qualityCompleteness?: never;
}

/** Public browser/server wire ref, narrowed exclusively by measurementKind. */
export type ArtifactRef = HistoricalQualityArtifactRef | GenericArtifactRef;

export interface IndexIssue {
  /** Path relative to eval/. */
  path: string;
  message: string;
}

export interface IndexResult {
  refs: ArtifactRef[];
  issues: IndexIssue[];
}

export interface RunFlags {
  runs?: number;
  case?: string;
  rule?: string;
  tier?: number;
  noJudge?: boolean;
  alpha?: number;
  attemptTimeoutMs?: number;
  strictEvidence?: boolean;
}

/**
 * The two environment configurations a discovery run compares, rendered as
 * `--a KEY=VALUE` / `--b KEY=VALUE`.
 *
 * `a` and `b` are named rather than a list because the engine requires exactly
 * two sides in that order (`assertOrderedDistinctSides` in
 * services/api/src/cli/discovery.plan.ts: a reversed pair reports side b's
 * values under the artifact's a column). Both sides must declare the same key
 * set and differ in at least one value; RunSpecSchema enforces both.
 */
export interface AbSides {
  a: Record<string, string>;
  b: Record<string, string>;
}

export interface EvalRunSpec {
  kind: "eval";
  harness: OpsHarness;
  /** Name of a committed or saved profile. "default" + overrides = ad-hoc. */
  profile: string;
  /** Ad-hoc overrides; only valid with profile "default". Never credentials. */
  overrides?: { models: Record<string, string>; env: Record<string, string> };
  flags: RunFlags;
  /**
   * Optional for discovery and invalid for every other harness: discovery
   * measures a single configuration when launched without `sides` and compares
   * a pair when launched with them. The scorecard harnesses score one
   * configuration against a committed baseline, so a second configuration would
   * have nothing to mean — `SUPPORTS_SIDES` (ops.sides.ts) is the predicate, and
   * it is "may", not "must".
   */
  sides?: AbSides;
}

/**
 * A guarded test-database reset. It is a run like any other so it streams live,
 * is logged and appears in run history. Only the database NAME is recorded: a
 * connection string never enters a record.
 */
export interface FixtureResetSpec {
  kind: "fixture-reset";
  personas: number;
  /** Always true: migrations are applied on every reset. Drift is never probed. */
  migrate: boolean;
  /** The database the operator confirmed by name. */
  databaseName: string;
}

export type RunSpec = EvalRunSpec | FixtureResetSpec;

export type RunStatus =
  | "queued"
  | "running"
  | "passed"
  | "regression"
  | "execution-error"
  | "insufficient-evidence"
  | "cancelled"
  | "interrupted"
  | "crashed";

/** One spawned command of a multi-step run, recorded for auditability. */
export interface RunStepRecord {
  label: string;
  argv: string[];
  /** Working directory, relative to the repository root. */
  cwd: string;
}

export interface RunRecord {
  id: string;
  spec: RunSpec;
  /**
   * The exact argv that was or will be spawned, recorded for auditability.
   * Empty for a multi-step run, which records `steps` instead.
   */
  argv: string[];
  /** The command sequence of a multi-step run. Absent for a single-command run. */
  steps?: RunStepRecord[];
  /** Injected environment. Never contains credentials. */
  env: Record<string, string>;
  profileFingerprint: string;
  experimental: boolean;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  pid: number | null;
  /** Path to the run report, relative to eval/, once the harness has written one. */
  artifactPath: string | null;
  workload: number;
}
