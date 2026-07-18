/**
 * Committed canary manifest: schema, hard budget caps, and resolution against
 * the live suite corpora (IND-447).
 *
 * The manifest is the single source of truth for what the scheduled/manual
 * live-eval canary executes. Manual (`workflow_dispatch`) and scheduled (cron)
 * runs consume the same committed file, so their artifacts stay comparable
 * run-over-run. Everything here is provider-free: parsing and resolution never
 * read credentials and never invoke a model.
 *
 * Budget caps are hard-coded constants, not manifest fields — a manifest edit
 * can shrink the canary but can never grow it past the caps without a code
 * change that shows up in review.
 */
import { z } from "zod";

export const CANARY_MANIFEST_ARTIFACT_TYPE = "index-eval/canary-manifest";
export const CANARY_MANIFEST_SCHEMA_VERSION = 1;

/** The baseline-backed suites the canary may schedule. */
export const CANARY_SUITES = ["matching", "opportunity", "premise", "profile"] as const;
export type CanarySuiteName = (typeof CANARY_SUITES)[number];

/**
 * Suites that exist under eval/ but are deliberately not canary-schedulable.
 * HyDE is a staged canonical study (blind adjudication, human resolution) and
 * must never run on a routine cron; clarification and viewer have no committed
 * scorecard baselines to compare against.
 */
export const CANARY_EXCLUDED_SUITES = ["hyde", "clarification", "viewer", "shared", "canary"] as const;

// ─── Hard budget caps (code-reviewed, not manifest-tunable) ────────────────
export const CANARY_MAX_TOTAL_CASES = 24;
export const CANARY_MAX_RUNS_PER_CASE = 3;
export const CANARY_MAX_REQUESTED_RUN_SLOTS = 60;
/** Mirrors DEFAULT_MAX_ATTEMPTS in eval/shared/runner.ts (retry ceiling per run slot). */
export const CANARY_MAX_ATTEMPTS_PER_RUN = 3;

const CanarySuiteSelectionSchema = z
  .object({
    /** Exact case ids from the suite's committed corpus. */
    cases: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const CanaryManifestSchema = z
  .object({
    artifactType: z.literal(CANARY_MANIFEST_ARTIFACT_TYPE),
    schemaVersion: z.literal(CANARY_MANIFEST_SCHEMA_VERSION),
    description: z.string().min(1),
    /** Requested runs per selected case (capped by CANARY_MAX_RUNS_PER_CASE). */
    runsPerCase: z.number().int().min(1).max(CANARY_MAX_RUNS_PER_CASE),
    /** Regression significance threshold forwarded to every harness. */
    alpha: z.number().gt(0).lt(1),
    suites: z.record(z.string(), CanarySuiteSelectionSchema),
  })
  .strict();

export interface CanaryManifest {
  artifactType: typeof CANARY_MANIFEST_ARTIFACT_TYPE;
  schemaVersion: typeof CANARY_MANIFEST_SCHEMA_VERSION;
  description: string;
  runsPerCase: number;
  alpha: number;
  suites: Partial<Record<CanarySuiteName, { cases: string[] }>>;
}

/** Parses and validates a canary manifest value. Throws actionable errors. */
export function parseCanaryManifest(value: unknown): CanaryManifest {
  const parsed = CanaryManifestSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
    throw new Error(`Invalid canary manifest: ${issues}`);
  }
  const suiteNames = Object.keys(parsed.data.suites);
  if (suiteNames.length === 0) {
    throw new Error("Invalid canary manifest: at least one suite must be selected");
  }
  const allowed = new Set<string>(CANARY_SUITES);
  for (const name of suiteNames) {
    if (allowed.has(name)) continue;
    if ((CANARY_EXCLUDED_SUITES as readonly string[]).includes(name)) {
      throw new Error(
        `Invalid canary manifest: suite "${name}" is excluded from routine canary scheduling`
          + (name === "hyde"
            ? " — the HyDE canonical study requires staged blind human adjudication and must be run deliberately, never on a cron"
            : " — it has no committed scorecard baseline to compare against"),
      );
    }
    throw new Error(`Invalid canary manifest: unknown suite "${name}" (allowed: ${CANARY_SUITES.join(", ")})`);
  }
  for (const name of suiteNames) {
    const cases = parsed.data.suites[name]!.cases;
    const seen = new Set<string>();
    for (const id of cases) {
      if (seen.has(id)) throw new Error(`Invalid canary manifest: suite "${name}" declares case "${id}" twice`);
      seen.add(id);
    }
  }
  return parsed.data as CanaryManifest;
}

// ─── Resolution against the live corpora ───────────────────────────────────

/** The minimal corpus surface the canary needs from each suite. */
export interface CanarySuiteCorpus {
  suite: CanarySuiteName;
  caseIds: readonly string[];
}

export interface CanaryResolvedSuite {
  suite: CanarySuiteName;
  caseIds: string[];
}

export interface CanaryResolvedSelection {
  suites: CanaryResolvedSuite[];
  totalCases: number;
  runsPerCase: number;
  requestedRunSlots: number;
}

/**
 * Resolves the manifest against the committed corpora and enforces budget caps.
 *
 * Every declared case id must exist exactly, and must be *unambiguous* under
 * the harnesses' exact-or-prefix `--case` semantics: if another corpus case id
 * starts with the declared id, one invocation would silently run two cases and
 * the plan's case/run accounting (and budget) would be wrong.
 */
export function resolveCanaryManifest(
  manifest: CanaryManifest,
  corpora: Partial<Record<CanarySuiteName, CanarySuiteCorpus>>,
): CanaryResolvedSelection {
  const suites: CanaryResolvedSuite[] = [];
  for (const suite of CANARY_SUITES) {
    const selection = manifest.suites[suite];
    if (!selection) continue;
    const corpus = corpora[suite];
    if (!corpus) throw new Error(`Canary manifest selects suite "${suite}" but no corpus was provided for it`);
    const known = new Set(corpus.caseIds);
    for (const id of selection.cases) {
      if (!known.has(id)) {
        throw new Error(`Canary manifest case "${id}" does not exist in the ${suite} corpus (was it renamed or removed?)`);
      }
      const shadowed = corpus.caseIds.filter((candidate) => candidate !== id && candidate.startsWith(id));
      if (shadowed.length > 0) {
        throw new Error(
          `Canary manifest case "${id}" is ambiguous under the ${suite} harness's --case prefix matching: `
            + `it is also a prefix of ${shadowed.join(", ")}`,
        );
      }
    }
    suites.push({ suite, caseIds: [...selection.cases] });
  }

  const totalCases = suites.reduce((sum, entry) => sum + entry.caseIds.length, 0);
  if (totalCases > CANARY_MAX_TOTAL_CASES) {
    throw new Error(`Canary manifest selects ${totalCases} cases, over the hard cap of ${CANARY_MAX_TOTAL_CASES}`);
  }
  const requestedRunSlots = totalCases * manifest.runsPerCase;
  if (requestedRunSlots > CANARY_MAX_REQUESTED_RUN_SLOTS) {
    throw new Error(
      `Canary manifest requests ${requestedRunSlots} run slots (${totalCases} cases × ${manifest.runsPerCase} runs), `
        + `over the hard cap of ${CANARY_MAX_REQUESTED_RUN_SLOTS}`,
    );
  }
  return { suites, totalCases, runsPerCase: manifest.runsPerCase, requestedRunSlots };
}
