import { htmlEscape, htmlRateCI, rateClass, renderRuleTable, renderScorecardShell, type EvalExecutionEvidence, type Regression } from "../shared/index.js";
import type { CaseResult, DiscoveryRetrievalCase, ModeResult, RetrievalMode, Scorecard } from "./discovery-retrieval.types.js";

const MODE_LABEL: Record<RetrievalMode, string> = {
  intent_to_premise: "Intent → premise",
  intent_to_context: "Intent → user context",
  context_to_context: "Context → user context",
};

function averageRecall(mode: ModeResult | undefined): number | null {
  if (!mode || mode.runResults.length === 0) return null;
  return mode.runResults.reduce((total, run) => total + run.detail.recallAtK, 0) / mode.runResults.length;
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

function modeByName(c: CaseResult, mode: RetrievalMode): ModeResult | undefined {
  return c.modeResults.find((result) => result.mode === mode);
}

function failedChecks(c: CaseResult): string {
  const failures = c.modeResults.flatMap((mode) => mode.runResults.flatMap((run, index) =>
    run.assertions
      .filter((assertion) => !assertion.passed)
      .map((assertion) => `<li><span class="muted">${htmlEscape(MODE_LABEL[mode.mode])}, run ${(run.runIndex ?? index) + 1}</span> <span class="component">${htmlEscape(assertion.kind)}</span>: ${htmlEscape(assertion.detail)}</li>`),
  ));
  return failures.length === 0
    ? ""
    : `<details class="failures" open><summary>failed checks (${failures.length})</summary><ul>${failures.join("")}</ul></details>`;
}

function modeDetails(mode: ModeResult): string {
  const runs = mode.runResults.map((run, index) => {
    const ranking = run.detail.ranking
      .map((entry, rank) => `<li>${rank + 1}. <code>${htmlEscape(entry.userId)}</code> <span class="muted">${entry.score.toFixed(3)} · ${htmlEscape(entry.text)}</span></li>`)
      .join("");
    return `<div class="reason"><span class="muted">run ${(run.runIndex ?? index) + 1} · Recall@K ${percent(run.detail.recallAtK)}</span><ul>${ranking}</ul></div>`;
  }).join("");
  return `<details><summary>${htmlEscape(MODE_LABEL[mode.mode])} rankings (${mode.runResults.length} run${mode.runResults.length === 1 ? "" : "s"})</summary>${runs}</details>`;
}

function caseCard(c: CaseResult, meta: DiscoveryRetrievalCase | undefined): string {
  const premise = modeByName(c, "intent_to_premise");
  const context = modeByName(c, "intent_to_context");
  const contextToContext = modeByName(c, "context_to_context");
  const premiseRecall = averageRecall(premise);
  const contextRecall = averageRecall(context);
  const delta = premiseRecall === null || contextRecall === null ? null : contextRecall - premiseRecall;
  const descriptions = meta
    ? `<p class="desc">${htmlEscape(meta.description)}</p><p class="desc"><span class="muted">intent:</span> ${htmlEscape(meta.source.intent)}</p>`
    : "";
  const modeRows = [premise, context, contextToContext].filter((mode): mode is ModeResult => mode !== undefined)
    .map((mode) => `<tr><td>${htmlEscape(MODE_LABEL[mode.mode])}</td><td>${htmlRateCI(mode.passRate, mode.passes, mode.runs)}</td><td>${percent(averageRecall(mode))}</td></tr>`)
    .join("");
  const details = c.modeResults.map(modeDetails).join("");
  return `<article class="case ${rateClass(c.passRate)}">
    <header><code class="cid">${htmlEscape(c.caseId)}</code><span class="verdict ${rateClass(c.passRate)}" title="${c.passes}/${c.runs} mode-runs">${htmlRateCI(c.passRate, c.passes, c.runs)}</span>${meta ? `<span class="badge">tier ${meta.tier}</span>` : ""}${c.flaky ? '<span class="badge flaky">flaky</span>' : ""}</header>
    ${descriptions}
    <table><thead><tr><th>Representation</th><th>Pass rate</th><th>Recall@K</th></tr></thead><tbody>${modeRows}</tbody></table>
    <p class="desc"><strong>Paired context − premise Recall@K:</strong> ${delta === null ? "n/a" : `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`}</p>
    ${failedChecks(c)}
    ${details}
  </article>`;
}

const INTRO = `<h2>What this report is measuring</h2>
<p>This evaluates the same frozen candidate pool represented as individual premises or one user-context paragraph. Intent-to-premise and intent-to-context are shown separately. Their paired delta is <strong>context Recall@K minus premise Recall@K</strong>; it is evidence of retrieval quality, not a claim that the representations should be equal. Context-to-context is reported independently because it embeds the source context directly rather than generating an intent HyDE query.</p>`;

export function renderHtml(
  scorecard: Scorecard,
  regressions: Regression[],
  cases: DiscoveryRetrievalCase[],
  execution?: EvalExecutionEvidence,
): string {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const cards = [...scorecard.rules]
    .sort((left, right) => left.rule.localeCompare(right.rule))
    .map((rule) => `<section class="rule"><h2>${htmlEscape(rule.rule)}</h2>${scorecard.cases
      .filter((result) => result.rule === rule.rule)
      .map((result) => caseCard(result, byId.get(result.caseId)))
      .join("")}</section>`)
    .join("");
  return renderScorecardShell(scorecard, regressions, {
    title: "Discovery retrieval eval",
    intro: INTRO,
    sections: [{ heading: "By rule", html: renderRuleTable(scorecard) }],
    caseCardsHtml: cards,
    execution,
  });
}

export async function writeHtmlReport(
  outputPath: string,
  scorecard: Scorecard,
  regressions: Regression[],
  cases: DiscoveryRetrievalCase[],
  execution?: EvalExecutionEvidence,
): Promise<void> {
  await Bun.write(outputPath, renderHtml(scorecard, regressions, cases, execution));
}
