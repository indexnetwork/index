import type { AssertionResult, CaseResult, ProfileCase, ProfileRunDetail, RunResult } from "./profile.types.js";

/** Grades a natural-language criterion. Returns true on pass. Injected for testability. */
export type Judge = (output: unknown, criteria: string) => Promise<boolean>;

const contains = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * Score a single run of a profile case. A run passes iff every assertion passes.
 *
 * @param c - The profile case being evaluated.
 * @param d - The normalized generator output for this run.
 * @param judge - Injected LLM judge for coverage/apply/preserve/reasoning checks.
 */
export async function scoreRun(c: ProfileCase, d: ProfileRunDetail, judge: Judge): Promise<RunResult> {
  const out: AssertionResult[] = [];
  const { expect: e } = c;

  if (e.expectNameContains) {
    out.push({
      kind: "name",
      passed: contains(d.name, e.expectNameContains),
      detail: `expected name to contain "${e.expectNameContains}", got "${d.name}"`,
    });
  }

  if (e.expectLocationContains) {
    out.push({
      kind: "location",
      passed: contains(d.location, e.expectLocationContains),
      detail: `expected location to contain "${e.expectLocationContains}", got "${d.location}"`,
    });
  }

  // Privacy is the headline guarantee: any PII in public fields fails, on by default.
  if (e.noPII !== false) {
    out.push({
      kind: "privacy",
      passed: d.piiHits.length === 0,
      detail: d.piiHits.length === 0 ? "no PII in public fields" : `PII leaked: ${d.piiHits.join(", ")}`,
    });
  }

  if (e.minSkills !== undefined) {
    out.push({ kind: "skills", passed: d.skills.length >= e.minSkills, detail: `expected ≥${e.minSkills} skills, got ${d.skills.length}` });
  }
  if (e.minInterests !== undefined) {
    out.push({ kind: "interests", passed: d.interests.length >= e.minInterests, detail: `expected ≥${e.minInterests} interests, got ${d.interests.length}` });
  }

  if (e.mustHaveSkills && e.mustHaveSkills.length > 0) {
    const passed = await judge(
      { skills: d.skills },
      `The skills list must capture ALL of these (allow synonyms/specializations): ${e.mustHaveSkills.map((s) => `"${s}"`).join("; ")}.`,
    );
    out.push({ kind: "coverage_skills", passed, detail: passed ? "judge: skills covered" : "judge: skills missing" });
  }
  if (e.mustHaveInterests && e.mustHaveInterests.length > 0) {
    const passed = await judge(
      { interests: d.interests },
      `The interests list must capture ALL of these (allow synonyms): ${e.mustHaveInterests.map((s) => `"${s}"`).join("; ")}.`,
    );
    out.push({ kind: "coverage_interests", passed, detail: passed ? "judge: interests covered" : "judge: interests missing" });
  }

  if (e.mustApply) {
    const passed = await judge(
      { name: d.name, bio: d.bio, location: d.location, context: d.context, skills: d.skills, interests: d.interests },
      `The updated profile must reflect this change: ${e.mustApply}.`,
    );
    out.push({ kind: "apply", passed, detail: passed ? "judge: change applied" : "judge: change not applied" });
  }
  if (e.mustPreserve) {
    const passed = await judge(
      { name: d.name, bio: d.bio, location: d.location, context: d.context, skills: d.skills, interests: d.interests },
      `The updated profile must still preserve: ${e.mustPreserve}.`,
    );
    out.push({ kind: "preserve", passed, detail: passed ? "judge: preserved" : "judge: not preserved" });
  }

  if (e.reasoningCriteria) {
    const passed = await judge(
      { name: d.name, bio: d.bio, location: d.location, context: d.context, skills: d.skills, interests: d.interests },
      e.reasoningCriteria,
    );
    out.push({ kind: "reasoning", passed, detail: passed ? "judge passed" : "judge failed" });
  }

  return { passed: out.every((a) => a.passed), assertions: out, detail: d };
}

/**
 * Aggregate N runs of a case into a CaseResult with pass-rate and flakiness.
 *
 * @param c - The profile case being evaluated.
 * @param details - One normalized detail per run.
 * @param judge - Injected LLM judge.
 */
export async function scoreCase(c: ProfileCase, details: ProfileRunDetail[], judge: Judge): Promise<CaseResult> {
  const runResults = await Promise.all(details.map((d) => scoreRun(c, d, judge)));
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
