import { htmlEscape, renderRuleTable, renderScorecardShell, type EvalExecutionEvidence, type Regression } from "../shared/index.js";
import { MATRIX_ROWS, type MatrixBaselineScorecard, type MatrixScorecard } from "./historical-matrix.policy.js";

function slotOrder(left: MatrixScorecard["cases"][number], right: MatrixScorecard["cases"][number]): number {
  const caseOrder = left.caseId.localeCompare(right.caseId);
  if (caseOrder !== 0) return caseOrder;
  const leftRow = MATRIX_ROWS.findIndex((row) => row.id === left.rowId);
  const rightRow = MATRIX_ROWS.findIndex((row) => row.id === right.rowId);
  if (leftRow !== rightRow) return leftRow - rightRow;
  return left.repetition - right.repetition;
}

function assertionsHtml(scorecard: MatrixScorecard["cases"][number]): string {
  return scorecard.assertions
    .map((assertion) => `${htmlEscape(assertion.kind)}: ${assertion.passed ? "pass" : "fail"}`)
    .join("<br>");
}

function configDeltasHtml(scorecard: MatrixScorecard["cases"][number]): string {
  return scorecard.configDeltas.length === 0
    ? "—"
    : scorecard.configDeltas
      .map((delta) => `${htmlEscape(delta.key)}: ${htmlEscape(delta.before ?? "unset")} → ${htmlEscape(delta.after ?? "unset")}`)
      .join("<br>");
}

function matrixTable(scorecard: MatrixScorecard): string {
  const rows = [...scorecard.cases]
    .sort(slotOrder)
    .map((slot) => `<tr>
      <td><code>${htmlEscape(slot.caseId)}</code></td>
      <td>${htmlEscape(slot.rowId)}</td>
      <td>${slot.repetition + 1}</td>
      <td>${slot.targetRank ?? "not returned"}</td>
      <td>${htmlEscape(slot.evidenceTypes.join(", ") || "none")}</td>
      <td>${assertionsHtml(slot)}</td>
      <td>${slot.judge ? (slot.judge.passed ? "pass" : "fail") : "not run"}</td>
      <td>${configDeltasHtml(slot)}</td>
    </tr>`)
    .join("");
  return `<table><thead><tr><th>case</th><th>row</th><th>repetition</th><th>target rank</th><th>evidence types</th><th>deterministic assertions</th><th>judge result</th><th>config deltas</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const INTRO = `<h2>What this report is measuring</h2>
<p>Each row evaluates one frozen historical case under one discovery environment. A slot passes only when the expected target is returned, excluded and non-fixture candidates are absent, all evidence is permitted for that row, execution completed, and the relationship judge approves.</p>`;

/** Renders the raw run scorecard; candidate text remains in JSON artifacts, not this summary table. */
export function renderHtml(
  scorecard: MatrixScorecard,
  regressions: Regression[],
  execution?: EvalExecutionEvidence,
): string {
  return renderScorecardShell(scorecard, regressions, {
    title: "Discovery environment matrix eval",
    intro: INTRO,
    sections: [
      { heading: "By matrix row", html: renderRuleTable(scorecard) },
      { heading: "Slots (case → row → repetition)", html: matrixTable(scorecard) },
    ],
    execution,
  });
}

/**
 * Produces the lean payload required for a governed baseline. It retains IDs,
 * evidence, assertions, judge outcomes, and configuration deltas while
 * removing raw provider candidate text that belongs only in a run artifact.
 */
export function leanMatrixScorecard(scorecard: MatrixScorecard): MatrixBaselineScorecard {
  return {
    ...scorecard,
    rules: scorecard.rules.map((rule) => ({ ...rule })),
    cases: scorecard.cases.map(({ candidates, assertions, evidenceTypes, configDeltas, ...slot }) => ({
      ...slot,
      evidenceTypes: [...evidenceTypes],
      assertions: assertions.map((assertion) => ({ ...assertion })),
      configDeltas: configDeltas.map((delta) => ({ ...delta })),
      candidates: candidates.map(({ id, evidenceTypes: candidateEvidence }) => ({ id, evidenceTypes: [...candidateEvidence] })),
    })),
  };
}

export async function writeHtmlReport(
  outputPath: string,
  scorecard: MatrixScorecard,
  regressions: Regression[],
  execution?: EvalExecutionEvidence,
): Promise<void> {
  await Bun.write(outputPath, renderHtml(scorecard, regressions, execution));
}
