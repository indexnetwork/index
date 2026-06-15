import { readdir } from "node:fs/promises";

import type { CaseResult, RuleResult, Scorecard, Rule, MatchingCase, CandidateExpectation, CandidateOutcome, AssertionKind } from "./matching.types.js";

// ── Statistical helpers ─────────────────────────────────────────────────────

/** Wilson score interval without continuity correction. Returns [lo, hi]. */
export function binomialCI(passes: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 1];
  const p = passes / total;
  const denom = 1 + z * z / total;
  const centre = (p + z * z / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)) / denom;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/** ln(n!) computed exactly enough for the small-n exact binomial CDF path. */
function lnFactorial(n: number): number {
  let out = 0;
  for (let i = 2; i <= n; i++) out += Math.log(i);
  return out;
}

/** Natural log of binomial coefficient C(n, k). */
function lnChoose(n: number, k: number): number {
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k);
}

function lnBetaInt(a: number, b: number): number {
  return lnFactorial(a - 1) + lnFactorial(b - 1) - lnFactorial(a + b - 1);
}

/**
 * One-sided binomial point-null p-value.
 * H₀: true pass-rate = nullRate; Ha: true pass-rate < nullRate (regression).
 */
export function binomialPValue(observedPasses: number, total: number, nullRate: number): number {
  if (total === 0) return 1;
  if (nullRate <= 0) return 1;
  if (nullRate >= 1) return observedPasses < total ? 0 : 1;
  let cumulative = 0;
  for (let k = 0; k <= observedPasses; k++) {
    const logP = lnChoose(total, k) + k * Math.log(nullRate) + (total - k) * Math.log1p(-nullRate);
    cumulative += Math.exp(logP);
  }
  return Math.min(1, Math.max(0, cumulative));
}

/**
 * One-sided beta-binomial posterior-predictive p-value.
 *
 * This treats the committed baseline as observed evidence rather than a perfect
 * point estimate. With a uniform Beta(1,1) prior, baseline x/n gives posterior
 * Beta(x+1, n-x+1), and we ask how likely the current pass count or lower is
 * under that posterior predictive distribution. This prevents 7/7 baselines
 * from making a single future miss mathematically impossible.
 */
export function predictivePValue(
  observedPasses: number,
  observedRuns: number,
  baselinePasses: number,
  baselineRuns: number,
): number {
  if (observedRuns === 0 || baselineRuns === 0) return 1;
  const a = baselinePasses + 1;
  const b = baselineRuns - baselinePasses + 1;
  const base = lnBetaInt(a, b);
  let cumulative = 0;
  for (let k = 0; k <= observedPasses; k++) {
    const logP = lnChoose(observedRuns, k) + lnBetaInt(k + a, observedRuns - k + b) - base;
    cumulative += Math.exp(logP);
  }
  return Math.min(1, Math.max(0, cumulative));
}

/** True when the posterior-predictive p-value is at or below alpha. */
export function binomialSignificance(observedPasses: number, total: number, nullRate: number, alpha = 0.05): boolean {
  return binomialPValue(observedPasses, total, nullRate) <= alpha;
}

/** Analytical error function (Abramowitz & Stegun 7.1.26). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/** Rate string with 95% confidence — only call this when n ≤ 1 cases (D2NPFN). */
function rateWithCI(passes: number, total: number): string {
  const [lo, hi] = binomialCI(passes, total);
  return `${Math.round((passes / total) * 100)}% (CI₉₅ ${Math.round(lo * 100)}%–${Math.round(hi * 100)}%)`;
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Computes the arithmetic mean of case rates within a list of CaseResult entries. */
export function meanRate(list: CaseResult[]): number {
  if (list.length === 0) return 0;
  return list.reduce((s, c) => s + c.passRate, 0) / list.length;
}

/**
 * Aggregates raw case results into a scorecard with per-rule and aggregate pass-rates.
 *
 * @param results - The individual case results to aggregate.
 * @param meta - Run metadata: the model name and number of runs per case.
 * @returns A scorecard with per-rule breakdowns, aggregate pass-rate, and generation timestamp.
 */
export function buildScorecard(
  results: CaseResult[],
  meta: { model: string; runs: number },
): Scorecard {
  const byRule = new Map<Rule, CaseResult[]>();
  for (const r of results) {
    const list = byRule.get(r.rule) ?? [];
    list.push(r);
    byRule.set(r.rule, list);
  }
  const rules: RuleResult[] = [...byRule.entries()].map(([rule, list]) => ({
    rule,
    caseCount: list.length,
    passRate: mean(list.map((c) => c.passRate)),
  }));
  return {
    generatedAt: new Date().toISOString(),
    model: meta.model,
    runs: meta.runs,
    aggregatePassRate: mean(results.map((c) => c.passRate)),
    rules,
    cases: results,
  };
}

export interface Regression {
  id: string;
  kind: "case" | "rule";
  before: number;
  after: number;
  /** One-sided posterior-predictive p-value for observing the current pass count or lower under the baseline evidence. */
  pValue: number;
}

/**
 * Compares a current scorecard against a baseline and returns any regressions.
 *
 * A regression is a case or rule where the current pass count is significantly
 * lower than expected from the baseline evidence (one-sided beta-binomial
 * posterior-predictive test at significance level alpha). New cases (absent from
 * baseline) are never regressions.
 *
 * @param current - The scorecard produced by the current run.
 * @param baseline - The previously saved baseline scorecard, or `null` if none exists.
 * @param alpha - Significance level for the one-sided binomial test.
 * @returns An object containing the list of detected regressions.
 */
export function diffBaseline(
  current: Scorecard,
  baseline: Scorecard | null,
  alpha = 0.05,
): { regressions: Regression[]; skippedCaseIds: string[] } {
  if (!baseline) return { regressions: [], skippedCaseIds: [] };
  const regressions: Regression[] = [];
  const skippedCaseIds: string[] = [];

  const baseCases = new Map(baseline.cases.map((c) => [c.caseId, c]));
  for (const c of current.cases) {
    const base = baseCases.get(c.caseId);
    if (base === undefined) {
      skippedCaseIds.push(c.caseId);
      continue;
    }
    const pValue = predictivePValue(c.passes, c.runs, base.passes, base.runs);
    if (pValue <= alpha) {
      regressions.push({ id: c.caseId, kind: "case", before: base.passRate, after: c.passRate, pValue });
    }
  }

  const baseByRule = new Map<Rule, { passes: number; runs: number }>();
  for (const c of baseline.cases) {
    const acc = baseByRule.get(c.rule) ?? { passes: 0, runs: 0 };
    acc.passes += c.passes;
    acc.runs += c.runs;
    baseByRule.set(c.rule, acc);
  }
  const comparableByRule = new Map<Rule, { passes: number; runs: number }>();
  for (const c of current.cases) {
    if (!baseCases.has(c.caseId)) continue;
    const acc = comparableByRule.get(c.rule) ?? { passes: 0, runs: 0 };
    acc.passes += c.passes;
    acc.runs += c.runs;
    comparableByRule.set(c.rule, acc);
  }
  for (const [rule, acc] of comparableByRule.entries()) {
    const base = baseByRule.get(rule);
    if (base === undefined || acc.runs === 0 || base.runs === 0) continue;
    const before = base.passes / base.runs;
    const after = acc.passes / acc.runs;
    const pValue = predictivePValue(acc.passes, acc.runs, base.passes, base.runs);
    if (pValue <= alpha) {
      regressions.push({ id: rule, kind: "rule", before, after, pValue });
    }
  }

  return { regressions, skippedCaseIds };
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const fmtPValue = (p: number): string => (p < 0.001 ? "p<0.001" : `p=${p.toFixed(3)}`);

/** Format a pass-rate with 95% confidence for console display. */
function fmtRate(passes: number, total: number): string {
  return rateWithCI(passes, total);
}

/** Human-readable scorecard for the console. */
export function formatConsole(sc: Scorecard, regressions: Regression[], skippedCaseIds: string[] = []): string {
  const lines: string[] = [];
  lines.push(`\n=== Matching Quality Scorecard ===`);
  lines.push(`model=${sc.model}  runs=${sc.runs}  cases=${sc.cases.length}`);
  // Use per-run observations for the CI while preserving case-level pass-rates for aggregate display.
  lines.push(`aggregate pass-rate: ${fmtRate(sc.cases.reduce((s, c) => s + c.passes, 0), sc.cases.length * sc.runs)}\n`);
  lines.push(`Per rule:`);
  for (const r of [...sc.rules].sort((a, b) => a.passRate - b.passRate)) {
    const n = r.caseCount * sc.runs;
    const passes = Math.round(r.passRate * n);
    lines.push(`  ${r.rule.padEnd(20)} ${fmtRate(passes, n)}  (${r.caseCount} case(s))`);
  }
  const flaky = sc.cases.filter((c) => c.flaky);
  if (flaky.length > 0) {
    lines.push(`\nFlaky (passed some runs, failed others):`);
    for (const c of flaky) lines.push(`  ${c.caseId}  ${c.passes}/${c.runs}`);
  }
  if (regressions.length > 0) {
    lines.push(`\n⚠ Regressions vs baseline:`);
    for (const r of regressions) {
      lines.push(`  [${r.kind}] ${r.id}: ${pct(r.before)} → ${pct(r.after)} (${fmtPValue(r.pValue)})`);
    }
  }
  if (skippedCaseIds.length > 0) {
    lines.push(`\nℹ ${skippedCaseIds.length} case(s) absent from baseline; not regression-checked:`);
    for (const id of skippedCaseIds.slice(0, 10)) lines.push(`  ${id}`);
    if (skippedCaseIds.length > 10) lines.push(`  …and ${skippedCaseIds.length - 10} more`);
  }
  return lines.join("\n");
}

/**
 * Reads a baseline scorecard from a JSON file on disk.
 *
 * @param path - Absolute or relative path to the baseline JSON file.
 * @returns The parsed scorecard, or `null` if the file does not exist.
 */
export async function readBaseline(path: string): Promise<Scorecard | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return (await file.json()) as Scorecard;
}

/**
 * Writes a scorecard to disk as a formatted JSON baseline file.
 *
 * Per-candidate `reasoning` is stripped from each run before writing: the baseline
 * is a diff target, and verbose model reasoning would make every `--update-baseline`
 * a noisy diff. The full reasoning lives in the run report instead ({@link writeRunReport}).
 *
 * @param path - Absolute or relative path to write to (created or overwritten).
 * @param sc - The scorecard to persist.
 */
export async function writeBaseline(path: string, sc: Scorecard): Promise<void> {
  const lean: Scorecard = {
    ...sc,
    cases: sc.cases.map((c) => ({
      ...c,
      runResults: c.runResults.map(({ candidates: _candidates, ...rest }) => rest),
    })),
  };
  await Bun.write(path, JSON.stringify(lean, null, 2) + "\n");
}

/**
 * Writes a full run report to disk: the scorecard *including* each run's
 * per-candidate `reasoning`. This is the explanatory artifact a reviewer or the
 * matching-eval report skill reads to see the evaluator's own justification for
 * every score. Written on demand via the `--report` flag; never committed.
 *
 * @param path - Absolute or relative path to write to. Parent dirs are created.
 * @param sc - The scorecard to persist, with candidate reasoning intact.
 */
export async function writeRunReport(path: string, sc: Scorecard): Promise<void> {
  await Bun.write(path, JSON.stringify(sc, null, 2) + "\n");
}

// ─── Rolling baseline ─────────────────────────────────────────────────────

interface RollingCaseAcc {
  caseId: string;
  rule: Rule;
  passes: number;
  runs: number;
}

/** Reads all JSON scorecards in a run directory, ignoring malformed files. */
async function readRunScorecards(runsDir: string): Promise<Scorecard[]> {
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }

  const out: Scorecard[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const file = Bun.file(`${runsDir}/${entry}`);
      const sc = (await file.json()) as Scorecard;
      if (sc.generatedAt && Array.isArray(sc.cases)) out.push(sc);
    } catch {
      // Run reports are diagnostic artifacts; one malformed file should not
      // disable baseline computation for every other run.
    }
  }
  return out;
}

/**
 * Computes a rolling baseline from recent run reports in `runsDir`.
 *
 * The resulting scorecard is synthetic: each case's baseline pass-rate is the
 * pass-weighted average across all recent scorecards containing that case. This
 * means filtered reports can still contribute to the subset of cases they ran,
 * while absent cases simply fall back to no comparison.
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
): Promise<Scorecard | null> {
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

  const cases: CaseResult[] = [...byCase.values()].map((acc) => {
    const passRate = acc.runs === 0 ? 0 : acc.passes / acc.runs;
    return {
      caseId: acc.caseId,
      rule: acc.rule,
      runs: acc.runs,
      passes: acc.passes,
      passRate,
      flaky: passRate > 0 && passRate < 1,
      runResults: [],
    };
  });

  return {
    ...buildScorecard(cases, { model: `rolling:${days}d:${scorecards.length}run${scorecards.length === 1 ? "" : "s"}`, runs: 1 }),
    generatedAt: now.toISOString(),
  };
}

// ─── HTML report ──────────────────────────────────────────────────────────
//
// A standalone, self-contained HTML scorecard. The `Scorecard` carries the
// evaluator's *actuals* (per-candidate score, role, matched, verbatim
// reasoning) but not the *expectations* — those live in the `MatchingCase`
// corpus. `renderHtml` joins the two by case id so every candidate shows
// expected-vs-actual side by side, with the evaluator's own reasoning behind a
// collapsible block. No external assets, no JS: openable straight from disk.

/** Pass-rate → quality class used for color-coding (≥90% good, ≥70% ok, else bad). */
function rateClass(rate: number): "good" | "ok" | "bad" {
  return rate >= 0.9 ? "good" : rate >= 0.7 ? "ok" : "bad";
}

/** Minimal HTML-entity escaping for text interpolated into the template. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pctText = (n: number): string => `${Math.round(n * 100)}%`;

/** Pass-rate cell text with 95% CI tooltip for HTML tables. */
function htmlRateCI(rate: number, passes: number, total: number): string {
  const [lo, hi] = binomialCI(passes, total);
  const ci = `CI₉₅ ${Math.round(lo * 100)}%–${Math.round(hi * 100)}%`;
  return `<span title="${ci}">${pctText(rate)}</span>`;
}

/** Per-case metadata derived from the corpus, keyed by candidate id. */
interface CaseMeta {
  tier: 1 | 2 | 3 | 4;
  domains: string[];
  description: string;
  discoveryQuery?: string;
  nameById: Map<string, string>;
  expectById: Map<string, CandidateExpectation>;
}

/** Index the corpus by case id, extracting display names and expectations. */
function indexCases(cases: MatchingCase[]): Map<string, CaseMeta> {
  const m = new Map<string, CaseMeta>();
  for (const c of cases) {
    const nameById = new Map<string, string>();
    for (const e of c.input.entities) {
      const reportName = c.reportNames?.[e.userId];
      // HTML reports are outside evaluator/protocol execution, so use a display
      // mapping for readability: reportNames override profile names, and profile
      // names fall back to stable entity ids.
      nameById.set(e.userId, reportName?.trim() || e.profile.name?.trim() || e.userId);
    }
    const expectById = new Map<string, CandidateExpectation>();
    for (const exp of c.expect) expectById.set(exp.candidateId, exp);
    m.set(c.id, { tier: c.tier, domains: c.domains, description: c.description, discoveryQuery: c.input.discoveryQuery, nameById, expectById });
  }
  return m;
}

/** Collect a candidate's outcome across every run that captured candidate detail. */
function outcomesByCandidate(c: CaseResult): Map<string, CandidateOutcome[]> {
  const byId = new Map<string, CandidateOutcome[]>();
  for (const rr of c.runResults) {
    for (const cand of rr.candidates ?? []) {
      const list = byId.get(cand.candidateId) ?? [];
      list.push(cand);
      byId.set(cand.candidateId, list);
    }
  }
  return byId;
}

/**
 * Indicative per-run correctness of one candidate outcome against its expectation:
 * surfaced-ness must match, and (when a band is set) the score must fall in it.
 * This drives chip color only — the authoritative verdict is the case pass-rate.
 */
function outcomeOk(exp: CandidateExpectation | undefined, o: CandidateOutcome): boolean {
  if (!exp) return true;
  if (o.matched !== exp.match) return false;
  if (exp.scoreBand && (o.score < exp.scoreBand[0] || o.score > exp.scoreBand[1])) return false;
  return true;
}

/** Render the expectation cell text for one candidate. */
function expectText(exp: CandidateExpectation | undefined): string {
  if (!exp) return "<span class='muted'>no expectation</span>";
  const surfaced = exp.match
    ? "<span class='tag yes'>surface</span>"
    : "<span class='tag no'>reject</span>";
  const band = exp.scoreBand ? ` <span class='muted'>${exp.scoreBand[0]}–${exp.scoreBand[1]}</span>` : "";
  const role = exp.role ? ` <span class='role'>${esc(exp.role)}</span>` : "";
  return `${surfaced}${band}${role}`;
}

/** Render one candidate's row: expected vs the actual outcome of each run, plus reasoning. */
function candidateRow(
  candidateId: string,
  meta: CaseMeta | undefined,
  outcomes: CandidateOutcome[],
): string {
  const exp = meta?.expectById.get(candidateId);
  const name = meta?.nameById.get(candidateId) ?? candidateId;
  const chips = outcomes
    .map((o) => {
      const ok = outcomeOk(exp, o);
      const roleTxt = o.role ? ` ${esc(o.role)}` : "";
      const returned = o.returned ?? o.score > 0;
      const title = o.matched ? "surfaced" : returned ? "returned below surfacing threshold" : "not returned";
      return `<span class="chip ${ok ? "good" : "bad"}" title="${title}">${o.score}${roleTxt}</span>`;
    })
    .join("");
  const reasoning = outcomes
    .map((o, i) => {
      const returned = o.returned ?? o.score > 0;
      const text = o.reasoning.trim()
        ? o.reasoning
        : returned
          ? "Returned by the evaluator, but the opportunity reasoning field was empty."
          : "Not returned by the evaluator. No opportunity object existed, so there is no evaluator reasoning for this candidate in this run.";
      return `<div class="reason"><span class="muted">run ${i + 1} · score ${o.score}${o.role ? " · " + esc(o.role) : ""}</span><p>${esc(text)}</p></div>`;
    })
    .join("");
  return `
    <tr>
      <td class="cand"><strong>${esc(name)}</strong><br><span class="muted">${esc(candidateId)}</span></td>
      <td>${expectText(exp)}</td>
      <td class="chips">${chips || "<span class='muted'>—</span>"}</td>
    </tr>
    <tr class="reasons"><td colspan="3"><details><summary>evaluator reasoning (${outcomes.length} run${outcomes.length === 1 ? "" : "s"})</summary>${reasoning}</details></td></tr>`;
}

/** Render failed assertions so reviewers can see which protocol component broke. */
function failedChecks(c: CaseResult): string {
  const failed = c.runResults.flatMap((rr, i) =>
    rr.assertions
      .filter((a) => !a.passed)
      .map(
        (a) =>
          `<li><span class="muted">run ${i + 1}</span> <span class="component">${esc(componentLabel(a.kind))}</span> <code>${esc(a.candidateId)}</code>: ${esc(a.detail)}</li>`,
      ),
  );
  if (failed.length === 0) return "";
  return `<details class="failures" open><summary>failed checks (${failed.length})</summary><ul>${failed.join("")}</ul></details>`;
}

/** Render one case card: header verdict, description, query, and the candidate table. */
function caseCard(c: CaseResult, meta: CaseMeta | undefined): string {
  const outcomes = outcomesByCandidate(c);
  // Candidate order: expected candidates first (corpus order), then any extras the evaluator scored.
  const ordered = [
    ...(meta ? [...meta.expectById.keys()] : []),
    ...[...outcomes.keys()].filter((id) => !meta || !meta.expectById.has(id)),
  ];
  const rows = ordered.map((id) => candidateRow(id, meta, outcomes.get(id) ?? [])).join("");
  const tier = meta ? `<span class="badge tier">tier ${meta.tier}</span>` : "";
  const domains = meta?.domains.map((d) => `<span class="badge domain">${esc(d)}</span>`).join("") ?? "";
  const flaky = c.flaky ? `<span class="badge flaky">flaky</span>` : "";
  const query = meta?.discoveryQuery
    ? `<p class="query">query: <code>${esc(meta.discoveryQuery)}</code></p>`
    : "";
  const desc = meta?.description ? `<p class="desc">${esc(meta.description)}</p>` : "";
  const ci = htmlRateCI(c.passRate, c.passes, c.runs);
  return `
  <article class="case ${rateClass(c.passRate)}">
    <header>
      <code class="cid">${esc(c.caseId)}</code>
      <span class="verdict ${rateClass(c.passRate)}" title="${c.passes}/${c.runs} runs">${ci}</span>
      ${tier}${domains}${flaky}
    </header>
    ${desc}${query}
    ${failedChecks(c)}
    <table>
      <thead><tr><th>candidate</th><th>expected</th><th>actual per run (score · role)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </article>`;
}

interface ComponentSummary {
  key: string;
  label: string;
  explanation: string;
  passed: number;
  total: number;
}

function componentLabel(kind: AssertionKind): string {
  switch (kind) {
    case "match":
      return "Surfacing";
    case "band":
      return "Score calibration";
    case "role":
      return "Valency role";
    case "reasoning":
      return "Reasoning quality";
  }
}

function componentExplanation(kind: AssertionKind): string {
  switch (kind) {
    case "match":
      return "Did protocol surface candidates that should match, and suppress candidates that should not?";
    case "band":
      return "Did the numeric opportunity score land inside the expected range?";
    case "role":
      return "Did protocol assign the expected agent/patient/peer valency role?";
    case "reasoning":
      return "Did the evaluator's natural-language justification satisfy the case-specific rubric?";
  }
}

function componentSummaries(sc: Scorecard): ComponentSummary[] {
  const order: AssertionKind[] = ["match", "band", "role", "reasoning"];
  const byKind = new Map<AssertionKind, { passed: number; total: number }>();
  for (const c of sc.cases) {
    for (const rr of c.runResults) {
      for (const a of rr.assertions) {
        const acc = byKind.get(a.kind) ?? { passed: 0, total: 0 };
        acc.total += 1;
        if (a.passed) acc.passed += 1;
        byKind.set(a.kind, acc);
      }
    }
  }
  return order
    .filter((kind) => byKind.has(kind))
    .map((kind) => {
      const acc = byKind.get(kind)!;
      return {
        key: kind,
        label: componentLabel(kind),
        explanation: componentExplanation(kind),
        passed: acc.passed,
        total: acc.total,
      };
    });
}

function componentRows(sc: Scorecard): string {
  return componentSummaries(sc)
    .map((s) => {
      const rate = s.total === 0 ? 0 : s.passed / s.total;
      return `<tr><td><strong>${esc(s.label)}</strong><br><span class="muted">${esc(s.explanation)}</span></td><td>${s.passed}/${s.total}</td><td class="${rateClass(rate)}">${htmlRateCI(rate, s.passed, s.total)}</td></tr>`;
    })
    .join("");
}

/**
 * Renders a full, standalone HTML scorecard for a matching-eval run.
 *
 * @param sc - The scorecard to render (use the `--report`-grade card with candidate reasoning intact).
 * @param regressions - Regressions vs the baseline, surfaced in a banner section.
 * @param cases - The corpus the run was scored against; joined by id for expectations, names, tier.
 * @returns A complete HTML document string.
 */
export function renderHtml(sc: Scorecard, regressions: Regression[], cases: MatchingCase[]): string {
  const meta = indexCases(cases);

  // Per-tier and per-domain aggregates, derived from the corpus join.
  const tierAgg = new Map<number, { count: number; sum: number; passes: number; runs: number }>();
  const domainAgg = new Map<string, { count: number; sum: number; passes: number; runs: number }>();
  for (const c of sc.cases) {
    const caseMeta = meta.get(c.caseId);
    const t = caseMeta?.tier ?? 0;
    const a = tierAgg.get(t) ?? { count: 0, sum: 0, passes: 0, runs: 0 };
    a.count += 1;
    a.sum += c.passRate;
    a.passes += c.passes;
    a.runs += c.runs;
    tierAgg.set(t, a);

    for (const d of caseMeta?.domains ?? ["unknown"]) {
      const da = domainAgg.get(d) ?? { count: 0, sum: 0, passes: 0, runs: 0 };
      da.count += 1;
      da.sum += c.passRate;
      da.passes += c.passes;
      da.runs += c.runs;
      domainAgg.set(d, da);
    }
  }
  const tierRows = [...tierAgg.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, a]) => {
      const rate = a.sum / a.count;
      return `<tr><td>tier ${t || "?"}</td><td>${a.count}</td><td class="${rateClass(rate)}">${htmlRateCI(rate, a.passes, a.runs)}</td></tr>`;
    })
    .join("");

  const domainRows = [...domainAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([domain, a]) => {
      const rate = a.sum / a.count;
      return `<tr><td>${esc(domain)}</td><td>${a.count}</td><td class="${rateClass(rate)}">${htmlRateCI(rate, a.passes, a.runs)}</td></tr>`;
    })
    .join("");

  const ruleRows = [...sc.rules]
    .sort((x, y) => x.passRate - y.passRate)
    .map(
      (r) => {
        const n = r.caseCount * sc.runs;
        const passes = Math.round(r.passRate * n);
        return `<tr><td>${esc(r.rule)}</td><td>${r.caseCount}</td><td class="${rateClass(r.passRate)}">${htmlRateCI(r.passRate, passes, n)}</td></tr>`;
      },
    )
    .join("");

  const components = componentRows(sc);

  const regressionBlock =
    regressions.length > 0
      ? `<section class="regressions"><h2>⚠ Regressions vs baseline</h2><ul>${regressions
          .map((r) => `<li>[${r.kind}] <code>${esc(r.id)}</code>: ${pctText(r.before)} → ${pctText(r.after)} <span class="muted">(${fmtPValue(r.pValue)})</span></li>`)
          .join("")}</ul></section>`
      : "";

  // Group case cards under rule headers, worst-performing rule first.
  const caseSections = [...sc.rules]
    .sort((x, y) => x.passRate - y.passRate)
    .map((r) => {
      const n = r.caseCount * sc.runs;
      const passes = Math.round(r.passRate * n);
      const cards = sc.cases.filter((c) => c.rule === r.rule).map((c) => caseCard(c, meta.get(c.caseId))).join("");
      return `<section class="rule"><h2>${esc(r.rule)} ${htmlRateCI(r.passRate, passes, n)} <span class="muted">(${r.caseCount} case${r.caseCount === 1 ? "" : "s"})</span></h2>${cards}</section>`;
    })
    .join("");

  const agg = rateClass(sc.aggregatePassRate);
  const totalObs = sc.cases.length * sc.runs;
  const totalPasses = sc.cases.reduce((s, c) => s + c.passes, 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Matching eval — ${pctText(sc.aggregatePassRate)} (${esc(sc.model)})</title>
<style>
  :root{--good:#16a34a;--ok:#d97706;--bad:#dc2626;--bg:#0f172a;--card:#1e293b;--line:#334155;--fg:#e2e8f0;--muted:#94a3b8}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
  .wrap{max-width:1000px;margin:0 auto;padding:24px}
  h1{font-size:22px;margin:0 0 4px}
  h2{font-size:16px;border-bottom:1px solid var(--line);padding-bottom:6px;margin:28px 0 12px}
  .muted{color:var(--muted)}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em}
  .good{color:var(--good)} .ok{color:var(--ok)} .bad{color:var(--bad)}
  .banner{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;display:flex;align-items:center;gap:24px;flex-wrap:wrap}
  .score{font-size:46px;font-weight:700;line-height:1}
  .meta{color:var(--muted);font-size:13px}
  table{width:100%;border-collapse:collapse;margin:6px 0}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .summary{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
  .summary>div{flex:1 1 300px}
  .summary table{max-width:100%}
  .explain{background:rgba(30,41,59,.72);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:14px 0}
  .explain h2{margin-top:0}
  .explain p,.explain ol{color:var(--muted);margin:8px 0}
  .explain strong{color:var(--fg)}
  .case{background:var(--card);border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:14px 16px;margin:12px 0}
  .case.good{border-left-color:var(--good)} .case.ok{border-left-color:var(--ok)} .case.bad{border-left-color:var(--bad)}
  .case header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cid{font-size:13px;color:var(--fg)}
  .verdict{font-weight:700;margin-left:auto}
  .badge{font-size:11px;padding:2px 7px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
  .badge.flaky{color:var(--ok);border-color:var(--ok)}
  .desc{color:var(--muted);margin:8px 0 4px}
  .query code{background:#0b1220;padding:2px 6px;border-radius:5px}
  .tag{font-size:11px;padding:1px 6px;border-radius:5px}
  .tag.yes{background:rgba(22,163,74,.18);color:#4ade80} .tag.no{background:rgba(220,38,38,.18);color:#f87171}
  .role{font-size:11px;color:#a5b4fc}
  .component{font-size:11px;color:#a5b4fc;text-transform:uppercase;letter-spacing:.04em}
  .chips{display:flex;flex-wrap:wrap;gap:4px}
  .chip{font-size:12px;padding:1px 7px;border-radius:5px;border:1px solid var(--line)}
  .chip.good{background:rgba(22,163,74,.15);border-color:rgba(22,163,74,.5)}
  .chip.bad{background:rgba(220,38,38,.15);border-color:rgba(220,38,38,.5)}
  .cand{min-width:150px}
  .reasons td{padding-top:0;border-bottom:1px solid var(--line)}
  details summary{cursor:pointer;color:var(--muted);font-size:12px;padding:4px 0}
  .reason{padding:6px 0;border-top:1px dashed var(--line)}
  .reason p{margin:4px 0 0;white-space:pre-wrap}
  .failures{margin:8px 0;padding:8px 10px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.45);border-radius:8px}
  .failures ul{margin:6px 0 0;padding-left:18px}
  .failures li{margin:3px 0}
  .regressions{background:rgba(220,38,38,.08);border:1px solid var(--bad);border-radius:10px;padding:8px 16px}
  .ci{font-size:11px;color:var(--muted)}
</style></head>
<body><div class="wrap">
  <div class="banner">
    <div><div class="score ${agg}">${pctText(sc.aggregatePassRate)}</div><div class="meta">aggregate pass-rate</div><div class="ci">${htmlRateCI(sc.aggregatePassRate, totalPasses, totalObs)}</div></div>
    <div class="meta">
      <div><strong>${esc(sc.model)}</strong></div>
      <div>${sc.cases.length} case${sc.cases.length === 1 ? "" : "s"} × ${sc.runs} run${sc.runs === 1 ? "" : "s"}</div>
      <div>generated ${esc(sc.generatedAt)}</div>
      <div>${regressions.length} regression${regressions.length === 1 ? "" : "s"} vs baseline</div>
    </div>
  </div>
  <section class="explain">
    <h2>What this report is measuring</h2>
    <p>This is a repeatability test for the matching evaluator. Each corpus case describes a discovery situation, a source user, and several candidate people. The protocol runs the same case ${sc.runs} time${sc.runs === 1 ? "" : "s"}; a run passes only when every expected candidate check passes.</p>
    <ol>
      <li><strong>Surfacing</strong>: should this candidate become an opportunity at all?</li>
      <li><strong>Score calibration</strong>: did the score land in the expected band?</li>
      <li><strong>Valency role</strong>: when asserted, did the candidate get the expected agent/patient/peer role?</li>
      <li><strong>Reasoning quality</strong>: when asserted, did the evaluator explanation satisfy the rubric?</li>
    </ol>
    <p>The aggregate score is the mean pass-rate across cases. Domain, rule, and tier tables identify where quality is weak. Component performance below identifies which part of protocol/scoring broke inside those cases.</p>
  </section>
  ${regressionBlock}
  <section class="summary">
    <div><h2>By protocol component</h2><table><thead><tr><th>component</th><th>checks</th><th>pass</th></tr></thead><tbody>${components}</tbody></table></div>
    <div><h2>By domain</h2><table><thead><tr><th>domain</th><th>cases</th><th>pass</th></tr></thead><tbody>${domainRows}</tbody></table></div>
    <div><h2>By rule</h2><table><thead><tr><th>rule</th><th>cases</th><th>pass</th></tr></thead><tbody>${ruleRows}</tbody></table></div>
    <div><h2>By tier</h2><table><thead><tr><th>tier</th><th>cases</th><th>pass</th></tr></thead><tbody>${tierRows}</tbody></table></div>
  </section>
  <section class="explain">
    <h2>How to read case cards</h2>
    <p>Each card is one test case. The percentage is how many repeated runs passed all checks. Candidate rows show the expected behavior and one chip per run: score plus role when present. Green chips mean that candidate's surfaced/rejected decision and score band were correct; red chips identify the failing candidate/run. Open “evaluator reasoning” to inspect the model's explanation for surfaced opportunities. If a candidate was not returned, the report says that explicitly instead of pretending reasoning was missing.</p>
  </section>
  ${caseSections}
  <p class="meta">Chip color is an at-a-glance indicator (surfaced-ness + band); failed-check details and each case's pass-rate are authoritative. Hover over pass-rates for 95% Wilson confidence intervals.</p>
</div></body></html>`;
}

/**
 * Writes a standalone HTML scorecard to disk.
 *
 * @param path - Absolute or relative path to write to. Parent dirs are created.
 * @param sc - The scorecard to render (candidate reasoning intact for the richest report).
 * @param regressions - Regressions vs the baseline.
 * @param cases - The corpus the run was scored against (joined by id).
 */
export async function writeHtmlReport(
  path: string,
  sc: Scorecard,
  regressions: Regression[],
  cases: MatchingCase[],
): Promise<void> {
  await Bun.write(path, renderHtml(sc, regressions, cases));
}
