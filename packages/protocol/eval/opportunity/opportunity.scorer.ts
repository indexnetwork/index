import { GREETING_MAX_LEN } from "./opportunity.constants.js";
import { hasGreetingPrefix, hasInternalLabel, hasMarkdown, hasUuid } from "./opportunity.leakage.js";
import type { AssertionResult, CaseResult, OpportunityCase, OpportunityRunDetail, RunResult } from "./opportunity.types.js";

/** Grades a natural-language criterion. Returns true on pass. Injected for testability. */
export type Judge = (output: unknown, criteria: string) => Promise<boolean>;

const SECOND_PERSON_RE = /\byou(r|rs|rself)?\b/i;

/**
 * Score a single run of an opportunity card case. A run passes iff every assertion passes.
 *
 * @param c - The case being evaluated.
 * @param d - The normalized presenter output for this run.
 * @param judge - Injected LLM judge for grounding/framing/tone checks.
 */
export async function scoreRun(c: OpportunityCase, d: OpportunityRunDetail, judge: Judge): Promise<RunResult> {
  const out: AssertionResult[] = [];
  const { expect: e } = c;
  const fields = [d.headline, d.personalizedSummary, d.suggestedAction, d.greeting];

  // The card must actually say something.
  out.push({
    kind: "non_empty",
    passed: d.headline.trim() !== "" && d.personalizedSummary.trim() !== "" && d.suggestedAction.trim() !== "",
    detail: "headline, summary, and suggested action must be non-empty",
  });

  // Addresses the viewer directly (on by default).
  if (e.secondPerson !== false) {
    out.push({
      kind: "voice",
      passed: SECOND_PERSON_RE.test(d.personalizedSummary),
      detail: SECOND_PERSON_RE.test(d.personalizedSummary) ? "summary speaks to the viewer" : "summary never says 'you'/'your'",
    });
  }

  // No raw identifiers or internal labels in any field (on by default).
  if (e.noLeakage !== false) {
    const uuidField = fields.find((f) => hasUuid(f));
    out.push({ kind: "uuid", passed: uuidField === undefined, detail: uuidField === undefined ? "no UUIDs in user-facing copy" : "a UUID leaked into the card" });
    const labelField = fields.find((f) => hasInternalLabel(f));
    out.push({ kind: "label", passed: labelField === undefined, detail: labelField === undefined ? "no internal labels in user-facing copy" : "an internal label leaked into the card" });
  }

  // Greeting must be plain prose within length (opt-in via greetingClean; skipped when empty).
  if (e.greetingClean === true && d.greeting.trim() !== "") {
    const cleanFormat = !hasMarkdown(d.greeting) && !hasGreetingPrefix(d.greeting);
    out.push({ kind: "greeting_format", passed: cleanFormat, detail: cleanFormat ? "greeting is plain prose with no salutation prefix" : "greeting has markdown or a 'Hey Name,' prefix" });
    out.push({ kind: "greeting_length", passed: d.greeting.length <= GREETING_MAX_LEN, detail: `greeting is ${d.greeting.length} chars (max ${GREETING_MAX_LEN})` });
  }

  // ── Judged ────────────────────────────────────────────────────────────
  if (e.mustReference) {
    const passed = await judge(
      { headline: d.headline, summary: d.personalizedSummary, suggestedAction: d.suggestedAction },
      `The card must accurately reflect this context and not contradict or invent facts beyond it: ${e.mustReference}.`,
    );
    out.push({ kind: "grounding", passed, detail: passed ? "judge: grounded in context" : "judge: hallucinated or off-context" });
  }
  if (e.framingCriteria) {
    const passed = await judge(
      { headline: d.headline, summary: d.personalizedSummary, suggestedAction: d.suggestedAction, greeting: d.greeting },
      e.framingCriteria,
    );
    out.push({ kind: "framing", passed, detail: passed ? "judge: framing correct" : "judge: framing wrong" });
  }
  if (e.toneCriteria) {
    const passed = await judge({ headline: d.headline, summary: d.personalizedSummary, suggestedAction: d.suggestedAction }, e.toneCriteria);
    out.push({ kind: "tone", passed, detail: passed ? "judge: tone good" : "judge: tone off" });
  }

  return { passed: out.every((a) => a.passed), assertions: out, detail: d };
}

/**
 * Aggregate N runs of a case into a CaseResult with pass-rate and flakiness.
 *
 * @param c - The case being evaluated.
 * @param details - One normalized card detail per run.
 * @param judge - Injected LLM judge.
 */
export async function scoreCase(c: OpportunityCase, details: OpportunityRunDetail[], judge: Judge): Promise<CaseResult> {
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
