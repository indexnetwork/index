import { readdir } from "node:fs/promises";

import { buildScorecard } from "./scorecard.js";
import type { CaseResultLike, ScorecardLike } from "./types.js";

interface RollingCaseAcc {
  caseId: string;
  rule: string;
  passes: number;
  runs: number;
}

/** Reads all JSON scorecards in a run directory, ignoring missing dirs and malformed files. */
async function readRunScorecards(runsDir: string): Promise<ScorecardLike[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }

  const out: ScorecardLike[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const file = Bun.file(`${runsDir}/${entry}`);
      const sc = (await file.json()) as ScorecardLike;
      if (sc.generatedAt && Array.isArray(sc.cases)) out.push(sc);
    } catch {
      // Run reports are diagnostic artifacts; one malformed file should not
      // disable rolling-baseline computation for every other run.
    }
  }
  return out;
}

/**
 * Computes a rolling baseline from recent run reports in `runsDir`.
 *
 * The resulting scorecard is synthetic: each case's baseline pass-rate is the
 * pass-weighted average across all recent scorecards containing that case. This
 * means filtered reports still contribute to the subset of cases they ran, while
 * absent cases simply fall back to no comparison.
 *
 * @param runsDir - Directory containing JSON scorecards written by `writeRunReport`.
 * @param days - Lookback window in days.
 * @param now - Clock injection for tests.
 * @returns A synthetic scorecard, or `null` when no reports fall in the window.
 */
export async function computeRollingBaseline(
  runsDir: string,
  days: number,
  now = new Date(),
): Promise<ScorecardLike<CaseResultLike> | null> {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const scorecards = (await readRunScorecards(runsDir)).filter((sc) => {
    const t = Date.parse(sc.generatedAt);
    return Number.isFinite(t) && t >= cutoff && t < now.getTime();
  });
  if (scorecards.length === 0) return null;

  const byCase = new Map<string, RollingCaseAcc>();
  for (const sc of scorecards) {
    for (const c of sc.cases) {
      const acc = byCase.get(c.caseId) ?? { caseId: c.caseId, rule: c.rule, passes: 0, runs: 0 };
      acc.passes += c.passes;
      acc.runs += c.runs;
      byCase.set(c.caseId, acc);
    }
  }

  const cases: CaseResultLike[] = [...byCase.values()].map((acc) => {
    const passRate = acc.runs === 0 ? 0 : acc.passes / acc.runs;
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
