/**
 * Versioned envelope for shared eval artifacts (committed baselines and run
 * reports), plus the runtime validation and deterministic provenance helpers
 * every baseline-backed harness reuses.
 *
 * Design constraints (IND-442):
 * - The envelope is generic: harness-specific per-case detail stays a
 *   harness-owned payload (case objects are passthrough beyond the shared
 *   aggregate fields). No HyDE adjudication / private-key / bootstrap concepts
 *   live here.
 * - Every read and write validates: malformed numbers, duplicate case/rule
 *   ids, inconsistent aggregates, non-monotonic timestamps, unknown schema
 *   versions, and incompatible artifact types are all rejected with
 *   actionable errors.
 * - Provenance is deterministic: SHA-256 over canonicalized (key-sorted,
 *   undefined-stripped) JSON for corpus/config inputs, and injectable Git
 *   revision/dirty readers. Fingerprint inputs must never contain embeddings,
 *   API keys, secret-bearing prompts, or raw environment values.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { z } from "zod";

import type { CaseResultLike, ScorecardLike } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Current shared eval artifact schema version. Bump on envelope shape changes. */
export const EVAL_ARTIFACT_SCHEMA_VERSION = 1;

export const EVAL_BASELINE_ARTIFACT_TYPE = "index-eval/baseline";
export const EVAL_RUN_REPORT_ARTIFACT_TYPE = "index-eval/run-report";

export type EvalArtifactType = typeof EVAL_BASELINE_ARTIFACT_TYPE | typeof EVAL_RUN_REPORT_ARTIFACT_TYPE;

/**
 * Sentinel for provenance that cannot be reconstructed when converting a
 * legacy (pre-envelope) artifact. Only valid when `source` is
 * `"legacy-migration"`; artifacts written by a live run must carry real
 * fingerprints.
 */
export const EVAL_LEGACY_UNAVAILABLE = "unavailable-legacy-migration";

/** Numeric tolerance for validating stored rates against recomputed rates. */
const RATE_TOLERANCE = 1e-6;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "expected a lowercase hex SHA-256");
const dateTimeSchema = z.string().datetime({ offset: true });
const rateSchema = z.number().finite().min(0).max(1);
const countSchema = z.number().int().min(0);

export const EvalGitProvenanceSchema = z
  .object({
    /** Commit hash, or "unknown" when Git metadata could not be read. */
    revision: z.union([z.string().regex(/^[a-f0-9]{40,64}$/i), z.literal("unknown")]),
    /** True when the worktree had uncommitted changes; null when unknown. */
    dirty: z.boolean().nullable(),
  })
  .strict();

export type EvalGitProvenance = z.infer<typeof EvalGitProvenanceSchema>;

export const EvalSelectionSchema = z
  .object({
    /** True when no case/rule/tier/component filters narrowed the corpus. */
    fullCorpus: z.boolean(),
    /** The raw CLI filters that produced the selection (empty when full corpus). */
    filters: z.record(z.string().min(1)),
  })
  .strict()
  .superRefine((selection, context) => {
    if (selection.fullCorpus && Object.keys(selection.filters).length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filters"],
        message: "fullCorpus artifacts must not carry selection filters",
      });
    }
  });

export type EvalSelection = z.infer<typeof EvalSelectionSchema>;

export const EvalCompletenessSchema = z
  .object({
    caseCount: countSchema,
    ruleCount: countSchema,
    totalRuns: countSchema,
    totalPasses: countSchema,
    flakyCaseCount: countSchema,
  })
  .strict();

export type EvalCompleteness = z.infer<typeof EvalCompletenessSchema>;

/** Shared per-case aggregate fields; harness-specific detail passes through. */
const caseResultSchema = z
  .object({
    caseId: z.string().min(1),
    rule: z.string().min(1),
    runs: z.number().int().min(1),
    passes: countSchema,
    passRate: rateSchema,
    flaky: z.boolean(),
  })
  .passthrough();

const ruleResultSchema = z
  .object({
    rule: z.string().min(1),
    caseCount: z.number().int().min(1),
    passRate: rateSchema,
  })
  .strict();

/** Shared scorecard payload: aggregate fields validated, cases passthrough. */
export const EvalScorecardPayloadSchema = z
  .object({
    generatedAt: dateTimeSchema,
    model: z.string().min(1),
    runs: z.number().int().min(1),
    aggregatePassRate: rateSchema,
    rules: z.array(ruleResultSchema).min(1),
    cases: z.array(caseResultSchema).min(1),
  })
  .strict()
  .superRefine((payload, context) => {
    const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

    const caseIds = payload.cases.map((c) => c.caseId);
    if (new Set(caseIds).size !== caseIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["cases"], message: "duplicate caseId values" });
    }
    const ruleLabels = payload.rules.map((r) => r.rule);
    if (new Set(ruleLabels).size !== ruleLabels.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["rules"], message: "duplicate rule labels" });
    }

    for (const [index, c] of payload.cases.entries()) {
      if (c.passes > c.runs) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index],
          message: `case ${c.caseId}: passes (${c.passes}) exceeds runs (${c.runs})`,
        });
        continue;
      }
      if (Math.abs(c.passRate - c.passes / c.runs) > RATE_TOLERANCE) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "passRate"],
          message: `case ${c.caseId}: passRate ${c.passRate} is inconsistent with ${c.passes}/${c.runs}`,
        });
      }
      if (c.flaky !== (c.passes > 0 && c.passes < c.runs)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "flaky"],
          message: `case ${c.caseId}: flaky flag is inconsistent with passes/runs`,
        });
      }
    }

    if (payload.cases.length > 0
      && Math.abs(payload.aggregatePassRate - mean(payload.cases.map((c) => c.passRate))) > RATE_TOLERANCE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aggregatePassRate"],
        message: "aggregatePassRate is inconsistent with the mean of case pass rates",
      });
    }

    const casesByRule = new Map<string, typeof payload.cases>();
    for (const c of payload.cases) {
      const list = casesByRule.get(c.rule) ?? [];
      list.push(c);
      casesByRule.set(c.rule, list);
    }
    if (casesByRule.size !== payload.rules.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules"],
        message: "rules rollup does not cover exactly the rules present in cases",
      });
    }
    for (const [index, rule] of payload.rules.entries()) {
      const members = casesByRule.get(rule.rule);
      if (!members) continue; // covered by the rollup mismatch issue above
      if (members.length !== rule.caseCount) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "caseCount"],
          message: `rule ${rule.rule}: caseCount ${rule.caseCount} != ${members.length} cases`,
        });
      } else if (Math.abs(rule.passRate - mean(members.map((c) => c.passRate))) > RATE_TOLERANCE) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "passRate"],
          message: `rule ${rule.rule}: passRate is inconsistent with its member cases`,
        });
      }
    }
  });

const fingerprintSchema = z.union([sha256Schema, z.literal(EVAL_LEGACY_UNAVAILABLE)]);

export const EvalArtifactEnvelopeSchema = z
  .object({
    artifactType: z.enum([EVAL_BASELINE_ARTIFACT_TYPE, EVAL_RUN_REPORT_ARTIFACT_TYPE]),
    schemaVersion: z.literal(EVAL_ARTIFACT_SCHEMA_VERSION),
    harness: z.string().min(1),
    harnessVersion: z.string().min(1),
    /** "run" for artifacts written by a live harness run; "legacy-migration" for explicit conversions. */
    source: z.enum(["run", "legacy-migration"]),
    createdAt: dateTimeSchema,
    startedAt: dateTimeSchema,
    completedAt: dateTimeSchema,
    /** Configured model IDs (no keys, no prompts). */
    models: z.array(z.string().min(1)).min(1),
    /** Configured runs per case. */
    runs: z.number().int().min(1),
    selection: EvalSelectionSchema,
    corpusFingerprint: fingerprintSchema,
    configFingerprint: fingerprintSchema,
    git: EvalGitProvenanceSchema,
    completeness: EvalCompletenessSchema,
    payload: EvalScorecardPayloadSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    const started = Date.parse(artifact.startedAt);
    const completed = Date.parse(artifact.completedAt);
    const created = Date.parse(artifact.createdAt);
    if (!(started <= completed && completed <= created)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "timestamps must satisfy startedAt <= completedAt <= createdAt",
      });
    }
    if (artifact.source === "run") {
      for (const key of ["corpusFingerprint", "configFingerprint"] as const) {
        if (artifact[key] === EVAL_LEGACY_UNAVAILABLE) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} "${EVAL_LEGACY_UNAVAILABLE}" is only valid for source "legacy-migration"`,
          });
        }
      }
    }
    if (new Set(artifact.models).size !== artifact.models.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["models"], message: "duplicate model IDs" });
    }
    if (artifact.payload.runs !== artifact.runs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runs"],
        message: `envelope runs (${artifact.runs}) != payload runs (${artifact.payload.runs})`,
      });
    }
    const expected = summarizeCompleteness(artifact.payload.cases, artifact.payload.rules.length);
    const stored = artifact.completeness;
    for (const key of Object.keys(expected) as (keyof EvalCompleteness)[]) {
      if (stored[key] !== expected[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["completeness", key],
          message: `completeness.${key} ${stored[key]} is inconsistent with the payload (expected ${expected[key]})`,
        });
      }
    }
  });

export type EvalArtifactEnvelope<P extends ScorecardLike = ScorecardLike> =
  Omit<z.infer<typeof EvalArtifactEnvelopeSchema>, "payload"> & { payload: P };

// ─── Parsing ─────────────────────────────────────────────────────────────────

export interface ParseEvalArtifactOptions {
  /** Reject the artifact unless its type matches. */
  expectedType: EvalArtifactType;
  /** Reject the artifact unless it belongs to this harness. */
  expectedHarness?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a value looks like a pre-envelope (legacy) bare scorecard. */
export function looksLikeLegacyScorecard(value: unknown): boolean {
  return isRecord(value)
    && !("artifactType" in value)
    && typeof value.generatedAt === "string"
    && Array.isArray(value.cases);
}

/**
 * Parses and strictly validates a shared eval artifact envelope.
 *
 * Throws actionable errors for: legacy unversioned scorecards (pointing at the
 * migration script), incompatible artifact types, unknown schema versions, and
 * any structural/consistency violation found by the envelope schema.
 */
export function parseEvalArtifact<P extends ScorecardLike = ScorecardLike>(
  value: unknown,
  options: ParseEvalArtifactOptions,
): EvalArtifactEnvelope<P> {
  if (!isRecord(value)) {
    throw new Error("Eval artifact is not a JSON object; the file is corrupt or truncated");
  }
  if (looksLikeLegacyScorecard(value)) {
    throw new Error(
      "Legacy unversioned eval artifact detected. Convert it explicitly with "
        + "`bun eval/shared/migrate-legacy-baselines.ts --write` (run from packages/protocol); "
        + "legacy scorecards are never cast silently.",
    );
  }
  if (value.artifactType !== options.expectedType) {
    throw new Error(
      `Incompatible artifact type: expected "${options.expectedType}", got "${String(value.artifactType)}"`,
    );
  }
  if (value.schemaVersion !== EVAL_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported eval artifact schema version ${String(value.schemaVersion)}; `
        + `this build supports version ${EVAL_ARTIFACT_SCHEMA_VERSION}. `
        + "Re-generate the artifact or upgrade the eval tooling.",
    );
  }
  const parsed = EvalArtifactEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid eval artifact: ${detail}`);
  }
  if (options.expectedHarness !== undefined && parsed.data.harness !== options.expectedHarness) {
    throw new Error(
      `Eval artifact belongs to harness "${parsed.data.harness}", expected "${options.expectedHarness}"`,
    );
  }
  return parsed.data as unknown as EvalArtifactEnvelope<P>;
}

// ─── Building ────────────────────────────────────────────────────────────────

function summarizeCompleteness(
  cases: readonly Pick<CaseResultLike, "runs" | "passes" | "flaky">[],
  ruleCount: number,
): EvalCompleteness {
  return {
    caseCount: cases.length,
    ruleCount,
    totalRuns: cases.reduce((sum, c) => sum + c.runs, 0),
    totalPasses: cases.reduce((sum, c) => sum + c.passes, 0),
    flakyCaseCount: cases.filter((c) => c.flaky).length,
  };
}

/** Run-scoped provenance every harness collects once per invocation. */
export interface EvalRunMeta {
  harness: string;
  harnessVersion: string;
  models: string[];
  runs: number;
  selection: EvalSelection;
  corpusFingerprint: string;
  configFingerprint: string;
  git: EvalGitProvenance;
  startedAt: string;
  completedAt: string;
}

/**
 * Wraps a scorecard payload in a validated envelope. Completeness is derived
 * from the payload (never trusted from the caller) and the result is parsed
 * before being returned, so an inconsistent envelope can never be produced.
 */
export function buildEvalArtifact<P extends ScorecardLike>(
  artifactType: EvalArtifactType,
  payload: P,
  meta: EvalRunMeta,
  options: { source?: "run" | "legacy-migration"; createdAt?: string } = {},
): EvalArtifactEnvelope<P> {
  const envelope = {
    artifactType,
    schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION,
    harness: meta.harness,
    harnessVersion: meta.harnessVersion,
    source: options.source ?? "run",
    createdAt: options.createdAt ?? new Date().toISOString(),
    startedAt: meta.startedAt,
    completedAt: meta.completedAt,
    models: meta.models,
    runs: meta.runs,
    selection: meta.selection,
    corpusFingerprint: meta.corpusFingerprint,
    configFingerprint: meta.configFingerprint,
    git: meta.git,
    completeness: summarizeCompleteness(payload.cases, payload.rules.length),
    payload,
  };
  return parseEvalArtifact<P>(envelope, { expectedType: artifactType });
}

// ─── Fingerprints ────────────────────────────────────────────────────────────

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Key-sorted, undefined-stripped deep copy so JSON serialization is canonical. */
export function canonicalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForFingerprint);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined && typeof entry !== "function")
        .sort(([left], [right]) => compareAscii(left, right))
        .map(([key, entry]) => [key, canonicalizeForFingerprint(entry)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Fingerprint input contains a non-finite number");
  }
  return value;
}

const SECRETLIKE_KEY = /(api[-_]?key|secret|token|password|credential|authorization)/i;

function assertNoSecretlikeKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretlikeKeys(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRETLIKE_KEY.test(key)) {
        throw new Error(
          `Fingerprint input contains a secret-like key "${path}.${key}"; `
            + "corpus/config fingerprints must never include API keys, tokens, or raw environment values",
        );
      }
      assertNoSecretlikeKeys(entry, `${path}.${key}`);
    }
  }
}

/** SHA-256 hex over canonicalized JSON. Deterministic across key order. */
export function fingerprintCanonicalJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalizeForFingerprint(value))).digest("hex");
}

/** Deterministic fingerprint of the selected corpus (case definitions). */
export function fingerprintEvalCorpus(cases: readonly unknown[]): string {
  return fingerprintCanonicalJson(cases);
}

/**
 * Deterministic fingerprint of the run configuration. Rejects secret-like keys
 * so credentials/environment values can never leak into provenance inputs.
 */
export function fingerprintEvalConfig(config: Record<string, unknown>): string {
  assertNoSecretlikeKeys(config, "config");
  return fingerprintCanonicalJson(config);
}

// ─── Git provenance ──────────────────────────────────────────────────────────

export type GitCommandRunner = (args: string[], cwd: string) => string;

function runGitCommand(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  }).trim();
}

/**
 * Reads revision/dirty state without invoking a shell. Falls back to
 * `{ revision: "unknown", dirty: null }` when Git metadata is unavailable.
 * The runner is injectable so provenance stays unit-testable.
 */
export function readEvalGitProvenance(cwd: string, runGit: GitCommandRunner = runGitCommand): EvalGitProvenance {
  try {
    const revision = runGit(["rev-parse", "HEAD"], cwd).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(revision)) throw new Error("git returned a non-revision");
    const dirty = runGit(["status", "--porcelain=v1", "--untracked-files=normal"], cwd).trim().length > 0;
    return { revision: revision.toLowerCase(), dirty };
  } catch {
    return { revision: "unknown", dirty: null };
  }
}

// ─── Legacy migration ────────────────────────────────────────────────────────

const legacyScorecardSchema = z
  .object({
    generatedAt: dateTimeSchema,
    model: z.string().min(1),
    runs: z.number().int().min(1),
    aggregatePassRate: rateSchema,
    rules: z.array(ruleResultSchema).min(1),
    cases: z.array(caseResultSchema).min(1),
  })
  .strict();

/**
 * Explicitly converts a legacy bare scorecard into a v1 baseline envelope.
 *
 * The payload is carried over untouched (identical case/rule/run/pass values);
 * provenance that cannot be reconstructed is marked with explicit
 * legacy-migration sentinels rather than fabricated. The result is fully
 * validated, so a legacy scorecard that is internally inconsistent fails the
 * conversion instead of becoming authoritative.
 */
export function migrateLegacyBaseline<P extends ScorecardLike>(
  legacyValue: unknown,
  options: { harness: string; harnessVersion: string; migratedAt?: string },
): EvalArtifactEnvelope<P> {
  if (!looksLikeLegacyScorecard(legacyValue)) {
    throw new Error("Refusing to migrate: input is not a legacy unversioned scorecard");
  }
  const legacyParsed = legacyScorecardSchema.safeParse(legacyValue);
  if (!legacyParsed.success) {
    const detail = legacyParsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Legacy scorecard failed validation; fix or regenerate it instead of migrating: ${detail}`);
  }
  const legacy = legacyValue as P;
  const models = legacy.model.split(" / ").map((m) => m.trim()).filter((m) => m.length > 0);
  return buildEvalArtifact<P>(
    EVAL_BASELINE_ARTIFACT_TYPE,
    legacy,
    {
      harness: options.harness,
      harnessVersion: options.harnessVersion,
      models: [...new Set(models)],
      runs: legacy.runs,
      selection: { fullCorpus: true, filters: {} },
      corpusFingerprint: EVAL_LEGACY_UNAVAILABLE,
      configFingerprint: EVAL_LEGACY_UNAVAILABLE,
      git: { revision: "unknown", dirty: null },
      startedAt: legacy.generatedAt,
      completedAt: legacy.generatedAt,
    },
    { source: "legacy-migration", createdAt: options.migratedAt ?? legacy.generatedAt },
  );
}
