import { readdir } from "node:fs/promises";

import { EVAL_LEGACY_UNAVAILABLE, EVAL_RUN_REPORT_ARTIFACT_TYPE, isEvalArtifactV2, parseEvalArtifact, type EvalArtifactEnvelope } from "./artifact.js";
import { buildScorecard } from "./scorecard.js";
import type { EvalEvidencePolicy } from "./runner.js";
import type { CaseResultLike, ScorecardLike } from "./types.js";

interface RollingCaseAcc {
  caseId: string;
  rule: string;
  passes: number;
  runs: number;
}

/** One rolling input that was rejected, with the exact reason (IND-445). */
export interface RollingExclusion {
  file: string;
  reason: string;
}

/**
 * The current run's cohort identity used to filter rolling inputs. `harness`
 * is always enforced; the optional dimensions are enforced when provided
 * (a filtered current run cannot supply a full-corpus corpus fingerprint).
 */
export interface RollingCompatibility {
  harness: string;
  harnessVersion?: string;
  models?: string[];
  corpusFingerprint?: string;
  configFingerprint?: string;
}

export interface RollingBaselineResult {
  /** The aggregated rolling scorecard, or `null` when no compatible complete reports qualify. */
  scorecard: ScorecardLike<CaseResultLike> | null;
  /** Files whose evidence contributed to the rolling baseline. */
  includedFiles: string[];
  /** Every rejected artifact with its exclusion reason. */
  excluded: RollingExclusion[];
}

export interface RollingBaselineOptions {
  /** Strict rolling evidence excludes v1 reports because completeness is unknowable. */
  evidencePolicy?: EvalEvidencePolicy;
  /** When provided, inputs must match the current run's cohort identity. */
  compatibility?: RollingCompatibility;
}

function sameModelSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((model) => b.has(model));
}

function truncate(message: string, max = 160): string {
  return message.length > max ? `${message.slice(0, max)}…` : message;
}

/**
 * Assesses one parsed run report against the rolling admission rules.
 * Returns the exclusion reason, or `null` when the report qualifies.
 */
function rollingExclusionReason(
  artifact: EvalArtifactEnvelope,
  options: { policy: EvalEvidencePolicy; compatibility?: RollingCompatibility; cutoff: number; nowMs: number; days: number },
): string | null {
  if (isEvalArtifactV2(artifact)) {
    if (!artifact.completeness.complete) return "incomplete execution evidence (missing terminal run slots)";
  } else if (options.policy === "strict") {
    return "schema-v1 report carries no execution evidence; completeness is unknowable under the strict policy";
  }

  const timestamp = Date.parse(artifact.payload.generatedAt);
  if (!Number.isFinite(timestamp) || timestamp < options.cutoff || timestamp >= options.nowMs) {
    return `outside the ${options.days}-day rolling window`;
  }

  if (!artifact.selection.fullCorpus || Object.keys(artifact.selection.filters).length > 0) {
    return "filtered run (rolling baselines only aggregate full-corpus reports)";
  }

  const compatibility = options.compatibility;
  if (compatibility) {
    if (compatibility.harnessVersion !== undefined && artifact.harnessVersion !== compatibility.harnessVersion) {
      return `harness version "${artifact.harnessVersion}" differs from current "${compatibility.harnessVersion}"`;
    }
    if (compatibility.models !== undefined && !sameModelSet(artifact.models, compatibility.models)) {
      return `model IDs [${[...artifact.models].sort().join(", ")}] differ from current [${[...compatibility.models].sort().join(", ")}]`;
    }
    if (
      compatibility.corpusFingerprint !== undefined
      && artifact.corpusFingerprint !== EVAL_LEGACY_UNAVAILABLE
      && artifact.corpusFingerprint !== compatibility.corpusFingerprint
    ) {
      return "corpus fingerprint differs from the current run (cases added, removed, or edited)";
    }
    if (
      compatibility.configFingerprint !== undefined
      && artifact.configFingerprint !== EVAL_LEGACY_UNAVAILABLE
      && artifact.configFingerprint !== compatibility.configFingerprint
    ) {
      return "scoring-config fingerprint differs from the current run";
    }
  }
  return null;
}

/**
 * Computes a rolling baseline from recent, complete, *compatible* run reports.
 *
 * Incomplete v2 reports never contribute. Normal mode can continue consuming
 * valid v1 score-only reports (their fingerprints are unknowable, never
 * fabricated); strict mode excludes them. Every rejected artifact is reported
 * in `excluded` with its reason — nothing is silently dropped. The
 * aggregation math over admitted inputs is unchanged.
 */
export async function computeRollingBaseline(
  runsDir: string,
  days: number,
  now = new Date(),
  options: RollingBaselineOptions = {},
): Promise<RollingBaselineResult> {
  const policy = options.evidencePolicy ?? "normal";
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return { scorecard: null, includedFiles: [], excluded: [] };
  }

  const excluded: RollingExclusion[] = [];
  const included: Array<{ file: string; artifact: EvalArtifactEnvelope }> = [];
  for (const entry of [...entries].sort()) {
    if (!entry.endsWith(".json")) continue;
    let artifact: EvalArtifactEnvelope;
    try {
      const file = Bun.file(`${runsDir}/${entry}`);
      artifact = parseEvalArtifact(await file.json(), {
        expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE,
        expectedHarness: options.compatibility?.harness,
      });
    } catch (err) {
      // A malformed diagnostic file must not disable every other rolling input,
      // but its exclusion is reported instead of being swallowed.
      excluded.push({ file: entry, reason: `invalid run-report artifact: ${truncate(err instanceof Error ? err.message : String(err))}` });
      continue;
    }
    const reason = rollingExclusionReason(artifact, { policy, compatibility: options.compatibility, cutoff, nowMs: now.getTime(), days });
    if (reason !== null) {
      excluded.push({ file: entry, reason });
      continue;
    }
    included.push({ file: entry, artifact });
  }

  const scorecards = included.map((entry) => entry.artifact.payload);
  if (scorecards.length === 0) return { scorecard: null, includedFiles: [], excluded };

  const byCase = new Map<string, RollingCaseAcc>();
  for (const scorecard of scorecards) {
    for (const entry of scorecard.cases) {
      if (entry.runs === 0) continue;
      const acc = byCase.get(entry.caseId) ?? { caseId: entry.caseId, rule: entry.rule, passes: 0, runs: 0 };
      acc.passes += entry.passes;
      acc.runs += entry.runs;
      byCase.set(entry.caseId, acc);
    }
  }
  if (byCase.size === 0) return { scorecard: null, includedFiles: [], excluded };

  const cases: CaseResultLike[] = [...byCase.values()].map((acc) => {
    const passRate = acc.passes / acc.runs;
    return {
      caseId: acc.caseId,
      rule: acc.rule,
      runs: acc.runs,
      passes: acc.passes,
      passRate,
      flaky: passRate > 0 && passRate < 1,
    };
  });

  return {
    scorecard: {
      ...buildScorecard(cases, {
        model: `rolling:${days}d:${scorecards.length}run${scorecards.length === 1 ? "" : "s"}`,
        runs: 1,
      }),
      generatedAt: now.toISOString(),
    },
    includedFiles: included.map((entry) => entry.file),
    excluded,
  };
}
