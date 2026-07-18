import { htmlEscape, rateClass, htmlRateCI, renderRuleTable, renderScorecardShell, type EvalExecutionEvidence, type HumanReport, type Regression } from "../shared/index.js";
import type { AssertionKind, CaseResult, PremiseCase, Rule, Scorecard, PremiseRunDetail } from "./premise.types.js";

// ─── Plain-language copy for the non-technical report ────────────────────────

/** Ordered themes for "What we tested", each mapped to one or more rules. */
const GROUPS: { ruleIds: Rule[]; label: string; blurb: string }[] = [
  { ruleIds: ["atomicity"], label: "Breaking text into separate facts", blurb: "Splitting a run-on bio into one clear fact at a time, in the person's own voice." },
  { ruleIds: ["tier_classification"], label: "Permanent facts vs current status", blurb: "Telling a lasting fact (a role) apart from a temporary one (currently fundraising)." },
  { ruleIds: ["intent_exclusion"], label: "Keeping facts, dropping wishes", blurb: "Saving who a person is, and ignoring what they're looking for." },
  { ruleIds: ["empty_input"], label: "Knowing when there's nothing to save", blurb: "Not inventing facts out of an empty greeting." },
  { ruleIds: ["speech_act"], label: "Recognizing the kind of statement", blurb: "Telling an identity claim apart from a description of experience." },
  { ruleIds: ["felicity_calibration"], label: "Judging how solid a claim is", blurb: "Scoring how specific and credible a self-description is." },
  { ruleIds: ["entropy"], label: "Spotting vague vs specific", blurb: "Flagging a statement that's too vague to be useful." },
];

/** Plain-language name for each failing check, used in "what happened" notes. */
const CHECK_COPY: Record<AssertionKind, string> = {
  count: "split the text into the wrong number of facts",
  empty: "invented facts from an empty message",
  tier: "mislabeled a permanent fact as temporary, or vice versa",
  first_person: "wrote a fact that wasn't in the person's own voice",
  coverage: "missed one of the key facts",
  exclusion: "kept something that was a wish, not a fact",
  speech_act: "misjudged what kind of statement it was",
  authority: "mis-scored how credible the claim is",
  sincerity: "mis-scored how genuine the claim sounds",
  clarity: "mis-scored how specific the claim is",
  entropy: "mis-scored how vague the claim is",
  reasoning: "its explanation didn't hold up",
};

/** Distinct plain-language reasons a case failed, across its runs. */
function failNote(c: CaseResult): string | undefined {
  const kinds = new Set<AssertionKind>();
  for (const rr of c.runResults) for (const a of rr.assertions) if (!a.passed) kinds.add(a.kind);
  if (kinds.size === 0) return undefined;
  return [...kinds].map((k) => CHECK_COPY[k]).join("; ") + ".";
}

/** Build the plain-language report from the scorecard + corpus narratives. */
function buildHumanReport(sc: Scorecard, cases: PremiseCase[]): HumanReport {
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
          expectation: meta?.human?.expectation ?? "behave correctly.",
          failNote: result ? failNote(result) : undefined,
        };
      }),
  })).filter((g) => g.cases.length > 0);
  return {
    subject: "the premise builder",
    oneLiner: "It turns what someone says about themselves into clean, separate facts — and judges how clear and credible each one is.",
    groups,
  };
}

/** Render the per-run detail (premises or felicity scores) behind a collapsible block. */
function detailHtml(d: PremiseRunDetail, runIndex: number): string {
  if (d.component === "decompose") {
    const items = (d.premises ?? [])
      .map((p) => `<li>${htmlEscape(p.text)} <span class="muted">(${p.tier})</span></li>`)
      .join("");
    const body = items ? `<ul>${items}</ul>` : "<p class='muted'>no premises</p>";
    return `<div class="reason"><span class="muted">run ${runIndex + 1} · ${(d.premises ?? []).length} premise(s)</span>${body}<p class="muted">${htmlEscape(d.reasoning)}</p></div>`;
  }
  const f = d.felicity;
  return `<div class="reason"><span class="muted">run ${runIndex + 1} · ${htmlEscape(d.speechActType ?? "?")}</span><p>authority ${f?.authority ?? "?"} · sincerity ${f?.sincerity ?? "?"} · clarity ${f?.clarity ?? "?"} · entropy ${d.semanticEntropy ?? "?"}</p><p class="muted">${htmlEscape(d.reasoning)}</p></div>`;
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
function caseCard(c: CaseResult, meta: PremiseCase | undefined): string {
  const tier = meta ? `<span class="badge">tier ${meta.tier}</span>` : "";
  const comp = meta ? `<span class="badge">${htmlEscape(meta.component)}</span>` : "";
  const flaky = c.flaky ? `<span class="badge flaky">flaky</span>` : "";
  const desc = meta?.description ? `<p class="desc">${htmlEscape(meta.description)}</p>` : "";
  const input = meta ? `<p class="desc"><span class="muted">input:</span> <code>${htmlEscape(meta.input)}</code></p>` : "";
  const details = c.runResults.map((rr, i) => (rr.detail ? detailHtml(rr.detail, rr.runIndex ?? i) : "")).join("");
  return `
  <article class="case ${rateClass(c.passRate)}">
    <header>
      <code class="cid">${htmlEscape(c.caseId)}</code>
      <span class="verdict ${rateClass(c.passRate)}" title="${c.passes}/${c.runs} runs">${htmlRateCI(c.passRate, c.passes, c.runs)}</span>
      ${comp}${tier}${flaky}
    </header>
    ${desc}${input}
    ${failedChecks(c)}
    <details><summary>agent output (${c.runResults.length} run${c.runResults.length === 1 ? "" : "s"})</summary>${details}</details>
  </article>`;
}

const INTRO = `<h2>What this report is measuring</h2>
<p>This is a repeatability test for the premise agents. <strong>Decompose</strong> cases check that free text splits into atomic, first-person premises with the right tiering and no leaked intents. <strong>Analyze</strong> cases check speech-act classification (DECLARATIVE vs ASSERTIVE) and felicity-condition calibration (authority, sincerity, clarity, semantic entropy). Each case runs N times; a run passes only when every check passes.</p>`;

/**
 * Render a standalone HTML scorecard for a premise-eval run via the shared shell.
 *
 * @param sc - The scorecard to render (run-report grade, with per-run detail intact).
 * @param regressions - Regressions vs the baseline.
 * @param cases - The corpus, joined by id for input text, tier, and description.
 */
export function renderHtml(
  sc: Scorecard,
  regressions: Regression[],
  cases: PremiseCase[],
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
    title: "Premise eval",
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
  cases: PremiseCase[],
  execution?: EvalExecutionEvidence,
): Promise<void> {
  await Bun.write(path, renderHtml(sc, regressions, cases, execution));
}
