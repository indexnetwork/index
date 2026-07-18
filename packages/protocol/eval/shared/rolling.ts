import { readdir } from "node:fs/promises";

import { EVAL_RUN_REPORT_ARTIFACT_TYPE, isEvalArtifactV2, parseEvalArtifact, type EvalArtifactEnvelope } from "./artifact.js";
import { buildScorecard } from "./scorecard.js";
import type { EvalEvidencePolicy } from "./runner.js";
import type { CaseResultLike, ScorecardLike } from "./types.js";

interface RollingCaseAcc {
  caseId: string;
  rule: string;
  passes: number;
  runs: number;
}

async function readRunArtifacts(runsDir: string): Promise<EvalArtifactEnvelope[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }

  const out: EvalArtifactEnvelope[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const file = Bun.file(`${runsDir}/${entry}`);
      out.push(parseEvalArtifact(await file.json(), { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE }));
    } catch {
      // A malformed diagnostic file must not disable every other rolling input.
    }
  }
  return out;
}

export interface RollingBaselineOptions {
  /** Strict rolling evidence excludes v1 reports because completeness is unknowable. */
  evidencePolicy?: EvalEvidencePolicy;
}

/**
 * Computes a rolling baseline from recent, complete run reports.
 *
 * Incomplete v2 reports never contribute. Normal mode can continue consuming
 * valid v1 score-only reports; strict mode excludes them rather than inventing
 * execution provenance they do not contain.
 */
export async function computeRollingBaseline(
  runsDir: string,
  days: number,
  now = new Date(),
  options: RollingBaselineOptions = {},
): Promise<ScorecardLike<CaseResultLike> | null> {
  const policy = options.evidencePolicy ?? "normal";
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const artifacts = (await readRunArtifacts(runsDir)).filter((artifact) => {
    if (isEvalArtifactV2(artifact)) return artifact.completeness.complete;
    return policy === "normal";
  });
  const scorecards = artifacts.map((artifact) => artifact.payload).filter((scorecard) => {
    const timestamp = Date.parse(scorecard.generatedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp < now.getTime();
  });
  if (scorecards.length === 0) return null;

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
  if (byCase.size === 0) return null;

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
    ...buildScorecard(cases, {
      model: `rolling:${days}d:${scorecards.length}run${scorecards.length === 1 ? "" : "s"}`,
      runs: 1,
    }),
    generatedAt: now.toISOString(),
  };
}
