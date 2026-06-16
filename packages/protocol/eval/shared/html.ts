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

/** Base CSS for the technical scorecard view. */
const BASE_CSS = `
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

/** Plain-language (non-technical) report styling: hero verdict, status pills, scenario cards. */
export const HUMAN_CSS = `
  .hero{border-radius:14px;padding:22px 26px;margin:0 0 18px;border:1px solid var(--line)}
  .hero.good{background:linear-gradient(135deg,rgba(22,163,74,.18),rgba(22,163,74,.03));border-color:rgba(22,163,74,.5)}
  .hero.ok{background:linear-gradient(135deg,rgba(217,119,6,.18),rgba(217,119,6,.03));border-color:rgba(217,119,6,.5)}
  .hero.bad{background:linear-gradient(135deg,rgba(220,38,38,.18),rgba(220,38,38,.03));border-color:rgba(220,38,38,.5)}
  .hero .vword{font-size:30px;font-weight:800;line-height:1.1}
  .hero .vword.good{color:#4ade80}.hero .vword.ok{color:#fbbf24}.hero .vword.bad{color:#f87171}
  .hero .vsub{font-size:15px;margin-top:6px;color:var(--fg)}
  .hero .vblurb{color:var(--muted);margin-top:8px;max-width:62ch}
  .pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 10px;border-radius:99px;white-space:nowrap}
  .pill.good{background:rgba(22,163,74,.18);color:#4ade80}
  .pill.ok{background:rgba(217,119,6,.2);color:#fbbf24}
  .pill.bad{background:rgba(220,38,38,.18);color:#f87171}
  ul.tested{list-style:none;margin:10px 0 0;padding:0}
  ul.tested li{display:flex;gap:14px;align-items:baseline;padding:11px 0;border-top:1px solid var(--line)}
  ul.tested li:first-child{border-top:none}
  ul.tested .t-label{font-weight:600}
  ul.tested .t-blurb{color:var(--muted);font-size:13px;margin-top:2px}
  h3.group{font-size:15px;margin:20px 0 8px;color:var(--fg)}
  .story{border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:12px 15px;margin:10px 0;background:var(--card)}
  .story.good{border-left-color:var(--good)}.story.ok{border-left-color:var(--ok)}.story.bad{border-left-color:var(--bad)}
  .story .s-row{margin-bottom:8px}
  .story p{margin:5px 0}
  .story .lead{display:inline-block;min-width:84px;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .story .whathappened{color:#f87171}
  details.tech>summary{font-size:14px;font-weight:600;color:var(--fg);padding:10px 0;border-top:1px solid var(--line);margin-top:22px}
  details.tech[open]>summary{margin-bottom:6px}
  details.human-details>summary{font-size:15px;font-weight:600;color:var(--fg);padding:8px 0;margin-top:8px}
`;

/** Full stylesheet for standalone scorecard documents (technical + human views). */
export const SCORECARD_CSS = BASE_CSS + HUMAN_CSS;

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
  /**
   * Plain-language report for non-technical readers. When supplied, it renders
   * at the top and the technical banner/sections/cards collapse beneath it.
   */
  human?: HumanReport;
}

// ─── Plain-language (human-readable) report ─────────────────────────────────
//
// Translates the statistical scorecard into something a non-technical reader
// understands: a top-line verdict, a "what we tested" rollup with plain status
// words instead of CIs/p-values, and concrete per-case scenario narratives.
// Harnesses supply the plain-language strings; this module computes status from
// the scorecard's aggregate pass counts.

type Tone = "good" | "ok" | "bad";

/** One plain-language scenario narrative for a single case. */
export interface HumanCase {
  caseId: string;
  /** What we showed the system, in plain words. */
  scenario: string;
  /** What the system should do, in plain words. Optional — omitted, the "It should" line is skipped. */
  expectation?: string;
  /** Plain "what went wrong" note, shown only when a run failed (harness-computed). */
  failNote?: string;
}

/** A plain-language theme grouping one or more scorecard rules. */
export interface HumanGroup {
  /** Plain-language theme name, e.g. "Privacy: never leaking contact info". */
  label: string;
  /** Optional one-line explanation of the theme. */
  blurb?: string;
  /** Scorecard rule ids this theme covers (status is aggregated across them). */
  ruleIds: string[];
  /** Plain narratives for the cases in this theme. */
  cases: HumanCase[];
}

/** The full plain-language report a harness hands to the shell. */
export interface HumanReport {
  /** What the system under test is, in plain words, e.g. "the profile builder". */
  subject: string;
  /** One plain sentence describing what it does / what this report covers. */
  oneLiner: string;
  groups: HumanGroup[];
}

export interface Verdict {
  word: string;
  tone: Tone;
  blurb: string;
  passes: number;
  total: number;
}

/** Plain-language overall verdict derived from the aggregate pass count + regressions. */
export function computeVerdict(sc: ScorecardLike, regressions: Regression[]): Verdict {
  const total = sc.cases.length * sc.runs;
  const passes = sc.cases.reduce((s, c) => s + c.passes, 0);
  const rate = total === 0 ? 0 : passes / total;
  const hasReg = regressions.length > 0;
  if (hasReg) {
    return { word: "Needs attention", tone: "bad", blurb: "Something that worked before is now failing — worth a look before relying on it.", passes, total };
  }
  if (rate >= 0.97) return { word: "Looking good", tone: "good", blurb: "The system behaved correctly on almost every check.", passes, total };
  if (rate >= 0.85) return { word: "Mostly working", tone: "ok", blurb: "Generally correct, with a few spots that were inconsistent.", passes, total };
  return { word: "Needs attention", tone: "bad", blurb: "Several checks did not pass reliably.", passes, total };
}

/** Plain-language status for a theme, aggregated across its rules' cases. */
export function groupStatus(
  sc: ScorecardLike,
  ruleIds: string[],
  regressions: Regression[],
): { tone: Tone; phrase: string } {
  const cases = sc.cases.filter((c) => ruleIds.includes(c.rule));
  const passes = cases.reduce((s, c) => s + c.passes, 0);
  const runs = cases.reduce((s, c) => s + c.runs, 0);
  const regressed = regressions.some(
    (r) => (r.kind === "rule" && ruleIds.includes(r.id)) || (r.kind === "case" && cases.some((c) => c.caseId === r.id)),
  );
  const rate = runs === 0 ? 0 : passes / runs;
  if (regressed) return { tone: "bad", phrase: "newly slipping" };
  if (rate === 1) return { tone: "good", phrase: "works reliably" };
  if (rate >= 0.5) return { tone: "ok", phrase: `inconsistent — missed ${runs - passes} of ${runs}` };
  return { tone: "bad", phrase: `often wrong — missed ${runs - passes} of ${runs}` };
}

/** Plain-language outcome for a single case across its repeated runs. */
function caseOutcome(passes: number, runs: number): { tone: Tone; phrase: string } {
  if (passes === runs) return { tone: "good", phrase: runs === 1 ? "Correct" : `Correct all ${runs} times` };
  if (passes === 0) return { tone: "bad", phrase: runs === 1 ? "Incorrect" : `Missed all ${runs} times` };
  return { tone: "ok", phrase: `Missed ${runs - passes} of ${runs} times` };
}

/**
 * Build the hero's scenario-anchored sub-line and blurb. The sub-line reconciles
 * with the "What we tested" list below it by counting *scenarios* (cases), not
 * runs: "79% — 5 of 8 scenarios passed every time". The blurb names the standout
 * failure (a single always-failing theme by label) and tallies the rest.
 *
 * @param sc - Scorecard (case-level pass counts).
 * @param regressions - Regressions; when present, defer to the verdict's regression blurb.
 * @param human - Human report, used to name a failing theme by its group label.
 * @param fallbackBlurb - The verdict blurb to use when nothing failed or a regression dominates.
 */
function heroSummary(
  sc: ScorecardLike,
  regressions: Regression[],
  human: HumanReport,
  fallbackBlurb: string,
): { subline: string; blurb: string } {
  const total = sc.cases.length;
  const fullPass = sc.cases.filter((c) => c.passes === c.runs).length;
  const runsTotal = sc.cases.reduce((s, c) => s + c.runs, 0);
  const passesTotal = sc.cases.reduce((s, c) => s + c.passes, 0);
  const pct = runsTotal === 0 ? 0 : Math.round((passesTotal / runsTotal) * 100);
  const subline = `${pct}% — ${fullPass} of ${total} scenario${total === 1 ? "" : "s"} passed every time`;

  // A live regression is the headline; keep the verdict's regression wording.
  if (regressions.length > 0) return { subline, blurb: fallbackBlurb };

  const labelFor = (rule: string): string | undefined => human.groups.find((g) => g.ruleIds.includes(rule))?.label;
  const alwaysFail = sc.cases.filter((c) => c.passes === 0);
  const partial = sc.cases.filter((c) => c.passes > 0 && c.passes < c.runs);

  const parts: string[] = [];
  if (alwaysFail.length === 1) {
    const label = labelFor(alwaysFail[0].rule);
    parts.push(label ? `the “${label}” scenario failed every run` : "one scenario failed every run");
  } else if (alwaysFail.length > 1) {
    parts.push(`${alwaysFail.length} scenarios failed every run`);
  }
  if (partial.length > 0) {
    let noun: string;
    if (alwaysFail.length > 0) {
      noun = partial.length === 1 ? "another was" : `${partial.length} others were`;
    } else {
      noun = partial.length === 1 ? "one was" : `${partial.length} were`;
    }
    parts.push(`${noun} occasionally off`);
  }
  if (parts.length === 0) return { subline, blurb: "Every scenario passed every run." };
  const joined = parts.join("; ");
  return { subline, blurb: joined.charAt(0).toUpperCase() + joined.slice(1) + "." };
}

/**
 * Renders the plain-language top section: a hero verdict, a "What we tested"
 * rollup with plain status words, and a "See the examples" block of per-case
 * scenario narratives. Self-contained HTML using the shared/HUMAN_CSS classes.
 */
export function renderHumanReport(sc: ScorecardLike, regressions: Regression[], human: HumanReport): string {
  const v = computeVerdict(sc, regressions);
  const { subline, blurb } = heroSummary(sc, regressions, human, v.blurb);
  const hero = `<section class="hero ${v.tone}"><div class="vword ${v.tone}">${htmlEscape(v.word)}</div><div class="vsub">${htmlEscape(subline)}</div><div class="vblurb">${htmlEscape(blurb)}</div></section>`;

  const tested = human.groups
    .map((g) => {
      const s = groupStatus(sc, g.ruleIds, regressions);
      const blurb = g.blurb ? `<div class="t-blurb">${htmlEscape(g.blurb)}</div>` : "";
      return `<li><span class="pill ${s.tone}">${htmlEscape(s.phrase)}</span><div><span class="t-label">${htmlEscape(g.label)}</span>${blurb}</div></li>`;
    })
    .join("");
  const whatWeTested = `<section class="explain"><h2>What we tested</h2><p class="muted">${htmlEscape(human.oneLiner)}</p><ul class="tested">${tested}</ul></section>`;

  const byId = new Map(sc.cases.map((c) => [c.caseId, c]));
  const examples = human.groups
    .map((g) => {
      const stories = g.cases
        .map((hc) => {
          const c = byId.get(hc.caseId);
          if (!c) return "";
          const o = caseOutcome(c.passes, c.runs);
          const fail = o.tone !== "good" && hc.failNote
            ? `<p class="whathappened"><span class="lead">What happened</span> ${htmlEscape(hc.failNote)}</p>`
            : "";
          const should = hc.expectation
            ? `<p><span class="lead">It should</span> ${htmlEscape(hc.expectation)}</p>`
            : "";
          return `<div class="story ${o.tone}"><div class="s-row"><span class="pill ${o.tone}">${htmlEscape(o.phrase)}</span></div><p><span class="lead">We tried</span> ${htmlEscape(hc.scenario)}</p>${should}${fail}</div>`;
        })
        .join("");
      return stories ? `<h3 class="group">${htmlEscape(g.label)}</h3>${stories}` : "";
    })
    .join("");
  const examplesBlock = `<details class="human-details" open><summary>See the examples</summary>${examples}</details>`;

  return `${hero}${whatWeTested}${examplesBlock}`;
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

  const banner = `<div class="banner">
    <div><div class="score ${agg}">${pctText(sc.aggregatePassRate)}</div><div class="meta">aggregate pass-rate</div><div class="ci">${htmlRateCI(sc.aggregatePassRate, totalPasses, totalObs)}</div></div>
    <div class="meta">
      <div><strong>${htmlEscape(opts.title)}</strong></div>
      <div><strong>${htmlEscape(sc.model)}</strong></div>
      <div>${sc.cases.length} case${sc.cases.length === 1 ? "" : "s"} × ${sc.runs} run${sc.runs === 1 ? "" : "s"}</div>
      <div>generated ${htmlEscape(sc.generatedAt)}</div>
      <div>${regressions.length} regression${regressions.length === 1 ? "" : "s"} vs baseline</div>
    </div>
  </div>`;

  const technical = `${banner}${intro}${regressionBlock}${summary}${opts.caseCardsHtml ?? ""}`;
  // When a plain-language report is supplied, it leads and the technical view
  // collapses beneath it; otherwise the technical view is the whole document.
  const bodyHtml = opts.human
    ? `${renderHumanReport(sc, regressions, opts.human)}<details class="tech"><summary>Technical details (for engineers)</summary>${technical}</details>`
    : technical;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(opts.title)} — ${pctText(sc.aggregatePassRate)} (${htmlEscape(sc.model)})</title>
<style>${SCORECARD_CSS}${opts.extraCss ?? ""}</style></head>
<body><div class="wrap">
  ${bodyHtml}
</div></body></html>`;
}
