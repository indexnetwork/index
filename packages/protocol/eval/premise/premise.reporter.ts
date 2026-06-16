import { htmlEscape, rateClass, htmlRateCI, renderRuleTable, renderScorecardShell, type Regression } from "../shared/index.js";
import type { CaseResult, PremiseCase, PremiseRunDetail, Scorecard } from "./premise.types.js";

/** Render the per-run detail (premises or felicity scores) behind a collapsible block. */
function detailHtml(d: PremiseRunDetail, i: number): string {
  if (d.component === "decompose") {
    const items = (d.premises ?? [])
      .map((p) => `<li>${htmlEscape(p.text)} <span class="muted">(${p.tier})</span></li>`)
      .join("");
    const body = items ? `<ul>${items}</ul>` : "<p class='muted'>no premises</p>";
    return `<div class="reason"><span class="muted">run ${i + 1} · ${(d.premises ?? []).length} premise(s)</span>${body}<p class="muted">${htmlEscape(d.reasoning)}</p></div>`;
  }
  const f = d.felicity;
  return `<div class="reason"><span class="muted">run ${i + 1} · ${htmlEscape(d.speechActType ?? "?")}</span><p>authority ${f?.authority ?? "?"} · sincerity ${f?.sincerity ?? "?"} · clarity ${f?.clarity ?? "?"} · entropy ${d.semanticEntropy ?? "?"}</p><p class="muted">${htmlEscape(d.reasoning)}</p></div>`;
}

/** Render failed assertions for a case. */
function failedChecks(c: CaseResult): string {
  const failed = c.runResults.flatMap((rr, i) =>
    rr.assertions
      .filter((a) => !a.passed)
      .map((a) => `<li><span class="muted">run ${i + 1}</span> <span class="component">${htmlEscape(a.kind)}</span>: ${htmlEscape(a.detail)}</li>`),
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
  const details = c.runResults.map((rr, i) => (rr.detail ? detailHtml(rr.detail, i) : "")).join("");
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
export function renderHtml(sc: Scorecard, regressions: Regression[], cases: PremiseCase[]): string {
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
  });
}

/** Write a standalone HTML scorecard to disk. */
export async function writeHtmlReport(
  path: string,
  sc: Scorecard,
  regressions: Regression[],
  cases: PremiseCase[],
): Promise<void> {
  await Bun.write(path, renderHtml(sc, regressions, cases));
}
