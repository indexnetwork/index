import type { EvaluatedOpportunityWithActors } from "../../src/opportunity/opportunity.evaluator.js";

import type {
  MatchingCase,
  CandidateExpectation,
  AssertionResult,
  CandidateOutcome,
  RunResult,
  CaseResult,
} from "./matching.types.js";

/** Grades a natural-language criterion. Returns true on pass. Injected for testability. */
export type Judge = (output: unknown, criteria: string) => Promise<boolean>;

/** Find the opportunity that includes this candidate as an actor (non-intro mode: 2 actors). */
function findOpportunity(
  candidateId: string,
  opportunities: EvaluatedOpportunityWithActors[],
): EvaluatedOpportunityWithActors | undefined {
  return opportunities.find((o) => o.actors.some((a) => a.userId === candidateId));
}

/** Evaluate one candidate expectation against one run's opportunities. */
async function scoreExpectation(
  exp: CandidateExpectation,
  opportunities: EvaluatedOpportunityWithActors[],
  judge: Judge,
): Promise<{ assertions: AssertionResult[]; outcome: CandidateOutcome }> {
  const out: AssertionResult[] = [];
  const opp = findOpportunity(exp.candidateId, opportunities);
  const matched = opp !== undefined && opp.score > 0;
  const effectiveScore = opp ? opp.score : 0;
  const role =
    opp && opp.score > 0 ? opp.actors.find((a) => a.userId === exp.candidateId)?.role : undefined;
  const outcome: CandidateOutcome = {
    candidateId: exp.candidateId,
    matched,
    score: effectiveScore,
    ...(role ? { role } : {}),
    reasoning: opp?.reasoning ?? "",
  };

  out.push({
    kind: "match",
    candidateId: exp.candidateId,
    passed: matched === exp.match,
    detail: `expected match=${exp.match}, got matched=${matched} (score ${effectiveScore})`,
  });

  if (exp.scoreBand) {
    const [min, max] = exp.scoreBand;
    out.push({
      kind: "band",
      candidateId: exp.candidateId,
      passed: effectiveScore >= min && effectiveScore <= max,
      detail: `expected score in [${min},${max}], got ${effectiveScore}`,
    });
  }

  if (exp.role && opp && opp.score > 0) {
    const actor = opp.actors.find((a) => a.userId === exp.candidateId);
    out.push({
      kind: "role",
      candidateId: exp.candidateId,
      passed: actor?.role === exp.role,
      detail: `expected role=${exp.role}, got ${actor?.role ?? "none"}`,
    });
  }

  if (exp.reasoningCriteria) {
    const passed = await judge(
      { candidateId: exp.candidateId, opportunity: opp ?? null, allResults: opportunities },
      exp.reasoningCriteria,
    );
    out.push({
      kind: "reasoning",
      candidateId: exp.candidateId,
      passed,
      detail: passed ? "judge passed" : "judge failed",
    });
  }

  return { assertions: out, outcome };
}

/**
 * Score a single run of a case.
 * A run passes iff every assertion passes.
 * @param c - The matching case being evaluated.
 * @param opportunities - The opportunities returned by this run.
 * @param judge - Injected LLM judge for reasoning assertions.
 * @returns A RunResult with a passed flag and per-assertion breakdown.
 */
export async function scoreRun(
  c: MatchingCase,
  opportunities: EvaluatedOpportunityWithActors[],
  judge: Judge,
): Promise<RunResult> {
  const graded = await Promise.all(c.expect.map((exp) => scoreExpectation(exp, opportunities, judge)));
  const assertions = graded.flatMap((g) => g.assertions);
  const candidates = graded.map((g) => g.outcome);
  return { passed: assertions.every((a) => a.passed), assertions, candidates };
}

/**
 * Aggregate N runs of a case into a CaseResult.
 * @param c - The matching case being evaluated.
 * @param runs - Array of per-run opportunity lists.
 * @param judge - Injected LLM judge for reasoning assertions.
 * @returns A CaseResult with pass-rate, flakiness flag, and per-run breakdown.
 */
export async function scoreCase(
  c: MatchingCase,
  runs: EvaluatedOpportunityWithActors[][],
  judge: Judge,
): Promise<CaseResult> {
  const runResults = await Promise.all(runs.map((r) => scoreRun(c, r, judge)));
  const passes = runResults.filter((r) => r.passed).length;
  const total = runResults.length;
  return {
    caseId: c.id,
    rule: c.rule,
    runs: total,
    passes,
    passRate: total === 0 ? 0 : passes / total,
    flaky: passes > 0 && passes < total,
    runResults,
  };
}
