import { meanRate } from "../shared/index.js";
import type { AnalyzeCase, AssertionResult, Band, CaseResult, DecomposeCase, PremiseCase, PremiseRunDetail, RunResult } from "./premise.types.js";

/** Grades a natural-language criterion. Returns true on pass. Injected for testability. */
export type Judge = (output: unknown, criteria: string) => Promise<boolean>;

const inBand = (value: number, [min, max]: Band): boolean => value >= min && value <= max;

/** Heuristic first-person check: premise begins with "I " / "I'" (the decomposer contract). */
function isFirstPerson(text: string): boolean {
  return /^\s*I[\s'’]/.test(text);
}

/** Score a decomposer run. */
async function scoreDecompose(c: DecomposeCase, d: PremiseRunDetail, judge: Judge): Promise<AssertionResult[]> {
  const out: AssertionResult[] = [];
  const premises = d.premises ?? [];
  const { expect: e } = c;

  if (e.expectEmpty) {
    out.push({
      kind: "empty",
      passed: premises.length === 0,
      detail: `expected no premises, got ${premises.length}`,
    });
    return out; // nothing else is meaningful for empty-input cases
  }

  if (e.minPremises !== undefined || e.maxPremises !== undefined) {
    const min = e.minPremises ?? 0;
    const max = e.maxPremises ?? Infinity;
    out.push({
      kind: "count",
      passed: premises.length >= min && premises.length <= max,
      detail: `expected ${min}–${max === Infinity ? "∞" : max} premises, got ${premises.length}`,
    });
  }

  if (e.minAssertive !== undefined) {
    const n = premises.filter((p) => p.tier === "assertive").length;
    out.push({ kind: "tier", passed: n >= e.minAssertive, detail: `expected ≥${e.minAssertive} assertive, got ${n}` });
  }
  if (e.minContextual !== undefined) {
    const n = premises.filter((p) => p.tier === "contextual").length;
    out.push({ kind: "tier", passed: n >= e.minContextual, detail: `expected ≥${e.minContextual} contextual, got ${n}` });
  }

  // Structural: every premise must be first person per the decomposer contract.
  const nonFirstPerson = premises.filter((p) => !isFirstPerson(p.text));
  out.push({
    kind: "first_person",
    passed: nonFirstPerson.length === 0,
    detail: nonFirstPerson.length === 0 ? "all premises first-person" : `non-first-person: ${nonFirstPerson.map((p) => `"${p.text}"`).join(", ")}`,
  });

  if (e.mustCover && e.mustCover.length > 0) {
    const passed = await judge(
      { premises: premises.map((p) => p.text) },
      `The premise list must collectively cover ALL of these facts: ${e.mustCover.map((f) => `"${f}"`).join("; ")}. Pass only if every fact is represented by at least one premise.`,
    );
    out.push({ kind: "coverage", passed, detail: passed ? "judge: all facts covered" : "judge: missing facts" });
  }

  if (e.mustNotContain) {
    const passed = await judge(
      { premises: premises.map((p) => p.text) },
      `None of these premises may express ${e.mustNotContain}. Pass only if NO premise contains that content.`,
    );
    out.push({ kind: "exclusion", passed, detail: passed ? "judge: excluded content absent" : "judge: excluded content present" });
  }

  if (e.reasoningCriteria) {
    const passed = await judge({ reasoning: d.reasoning, premises }, e.reasoningCriteria);
    out.push({ kind: "reasoning", passed, detail: passed ? "judge passed" : "judge failed" });
  }

  return out;
}

/** Score an analyzer run. */
async function scoreAnalyze(c: AnalyzeCase, d: PremiseRunDetail, judge: Judge): Promise<AssertionResult[]> {
  const out: AssertionResult[] = [];
  const { expect: e } = c;

  if (e.speechActType) {
    out.push({
      kind: "speech_act",
      passed: d.speechActType === e.speechActType,
      detail: `expected ${e.speechActType}, got ${d.speechActType ?? "none"}`,
    });
  }

  const f = d.felicity;
  if (e.authorityBand) {
    out.push({ kind: "authority", passed: f !== undefined && inBand(f.authority, e.authorityBand), detail: `expected authority in [${e.authorityBand}], got ${f?.authority ?? "none"}` });
  }
  if (e.sincerityBand) {
    out.push({ kind: "sincerity", passed: f !== undefined && inBand(f.sincerity, e.sincerityBand), detail: `expected sincerity in [${e.sincerityBand}], got ${f?.sincerity ?? "none"}` });
  }
  if (e.clarityBand) {
    out.push({ kind: "clarity", passed: f !== undefined && inBand(f.clarity, e.clarityBand), detail: `expected clarity in [${e.clarityBand}], got ${f?.clarity ?? "none"}` });
  }
  if (e.entropyBand) {
    out.push({ kind: "entropy", passed: d.semanticEntropy !== undefined && inBand(d.semanticEntropy, e.entropyBand), detail: `expected entropy in [${e.entropyBand}], got ${d.semanticEntropy ?? "none"}` });
  }

  if (e.reasoningCriteria) {
    const passed = await judge({ reasoning: d.reasoning, speechActType: d.speechActType, felicity: f, semanticEntropy: d.semanticEntropy }, e.reasoningCriteria);
    out.push({ kind: "reasoning", passed, detail: passed ? "judge passed" : "judge failed" });
  }

  return out;
}

/**
 * Score a single run of a case. A run passes iff every assertion passes.
 *
 * @param c - The premise case being evaluated.
 * @param detail - The normalized agent output for this run.
 * @param judge - Injected LLM judge for coverage/exclusion/reasoning assertions.
 */
export async function scoreRun(c: PremiseCase, detail: PremiseRunDetail, judge: Judge): Promise<RunResult> {
  const assertions =
    c.component === "decompose" ? await scoreDecompose(c, detail, judge) : await scoreAnalyze(c, detail, judge);
  return { passed: assertions.every((a) => a.passed), assertions, detail };
}

/**
 * Aggregate N runs of a case into a CaseResult with pass-rate and flakiness.
 *
 * @param c - The premise case being evaluated.
 * @param details - One normalized detail per run.
 * @param judge - Injected LLM judge.
 */
export async function scoreCase(c: PremiseCase, details: PremiseRunDetail[], judge: Judge): Promise<CaseResult> {
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

/** Re-exported for parity with other harnesses' reporter usage. */
export { meanRate };
