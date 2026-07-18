import { htmlEscape, SCORECARD_CSS } from "../shared/html.js";
import type { ViewerDocument, ViewerFailure } from "./viewer.types.js";

const CSP_NONCE = "index-eval-viewer-v1";
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `script-src 'nonce-${CSP_NONCE}'`,
  `style-src 'nonce-${CSP_NONCE}'`,
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "trusted-types 'none'",
  "require-trusted-types-for 'script'",
].join("; ");

const VIEWER_CSS = `
  :root{--selected:#38bdf8;--selected-bg:rgba(56,189,248,.1);--surface:#111c31}
  html{scroll-behavior:smooth}
  body{min-height:100vh}
  button,input,select{font:inherit}
  button,select,input[type="search"]{border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);padding:8px 10px}
  button{cursor:pointer}
  button:hover:not(:disabled){border-color:var(--selected)}
  button:disabled{cursor:not-allowed;opacity:.45}
  :focus-visible{outline:3px solid var(--selected);outline-offset:2px}
  .skip-link{position:absolute;left:12px;top:-80px;background:var(--fg);color:var(--bg);padding:8px 12px;border-radius:8px;z-index:10}
  .skip-link:focus{top:12px}
  .site-header{border-bottom:1px solid var(--line);background:rgba(15,23,42,.96)}
  .site-header .wrap{padding-bottom:18px}
  .eyebrow{color:var(--selected);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  .header-meta{display:flex;gap:10px 20px;flex-wrap:wrap;margin-top:10px;color:var(--muted);font-size:12px}
  .panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;margin:18px 0}
  .panel>h2:first-child{margin-top:0}
  .overview-grid,.field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .fact-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
  .fact-card h3{font-size:13px;margin:0 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .facts{margin:0}
  .facts div{padding:7px 0;border-top:1px solid var(--line)}
  .facts div:first-child{border-top:0;padding-top:0}
  .facts dt{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .facts dd{margin:2px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}
  .aggregate{font-size:36px;font-weight:750;line-height:1.1}
  .notice{border-left:3px solid var(--selected);padding:8px 10px;background:var(--selected-bg);color:var(--muted);margin-top:12px;white-space:pre-wrap}
  .controls{display:grid;grid-template-columns:minmax(220px,2fr) repeat(4,minmax(130px,1fr)) auto;gap:12px;align-items:end}
  .control{display:flex;flex-direction:column;gap:5px;min-width:0}
  .control label{font-size:12px;color:var(--muted);font-weight:600}
  .result-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:16px 0 10px}
  .pager,.item-nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .pager-output{min-width:110px;text-align:center;color:var(--muted);font-size:12px}
  .workspace{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(0,1.4fr);gap:16px;align-items:start}
  .item-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}
  .item-button{width:100%;text-align:left;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 10px;padding:11px 12px}
  .item-button[aria-current="true"]{border-color:var(--selected);background:var(--selected-bg)}
  .item-id{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
  .item-group{display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
  .status{display:inline-block;align-self:start;border:1px solid currentColor;border-radius:99px;padding:1px 7px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em}
  .status.pass,.delta.improved{color:#4ade80}
  .status.fail,.delta.regressed{color:#f87171}
  .status.flaky,.status.incomplete,.delta.unchanged{color:#fbbf24}
  .status.unjudged,.delta.new,.delta.none{color:var(--muted)}
  .delta{font-size:12px;font-weight:600}
  .detail{margin:0;position:sticky;top:12px;min-width:0}
  .detail-header{display:flex;justify-content:space-between;gap:12px;align-items:start;flex-wrap:wrap}
  .detail-header h2{margin:0;border:0;padding:0;overflow-wrap:anywhere}
  .detail-subtitle{color:var(--muted);margin:4px 0 0;overflow-wrap:anywhere}
  .diagnostic-list,.execution-list,.attempt-list{list-style:none;padding:0;margin:8px 0;display:grid;gap:9px}
  .diagnostic,.execution-run,.attempt{border:1px solid var(--line);border-radius:9px;padding:10px;background:var(--card)}
  .diagnostic-head,.execution-head,.attempt-head{display:flex;justify-content:space-between;gap:8px;align-items:start;font-weight:650;flex-wrap:wrap}
  .execution-head h4,.attempt-head h5{margin:0;overflow-wrap:anywhere}
  .execution-meta{margin-top:8px}
  .attempt-list{margin:10px 0 0;padding-left:14px;border-left:2px solid var(--line)}
  .attempt{background:var(--surface)}
  .check-list{list-style:none;padding:0;margin:8px 0 0;display:flex;gap:6px;flex-wrap:wrap}
  .check{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:2px 6px;overflow-wrap:anywhere}
  .check.yes{color:#4ade80}.check.no{color:#f87171}
  .empty{color:var(--muted);padding:18px;text-align:center;border:1px dashed var(--line);border-radius:9px}
  .keyboard-list{display:flex;gap:8px 18px;flex-wrap:wrap;color:var(--muted);font-size:12px;padding:0;list-style:none}
  kbd{border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;background:var(--card);color:var(--fg);padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .footer{color:var(--muted);font-size:12px;padding-bottom:28px}
  .failure{max-width:720px;margin:10vh auto 0}
  .failure-code{display:inline-block;color:#fbbf24;border:1px solid #d97706;border-radius:99px;padding:2px 9px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
  .failure-message{font-size:17px;white-space:pre-wrap}
  .source-summary{margin-top:18px;padding-top:14px;border-top:1px solid var(--line)}
  .source-summary code{overflow-wrap:anywhere}
  .visually-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
  [hidden]{display:none!important}
  @media(max-width:900px){.controls{grid-template-columns:repeat(2,minmax(0,1fr))}.control.search{grid-column:1/-1}.workspace{grid-template-columns:1fr}.detail{position:static}}
  @media(max-width:540px){.controls{grid-template-columns:1fr}.control.search{grid-column:auto}.wrap{padding:16px}.item-nav button{flex:1}}
  @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

function serializeForScript(document: ViewerDocument): string {
  return JSON.stringify(document)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function renderHead(title: string): string {
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<title>${htmlEscape(title)}</title>
<style nonce="${CSP_NONCE}">${SCORECARD_CSS}${VIEWER_CSS}</style>
</head>`;
}

/**
 * Renders a deterministic, self-contained, read-only viewer for one projected eval artifact.
 *
 * @param viewerDocument - Privacy-safe adapter output; it is the only data serialized into the page.
 * @returns A complete standalone HTML document.
 */
export function renderViewerHtml(viewerDocument: ViewerDocument): string {
  const serializedDocument = serializeForScript(viewerDocument);

  return `<!doctype html>
<html lang="en">
${renderHead("Eval artifact viewer")}
<body>
<a class="skip-link" href="#viewer-main">Skip to viewer</a>
<header class="site-header">
  <div class="wrap">
    <div class="eyebrow">Eval artifact viewer</div>
    <h1 id="document-title">Evaluation artifact</h1>
    <p class="muted" id="document-kind"></p>
    <div class="header-meta" id="source-meta" aria-label="Source provenance"></div>
  </div>
</header>
<main class="wrap" id="viewer-main" tabindex="-1">
  <section class="panel" aria-labelledby="overview-heading">
    <h2 id="overview-heading">Overview</h2>
    <div class="overview-grid">
      <section class="fact-card" aria-labelledby="aggregate-heading">
        <h3 id="aggregate-heading">Aggregate pass rate</h3>
        <div class="aggregate" id="aggregate-rate">—</div>
        <div class="muted" id="aggregate-detail"></div>
      </section>
      <section class="fact-card" aria-labelledby="artifact-heading">
        <h3 id="artifact-heading">Artifact</h3>
        <dl class="facts" id="artifact-facts"></dl>
      </section>
      <section class="fact-card" aria-labelledby="provenance-heading">
        <h3 id="provenance-heading">Provenance</h3>
        <dl class="facts" id="provenance-facts"></dl>
      </section>
      <section class="fact-card" aria-labelledby="completeness-heading">
        <h3 id="completeness-heading">Completeness</h3>
        <dl class="facts" id="completeness-facts"></dl>
      </section>
      <section class="fact-card" aria-labelledby="summary-heading">
        <h3 id="summary-heading">Summary</h3>
        <dl class="facts" id="summary-facts"></dl>
      </section>
      <section class="fact-card" id="baseline-card" aria-labelledby="baseline-heading" hidden>
        <h3 id="baseline-heading">Baseline comparison</h3>
        <dl class="facts" id="baseline-facts"></dl>
      </section>
    </div>
    <p class="notice" id="telemetry-notice" hidden></p>
  </section>

  <section class="panel" aria-labelledby="rules-heading">
    <h2 id="rules-heading">Rules</h2>
    <div class="empty" id="rules-empty" hidden>No rule rollups are available.</div>
    <div id="rules-table-wrap">
      <table>
        <caption class="visually-hidden">Rule pass rates and baseline changes</caption>
        <thead><tr><th scope="col">Rule</th><th scope="col">Items</th><th scope="col">Pass rate</th><th scope="col">Baseline delta</th></tr></thead>
        <tbody id="rules-body"></tbody>
      </table>
    </div>
  </section>

  <section class="panel" aria-labelledby="cases-heading">
    <h2 id="cases-heading">Cases</h2>
    <div class="controls" aria-label="Case filters">
      <div class="control search">
        <label for="search-input">Search cases</label>
        <input id="search-input" type="search" autocomplete="off" spellcheck="false" placeholder="ID, group, field, diagnostic, or execution">
      </div>
      <div class="control">
        <label for="group-filter">Group</label>
        <select id="group-filter"><option value="all">All groups</option></select>
      </div>
      <div class="control">
        <label for="state-filter">Result state</label>
        <select id="state-filter">
          <option value="all">All states</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="flaky">Flaky</option><option value="incomplete">Incomplete execution</option><option value="unjudged">Unjudged</option>
        </select>
      </div>
      <div class="control">
        <label for="delta-filter">Baseline delta</label>
        <select id="delta-filter">
          <option value="all">All deltas</option><option value="improved">Improved</option><option value="regressed">Regressed</option><option value="unchanged">Unchanged</option><option value="new">New</option><option value="none">Not compared</option>
        </select>
      </div>
      <div class="control">
        <label for="page-size">Cases per page</label>
        <select id="page-size"><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select>
      </div>
      <button id="clear-filters" type="button">Clear filters</button>
    </div>

    <div class="result-bar">
      <div id="result-count" role="status" aria-live="polite" aria-atomic="true"></div>
      <nav class="pager" aria-label="Case pages">
        <button id="previous-page" type="button" aria-label="Previous page">Previous page</button>
        <output class="pager-output" id="page-output" aria-live="polite"></output>
        <button id="next-page" type="button" aria-label="Next page">Next page</button>
      </nav>
    </div>

    <div class="workspace">
      <div>
        <ol class="item-list" id="item-list" aria-label="Filtered cases"></ol>
        <div class="empty" id="items-empty" hidden>No cases match the current filters.</div>
      </div>
      <article class="panel detail" id="item-detail" aria-labelledby="selected-item-heading">
        <div class="detail-header">
          <div>
            <h2 id="selected-item-heading" tabindex="-1" aria-live="polite">Select a case</h2>
            <p class="detail-subtitle" id="selected-item-subtitle"></p>
          </div>
          <span class="status unjudged" id="selected-item-state">Unjudged</span>
        </div>
        <div class="item-nav" aria-label="Selected case navigation">
          <button id="previous-item" type="button">Previous item</button>
          <button id="next-item" type="button">Next item</button>
          <button id="random-item" type="button">Random item</button>
        </div>
        <section aria-labelledby="selected-metrics-heading">
          <h3 id="selected-metrics-heading">Metrics</h3>
          <dl class="facts" id="selected-metrics"></dl>
        </section>
        <section aria-labelledby="selected-fields-heading">
          <h3 id="selected-fields-heading">Fields</h3>
          <dl class="facts" id="selected-fields"></dl>
        </section>
        <section aria-labelledby="execution-heading">
          <h3 id="execution-heading">Execution</h3>
          <div id="execution-runs"></div>
        </section>
        <section aria-labelledby="diagnostics-heading">
          <h3 id="diagnostics-heading">Diagnostics</h3>
          <div id="diagnostics"></div>
        </section>
      </article>
    </div>
  </section>

  <aside class="panel" aria-labelledby="shortcuts-heading">
    <h2 id="shortcuts-heading">Keyboard shortcuts</h2>
    <ul class="keyboard-list">
      <li><kbd>/</kbd> Search</li><li><kbd>j</kbd> Next item</li><li><kbd>k</kbd> Previous item</li><li><kbd>r</kbd> Random item</li><li><kbd>[</kbd> Previous page</li><li><kbd>]</kbd> Next page</li><li><kbd>Esc</kbd> Clear search</li>
    </ul>
  </aside>
</main>
<footer class="wrap footer">Read-only local artifact view. No data is transmitted.</footer>
<script nonce="${CSP_NONCE}">
"use strict";
const viewerDocument = ${serializedDocument};
(() => {
  const byId = (id) => window.document.getElementById(id);
  const make = (tag, className, text) => {
    const node = window.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const lexicalSort = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  const percent = (value) => value === null || value === undefined ? "—" : String(Math.round(value * 100)) + "%";
  const signedPercent = (value) => {
    if (value === null || value === undefined) return "—";
    const rounded = Math.round(value * 100);
    return (rounded > 0 ? "+" : "") + String(rounded) + " pp";
  };
  const byteText = (value) => new Intl.NumberFormat("en-US").format(value) + " bytes";
  const validStates = ["all", "pass", "fail", "flaky", "incomplete", "unjudged"];
  const validDeltas = ["all", "improved", "regressed", "unchanged", "new", "none"];
  const validSizes = [10, 25, 50, 100];
  const state = { query: "", group: "all", result: "all", delta: "all", pageSize: 25, page: 1, selectedId: "" };
  let filteredItems = [];
  let randomState = seedFromDigest(viewerDocument.source.sha256);

  function seedFromDigest(digest) {
    let seed = 2166136261;
    for (let index = 0; index < digest.length; index += 1) {
      seed ^= digest.charCodeAt(index);
      seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
  }

  function nextRandomIndex(length) {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let value = randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    value = (value ^ (value >>> 14)) >>> 0;
    return Math.floor((value / 4294967296) * length);
  }

  function appendFact(list, label, value) {
    const row = make("div");
    row.append(make("dt", "", label), make("dd", "", value));
    list.append(row);
  }

  function renderFields(target, fields, emptyText) {
    target.replaceChildren();
    if (fields.length === 0) {
      appendFact(target, "Availability", emptyText);
      return;
    }
    for (const field of fields) appendFact(target, field.label, field.value);
  }

  function renderOverview() {
    byId("document-title").textContent = viewerDocument.title;
    byId("document-kind").textContent = viewerDocument.kind + " · adapter " + viewerDocument.adapterId + " · schema " + String(viewerDocument.viewerSchemaVersion);
    window.document.title = viewerDocument.title + " — Eval artifact viewer";

    const sourceMeta = byId("source-meta");
    sourceMeta.replaceChildren();
    sourceMeta.append(
      make("span", "", "SHA-256 " + viewerDocument.source.sha256),
      make("span", "", byteText(viewerDocument.source.byteLength)),
      make("span", "", String(viewerDocument.items.length) + (viewerDocument.items.length === 1 ? " item" : " items")),
    );

    byId("aggregate-rate").textContent = percent(viewerDocument.aggregatePassRate);
    byId("aggregate-detail").textContent = viewerDocument.aggregatePassRate === null ? "Aggregate judgment unavailable" : "Across projected case results";
    renderFields(byId("artifact-facts"), viewerDocument.artifact, "No artifact fields supplied");
    const provenance = [{ label: "Source SHA-256", value: viewerDocument.source.sha256 }, { label: "Source bytes", value: byteText(viewerDocument.source.byteLength) }, ...viewerDocument.provenance];
    renderFields(byId("provenance-facts"), provenance, "No provenance fields supplied");
    renderFields(byId("completeness-facts"), viewerDocument.completeness, "No completeness fields supplied");
    renderFields(byId("summary-facts"), viewerDocument.summary, "No summary fields supplied");

    const notice = byId("telemetry-notice");
    notice.hidden = !viewerDocument.telemetryNotice;
    notice.textContent = viewerDocument.telemetryNotice || "";

    const baselineCard = byId("baseline-card");
    baselineCard.hidden = !viewerDocument.baseline;
    if (viewerDocument.baseline) {
      const baseline = viewerDocument.baseline;
      renderFields(byId("baseline-facts"), [
        { label: "Source SHA-256", value: baseline.source.sha256 },
        { label: "Source bytes", value: byteText(baseline.source.byteLength) },
        { label: "Before", value: percent(baseline.aggregate.before) },
        { label: "After", value: percent(baseline.aggregate.after) },
        { label: "Change", value: signedPercent(baseline.aggregate.change) },
        { label: "State", value: baseline.aggregate.state },
        { label: "Compatibility", value: baseline.compatibility },
        { label: "Comparison notice", value: baseline.notice },
        { label: "Missing items", value: String(baseline.missingItemIds.length) },
      ], "No baseline fields supplied");
    }
  }

  function deltaText(delta) {
    if (!delta) return "Not compared";
    return delta.state + " (" + percent(delta.before) + " → " + percent(delta.after) + ", " + signedPercent(delta.change) + ")";
  }

  function renderRules() {
    const body = byId("rules-body");
    body.replaceChildren();
    byId("rules-empty").hidden = viewerDocument.rules.length !== 0;
    byId("rules-table-wrap").hidden = viewerDocument.rules.length === 0;
    for (const rule of viewerDocument.rules) {
      const row = make("tr");
      const ruleCell = make("th", "", rule.id);
      ruleCell.scope = "row";
      row.append(ruleCell, make("td", "", rule.itemCount), make("td", "", percent(rule.passRate)));
      const deltaCell = make("td");
      const deltaState = rule.delta ? rule.delta.state : "none";
      deltaCell.append(make("span", "delta " + deltaState, deltaText(rule.delta)));
      row.append(deltaCell);
      body.append(row);
    }
  }

  function addGroupOptions() {
    const groups = [...new Set(viewerDocument.items.map((item) => item.group))].sort(lexicalSort);
    const select = byId("group-filter");
    for (const group of groups) {
      const option = make("option", "", group);
      option.value = group;
      select.append(option);
    }
  }

  function decodeHashValue(value) {
    try { return decodeURIComponent(value); } catch { return ""; }
  }

  function readHash() {
    const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const values = {};
    for (const pair of raw.split("&")) {
      if (!pair) continue;
      const separator = pair.indexOf("=");
      const key = decodeHashValue(separator === -1 ? pair : pair.slice(0, separator));
      const value = decodeHashValue(separator === -1 ? "" : pair.slice(separator + 1));
      values[key] = value;
    }
    state.query = values.q || "";
    state.group = values.group === "all" || viewerDocument.items.some((item) => item.group === values.group) ? values.group || "all" : "all";
    state.result = validStates.includes(values.state) ? values.state : "all";
    state.delta = validDeltas.includes(values.delta) ? values.delta : "all";
    const parsedSize = Number(values.size);
    state.pageSize = validSizes.includes(parsedSize) ? parsedSize : 25;
    const parsedPage = Number(values.page);
    state.page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    state.selectedId = values.item || "";
    syncControls();
  }

  function writeHash() {
    const values = [
      ["q", state.query], ["group", state.group], ["state", state.result], ["delta", state.delta],
      ["size", String(state.pageSize)], ["page", String(state.page)], ["item", state.selectedId],
    ];
    const hash = values.map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&");
    window.history.replaceState(null, "", "#" + hash);
  }

  function syncControls() {
    byId("search-input").value = state.query;
    byId("group-filter").value = state.group;
    byId("state-filter").value = state.result;
    byId("delta-filter").value = state.delta;
    byId("page-size").value = String(state.pageSize);
  }

  function itemSearchText(item) {
    const parts = [item.id, item.group, item.state];
    for (const field of item.fields) parts.push(field.label, field.value);
    for (const diagnostic of item.diagnostics) {
      parts.push(String(diagnostic.run), diagnostic.passed ? "passed" : "failed");
      for (const check of diagnostic.checks) parts.push(check.kind, check.passed ? "passed" : "failed");
    }
    parts.push("execution available", String(item.executionAvailable), item.executionAvailable ? "execution telemetry available" : "execution attempt telemetry unavailable");
    for (const executionRun of item.executionRuns) {
      parts.push(
        "requested run", String(executionRun.run), "run id", executionRun.runId,
        "outcome", executionRun.outcome, "recovered", String(executionRun.recovered),
        executionRun.recovered ? "recovered" : "not recovered",
      );
      if (executionRun.attempts.length === 0) parts.push("cancelled before start");
      for (const attempt of executionRun.attempts) {
        parts.push(
          "attempt", String(attempt.attemptNumber), "attempt id", attempt.attemptId,
          "outcome", attempt.outcome, "started at", attempt.startedAt,
          "completed at", attempt.completedAt, "duration ms", String(attempt.durationMs),
          "retryable", String(attempt.retryable), attempt.retryable ? "retryable" : "not retryable",
          "backoff ms", String(attempt.backoffMs),
        );
      }
    }
    return parts.join("\\n").toLowerCase();
  }

  function applyFilters() {
    const query = state.query.trim().toLowerCase();
    filteredItems = viewerDocument.items.filter((item) => {
      if (state.group !== "all" && item.group !== state.group) return false;
      if (state.result !== "all" && item.state !== state.result) return false;
      const itemDelta = item.delta ? item.delta.state : "none";
      if (state.delta !== "all" && itemDelta !== state.delta) return false;
      return !query || itemSearchText(item).includes(query);
    });
  }

  function pageCount() {
    return Math.max(1, Math.ceil(filteredItems.length / state.pageSize));
  }

  function pageItems() {
    const start = (state.page - 1) * state.pageSize;
    return filteredItems.slice(start, start + state.pageSize);
  }

  function ensureSelection(itemsOnPage) {
    if (filteredItems.length === 0) {
      state.selectedId = "";
      return;
    }
    const selectedIndex = filteredItems.findIndex((item) => item.id === state.selectedId);
    if (selectedIndex === -1) state.selectedId = (itemsOnPage[0] || filteredItems[0]).id;
  }

  function renderItemList(itemsOnPage) {
    const list = byId("item-list");
    list.replaceChildren();
    byId("items-empty").hidden = filteredItems.length !== 0;
    for (const item of itemsOnPage) {
      const listItem = make("li");
      const button = make("button", "item-button");
      button.type = "button";
      button.dataset.itemId = item.id;
      button.setAttribute("aria-current", String(item.id === state.selectedId));
      const identity = make("span");
      identity.append(make("span", "item-id", item.id), make("span", "item-group", item.group));
      const status = make("span", "status " + item.state, item.state);
      button.append(identity, status);
      button.addEventListener("click", () => selectItem(item.id, true));
      listItem.append(button);
      list.append(listItem);
    }
  }

  function renderMetrics(item) {
    const metrics = byId("selected-metrics");
    metrics.replaceChildren();
    appendFact(metrics, "Result", item.state);
    appendFact(metrics, "Runs", item.runs === undefined ? "—" : item.runs);
    appendFact(metrics, "Passes", item.passes === undefined ? "—" : item.passes);
    appendFact(metrics, "Pass rate", percent(item.passRate));
    appendFact(metrics, "Baseline delta", deltaText(item.delta));
  }

  function executionStatusClass(outcome) {
    if (outcome === "success") return "pass";
    if (outcome === "cancelled") return "unjudged";
    return "fail";
  }

  function renderExecution(item) {
    const target = byId("execution-runs");
    target.replaceChildren();
    if (!item.executionAvailable) {
      target.append(make("p", "empty", "Execution and attempt telemetry are unavailable for this item."));
      return;
    }
    if (item.executionRuns.length === 0) {
      target.append(make("p", "empty", "No execution run rows were supplied."));
      return;
    }

    const runs = make("ol", "execution-list");
    for (const executionRun of item.executionRuns) {
      const runRow = make("li", "execution-run");
      const runHead = make("div", "execution-head");
      const runTitle = make("h4", "", "Requested run " + String(executionRun.run) + " · " + executionRun.runId);
      const runOutcome = make("span", "status " + executionStatusClass(executionRun.outcome), executionRun.outcome);
      runHead.append(runTitle, runOutcome);
      runRow.append(runHead);

      const runFacts = make("dl", "facts execution-meta");
      appendFact(runFacts, "Requested run number", executionRun.run);
      appendFact(runFacts, "Run ID", executionRun.runId);
      appendFact(runFacts, "Outcome", executionRun.outcome);
      appendFact(runFacts, "Recovered", executionRun.recovered ? "Yes" : "No");
      runRow.append(runFacts);

      if (executionRun.attempts.length === 0) {
        runRow.append(make("p", "empty", "Cancelled before start. No attempts were recorded."));
      } else {
        const attempts = make("ol", "attempt-list");
        attempts.setAttribute("aria-label", "Attempts for requested run " + String(executionRun.run));
        for (const attempt of executionRun.attempts) {
          const attemptRow = make("li", "attempt");
          const attemptHead = make("div", "attempt-head");
          const attemptTitle = make("h5", "", "Attempt " + String(attempt.attemptNumber) + " · " + attempt.attemptId);
          const attemptOutcome = make("span", "status " + executionStatusClass(attempt.outcome), attempt.outcome);
          attemptHead.append(attemptTitle, attemptOutcome);
          attemptRow.append(attemptHead);

          const attemptFacts = make("dl", "facts execution-meta");
          appendFact(attemptFacts, "Attempt number", attempt.attemptNumber);
          appendFact(attemptFacts, "Attempt ID", attempt.attemptId);
          appendFact(attemptFacts, "Outcome", attempt.outcome);
          appendFact(attemptFacts, "Started at", attempt.startedAt);
          appendFact(attemptFacts, "Completed at", attempt.completedAt);
          appendFact(attemptFacts, "Duration", String(attempt.durationMs) + " ms");
          appendFact(attemptFacts, "Retryable", attempt.retryable ? "Yes" : "No");
          appendFact(attemptFacts, "Backoff", String(attempt.backoffMs) + " ms");
          attemptRow.append(attemptFacts);
          attempts.append(attemptRow);
        }
        runRow.append(attempts);
      }
      runs.append(runRow);
    }
    target.append(runs);
  }

  function renderDiagnostics(item) {
    const target = byId("diagnostics");
    target.replaceChildren();
    if (!item.diagnosticsAvailable) {
      target.append(make("p", "empty", "Diagnostics are unavailable for this item."));
      return;
    }
    if (item.diagnostics.length === 0) {
      target.append(make("p", "empty", "No diagnostic rows were supplied."));
      return;
    }
    const list = make("ol", "diagnostic-list");
    for (const diagnostic of item.diagnostics) {
      const row = make("li", "diagnostic");
      const heading = make("div", "diagnostic-head");
      heading.append(make("span", "", "Run " + String(diagnostic.run)), make("span", "status " + (diagnostic.passed ? "pass" : "fail"), diagnostic.passed ? "Pass" : "Fail"));
      row.append(heading);
      if (diagnostic.checks.length === 0) {
        row.append(make("p", "muted", "No allowlisted checks supplied."));
      } else {
        const checks = make("ul", "check-list");
        for (const check of diagnostic.checks) {
          const checkRow = make("li", "check " + (check.passed ? "yes" : "no"), (check.passed ? "Pass: " : "Fail: ") + check.kind);
          checks.append(checkRow);
        }
        row.append(checks);
      }
      list.append(row);
    }
    target.append(list);
  }

  function renderSelectedItem() {
    const item = filteredItems.find((candidate) => candidate.id === state.selectedId);
    const detail = byId("item-detail");
    if (!item) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    byId("selected-item-heading").textContent = item.id;
    byId("selected-item-subtitle").textContent = item.group;
    const stateBadge = byId("selected-item-state");
    stateBadge.className = "status " + item.state;
    stateBadge.textContent = item.state;
    renderMetrics(item);
    renderFields(byId("selected-fields"), item.fields, "No display fields supplied");
    renderExecution(item);
    renderDiagnostics(item);

    const index = filteredItems.indexOf(item);
    byId("previous-item").disabled = index <= 0;
    byId("next-item").disabled = index === -1 || index >= filteredItems.length - 1;
    byId("random-item").disabled = filteredItems.length === 0;
  }

  function render(options) {
    applyFilters();
    state.page = Math.min(Math.max(1, state.page), pageCount());
    let itemsOnPage = pageItems();
    ensureSelection(itemsOnPage);
    const selectedIndex = filteredItems.findIndex((item) => item.id === state.selectedId);
    if (selectedIndex !== -1 && options && options.followSelection) {
      state.page = Math.floor(selectedIndex / state.pageSize) + 1;
      itemsOnPage = pageItems();
    }
    renderItemList(itemsOnPage);
    renderSelectedItem();

    const first = filteredItems.length === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
    const last = Math.min(filteredItems.length, state.page * state.pageSize);
    byId("result-count").textContent = filteredItems.length === viewerDocument.items.length
      ? String(filteredItems.length) + (filteredItems.length === 1 ? " case" : " cases")
      : String(filteredItems.length) + " of " + String(viewerDocument.items.length) + " cases";
    byId("page-output").textContent = "Page " + String(state.page) + " of " + String(pageCount()) + (filteredItems.length ? " · " + String(first) + "–" + String(last) : "");
    byId("previous-page").disabled = state.page <= 1;
    byId("next-page").disabled = state.page >= pageCount();
    writeHash();
  }

  function selectItem(id, focusDetail) {
    state.selectedId = id;
    render({ followSelection: true });
    if (focusDetail) byId("selected-item-heading").focus({ preventScroll: true });
  }

  function moveItem(offset) {
    if (filteredItems.length === 0) return;
    const current = filteredItems.findIndex((item) => item.id === state.selectedId);
    const target = Math.min(filteredItems.length - 1, Math.max(0, current + offset));
    if (target !== current) selectItem(filteredItems[target].id, true);
  }

  function chooseRandomItem() {
    if (filteredItems.length === 0) return;
    let target = nextRandomIndex(filteredItems.length);
    if (filteredItems.length > 1 && filteredItems[target].id === state.selectedId) target = (target + 1) % filteredItems.length;
    selectItem(filteredItems[target].id, true);
  }

  function movePage(offset) {
    const target = Math.min(pageCount(), Math.max(1, state.page + offset));
    if (target === state.page) return;
    state.page = target;
    const first = filteredItems[(state.page - 1) * state.pageSize];
    state.selectedId = first ? first.id : "";
    render();
  }

  function filtersChanged() {
    state.query = byId("search-input").value;
    state.group = byId("group-filter").value;
    state.result = byId("state-filter").value;
    state.delta = byId("delta-filter").value;
    state.pageSize = Number(byId("page-size").value);
    state.page = 1;
    state.selectedId = "";
    render();
  }

  byId("search-input").addEventListener("input", filtersChanged);
  byId("group-filter").addEventListener("change", filtersChanged);
  byId("state-filter").addEventListener("change", filtersChanged);
  byId("delta-filter").addEventListener("change", filtersChanged);
  byId("page-size").addEventListener("change", filtersChanged);
  byId("clear-filters").addEventListener("click", () => {
    state.query = ""; state.group = "all"; state.result = "all"; state.delta = "all"; state.page = 1; state.selectedId = "";
    syncControls();
    render();
    byId("search-input").focus();
  });
  byId("previous-page").addEventListener("click", () => movePage(-1));
  byId("next-page").addEventListener("click", () => movePage(1));
  byId("previous-item").addEventListener("click", () => moveItem(-1));
  byId("next-item").addEventListener("click", () => moveItem(1));
  byId("random-item").addEventListener("click", chooseRandomItem);

  window.document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const active = window.document.activeElement;
    const editing = active && (active.tagName === "INPUT" || active.tagName === "SELECT");
    if (event.key === "Escape") {
      if (state.query) {
        state.query = "";
        byId("search-input").value = "";
        state.page = 1;
        render();
      }
      if (active && typeof active.blur === "function") active.blur();
      return;
    }
    if (editing) return;
    if (event.key === "/") {
      event.preventDefault();
      byId("search-input").focus();
      byId("search-input").select();
    } else if (event.key === "j") {
      event.preventDefault(); moveItem(1);
    } else if (event.key === "k") {
      event.preventDefault(); moveItem(-1);
    } else if (event.key === "r") {
      event.preventDefault(); chooseRandomItem();
    } else if (event.key === "[") {
      event.preventDefault(); movePage(-1);
    } else if (event.key === "]") {
      event.preventDefault(); movePage(1);
    }
  });

  addGroupOptions();
  renderOverview();
  renderRules();
  readHash();
  render({ followSelection: true });
})();
</script>
</body>
</html>`;
}

/**
 * Renders a deterministic static error page containing only sanitized failure guidance and source provenance.
 *
 * @param failure - Public-safe failure information.
 * @returns A complete standalone HTML document with no script.
 */
export function renderViewerFailureHtml(failure: ViewerFailure): string {
  const source = failure.source
    ? `<div class="source-summary"><h2>Source summary</h2><p><strong>SHA-256 digest:</strong> <code>${htmlEscape(failure.source.sha256)}</code></p><p><strong>Byte count:</strong> ${failure.source.byteLength}</p></div>`
    : "";

  return `<!doctype html>
<html lang="en">
${renderHead("Eval artifact could not be displayed")}
<body>
<main class="wrap failure" aria-labelledby="failure-title">
  <section class="panel" role="alert">
    <span class="failure-code">${htmlEscape(failure.code)}</span>
    <h1 id="failure-title">${htmlEscape(failure.title)}</h1>
    <p class="failure-message">${htmlEscape(failure.message)}</p>
    <p class="muted">The viewer stopped without rendering any artifact content.</p>
    ${source}
  </section>
</main>
</body>
</html>`;
}
