import { htmlEscape, rateClass, htmlRateCI, renderRuleTable, renderScorecardShell, type EvalExecutionEvidence, type HumanReport, type Regression } from "../shared/index.js";
import type { AssertionKind, CaseResult, OpportunityCase, Rule, Scorecard, OpportunityRunDetail } from "./opportunity.types.js";

// ─── Plain-language copy for the non-technical report ────────────────────────

/** Ordered themes for "What we tested", each mapped to one rule. */
const GROUPS: { ruleIds: Rule[]; label: string; blurb: string }[] = [
  { ruleIds: ["viewer_voice"], label: "Speaking to the reader directly", blurb: "Writing the card to \u201cyou\u201d \u2014 the person it's for \u2014 not as a detached report." },
  { ruleIds: ["no_leakage"], label: "No database leaks or jargon", blurb: "Never showing raw ids or internal labels in a card a person reads." },
  { ruleIds: ["greeting"], label: "A clean intro message", blurb: "Drafting a natural opener with no formatting and no \u201cHey Name,\u201d header." },
  { ruleIds: ["grounding"], label: "Sticking to the facts", blurb: "Explaining the match using the real context, not invented details." },
  { ruleIds: ["introducer_role"], label: "Getting the framing right", blurb: "When someone is connecting two others \u2014 or made a personal intro \u2014 the card reflects that." },
  { ruleIds: ["tone"], label: "Warm, not clinical", blurb: "Reading like a personal recommendation, not a dry analysis of two strangers." },
];

/** Plain-language name for each failing check, used in "what happened" notes. */
const CHECK_COPY: Record<AssertionKind, string> = {
  non_empty: "left part of the card blank",
  voice: "didn't speak to the reader directly",
  uuid: "leaked a raw database id into the card",
  label: "used internal jargon in the card",
  greeting_format: "the intro message had formatting or a \u201cHey Name,\u201d header",
  greeting_length: "the intro message was too long",
  grounding: "described the match inaccurately",
  framing: "framed the connection from the wrong point of view",
  tone: "the copy read as cold or clinical",
};

/** Distinct plain-language reasons a case failed, across its runs. */
function failNote(c: CaseResult): string | undefined {
  const kinds = new Set<AssertionKind>();
  for (const rr of c.runResults) for (const a of rr.assertions) if (!a.passed) kinds.add(a.kind);
  if (kinds.size === 0) return undefined;
  return [...kinds].map((k) => CHECK_COPY[k]).join("; ") + ".";
}

/** Build the plain-language report from the scorecard + corpus narratives. */
function buildHumanReport(sc: Scorecard, cases: OpportunityCase[]): HumanReport {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const resultById = new Map(sc.cases.map((c) => [c.caseId, c]));
  const groups = GROUPS.map((g) => ({
    label: g.label,
    blurb: g.blurb,
    ruleIds: g.ruleIds as string[],
    cases: sc.cases
      .filter((c) => g.ruleIds.includes(c.rule))
      .map((c) => {
        const meta = byId.get(c.caseId);
        const result = resultById.get(c.caseId);
        return {
          caseId: c.caseId,
          scenario: meta?.human?.scenario ?? meta?.description ?? c.caseId,
          expectation: meta?.human?.expectation ?? "produce a good card.",
          failNote: result ? failNote(result) : undefined,
        };
      }),
  })).filter((g) => g.cases.length > 0);
  return {
    subject: "the card writer",
    oneLiner: "It writes the connection cards people actually read \u2014 the headline, the why-this-matters, and a ready-to-send intro \u2014 and must keep them clean, accurate, and personal.",
    groups,
  };
}

// ─── Technical case cards ────────────────────────────────────────────────────

/** Render one run's generated card behind a collapsible block. */
function detailHtml(d: OpportunityRunDetail, runIndex: number): string {
  const leaks = d.leaks.length > 0 ? ` <span class="bad">leaks: ${htmlEscape(d.leaks.join(", "))}</span>` : "";
  return `<div class="reason">
    <span class="muted">run ${runIndex + 1}</span>${leaks}
    <p><strong>${htmlEscape(d.headline)}</strong></p>
    <p>${htmlEscape(d.personalizedSummary)}</p>
    <p class="muted">action: ${htmlEscape(d.suggestedAction)}</p>
    <p class="muted">greeting: ${htmlEscape(d.greeting || "\u2014")}</p>
  </div>`;
}

/** Render failed assertions for a case. */
function failedChecks(c: CaseResult): string {
  const failed = c.runResults.flatMap((rr, i) =>
    rr.assertions
      .filter((a) => !a.passed)
      .map((a) => `<li><span class="muted">run ${(rr.runIndex ?? i) + 1}</span> <span class="component">${htmlEscape(a.kind)}</span>: ${htmlEscape(a.detail)}</li>`),
  );
  if (failed.length === 0) return "";
  return `<details class="failures" open><summary>failed checks (${failed.length})</summary><ul>${failed.join("")}</ul></details>`;
}

/** Render one case card. */
function caseCard(c: CaseResult, meta: OpportunityCase | undefined): string {
  const tier = meta ? `<span class="badge">tier ${meta.tier}</span>` : "";
  const role = meta ? `<span class="badge">${htmlEscape(meta.input.viewerRole)}</span>` : "";
  const flaky = c.flaky ? `<span class="badge flaky">flaky</span>` : "";
  const desc = meta?.description ? `<p class="desc">${htmlEscape(meta.description)}</p>` : "";
  const details = c.runResults.map((rr, i) => (rr.detail ? detailHtml(rr.detail, rr.runIndex ?? i) : "")).join("");
  return `
  <article class="case ${rateClass(c.passRate)}">
    <header>
      <code class="cid">${htmlEscape(c.caseId)}</code>
      <span class="verdict ${rateClass(c.passRate)}" title="${c.passes}/${c.runs} runs">${htmlRateCI(c.passRate, c.passes, c.runs)}</span>
      ${role}${tier}${flaky}
    </header>
    ${desc}
    ${failedChecks(c)}
    <details><summary>generated card (${c.runResults.length} run${c.runResults.length === 1 ? "" : "s"})</summary>${details}</details>
  </article>`;
}

const INTRO = `<h2>What this report is measuring</h2>
<p>This is a repeatability test for the opportunity-card writer \u2014 the part that turns a match into the card a person reads: a headline, a \u201cwhy this matters to you\u201d summary, a suggested next step, and a ready-to-send intro message. Each case runs N times; a run passes only when every check passes. Leaking a raw id, slipping into internal jargon, or drifting from the facts fails the run.</p>`;

/**
 * Render a standalone HTML scorecard for an opportunity-card run via the shared shell.
 *
 * @param sc - The scorecard (run-report grade, with per-run detail intact).
 * @param regressions - Regressions vs the baseline.
 * @param cases - The corpus, joined by id for description, role, and narratives.
 */
export function renderHtml(
  sc: Scorecard,
  regressions: Regression[],
  cases: OpportunityCase[],
  execution?: EvalExecutionEvidence,
): string {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const caseCards = [...sc.rules]
    .sort((x, y) => x.passRate - y.passRate)
    .map((r) => {
      const cards = sc.cases.filter((c) => c.rule === r.rule).map((c) => caseCard(c, byId.get(c.caseId))).join("");
      return `<section class="rule"><h2>${htmlEscape(r.rule)}</h2>${cards}</section>`;
    })
    .join("");

  return renderScorecardShell(sc, regressions, {
    title: "Opportunity eval",
    intro: INTRO,
    sections: [{ heading: "By rule", html: renderRuleTable(sc) }],
    caseCardsHtml: caseCards,
    human: buildHumanReport(sc, cases),
    execution,
  });
}

/** Write a standalone HTML scorecard to disk. */
export async function writeHtmlReport(
  path: string,
  sc: Scorecard,
  regressions: Regression[],
  cases: OpportunityCase[],
  execution?: EvalExecutionEvidence,
): Promise<void> {
  await Bun.write(path, renderHtml(sc, regressions, cases, execution));
}
