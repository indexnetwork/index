import { binomialCI, buildScorecard, computeRollingBaseline, diffBaseline, formatConsole as sharedFormatConsole, readBaseline as sharedReadBaseline, writeBaseline as sharedWriteBaseline, writeRunReport, binomialPValue, binomialSignificance, predictivePValue, renderExecutionEvidence, renderHumanReport, HUMAN_CSS, type EvalExecutionEvidence, type EvalRunMeta, type HumanReport, type Regression } from "../shared/index.js";
import type { CaseResult, Scorecard, MatchingCase, CandidateExpectation, CandidateOutcome, AssertionKind, Rule } from "./matching.types.js";

// ── Shared machinery re-exported for matching consumers and tests ────────────
// The statistics, scorecard aggregation, baseline diff, rolling baseline, and
// run-report writer all live in `eval/shared`. Matching keeps only its bespoke
// HTML renderer and a candidate-stripping baseline writer below.
export {
  binomialCI,
  binomialPValue,
  binomialSignificance,
  predictivePValue,
  buildScorecard,
  computeRollingBaseline,
  diffBaseline,
  writeRunReport,
  type Regression,
};

/** Read a committed matching baseline, typed as a matching {@link Scorecard}. */
export function readBaseline(path: string): Promise<Scorecard | null> {
  return sharedReadBaseline<Scorecard>(path, { harness: "matching" });
}

/** Console scorecard with the matching-specific title. */
export function formatConsole(
  sc: Scorecard,
  regressions: Regression[],
  skippedCaseIds: string[] = [],
  execution?: EvalExecutionEvidence,
): string {
  return sharedFormatConsole(sc, regressions, skippedCaseIds, { title: "Matching Quality Scorecard", execution });
}

/**
 * Writes the committed baseline, stripping each run's per-candidate `reasoning`.
 * The baseline is a diff target, so verbose model reasoning would make every
 * `--update-baseline` a noisy diff; the full reasoning lives in the run report.
 *
 * @param path - Absolute or relative path to write to.
 * @param sc - The scorecard to persist (candidate detail stripped before writing).
 * @param opts.meta - Run provenance recorded in the versioned envelope.
 * @param opts.force - Explicit consent to overwrite an existing baseline.
 */
export async function writeBaseline(path: string, sc: Scorecard, opts: { meta: EvalRunMeta; force?: boolean }): Promise<void> {
  await sharedWriteBaseline(path, sc, {
    meta: opts.meta,
    force: opts.force,
    leanCase: (c) => ({
      ...c,
      runResults: c.runResults.map(({ candidates: _candidates, ...rest }) => rest),
    }),
  });
}

// ─── HTML report ──────────────────────────────────────────────────────────
//
// A standalone, self-contained HTML scorecard. The `Scorecard` carries the
// evaluator's *actuals* (per-candidate score, role, matched, verbatim
// reasoning) but not the *expectations* — those live in the `MatchingCase`
// corpus. `renderHtml` joins the two by case id so every candidate shows
// expected-vs-actual side by side, with the evaluator's own reasoning behind a
// collapsible block. No external assets, no JS: openable straight from disk.

const pctText = (n: number): string => `${Math.round(n * 100)}%`;
const fmtPValue = (p: number): string => (p < 0.001 ? "p<0.001" : `p=${p.toFixed(3)}`);

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
function outcomesByCandidate(c: CaseResult): Map<string, Array<{ outcome: CandidateOutcome; runIndex: number }>> {
  const byId = new Map<string, Array<{ outcome: CandidateOutcome; runIndex: number }>>();
  for (const [fallbackIndex, rr] of c.runResults.entries()) {
    for (const cand of rr.candidates ?? []) {
      const list = byId.get(cand.candidateId) ?? [];
      list.push({ outcome: cand, runIndex: rr.runIndex ?? fallbackIndex });
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
  outcomes: Array<{ outcome: CandidateOutcome; runIndex: number }>,
): string {
  const exp = meta?.expectById.get(candidateId);
  const name = meta?.nameById.get(candidateId) ?? candidateId;
  const chips = outcomes
    .map(({ outcome, runIndex }) => {
      const ok = outcomeOk(exp, outcome);
      const roleTxt = outcome.role ? ` ${esc(outcome.role)}` : "";
      const returned = outcome.returned ?? outcome.score > 0;
      const title = `run ${runIndex + 1}: ${outcome.matched ? "surfaced" : returned ? "returned below surfacing threshold" : "not returned"}`;
      return `<span class="chip ${ok ? "good" : "bad"}" title="${title}">${outcome.score}${roleTxt}</span>`;
    })
    .join("");
  const reasoning = outcomes
    .map(({ outcome, runIndex }) => {
      const returned = outcome.returned ?? outcome.score > 0;
      const text = outcome.reasoning.trim()
        ? outcome.reasoning
        : returned
          ? "Returned by the evaluator, but the opportunity reasoning field was empty."
          : "Not returned by the evaluator. No opportunity object existed, so there is no evaluator reasoning for this candidate in this run.";
      return `<div class="reason"><span class="muted">run ${runIndex + 1} · score ${outcome.score}${outcome.role ? " · " + esc(outcome.role) : ""}</span><p>${esc(text)}</p></div>`;
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
          `<li><span class="muted">run ${(rr.runIndex ?? i) + 1}</span> <span class="component">${esc(componentLabel(a.kind))}</span> <code>${esc(a.candidateId)}</code>: ${esc(a.detail)}</li>`,
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
// ─── Plain-language copy for the non-technical report ───────────────────────

/** Ordered themes for "What we tested", each mapped to one matching rule. */
const HUMAN_GROUPS: { ruleIds: Rule[]; label: string; blurb: string }[] = [
  { ruleIds: ["is_a_identity"], label: "Telling similar people apart", blurb: "Not confusing an investor with the engineer they funded, or a scout with the athlete they scout." },
  { ruleIds: ["query_primary"], label: "Matching on what was actually asked", blurb: "Letting the request drive the match, not unrelated background detail." },
  { ruleIds: ["complementary_role"], label: "Matching people who fit together", blurb: "Pairing people whose needs and offerings complement each other." },
  { ruleIds: ["same_side"], label: "Not matching people who want the same thing", blurb: "Two people both hiring, or both raising, aren't a match for each other." },
  { ruleIds: ["valency_role"], label: "Getting who-helps-whom right", blurb: "Assigning the seeker and the provider roles correctly." },
  { ruleIds: ["location"], label: "Respecting where people are", blurb: "Honoring a location requirement without over-penalizing unknown cities." },
  { ruleIds: ["score_calibration"], label: "Scoring matches sensibly", blurb: "Strong matches score high, weak ones score low." },
  { ruleIds: ["already_known"], label: "Skipping people who already know each other", blurb: "Not re-introducing people who are already connected." },
  { ruleIds: ["event_network"], label: "Not inventing event attendance", blurb: "Treating event-network placement as context rather than proof of attendance or shared presence." },
  { ruleIds: ["historical"], label: "Rediscovering real collaborations", blurb: "Surfacing pairs who actually went on to work together, over plausible lookalikes." },
];

/** Plain-language name for each failing check, used in "what happened" notes. */
const HUMAN_CHECK_COPY: Record<AssertionKind, string> = {
  match: "surfaced the wrong person, or hid the right one",
  band: "scored the match too high or too low",
  role: "got who-helps-whom backwards",
  reasoning: "its explanation didn't hold up",
};

/** Distinct plain-language reasons a case failed, across its runs. */
function humanFailNote(c: CaseResult): string | undefined {
  const kinds = new Set<AssertionKind>();
  for (const rr of c.runResults) for (const a of rr.assertions) if (!a.passed) kinds.add(a.kind);
  if (kinds.size === 0) return undefined;
  return [...kinds].map((k) => HUMAN_CHECK_COPY[k]).join("; ") + ".";
}

/** Build the plain-language report from the scorecard + corpus descriptions. */
function buildHumanReport(sc: Scorecard, cases: MatchingCase[]): HumanReport {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const resultById = new Map(sc.cases.map((c) => [c.caseId, c]));
  const groups = HUMAN_GROUPS.map((g) => ({
    label: g.label,
    blurb: g.blurb,
    ruleIds: g.ruleIds as string[],
    cases: sc.cases
      .filter((c) => g.ruleIds.includes(c.rule))
      .map((c) => {
        const result = resultById.get(c.caseId);
        return {
          caseId: c.caseId,
          scenario: byId.get(c.caseId)?.description ?? c.caseId,
          failNote: result ? humanFailNote(result) : undefined,
        };
      }),
  })).filter((g) => g.cases.length > 0);
  return {
    subject: "the matchmaker",
    oneLiner: "It looks at one person and decides which other people are worth introducing them to — and why.",
    groups,
  };
}

export function renderHtml(
  sc: Scorecard,
  regressions: Regression[],
  cases: MatchingCase[],
  execution?: EvalExecutionEvidence,
): string {
  const meta = indexCases(cases);
  const human = renderHumanReport(sc, regressions, buildHumanReport(sc, cases));

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
        const members = sc.cases.filter((entry) => entry.rule === r.rule);
        const n = members.reduce((sum, entry) => sum + entry.runs, 0);
        const passes = members.reduce((sum, entry) => sum + entry.passes, 0);
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
      const members = sc.cases.filter((entry) => entry.rule === r.rule);
      const n = members.reduce((sum, entry) => sum + entry.runs, 0);
      const passes = members.reduce((sum, entry) => sum + entry.passes, 0);
      const cards = sc.cases.filter((c) => c.rule === r.rule).map((c) => caseCard(c, meta.get(c.caseId))).join("");
      return `<section class="rule"><h2>${esc(r.rule)} ${htmlRateCI(r.passRate, passes, n)} <span class="muted">(${r.caseCount} case${r.caseCount === 1 ? "" : "s"})</span></h2>${cards}</section>`;
    })
    .join("");

  const agg = rateClass(sc.aggregatePassRate);
  const totalObs = sc.cases.reduce((sum, entry) => sum + entry.runs, 0);
  const totalPasses = sc.cases.reduce((s, c) => s + c.passes, 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Matching eval — ${pctText(sc.aggregatePassRate)} (${esc(sc.model)})</title>
<style>
  ${HUMAN_CSS}
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
  ${human}
  <details class="tech"><summary>Technical details (for engineers)</summary>
  ${execution ? renderExecutionEvidence(execution) : ""}
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
  </details>
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
  execution?: EvalExecutionEvidence,
): Promise<void> {
  await Bun.write(path, renderHtml(sc, regressions, cases, execution));
}
