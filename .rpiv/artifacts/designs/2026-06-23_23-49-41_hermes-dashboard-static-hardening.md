---
date: 2026-06-23T23:49:41+0300
author: Yanek Yuk
commit: 4150d08484
branch: dev
repository: index
topic: hermes-dashboard-static-hardening
tags: [design, hermes-plugin, dashboard, code-review-fix]
status: ready
parent: .worktrees/feat-hermes-dashboard-shell/.rpiv/artifacts/reviews/2026-06-23_22-54-51_feat-hermes-dashboard-shell-working.md
last_updated: 2026-06-23T23:49:41+0300
last_updated_by: Yanek Yuk
source_worktree: .worktrees/feat-hermes-dashboard-shell
---

# Design: Hermes Dashboard Static-Only Hardening

## Summary

Address the Hermes dashboard shell review by removing the unguarded backend API surface from this slice and shipping the dashboard as static-only. The existing no-build dashboard tab remains available, while live Index overview routes are deferred until Hermes route authentication is known and can be modeled explicitly.

## Requirements

- Fix review finding S1 by preventing `dashboard/plugin_api.py` from being mounted through `dashboard/manifest.json`.
- Fix review finding S2 by removing unauthenticated dashboard health exposure from the shipped dashboard manifest.
- Remove the current dead/risky live API code path rather than hardening unauthenticated routes in place.
- Preserve the dashboard tab as a read-only static Hermes UI.
- Preserve the no-build checked-in `dist/index.js` / `dist/style.css` dashboard distribution model.
- Keep tests dependency-light, using the existing stdlib `tests/smoke.py` style.
- Do not create a second Index REST or MCP client in dashboard code.

## Current State Analysis

The dashboard currently ships both a static tab and an optional Python backend API. The backend API is wired by manifest, imports native handlers, and exposes `/health` and `/overview` with no local guard. The frontend attempts to call `/api/plugins/index-network/overview` when `SDK.fetchJSON` exists and renders “Live read-only” based on the backend `live` boolean.

### Key Discoveries

- `packages/hermes-plugin/dashboard/manifest.json:13` wires `"api": "plugin_api.py"`, causing Hermes hosts that support Python dashboard routes to load the backend module.
- `packages/hermes-plugin/dashboard/plugin_api.py:216` and `packages/hermes-plugin/dashboard/plugin_api.py:228` define unauthenticated `/health` and `/overview` routes.
- `packages/hermes-plugin/dashboard/plugin_api.py:193-195` calls `index_agent_me`, `index_read_intents`, and `read_docs` through native handlers, so `/overview` can return Index-key-backed data.
- `packages/hermes-plugin/dashboard/plugin_api.py:32` mutates `sys.path` globally to import `tools.py`.
- `packages/hermes-plugin/dashboard/dist/index.js:27` assumes the live endpoint path `/api/plugins/index-network/overview` and `dist/index.js:94` renders “Live read-only” from `overview.live`.
- `packages/hermes-plugin/tests/smoke.py:144-185` currently validates the dashboard API by string inspection instead of executing or removing it.
- `packages/hermes-plugin/dashboard/README.md:42` says future live dashboard code should reuse `tools.py` rather than creating a second Index client.
- `packages/hermes-plugin/tools.py:223` can return non-JSON MCP text as `text`, which the removed backend path did not summarize correctly.

## Scope

### Building

- Remove `api` from the dashboard manifest.
- Delete `dashboard/plugin_api.py` from the intended dashboard source tree for this slice.
- Remove frontend live fetch/status plumbing and keep a static read-only dashboard tab.
- Update package and dashboard READMEs to describe static-only behavior and defer live routes until route auth exists.
- Update smoke tests to assert the static-only contract: no `api` manifest entry, no dashboard API file requirement, no live endpoint fetch, and no negotiation action controls.

### Not Building

- No live `/health` or `/overview` routes in this slice.
- No Hermes route-auth dependency or shared-secret protocol.
- No direct dashboard REST/MCP client.
- No dashboard build pipeline or source transpilation step.
- No changes to `tools.py`, root Hermes tool registration, generated skills, or Index protocol APIs.

## Decisions

### Static-only route exposure

**Ambiguity:** The review offered either adding a Hermes-supported route guard or omitting the backend API from the manifest. No Python/FastAPI auth dependency pattern exists in this repo, and live route auth depends on Hermes host behavior.

**Explored:**
- Static-only now: remove `manifest.json:13` and delete/defer the backend API. Pro: fixes unauthenticated route exposure completely; matches source-dependent route support documented in `dashboard/README.md:32`. Con: live overview is unavailable for this slice.
- Keep sanitized API: harden redaction/status while assuming host authentication. Pro: preserves live overview. Con: leaves S1/S2 dependent on an unverified external guarantee.
- Env header guard: add dashboard secret header. Pro: local guard. Con: no evidence `SDK.fetchJSON` can provide such a secret safely.

**Decision:** Static-only now. Remove backend API wiring and defer live routes until route authentication is understood.

### Reuse native handlers for future live data

Future live dashboard routes should still reuse `tools.py` rather than adding a second Index client. Evidence: `dashboard/README.md:42` states `tools.py` owns authentication headers, scoped MCP forwarding, timeout behavior, and response decoding.

### Keep no-build dashboard assets

The dashboard is a checked-in IIFE and scoped CSS (`dashboard/dist/index.js`, `dashboard/dist/style.css`). The design patches the distribution files directly and does not introduce a bundler.

### Keep stdlib smoke tests

`packages/hermes-plugin/tests/smoke.py:44-100` already uses `importlib`, fake `urlopen`, and bare assertions. The design extends that style instead of adding pytest, FastAPI, or frontend test dependencies.

## Architecture

### packages/hermes-plugin/dashboard/manifest.json — MODIFY

Remove backend API registration while keeping static entry and CSS.

```json
{
  "name": "index-network",
  "label": "Index Network",
  "description": "Static read-only Index Network guidance for signals, protocol usage, and autonomous negotiator setup.",
  "icon": "Sparkles",
  "version": "0.4.0",
  "tab": {
    "path": "/index-network",
    "position": "after:skills"
  },
  "entry": "dist/index.js",
  "css": "dist/style.css"
}
```

### packages/hermes-plugin/dashboard/plugin_api.py — DELETE

Delete the unmounted/unauthed backend API module from this dashboard slice.

```text
DELETE FILE: packages/hermes-plugin/dashboard/plugin_api.py
```

### packages/hermes-plugin/dashboard/README.md — MODIFY

Update dashboard docs from optional live routes to static-only behavior and deferred route-auth work.

````markdown
# Index Network Hermes Dashboard

This directory contains the plugin-local Hermes dashboard tab for the Index Network plugin.

```text
dashboard/manifest.json   # Hermes dashboard plugin manifest
dashboard/dist/index.js   # no-build IIFE bundle registered with the Hermes Plugin SDK
dashboard/dist/style.css  # theme-aware styles scoped to .index-dashboard*
```

## Scope

The dashboard is intentionally static and read-only. It gives Hermes users protocol-aligned guidance for Index Network signals, communities, and autonomous negotiator setup without exposing Python dashboard routes or creating a second Index data contract.

It does **not**:

- mount Python backend routes;
- call live Index MCP or REST APIs;
- claim pending negotiation turns;
- submit negotiation responses;
- run discovery;
- expose raw tool output, internal identifiers, tokens, raw messages, or assistant reasoning.

## Runtime behavior

The tab always registers as `index-network` and renders static protocol-aligned guidance through `dist/index.js` and `dist/style.css`.

Live dashboard routes are deliberately deferred until Hermes exposes a documented route-auth mechanism for this plugin source. When that work is reintroduced, route handlers should live behind explicit authentication and continue reusing the native handlers in `../tools.py`; do not add direct Index MCP or REST client code in the dashboard.

## Verify

From the monorepo root:

```bash
cd packages/hermes-plugin && bun run test
```

For manual Hermes dashboard testing, refresh plugin discovery after installing or changing dashboard files:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Then open `hermes dashboard` and visit the **Index Network** tab. The tab should render static guidance without requiring Python dashboard routes.
````

### packages/hermes-plugin/README.md — MODIFY

Update package docs so install/verify guidance no longer advertises backend dashboard routes in this slice.

````markdown
It also bundles generated, namespaced Hermes plugin skills, an orchestrator hint hook, a slash command, and a static read-only dashboard tab:

- `skills/index-orchestrator/SKILL.md` — signal/intent review and discovery preparation guidance for Hermes.
- `skills/index-negotiator/SKILL.md` — autonomous personal-agent negotiation guidance for scheduled Hermes runs.
- `pre_llm_call` hook — nudges Hermes to load `skill_view("index-network:index-orchestrator")` for clear Index/signal/intent/opportunity prompts.
- `/index` command — returns the same skill-loading hint explicitly.
- `dashboard/` — Hermes dashboard tab with static read-only guidance for Index signals, protocol usage, and autonomous negotiator setup.
````

````markdown
## Dashboard view

The plugin ships a plugin-local Hermes dashboard tab under `dashboard/`:

```text
dashboard/manifest.json
dashboard/dist/index.js
dashboard/dist/style.css
```

The tab appears as **Index Network** in Hermes and is read-only. It summarizes protocol guidance for signals and communities, explains autonomous negotiator setup, and never calls live Index APIs or the pickup/respond negotiation tools from dashboard UI.

This slice intentionally ships the dashboard as static-only. Python dashboard backend routes are deferred until Hermes route authentication is documented for this plugin source; any future live route design should reuse `tools.py` for Index authentication, scoped MCP forwarding, timeouts, and response decoding instead of creating a second client.
````

````markdown
For manual dashboard checks, run `curl http://127.0.0.1:9119/api/dashboard/plugins/rescan` or restart `hermes dashboard`, then open the **Index Network** tab. The tab should render static guidance without requiring `/api/plugins/index-network/*` backend routes.
````

### packages/hermes-plugin/dashboard/dist/index.js — MODIFY

Remove live fetch state and render static read-only guidance only.

```javascript
/**
 * Index Network Hermes dashboard.
 *
 * Registers a static, read-only dashboard tab. Live Python dashboard routes are
 * deliberately deferred until route authentication is explicit for this plugin
 * source, so this bundle performs no network fetches.
 */
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) {
    console.warn("[index-network] Hermes dashboard plugin SDK is unavailable.");
    return;
  }

  const React = SDK.React;
  const components = SDK.components || {};
  const Card = components.Card || "section";
  const CardHeader = components.CardHeader || "div";
  const CardTitle = components.CardTitle || "h2";
  const CardContent = components.CardContent || "div";
  const Badge = components.Badge || "span";

  function BadgeText(props) {
    return React.createElement(Badge, { variant: "outline", className: "index-dashboard__badge" }, props.children);
  }

  function GuidanceCard(props) {
    return React.createElement(Card, { className: "index-dashboard__card" },
      React.createElement(CardHeader, { className: "index-dashboard__card-header" },
        React.createElement("div", { className: "index-dashboard__card-title-row" },
          React.createElement(CardTitle, { className: "index-dashboard__card-title" }, props.title),
          props.badge ? React.createElement(BadgeText, null, props.badge) : null,
        ),
      ),
      React.createElement(CardContent, { className: "index-dashboard__card-content" }, props.children),
    );
  }

  function BulletList(props) {
    return React.createElement("ul", { className: "index-dashboard__list" },
      props.items.map(function (item) {
        return React.createElement("li", { key: item }, item);
      }),
    );
  }

  function StatusPanel() {
    return React.createElement("div", { className: "index-dashboard__status-card" },
      React.createElement(BadgeText, null, "Static read-only"),
      React.createElement("p", null,
        "This dashboard version does not mount Python routes or call live Index APIs. Use the bundled Hermes tools and skills for authenticated work.",
      ),
    );
  }

  function IndexNetworkDashboard() {
    return React.createElement("div", { className: "index-dashboard" },
      React.createElement("section", { className: "index-dashboard__hero" },
        React.createElement("div", null,
          React.createElement("p", { className: "index-dashboard__eyebrow" }, "Index Network"),
          React.createElement("h1", { className: "index-dashboard__title" }, "Signals and autonomous negotiation"),
          React.createElement("p", { className: "index-dashboard__subtitle" },
            "A static read-only overview for the Index Network Hermes plugin. It keeps protocol guidance close to the native Hermes tools while avoiding unauthenticated dashboard backend routes.",
          ),
          React.createElement("p", { className: "index-dashboard__agent" },
            "Load index-network:index-orchestrator in Hermes chat for authenticated signal review and discovery preparation.",
          ),
        ),
        React.createElement(StatusPanel, null),
      ),

      React.createElement("div", { className: "index-dashboard__grid" },
        React.createElement(GuidanceCard, { title: "Signals", badge: "Guidance" },
          React.createElement("p", null,
            "Use signal language in user-facing copy and keep communities' visibility bounded by the configured Index agent key.",
          ),
          React.createElement(BulletList, { items: [
            "Summarize the top few relevant points instead of displaying raw records.",
            "Prefer community names and concise descriptions over internal identifiers.",
            "Use the native Hermes tools when authenticated live data is needed.",
          ] }),
        ),

        React.createElement(GuidanceCard, { title: "Protocol guide", badge: "Static" },
          React.createElement("p", null,
            "Explain Index results as short prose or bullets. Do not surface internal identifiers unless the user can act on them, and never expose tokens, raw messages, or assistant reasoning.",
          ),
          React.createElement("p", { className: "index-dashboard__muted" },
            "For interactive work, load the bundled skill index-network:index-orchestrator in Hermes.",
          ),
        ),

        React.createElement(GuidanceCard, { title: "Autonomous negotiator", badge: "Scheduled" },
          React.createElement("p", null,
            "Autonomous negotiation is handled by the bundled index-network:index-negotiator skill on a schedule. A frequent scheduled run keeps the personal-agent heartbeat fresh.",
          ),
          React.createElement(BulletList, { items: [
            "No claim button is shown here; claiming a pending turn is an authenticated tool action.",
            "No response controls are shown here; submitted negotiation actions must remain tool-confirmed.",
            "Use the schedule/gateway configuration in Hermes for autonomous operation.",
          ] }),
        ),

        React.createElement(GuidanceCard, { title: "Dashboard status", badge: "Static-only" },
          React.createElement("p", null,
            "Live dashboard routes are deferred until route authentication is documented for this plugin source. The tab remains useful without backend route mounting.",
          ),
          React.createElement(BulletList, { items: [
            "Static assets load through the Hermes dashboard plugin registry.",
            "Authenticated Index access stays in the native Hermes tools and bundled skills.",
            "Future live routes should reuse tools.py instead of adding a second Index client.",
          ] }),
        ),
      ),
    );
  }

  window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();
```

### packages/hermes-plugin/tests/smoke.py — MODIFY

Update smoke contract for static-only dashboard files and frontend strings.

```python
PYTHON_FILES = ["__init__.py", "schemas.py", "tools.py"]
DASHBOARD_FILES = [
    "dashboard/manifest.json",
    "dashboard/dist/index.js",
    "dashboard/dist/style.css",
]
```

```python
    dashboard_manifest = json.loads((ROOT / "dashboard" / "manifest.json").read_text())
    assert dashboard_manifest["name"] == "index-network"
    assert dashboard_manifest["label"] == "Index Network"
    assert dashboard_manifest["entry"] == "dist/index.js"
    assert dashboard_manifest["css"] == "dist/style.css"
    assert "api" not in dashboard_manifest
    assert dashboard_manifest["tab"]["path"] == "/index-network"
    for key in ("entry", "css"):
        assert (ROOT / "dashboard" / dashboard_manifest[key]).exists(), dashboard_manifest[key]
    assert not (ROOT / "dashboard" / "plugin_api.py").exists()

    dashboard_js_path = ROOT / "dashboard" / "dist" / "index.js"
    subprocess.run(["node", "--check", str(dashboard_js_path)], check=True)
    dashboard_js = dashboard_js_path.read_text()
    assert 'register("index-network"' in dashboard_js
    assert "Static read-only" in dashboard_js
    assert "Static-only" in dashboard_js
    assert "Signals" in dashboard_js
    assert "communities" in dashboard_js
    assert "internal identifiers" in dashboard_js
    assert "raw records" in dashboard_js
    assert ("/api/" + "plugins/") not in dashboard_js
    assert "SDK.fetchJSON" not in dashboard_js
    assert "Live read-only" not in dashboard_js
    assert "raw JSON" not in dashboard_js
    assert "tool_call" not in dashboard_js
    assert "intentId" not in dashboard_js
    assert "networkId" not in dashboard_js
    assert "opportunityId" not in dashboard_js
    assert "index_pickup_negotiation" not in dashboard_js
    assert "index_respond_negotiation" not in dashboard_js

    dashboard_readme = (ROOT / "dashboard" / "README.md").read_text()
    package_readme = (ROOT / "README.md").read_text()
    assert "static and read-only" in dashboard_readme
    assert "mount Python backend routes" in dashboard_readme
    assert "Live dashboard routes are deliberately deferred" in dashboard_readme
    assert "../tools.py" in dashboard_readme
    assert "static-only" in package_readme
    assert "never calls live Index APIs" in package_readme
    assert "tools.py" in package_readme
    forbidden_api_path = "dashboard/" + "plugin_api.py"
    assert forbidden_api_path not in package_readme
```

## Slices

### Slice 1: Static-only runtime contract

**Files**: `packages/hermes-plugin/dashboard/manifest.json`, `packages/hermes-plugin/dashboard/plugin_api.py`, `packages/hermes-plugin/dashboard/README.md`, `packages/hermes-plugin/README.md`, `packages/hermes-plugin/dashboard/dist/index.js`

#### Automated Verification:
- [ ] `packages/hermes-plugin/dashboard/manifest.json` parses as JSON and does not contain an `api` key.
- [ ] `test ! -e packages/hermes-plugin/dashboard/plugin_api.py` succeeds after implementation.
- [ ] `grep -R 'plugin_api.py\|/api/plugins/index-network/health\|/api/plugins/index-network/overview' packages/hermes-plugin/dashboard/README.md packages/hermes-plugin/README.md packages/hermes-plugin/dashboard/dist/index.js` returns no matches.
- [ ] `node --check packages/hermes-plugin/dashboard/dist/index.js` passes.

#### Manual Verification:
- [ ] Dashboard docs describe static-only behavior and explicitly defer Python route work until route authentication is known.
- [ ] The dashboard UI still registers `index-network` and presents signals, protocol guide, negotiator, and status cards without a live fetch.
- [ ] Future live-route guidance still says to reuse `tools.py` rather than creating a second Index client.

### Slice 2: Smoke coverage alignment

**Files**: `packages/hermes-plugin/tests/smoke.py`

#### Automated Verification:
- [ ] `cd packages/hermes-plugin && bun run test` passes.
- [ ] `grep -R '"api": "plugin_api.py"' packages/hermes-plugin/dashboard packages/hermes-plugin/tests packages/hermes-plugin/README.md` returns no matches.
- [ ] `grep -R '/api/plugins/index-network/overview' packages/hermes-plugin/dashboard packages/hermes-plugin/tests` returns no matches.
- [ ] `grep -R 'dashboard/plugin_api.py' packages/hermes-plugin/README.md packages/hermes-plugin/tests/smoke.py` returns no matches.

#### Manual Verification:
- [ ] Smoke tests enforce the static-only dashboard contract instead of route-string presence.
- [ ] Smoke tests still assert the dashboard registers `index-network` and excludes negotiation action controls.
- [ ] Terminal test coverage aligns with all review-fix verification notes.

## Desired End State

From Hermes, the dashboard manifest presents only static assets:

```json
{
  "name": "index-network",
  "entry": "dist/index.js",
  "css": "dist/style.css"
}
```

The dashboard UI registers the same tab without attempting a live API call:

```javascript
window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
```

The smoke test enforces the static-only contract:

```python
assert "api" not in dashboard_manifest
assert "/api/plugins/index-network/overview" not in dashboard_js
```

## File Map

```text
packages/hermes-plugin/dashboard/manifest.json        # MODIFY — remove API module registration
packages/hermes-plugin/dashboard/plugin_api.py        # DELETE — remove unguarded backend API module
packages/hermes-plugin/dashboard/README.md            # MODIFY — describe static-only dashboard behavior
packages/hermes-plugin/README.md                      # MODIFY — align package docs with static-only dashboard
packages/hermes-plugin/dashboard/dist/index.js        # MODIFY — remove live fetch/status plumbing
packages/hermes-plugin/tests/smoke.py                 # MODIFY — enforce static-only dashboard contract
```

## Ordering Constraints

- Slice 1 must apply the manifest/API removal and frontend live-fetch removal atomically so no intermediate phase leaves a dangling `/overview` request.
- Slice 2 depends on Slice 1 because tests assert the final static-only manifest and bundle contract.
- No slices should run in parallel; Slice 1 defines the runtime contract and Slice 2 enforces it.

## Verification Notes

- Run `cd packages/hermes-plugin && bun run test` after Slice 2.
- `grep -R '"api": "plugin_api.py"' packages/hermes-plugin/dashboard packages/hermes-plugin/tests packages/hermes-plugin/README.md` should return no matches after Slice 2.
- `grep -R '/api/plugins/index-network/overview' packages/hermes-plugin/dashboard packages/hermes-plugin/tests` should return no matches after Slice 2.
- `grep -R 'dashboard/plugin_api.py' packages/hermes-plugin/README.md packages/hermes-plugin/tests/smoke.py` should return no matches after Slice 2.
- Smoke tests should still assert the dashboard registers `index-network` and does not include pickup/respond negotiation controls.
- Manual dashboard check: the tab renders static guidance even when no Python route mounting exists.

## Performance Considerations

Removing the live overview fetch removes the dashboard's concurrent backend calls and eliminates route-level Index/MCP work on dashboard load. Static rendering remains O(1) in local bundle size and has no network dependency.

## Migration Notes

No persisted data or database schema changes. Runtime rollback is straightforward: reintroduce a guarded `api` manifest entry and backend module in a later design when Hermes route auth is available.

## Pattern References

- `packages/hermes-plugin/dashboard/README.md:42` — future live routes should reuse `tools.py` as the auth/timeout/decoding source of truth.
- `packages/hermes-plugin/tests/smoke.py:44-100` — stdlib import/fake/assert smoke-test style to extend.
- `packages/hermes-plugin/dashboard/dist/index.js:208` — dashboard tab registration pattern to preserve.
- `packages/hermes-plugin/tools.py:223` — future live route guidance must handle MCP text responses if reintroduced.
- `packages/protocol/src/mcp/mcp.server.ts:120-137` — redaction-by-construction precedent for future live dashboard DTOs.

## Developer Context

- Directional confirm: “About to keep the dashboard API as a thin wrapper over existing native handlers (`dashboard/plugin_api.py:34-35`, `dashboard/README.md:42`) rather than adding a second Index REST/MCP client. Confirm that direction?” Answer: Follow wrapper.
- Directional confirm: “About to keep the dashboard shell no-build/static-first (`dashboard/dist/index.js`, `dashboard/dist/style.css`) and update the checked-in bundle by hand. Confirm that direction?” Answer: Follow static.
- Directional confirm: “About to extend `packages/hermes-plugin/tests/smoke.py` using the existing stdlib bare-assert style (`tests/smoke.py:44-100`) rather than adding pytest/FastAPI test dependencies. Confirm that direction?” Answer: Follow stdlib.
- Directional confirm: “About to preserve optional live routes (`dashboard/README.md:32`, `dist/index.js:56`) so the dashboard still renders static guidance when Hermes does not mount Python routes. Confirm that direction?” Answer: Follow optional.
- Route-auth ambiguity: “`manifest.json:13` wires `plugin_api.py`, but `/overview` at `plugin_api.py:228` returns Index-key-backed summaries with no local auth guard and no repo pattern for Hermes route auth. Which design should we use?” Answer: Static-only now.
- Design summary checkpoint: approved proceeding to decomposition.
- Decomposition checkpoint: approved 3-slice static-only hardening decomposition.
- Slice verifier checkpoint: Slice 1 verifier found an atomicity violation because backend removal left `dist/index.js:27` and `dist/index.js:72` live overview calls until a later slice. Developer approved merging runtime changes so manifest/API removal and frontend fetch removal happen in one slice.

## Design History

- Slice 1: Static-only runtime contract — approved as generated
- Slice 2: Smoke coverage alignment — approved as generated

## References

- `.worktrees/feat-hermes-dashboard-shell/.rpiv/artifacts/reviews/2026-06-23_22-54-51_feat-hermes-dashboard-shell-working.md`
- `packages/hermes-plugin/dashboard/manifest.json`
- `packages/hermes-plugin/dashboard/plugin_api.py`
- `packages/hermes-plugin/dashboard/dist/index.js`
- `packages/hermes-plugin/tests/smoke.py`
- `packages/hermes-plugin/dashboard/README.md`
- `packages/hermes-plugin/README.md`
