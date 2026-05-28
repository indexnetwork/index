import type {
  CaseResult,
  RuleResult,
  Scorecard,
  Rule,
  MatchingCase,
  CandidateExpectation,
  CandidateOutcome,
} from "./matching.types.js";

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

/** ln(n!) via Stirling approximation for exact binomial CDF. */
function lnFactorial(n: number): number {
  if (n <= 1) return 0;
  // Stirling: ln(n!) ≈ n ln n - n + (ln(2π n) / 2)
  return n * Math.log(n) - n + Math.log(2 * Math.PI * n) / 2;
}

/** Natural log of binomial coefficient C(n, k). */
function lnChoose(n: number, k: number): number {
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k);
}

/**
 * One-sided exact binomial p-value (up to 30 trials; falls back to z-test beyond).
 * H₀: true pass-rate = nullRate; Ha: true pass-rate < nullRate (regression).
 */
export function binomialSignificance(observedPasses: number, total: number, nullRate: number, alpha = 0.05): boolean {
  if (total === 0) return false;
  // Exact test when n fits within limits; z-test otherwise.
  if (total <= 30) {
    let cumulative = 0;
    for (let k = 0; k <= observedPasses; k++) {
      const logP = lnChoose(total, k) + k * Math.log(nullRate) + (total - k) * Math.log1p(-nullRate);
      cumulative += Math.exp(logP);
      // Stop when already above alpha to avoid irrelevant probability mass at the tail.
      if (cumulative > alpha) break;
    }
    return cumulative <= alpha;
  }
  // Normal approximation: z = (p̂ - nullRate) / SE
  const p̂ = observedPasses / total;
  const se = Math.sqrt(nullRate * (1 - nullRate) / total);
  const z = (p̂ - nullRate) / se;
  // One-sided: P(Z ≤ z)
  return 0.5 * (1 + erf(z / Math.sqrt(2))) <= alpha;
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
}

/**
 * Compares a current scorecard against a baseline and returns any regressions.
 *
 * A regression is a case or rule where the current pass-rate is significantly
 * lower than the baseline pass-rate (one-sided binomial test at significance
 * level alpha). New cases (absent from baseline) are never regressions.
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
): { regressions: Regression[] } {
  if (!baseline) return { regressions: [] };
  const regressions: Regression[] = [];

  const baseCases = new Map(baseline.cases.map((c) => [c.caseId, c.passRate]));
  for (const c of current.cases) {
    const nullRate = baseCases.get(c.caseId);
    if (nullRate === undefined) continue;
    const sig = binomialSignificance(c.passes, c.runs, nullRate, alpha);
    if (sig) {
      regressions.push({ id: c.caseId, kind: "case", before: nullRate, after: c.passRate });
    }
  }

  const baseRules = new Map(baseline.rules.map((r) => [r.rule, r.passRate]));
  for (const r of current.rules) {
    const nullRate = baseRules.get(r.rule);
    if (nullRate === undefined) continue;
    const n = r.caseCount * current.runs;
    const passes = Math.round(r.passRate * n);
    const sig = binomialSignificance(passes, n, nullRate, alpha);
    if (sig) {
      regressions.push({ id: r.rule, kind: "rule", before: nullRate, after: r.passRate });
    }
  }

  return { regressions };
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** Format a pass-rate with 95% confidence for console display. */
function fmtRate(passes: number, total: number): string {
  return `${Math.round((passes / total) * 100)}% (${rateWithCI(passes, total)})`;
}

/** Human-readable scorecard for the console. */
export function formatConsole(sc: Scorecard, regressions: Regression[]): string {
  const lines: string[] = [];
  lines.push(`\n=== Matching Quality Scorecard ===`);
  lines.push(`model=${sc.model}  runs=${sc.runs}  cases=${sc.cases.length}`);
  // have to use sc.cases.length to compute n (since it's the number of independent observations — cases are independent, individual runs are not)
  const [lo, hi] = binomialCI(
    sc.cases.reduce((s, c) => s + c.passes, 0),
    sc.cases.length * sc.runs,
  );
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
      lines.push(`  [${r.kind}] ${r.id}: ${pct(r.before)} → ${pct(r.after)}`);
    }
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
  tier: 1 | 2 | 3;
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
    for (const e of c.input.entities) nameById.set(e.userId, e.profile.name?.trim() || e.userId);
    const expectById = new Map<string, CandidateExpectation>();
    for (const exp of c.expect) expectById.set(exp.candidateId, exp);
    m.set(c.id, { tier: c.tier, description: c.description, discoveryQuery: c.input.discoveryQuery, nameById, expectById });
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
      return `<span class="chip ${ok ? "good" : "bad"}" title="${o.matched ? "surfaced" : "not surfaced"}">${o.score}${roleTxt}</span>`;
    })
    .join("");
  const reasoning = outcomes
    .map(
      (o, i) =>
        `<div class="reason"><span class="muted">run ${i + 1} · score ${o.score}${o.role ? " · " + esc(o.role) : ""}</span><p>${esc(o.reasoning || "(no reasoning captured)")}</p></div>`,
    )
    .join("");
  return `
    <tr>
      <td class="cand"><strong>${esc(name)}</strong><br><span class="muted">${esc(candidateId)}</span></td>
      <td>${expectText(exp)}</td>
      <td class="chips">${chips || "<span class='muted'>—</span>"}</td>
    </tr>
    <tr class="reasons"><td colspan="3"><details><summary>evaluator reasoning (${outcomes.length} run${outcomes.length === 1 ? "" : "s"})</summary>${reasoning}</details></td></tr>`;
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
      ${tier}${flaky}
    </header>
    ${desc}${query}
    <table>
      <thead><tr><th>candidate</th><th>expected</th><th>actual per run (score · role)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </article>`;
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

  // Per-tier aggregate, derived from the corpus join (RuleResult carries no tier).
  const tierAgg = new Map<number, { count: number; sum: number; passes: number; runs: number }>();
  for (const c of sc.cases) {
    const t = meta.get(c.caseId)?.tier ?? 0;
    const a = tierAgg.get(t) ?? { count: 0, sum: 0, passes: 0, runs: 0 };
    a.count += 1;
    a.sum += c.passRate;
    a.passes += c.passes;
    a.runs += c.runs;
    tierAgg.set(t, a);
  }
  const tierRows = [...tierAgg.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, a]) => {
      const rate = a.sum / a.count;
      return `<tr><td>tier ${t || "?"}</td><td>${a.count}</td><td class="${rateClass(rate)}">${htmlRateCI(rate, a.passes, a.runs)}</td></tr>`;
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

  const regressionBlock =
    regressions.length > 0
      ? `<section class="regressions"><h2>⚠ Regressions vs baseline</h2><ul>${regressions
          .map((r) => `<li>[${r.kind}] <code>${esc(r.id)}</code>: ${pctText(r.before)} → ${pctText(r.after)}</li>`)
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
  .summary{display:flex;gap:24px;flex-wrap:wrap}
  .summary table{max-width:420px}
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
  .chips{display:flex;flex-wrap:wrap;gap:4px}
  .chip{font-size:12px;padding:1px 7px;border-radius:5px;border:1px solid var(--line)}
  .chip.good{background:rgba(22,163,74,.15);border-color:rgba(22,163,74,.5)}
  .chip.bad{background:rgba(220,38,38,.15);border-color:rgba(220,38,38,.5)}
  .cand{min-width:150px}
  .reasons td{padding-top:0;border-bottom:1px solid var(--line)}
  details summary{cursor:pointer;color:var(--muted);font-size:12px;padding:4px 0}
  .reason{padding:6px 0;border-top:1px dashed var(--line)}
  .reason p{margin:4px 0 0;white-space:pre-wrap}
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
  ${regressionBlock}
  <section class="summary">
    <div><h2>By rule</h2><table><thead><tr><th>rule</th><th>cases</th><th>pass</th></tr></thead><tbody>${ruleRows}</tbody></table></div>
    <div><h2>By tier</h2><table><thead><tr><th>tier</th><th>cases</th><th>pass</th></tr></thead><tbody>${tierRows}</tbody></table></div>
  </section>
  ${caseSections}
  <p class="meta">Chip color is an at-a-glance indicator (surfaced-ness + band); the authoritative verdict is each case's pass-rate from the scorer. Hover over pass-rates for 95% Wilson confidence intervals.</p>
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
