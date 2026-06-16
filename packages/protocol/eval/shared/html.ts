import { binomialCI } from "./stats.js";
import type { Regression, ScorecardLike } from "./types.js";

/** Minimal HTML-entity escaping for text interpolated into templates. */
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pass-rate → quality class used for color-coding (≥90% good, ≥70% ok, else bad). */
export function rateClass(rate: number): "good" | "ok" | "bad" {
  return rate >= 0.9 ? "good" : rate >= 0.7 ? "ok" : "bad";
}

const pctText = (n: number): string => `${Math.round(n * 100)}%`;
const fmtPValue = (p: number): string => (p < 0.001 ? "p<0.001" : `p=${p.toFixed(3)}`);

/** Pass-rate cell text with a 95% Wilson CI tooltip for HTML tables. */
export function htmlRateCI(rate: number, passes: number, total: number): string {
  const [lo, hi] = binomialCI(passes, total);
  const ci = `CI₉₅ ${Math.round(lo * 100)}%–${Math.round(hi * 100)}%`;
  return `<span title="${ci}">${pctText(rate)}</span>`;
}

/** Shared CSS for standalone, self-contained scorecard documents. */
export const SCORECARD_CSS = `
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
  .tag{font-size:11px;padding:1px 6px;border-radius:5px}
  .tag.yes{background:rgba(22,163,74,.18);color:#4ade80} .tag.no{background:rgba(220,38,38,.18);color:#f87171}
  details summary{cursor:pointer;color:var(--muted);font-size:12px;padding:4px 0}
  .failures{margin:8px 0;padding:8px 10px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.45);border-radius:8px}
  .failures ul{margin:6px 0 0;padding-left:18px}
  .failures li{margin:3px 0}
  .regressions{background:rgba(220,38,38,.08);border:1px solid var(--bad);border-radius:10px;padding:8px 16px}
  .ci{font-size:11px;color:var(--muted)}
`;

/** A named section in the scorecard summary area. `html` is the section body (already escaped). */
export interface ShellSection {
  heading: string;
  html: string;
}

export interface ShellOptions {
  /** Document & banner title, e.g. "Premise eval". */
  title: string;
  /** Optional explanatory block (raw HTML) rendered under the banner. */
  intro?: string;
  /** Extra summary sections (e.g. by-rule, by-tier) rendered before case cards. */
  sections?: ShellSection[];
  /** Pre-rendered case-card HTML, supplied by the harness. */
  caseCardsHtml?: string;
  /** Extra CSS appended after the shared stylesheet. */
  extraCss?: string;
}

/** Render the by-rule rollup table (worst rule first) — a sensible default section. */
export function renderRuleTable(sc: ScorecardLike): string {
  const rows = [...sc.rules]
    .sort((x, y) => x.passRate - y.passRate)
    .map((r) => {
      const n = r.caseCount * sc.runs;
      const passes = Math.round(r.passRate * n);
      return `<tr><td>${htmlEscape(r.rule)}</td><td>${r.caseCount}</td><td class="${rateClass(r.passRate)}">${htmlRateCI(r.passRate, passes, n)}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>rule</th><th>cases</th><th>pass</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Renders a complete, standalone, self-contained scorecard HTML document: banner
 * with the aggregate pass-rate + CI, an optional intro, a regression banner, the
 * harness-supplied summary sections, and the harness-supplied case cards. No
 * external assets, no JS — openable straight from disk.
 *
 * @param sc - The scorecard to render.
 * @param regressions - Regressions vs the baseline, shown in a red banner.
 * @param opts - Title, intro, summary sections, and case-card HTML.
 * @returns A full HTML document string.
 */
export function renderScorecardShell(sc: ScorecardLike, regressions: Regression[], opts: ShellOptions): string {
  const agg = rateClass(sc.aggregatePassRate);
  const totalObs = sc.cases.length * sc.runs;
  const totalPasses = sc.cases.reduce((s, c) => s + c.passes, 0);

  const regressionBlock =
    regressions.length > 0
      ? `<section class="regressions"><h2>⚠ Regressions vs baseline</h2><ul>${regressions
          .map(
            (r) =>
              `<li>[${r.kind}] <code>${htmlEscape(r.id)}</code>: ${pctText(r.before)} → ${pctText(r.after)} <span class="muted">(${fmtPValue(r.pValue)})</span></li>`,
          )
          .join("")}</ul></section>`
      : "";

  const intro = opts.intro ? `<section class="explain">${opts.intro}</section>` : "";
  const sections =
    (opts.sections ?? [])
      .map((s) => `<div><h2>${htmlEscape(s.heading)}</h2>${s.html}</div>`)
      .join("") || "";
  const summary = sections ? `<section class="summary">${sections}</section>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(opts.title)} — ${pctText(sc.aggregatePassRate)} (${htmlEscape(sc.model)})</title>
<style>${SCORECARD_CSS}${opts.extraCss ?? ""}</style></head>
<body><div class="wrap">
  <div class="banner">
    <div><div class="score ${agg}">${pctText(sc.aggregatePassRate)}</div><div class="meta">aggregate pass-rate</div><div class="ci">${htmlRateCI(sc.aggregatePassRate, totalPasses, totalObs)}</div></div>
    <div class="meta">
      <div><strong>${htmlEscape(opts.title)}</strong></div>
      <div><strong>${htmlEscape(sc.model)}</strong></div>
      <div>${sc.cases.length} case${sc.cases.length === 1 ? "" : "s"} × ${sc.runs} run${sc.runs === 1 ? "" : "s"}</div>
      <div>generated ${htmlEscape(sc.generatedAt)}</div>
      <div>${regressions.length} regression${regressions.length === 1 ? "" : "s"} vs baseline</div>
    </div>
  </div>
  ${intro}
  ${regressionBlock}
  ${summary}
  ${opts.caseCardsHtml ?? ""}
</div></body></html>`;
}
