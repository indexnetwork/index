---
date: 2026-06-23T19:23:09+0300
author: Yanek Yuk
commit: 4150d08484
branch: dev
repository: index
topic: hermes-plugin-dashboard
tags: [plan, blueprint, hermes-plugin, dashboard, mcp, negotiation]
status: ready
parent: .rpiv/artifacts/research/2026-06-23_19-07-13_hermes-plugin-dashboard.md
phase_count: 4
phases:
  - { n: 1, title: Static dashboard shell }
  - { n: 2, title: Live overview API integration }
  - { n: 3, title: Documentation alignment }
  - { n: 4, title: Smoke coverage }
unresolved_phase_count: 0
last_updated: 2026-06-23T19:23:09+0300
last_updated_by: Yanek Yuk
---

# Hermes Plugin Dashboard Implementation Plan

## Overview

Build the first Index Network dashboard tab inside the Hermes plugin's reserved `dashboard/` directory. The dashboard follows Hermes' manifest + no-build JavaScript plugin model, uses a thin `plugin_api.py` wrapper around existing native `index_*` handlers when backend routes are available, and gracefully falls back to static protocol guidance when Hermes does not mount user-installed plugin backend routes.

## Requirements

- Add the expected dashboard files under `packages/hermes-plugin/dashboard/`: `manifest.json`, `dist/index.js`, `dist/style.css`, and `plugin_api.py`.
- Keep the dashboard plugin-local and additive; do not change AgentVillage control-plane hosting or introduce a separate Index data contract.
- Present a balanced overview: scoped signals/protocol guidance plus autonomous negotiator setup/status.
- Source live protocol data through the same native Hermes handlers that agents use: `index_read_intents`, `index_read_docs`, and `index_agent_me`.
- Do not include active negotiation controls in the first version; avoid `index_pickup_negotiation` and `index_respond_negotiation` from dashboard UI because pickup claims pending turns and respond submits decisions.
- Follow protocol presentation rules: product vocabulary, natural-language summaries, no raw JSON/tool envelopes/internal IDs unless actionable.
- Extend existing Hermes plugin smoke coverage for dashboard files, manifest references, API route exports, and syntax validity.

## Current State Analysis

The Hermes plugin already ships native tool wrappers, generated skills, hooks, a slash command, and a published placeholder dashboard directory. There is no implemented dashboard yet, and no exact in-repo plugin dashboard example. Hermes' current dashboard docs define a manifest/IIFE/SDK model, but warn that Python plugin API routes are mounted only for bundled plugins; user-installed plugins can still extend the UI with static JS/CSS.

### Key Discoveries

- `packages/hermes-plugin/dashboard/README.md:1-14` reserves the dashboard directory and names the intended future files.
- `packages/hermes-plugin/package.json:12-19` already includes `dashboard/` in the published package file list.
- `packages/hermes-plugin/__init__.py:82-123` is the native registration root; dashboard actions should not diverge from these handlers.
- `packages/hermes-plugin/tools.py:383-411` implements `index_read_intents` via the canonical scoped MCP `read_intents` path.
- `packages/hermes-plugin/tools.py:428-496` implements negotiation pickup/respond; these are side-effecting and remain out of read-only dashboard scope.
- `packages/protocol/src/shared/agent/utility.tools.ts:260-283` and `packages/protocol/src/mcp/mcp.server.ts:384-393` require synthesized, product-language presentation rather than raw JSON or internal IDs.
- Hermes dashboard docs define `manifest.json` fields (`name`, `label`, `tab`, `entry`, optional `css`, optional `api`) and an IIFE that registers with `window.__HERMES_PLUGINS__.register(...)`.
- Hermes docs/source state that user-installed/project plugins may not auto-import `plugin_api.py`; the UI must degrade gracefully when `/api/plugins/index-network/*` routes are unavailable.
- `packages/hermes-plugin/tests/smoke.py:103-135` already validates manifest/tool parity and is the correct test style to extend.

## Desired End State

A Hermes user can install the plugin and see an **Index Network** tab in the Hermes dashboard. When backend routes are mounted, the tab can load a read-only overview:

```javascript
SDK.fetchJSON("/api/plugins/index-network/overview")
  .then(renderOverview)
  .catch(renderBackendUnavailableFallback);
```

The backend route remains a thin adapter over native plugin handlers:

```python
@router.get("/overview")
async def overview():
    return build_overview()
```

The browser bundle registers the Hermes dashboard page without introducing build tooling:

```javascript
(function () {
  const SDK = window.__HERMES_PLUGIN_SDK__;
  function IndexNetworkDashboard() { /* render read-only overview */ }
  window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();
```

If Hermes does not mount `plugin_api.py`, the tab still renders setup guidance explaining that native tools and skills are installed and that live dashboard data requires bundled-route support.

## What We're NOT Doing

- Not building AgentVillage control-plane hosting, dashboard proxying, tenant dashboards, or Railway deployment wiring.
- Not adding negotiation response buttons or any dashboard path that calls `index_pickup_negotiation`/`index_respond_negotiation`.
- Not introducing Vite, React source compilation, or new package-level build scripts for the dashboard.
- Not changing Index MCP tool schemas, protocol backend routes, database schema, or package exports.
- Not hand-editing generated Hermes skill `SKILL.md` files; dashboard copy may reference generated skill names but does not change templates in this plan.
- Not exposing raw tool JSON, internal IDs, tokens, assistant reasoning, or raw messages in the dashboard.

## Decisions

### Decision 1: Keep the dashboard plugin-local

The reserved implementation surface is `packages/hermes-plugin/dashboard/*`, and `dashboard/` is already included in the package files list (`packages/hermes-plugin/dashboard/README.md:1-14`, `packages/hermes-plugin/package.json:12-19`).

Decision: implement only under the Hermes plugin package plus its README/test files; do not add AgentVillage or protocol server code.

### Decision 2: Follow Hermes' no-build IIFE dashboard pattern

Ambiguity: add frontend build tooling or commit the generated dashboard bundle directly.

Explored:
- Option A: no-build IIFE, matching Hermes' documented example and `window.__HERMES_PLUGIN_SDK__` loading model. Pro: minimal package footprint, no new build command, matches plugin docs. Con: verbose `React.createElement` authoring.
- Option B: add Vite/esbuild source + build step. Pro: easier JSX authoring. Con: expands package workflow and contradicts the current placeholder's simple file-list contract.

Decision: use a committed no-build IIFE in `dashboard/dist/index.js`. Developer confirmed this direction.

### Decision 3: Use resilient dynamic API routes

Ambiguity: Hermes supports `plugin_api.py` in docs, but current docs/source warn backend routes are reserved for bundled plugins while this package is user-installed via Hermes.

Explored:
- Option A: resilient dynamic. Ship `plugin_api.py` thin wrappers and a UI that uses them when mounted, but degrades gracefully on 404/unavailable routes. Pro: supports bundled/future Hermes route mounting without breaking user installs. Con: first user-installed experience may be static/fallback.
- Option B: static only. Pro: always works. Con: no live signals/agent overview.
- Option C: backend required. Pro: simpler UI logic. Con: likely broken for normal user-installed plugins.

Decision: resilient dynamic. Developer selected this option.

### Decision 4: Read-only first, no negotiation controls

Ambiguity: whether to include active controls. `index_pickup_negotiation` claims turns and updates heartbeat, and `index_respond_negotiation` submits agent decisions (`packages/hermes-plugin/tools.py:428-496`).

Decision: read-only first. The dashboard may show setup guidance and agent identity/status where available, but must not call pickup/respond or provide negotiation action controls. Developer selected this option.

### Decision 5: Extend existing smoke tests

The current plugin uses a single Python smoke test for syntax, tool registration, schema/handler parity, and manifest parity (`packages/hermes-plugin/tests/smoke.py:103-135`).

Decision: extend `tests/smoke.py` for dashboard manifest/file/API checks rather than adding a new test runner. Developer confirmed this direction.

## Phase 1: Static dashboard shell

### Overview

Adds a self-contained static Hermes dashboard tab that works without backend plugin route support. Depends on nothing; Phase 2 layers live data onto this shell.

### Changes Required:

#### 1. packages/hermes-plugin/dashboard/manifest.json

**File**: `packages/hermes-plugin/dashboard/manifest.json`
**Changes**: NEW — Hermes dashboard plugin manifest for the Index Network tab, referencing only files created in this phase.

```json
{
  "name": "index-network",
  "label": "Index Network",
  "description": "Read-only Index Network overview for signals, protocol guidance, and autonomous negotiator setup.",
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

#### 2. packages/hermes-plugin/dashboard/dist/index.js

**File**: `packages/hermes-plugin/dashboard/dist/index.js`
**Changes**: NEW — Hermes Plugin SDK IIFE that renders the static read-only dashboard shell and fallback guidance.

```javascript
/**
 * Index Network Hermes dashboard shell.
 *
 * Phase 1 is intentionally static: it registers the dashboard tab and renders
 * protocol-aligned read-only guidance without depending on backend plugin API
 * route support. Phase 2 layers live overview loading onto this shell.
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

  function IndexNetworkDashboard() {
    return React.createElement("div", { className: "index-dashboard" },
      React.createElement("section", { className: "index-dashboard__hero" },
        React.createElement("div", null,
          React.createElement("p", { className: "index-dashboard__eyebrow" }, "Index Network"),
          React.createElement("h1", { className: "index-dashboard__title" }, "Signals and autonomous negotiation"),
          React.createElement("p", { className: "index-dashboard__subtitle" },
            "A read-only overview for the Index Network Hermes plugin. It keeps protocol guidance close to the native Hermes tools while preserving scoped visibility and calm product language.",
          ),
        ),
        React.createElement("div", { className: "index-dashboard__status-card" },
          React.createElement(BadgeText, null, "Read-only"),
          React.createElement("p", null,
            "This first dashboard shell does not claim negotiation turns, submit responses, or expose raw tool output.",
          ),
        ),
      ),

      React.createElement("div", { className: "index-dashboard__grid" },
        React.createElement(GuidanceCard, { title: "Signals", badge: "Scoped" },
          React.createElement("p", null,
            "Review what you are looking for and what communities are looking for through the same scoped Index access used by the Hermes plugin.",
          ),
          React.createElement(BulletList, { items: [
            "Use signal language in user-facing copy.",
            "Keep communities' visibility bounded by the configured Index agent key.",
            "Summarize the top few relevant points instead of displaying raw records.",
          ] }),
        ),

        React.createElement(GuidanceCard, { title: "Protocol guide", badge: "Natural language" },
          React.createElement("p", null,
            "The dashboard follows the MCP agent guide: explain results as short prose or bullets, avoid card markup, and do not surface internal identifiers unless the user can act on them.",
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
            "No pickup button is shown here; pickup can claim a pending turn.",
            "No response controls are shown here; submitted negotiation actions must remain tool-confirmed.",
            "Use the schedule/gateway configuration in Hermes for autonomous operation.",
          ] }),
        ),

        React.createElement(GuidanceCard, { title: "Live overview", badge: "Optional" },
          React.createElement("p", null,
            "Hermes can mount plugin API routes for supported plugin sources. When those routes are available, this tab can show a live read-only overview; otherwise this static guidance remains safe and useful.",
          ),
          React.createElement("p", { className: "index-dashboard__muted" },
            "If the tab appears but live data is unavailable, the native Hermes tools and skills can still be used from chat or scheduled runs.",
          ),
        ),
      ),
    );
  }

  window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();
```

#### 3. packages/hermes-plugin/dashboard/dist/style.css

**File**: `packages/hermes-plugin/dashboard/dist/style.css`
**Changes**: NEW — Theme-aware dashboard styles scoped to Index dashboard classes.

```css
.index-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.index-dashboard__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 340px);
  gap: 1rem;
  align-items: stretch;
  padding: 1.25rem;
  border: 1px solid var(--color-border, rgba(148, 163, 184, 0.24));
  border-radius: var(--radius, 0.75rem);
  background:
    radial-gradient(circle at top left, rgba(79, 209, 197, 0.16), transparent 36rem),
    var(--color-card, rgba(15, 23, 42, 0.72));
  color: var(--color-card-foreground, inherit);
}

.index-dashboard__eyebrow {
  margin: 0 0 0.35rem;
  color: var(--color-muted-foreground, rgba(148, 163, 184, 0.92));
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.index-dashboard__title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 3rem);
  line-height: 1;
  letter-spacing: -0.04em;
}

.index-dashboard__subtitle {
  max-width: 58rem;
  margin: 0.75rem 0 0;
  color: var(--color-muted-foreground, rgba(148, 163, 184, 0.92));
  font-size: 0.95rem;
  line-height: 1.6;
}

.index-dashboard__status-card,
.index-dashboard__card {
  border: 1px solid var(--color-border, rgba(148, 163, 184, 0.24));
  border-radius: var(--radius, 0.75rem);
  background: color-mix(in srgb, var(--color-card, #0f172a) 88%, transparent);
}

.index-dashboard__status-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
}

.index-dashboard__status-card p,
.index-dashboard__card p {
  margin: 0;
  color: var(--color-muted-foreground, rgba(148, 163, 184, 0.92));
  line-height: 1.55;
}

.index-dashboard__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.index-dashboard__card-header {
  padding-bottom: 0.35rem;
}

.index-dashboard__card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.index-dashboard__card-title {
  font-size: 1rem;
}

.index-dashboard__card-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.index-dashboard__badge {
  white-space: nowrap;
}

.index-dashboard__list {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding-left: 1.1rem;
  color: var(--color-muted-foreground, rgba(148, 163, 184, 0.92));
}

.index-dashboard__list li::marker {
  color: var(--color-primary, currentColor);
}

.index-dashboard__muted {
  font-size: 0.875rem;
}

@media (max-width: 900px) {
  .index-dashboard__hero,
  .index-dashboard__grid {
    grid-template-columns: 1fr;
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Manifest JSON parses: `python3 -m json.tool packages/hermes-plugin/dashboard/manifest.json >/dev/null`.
- [x] Manifest references existing Phase 1 assets: `test -f packages/hermes-plugin/dashboard/dist/index.js && test -f packages/hermes-plugin/dashboard/dist/style.css`.
- [x] Dashboard bundle registers the manifest plugin name: `grep -q 'register("index-network"' packages/hermes-plugin/dashboard/dist/index.js`.

#### Manual Verification:
- [ ] The Phase 1 dashboard is read-only static guidance and does not call `/api/plugins/` routes yet.
- [ ] User-facing copy uses “signals” and “communities” and does not expose raw JSON, internal IDs, or raw tool envelopes.
- [ ] The manifest does not include `api` until Phase 2 creates `plugin_api.py`.

## Phase 2: Live overview API integration

### Overview

Adds optional live read-only backend routes and updates the static tab to consume them when available. Depends on Phase 1; it modifies the shell created there.

### Changes Required:

#### 1. packages/hermes-plugin/dashboard/plugin_api.py

**File**: `packages/hermes-plugin/dashboard/plugin_api.py`
**Changes**: NEW — FastAPI router with read-only overview endpoints that wrap existing native handlers.

```python
"""Read-only dashboard API routes for the Index Network Hermes plugin.

The dashboard API deliberately reuses the native Hermes plugin handlers from
``tools.py``. It should not grow a second Index MCP/API client: the native
handlers already own authentication headers, scoped MCP forwarding, response
parsing, and error normalization.
"""

from __future__ import annotations

import concurrent.futures
import json
import sys
from pathlib import Path
from typing import Any, Callable

try:
    from fastapi import APIRouter
except Exception:  # pragma: no cover - local smoke tests may not install FastAPI.
    class APIRouter:  # type: ignore[no-redef]
        """Tiny decorator-compatible fallback for import/syntax smoke tests."""

        def get(self, *_args: Any, **_kwargs: Any) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
            def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
                return func

            return decorator


_PLUGIN_ROOT = Path(__file__).resolve().parents[1]
if str(_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_ROOT))

try:
    import tools as index_tools
except Exception as exc:  # pragma: no cover - surfaced through /health and /overview.
    index_tools = None  # type: ignore[assignment]
    _TOOLS_IMPORT_ERROR: Exception | None = exc
else:
    _TOOLS_IMPORT_ERROR = None

router = APIRouter()
_DASHBOARD_OVERVIEW_TIMEOUT_SECONDS = 12.0


def _parse_tool_result(raw: Any) -> dict[str, Any]:
    """Normalize a native handler return value into a dictionary."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {"success": True, "text": raw}
        if isinstance(parsed, dict):
            return parsed
        return {"success": True, "data": parsed}
    return {"success": True, "data": raw}


def _handler_unavailable_payload() -> dict[str, Any]:
    message = "Index native handlers are unavailable in this dashboard process."
    if _TOOLS_IMPORT_ERROR is not None:
        message = f"{message} {_TOOLS_IMPORT_ERROR}"
    return {"success": False, "error": message}


def _call_native_handler(handler_name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call a handler exported by tools.py and return its parsed JSON payload."""
    if index_tools is None:
        return _handler_unavailable_payload()
    handler = getattr(index_tools, handler_name, None)
    if not callable(handler):
        return {"success": False, "error": f"Index native handler {handler_name} is not available."}
    try:
        return _parse_tool_result(handler(args or {}))
    except Exception as exc:  # noqa: BLE001 - dashboard routes should return JSON errors.
        return {"success": False, "error": f"Index native handler {handler_name} failed: {exc}"}


def _call_mcp_tool(tool_name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call an allowlisted forwarded MCP wrapper through tools.py."""
    if index_tools is None:
        return _handler_unavailable_payload()
    try:
        handler = index_tools.make_mcp_tool_handler(tool_name)
        return _parse_tool_result(handler(args or {}))
    except Exception as exc:  # noqa: BLE001 - dashboard routes should return JSON errors.
        return {"success": False, "error": f"Index MCP tool {tool_name} failed: {exc}"}


def _payload_data(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


def _clean_text(value: Any, *, max_chars: int = 280) -> str | None:
    if not isinstance(value, str):
        return None
    compact = " ".join(value.split()).strip()
    if not compact:
        return None
    if len(compact) <= max_chars:
        return compact
    return f"{compact[: max_chars - 1].rstrip()}…"


def _public_signal(row: Any) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    description = _clean_text(row.get("description") or row.get("payload") or row.get("summary"), max_chars=220)
    summary = _clean_text(row.get("summary"), max_chars=180)
    if not description and not summary:
        return None

    communities: list[str] = []
    raw_networks = row.get("networks") or row.get("indexes") or row.get("intentNetworks")
    if isinstance(raw_networks, list):
        for network in raw_networks[:3]:
            if not isinstance(network, dict):
                continue
            title = _clean_text(network.get("title") or network.get("name") or network.get("networkTitle"), max_chars=80)
            if title:
                communities.append(title)

    signal: dict[str, Any] = {}
    if description:
        signal["description"] = description
    if summary and summary != description:
        signal["summary"] = summary
    if isinstance(row.get("status"), str):
        signal["status"] = row["status"]
    if isinstance(row.get("confidence"), (int, float)):
        signal["confidence"] = round(float(row["confidence"]), 2)
    if communities:
        signal["communities"] = communities
    return signal


def _summarize_signals(payload: dict[str, Any]) -> dict[str, Any]:
    data = _payload_data(payload)
    raw_intents = data.get("intents") if isinstance(data, dict) else None
    signals = []
    if isinstance(raw_intents, list):
        signals = [signal for signal in (_public_signal(row) for row in raw_intents[:5]) if signal]
    total_count = data.get("totalCount") or data.get("count") or len(signals)
    return {
        "available": payload.get("success") is not False,
        "totalCount": total_count if isinstance(total_count, int) else len(signals),
        "signals": signals,
        **({"error": payload.get("error")} if payload.get("success") is False else {}),
    }


def _summarize_agent(payload: dict[str, Any]) -> dict[str, Any]:
    data = _payload_data(payload)
    agent = data.get("agent") if isinstance(data.get("agent"), dict) else data
    if not isinstance(agent, dict) or payload.get("success") is False:
        return {"available": False, **({"error": payload.get("error")} if payload.get("error") else {})}

    public_agent: dict[str, Any] = {"available": True}
    name = _clean_text(agent.get("name"), max_chars=120)
    if name:
        public_agent["name"] = name
    for source_key, target_key in (
        ("status", "status"),
        ("lastSeenAt", "lastSeenAt"),
        ("last_seen_at", "lastSeenAt"),
        ("onboardingCompleted", "onboardingCompleted"),
        ("onboarding_completed", "onboardingCompleted"),
    ):
        value = agent.get(source_key)
        if value is not None and target_key not in public_agent:
            public_agent[target_key] = value
    return public_agent


def _summarize_guidance(payload: dict[str, Any]) -> dict[str, Any]:
    data = _payload_data(payload)
    content = data.get("content") if isinstance(data, dict) else None
    excerpt = _clean_text(content, max_chars=700)
    return {
        "available": payload.get("success") is not False and bool(excerpt),
        "topic": "mcp_agent_guide",
        **({"excerpt": excerpt} if excerpt else {}),
        **({"error": payload.get("error")} if payload.get("success") is False else {}),
    }


def _collect_overview_payloads() -> dict[str, dict[str, Any]]:
    """Collect overview payloads concurrently with a dashboard-level deadline."""
    calls: dict[str, Callable[[], dict[str, Any]]] = {
        "agent": lambda: _call_native_handler("index_agent_me"),
        "signals": lambda: _call_native_handler("index_read_intents", {"limit": 5, "page": 1}),
        "guidance": lambda: _call_mcp_tool("read_docs", {"topic": "mcp_agent_guide"}),
    }
    results: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls), thread_name_prefix="index-dashboard") as executor:
        futures = {executor.submit(call): name for name, call in calls.items()}
        done, pending = concurrent.futures.wait(futures, timeout=_DASHBOARD_OVERVIEW_TIMEOUT_SECONDS)
        for future in done:
            name = futures[future]
            try:
                results[name] = future.result()
            except Exception as exc:  # noqa: BLE001 - dashboard routes should return JSON errors.
                results[name] = {"success": False, "error": f"{name} overview failed: {exc}"}
        for future in pending:
            future.cancel()
            results[futures[future]] = {"success": False, "error": "Dashboard overview timed out."}
    return results


@router.get("/health")
def health() -> dict[str, Any]:
    """Return lightweight dashboard API health without calling Index."""
    return {
        "success": index_tools is not None,
        "plugin": "index-network",
        "readOnly": True,
        "nativeHandlersAvailable": index_tools is not None,
        **({"error": str(_TOOLS_IMPORT_ERROR)} if _TOOLS_IMPORT_ERROR is not None else {}),
    }


@router.get("/overview")
def overview() -> dict[str, Any]:
    """Return a redacted, read-only Index dashboard overview."""
    payloads = _collect_overview_payloads()
    agent_payload = payloads["agent"]
    signals_payload = payloads["signals"]
    guidance_payload = payloads["guidance"]

    errors = []
    for label, payload in payloads.items():
        if payload.get("success") is False:
            errors.append({"source": label, "message": payload.get("error") or "Unavailable"})

    return {
        "success": True,
        "live": len(errors) < 3,
        "readOnly": True,
        "source": "index-native-handlers",
        "agent": _summarize_agent(agent_payload),
        "signals": _summarize_signals(signals_payload),
        "guidance": _summarize_guidance(guidance_payload),
        "negotiator": {
            "available": True,
            "mode": "read_only",
            "summary": (
                "Autonomous negotiation is managed by the index-network:index-negotiator skill on a schedule. "
                "This dashboard does not poll or claim pending turns."
            ),
            "actionsAvailable": False,
        },
        "limitations": [
            "Hermes currently mounts Python plugin API routes only for supported plugin sources; user-installed plugins may show the static fallback.",
            "Negotiation pickup and response actions are intentionally excluded from this read-only dashboard version.",
        ],
        "errors": errors,
    }
```

#### 2. packages/hermes-plugin/dashboard/manifest.json

**File**: `packages/hermes-plugin/dashboard/manifest.json`
**Changes**: MODIFY — Add the optional `api` entry once `plugin_api.py` exists.

```json
{
  "name": "index-network",
  "label": "Index Network",
  "description": "Read-only Index Network overview for signals, protocol guidance, and autonomous negotiator setup.",
  "icon": "Sparkles",
  "version": "0.4.0",
  "tab": {
    "path": "/index-network",
    "position": "after:skills"
  },
  "entry": "dist/index.js",
  "css": "dist/style.css",
  "api": "plugin_api.py"
}
```

#### 3. packages/hermes-plugin/dashboard/dist/index.js

**File**: `packages/hermes-plugin/dashboard/dist/index.js`
**Changes**: MODIFY — Add live overview loading with graceful fallback when backend routes are unavailable.

```javascript
/**
 * Index Network Hermes dashboard.
 *
 * Registers a read-only dashboard tab. It uses optional plugin API routes when
 * Hermes mounts them, and otherwise keeps the static protocol guidance usable.
 */
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) {
    console.warn("[index-network] Hermes dashboard plugin SDK is unavailable.");
    return;
  }

  const React = SDK.React;
  const hooks = SDK.hooks || {};
  const useEffect = hooks.useEffect || React.useEffect;
  const useState = hooks.useState || React.useState;
  const components = SDK.components || {};
  const Card = components.Card || "section";
  const CardHeader = components.CardHeader || "div";
  const CardTitle = components.CardTitle || "h2";
  const CardContent = components.CardContent || "div";
  const Badge = components.Badge || "span";
  const Button = components.Button || "button";
  const OVERVIEW_ENDPOINT = "/api/plugins/index-network/overview";

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

  function compactError(error) {
    if (!error) return "Live overview unavailable.";
    const message = error.message || String(error);
    if (/404/.test(message)) return "Live dashboard routes are not mounted for this Hermes plugin source.";
    return message.length > 160 ? `${message.slice(0, 157)}…` : message;
  }

  function useOverview() {
    const initial = { loading: Boolean(SDK.fetchJSON), overview: null, error: null };
    const stateTuple = useState ? useState(initial) : [initial, function () {}];
    const state = stateTuple[0];
    const setState = stateTuple[1];

    function loadOverview() {
      if (!SDK.fetchJSON) {
        setState({ loading: false, overview: null, error: new Error("Hermes fetch helper is unavailable.") });
        return;
      }
      setState({ loading: true, overview: state.overview, error: null });
      SDK.fetchJSON(OVERVIEW_ENDPOINT)
        .then(function (overview) {
          setState({ loading: false, overview: overview, error: null });
        })
        .catch(function (error) {
          setState({ loading: false, overview: null, error: error });
        });
    }

    if (useEffect) {
      useEffect(function () {
        loadOverview();
      }, []);
    }

    return { state: state, reload: loadOverview };
  }

  function StatusPanel(props) {
    const state = props.state;
    const overview = state.overview;
    const error = state.error;
    const badge = state.loading ? "Checking" : overview && overview.live ? "Live read-only" : "Static fallback";
    const text = state.loading
      ? "Checking whether Hermes mounted the optional Index dashboard API routes."
      : overview && overview.live
        ? "Live read-only overview loaded through the plugin API. No negotiation turns were claimed."
        : compactError(error);

    return React.createElement("div", { className: "index-dashboard__status-card" },
      React.createElement(BadgeText, null, badge),
      React.createElement("p", null, text),
      React.createElement(Button, {
        type: "button",
        className: "index-dashboard__button",
        onClick: props.reload,
        disabled: state.loading,
      }, state.loading ? "Checking…" : "Refresh overview"),
    );
  }

  function renderSignalRows(signals) {
    if (!signals || !signals.available || !Array.isArray(signals.signals) || signals.signals.length === 0) {
      return React.createElement(BulletList, { items: [
        "Use signal language in user-facing copy.",
        "Keep communities' visibility bounded by the configured Index agent key.",
        "Summarize the top few relevant points instead of displaying raw records.",
      ] });
    }

    return React.createElement("div", { className: "index-dashboard__signal-list" },
      signals.signals.map(function (signal, index) {
        return React.createElement("article", { key: `${signal.description || signal.summary || "signal"}-${index}`, className: "index-dashboard__signal" },
          React.createElement("strong", null, signal.description || signal.summary),
          signal.summary && signal.summary !== signal.description
            ? React.createElement("p", null, signal.summary)
            : null,
          Array.isArray(signal.communities) && signal.communities.length > 0
            ? React.createElement("p", { className: "index-dashboard__muted" }, `Communities: ${signal.communities.join(", ")}`)
            : null,
        );
      }),
    );
  }

  function agentLabel(agent) {
    if (!agent || !agent.available) return "Agent key not verified in this dashboard view.";
    if (agent.name) return `Authenticated as ${agent.name}.`;
    return "Authenticated Index agent is available.";
  }

  function IndexNetworkDashboard() {
    const overviewState = useOverview();
    const state = overviewState.state;
    const overview = state.overview || {};
    const guidance = overview.guidance || {};
    const negotiator = overview.negotiator || {};
    const signals = overview.signals || null;

    return React.createElement("div", { className: "index-dashboard" },
      React.createElement("section", { className: "index-dashboard__hero" },
        React.createElement("div", null,
          React.createElement("p", { className: "index-dashboard__eyebrow" }, "Index Network"),
          React.createElement("h1", { className: "index-dashboard__title" }, "Signals and autonomous negotiation"),
          React.createElement("p", { className: "index-dashboard__subtitle" },
            "A read-only overview for the Index Network Hermes plugin. It keeps protocol guidance close to the native Hermes tools while preserving scoped visibility and calm product language.",
          ),
          React.createElement("p", { className: "index-dashboard__agent" }, agentLabel(overview.agent)),
        ),
        React.createElement(StatusPanel, { state: state, reload: overviewState.reload }),
      ),

      React.createElement("div", { className: "index-dashboard__grid" },
        React.createElement(GuidanceCard, { title: "Signals", badge: signals && signals.available ? `${signals.totalCount || 0} visible` : "Scoped" },
          React.createElement("p", null,
            "Review what you are looking for and what communities are looking for through the same scoped Index access used by the Hermes plugin.",
          ),
          renderSignalRows(signals),
        ),

        React.createElement(GuidanceCard, { title: "Protocol guide", badge: guidance.available ? "Loaded" : "Natural language" },
          React.createElement("p", null,
            guidance.excerpt || "The dashboard follows the MCP agent guide: explain results as short prose or bullets, avoid card markup, and do not surface internal identifiers unless the user can act on them.",
          ),
          React.createElement("p", { className: "index-dashboard__muted" },
            "For interactive work, load the bundled skill index-network:index-orchestrator in Hermes.",
          ),
        ),

        React.createElement(GuidanceCard, { title: "Autonomous negotiator", badge: "Scheduled" },
          React.createElement("p", null,
            negotiator.summary || "Autonomous negotiation is handled by the bundled index-network:index-negotiator skill on a schedule. A frequent scheduled run keeps the personal-agent heartbeat fresh.",
          ),
          React.createElement(BulletList, { items: [
            "No pickup button is shown here; pickup can claim a pending turn.",
            "No response controls are shown here; submitted negotiation actions must remain tool-confirmed.",
            "Use the schedule/gateway configuration in Hermes for autonomous operation.",
          ] }),
        ),

        React.createElement(GuidanceCard, { title: "Live overview", badge: overview.live ? "Available" : "Optional" },
          React.createElement("p", null,
            overview.live
              ? "Live read-only data is available in this Hermes dashboard process."
              : "Hermes can mount plugin API routes for supported plugin sources. When those routes are unavailable, this static guidance remains safe and useful.",
          ),
          Array.isArray(overview.limitations) && overview.limitations.length > 0
            ? React.createElement(BulletList, { items: overview.limitations })
            : React.createElement("p", { className: "index-dashboard__muted" },
              "If live data is unavailable, the native Hermes tools and skills can still be used from chat or scheduled runs.",
            ),
        ),
      ),
    );
  }

  window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();
```

### Success Criteria:

#### Automated Verification:
- [x] `python3 -m py_compile packages/hermes-plugin/dashboard/plugin_api.py` succeeds.
- [x] Manifest JSON parses and includes the API file: `python3 - <<'PY'\nimport json, pathlib\nmanifest=json.loads(pathlib.Path('packages/hermes-plugin/dashboard/manifest.json').read_text())\nassert manifest['api'] == 'plugin_api.py'\nPY`
- [x] Dashboard bundle uses the optional overview endpoint: `grep -q '/api/plugins/index-network/overview' packages/hermes-plugin/dashboard/dist/index.js`.
- [x] Read-only guard holds: `! grep -R "index_pickup_negotiation\|index_respond_negotiation" packages/hermes-plugin/dashboard`.

#### Manual Verification:
- [ ] `/api/plugins/index-network/overview` returns summarized signals/guidance/agent state when Hermes mounts plugin routes.
- [ ] When the overview route is unavailable, the dashboard renders the static fallback instead of a blank/error-only page.
- [ ] Live UI copy remains read-only and does not offer pickup/respond controls.

## Phase 3: Documentation alignment

### Overview

Updates dashboard and package docs to describe the implemented read-only dashboard, fallback behavior, and verification path. Depends on Phase 2; can run only after concrete files and routes are named.

### Changes Required:

#### 1. packages/hermes-plugin/dashboard/README.md

**File**: `packages/hermes-plugin/dashboard/README.md`
**Changes**: MODIFY — Replace placeholder with dashboard structure, route behavior, and scope notes.

````markdown
# Index Network Hermes Dashboard

This directory contains the plugin-local Hermes dashboard tab for the Index Network plugin.

```text
dashboard/manifest.json   # Hermes dashboard plugin manifest
dashboard/dist/index.js   # no-build IIFE bundle registered with the Hermes Plugin SDK
dashboard/dist/style.css  # theme-aware styles scoped to .index-dashboard*
dashboard/plugin_api.py   # optional read-only FastAPI routes for supported Hermes plugin sources
```

## Scope

The dashboard is intentionally read-only. It gives Hermes users a compact overview of Index Network signals, protocol guidance, and autonomous negotiator setup without creating a second Index data contract.

It does **not**:

- claim pending negotiation turns;
- submit negotiation responses;
- run discovery;
- expose raw tool JSON, internal identifiers, tokens, raw messages, or assistant reasoning.

## Runtime behavior

The tab always registers as `index-network` and renders static protocol-aligned guidance through `dist/index.js` and `dist/style.css`.

When Hermes mounts Python plugin routes for this plugin source, `plugin_api.py` exposes:

- `GET /api/plugins/index-network/health` — lightweight dashboard API health;
- `GET /api/plugins/index-network/overview` — summarized read-only agent, signal, protocol-guide, and negotiator setup state.

Hermes dashboard route support is source-dependent. Current Hermes documentation says user-installed and project dashboard plugins may extend the UI with static JavaScript/CSS, while Python backend routes are reserved for supported/bundled plugin sources. For that reason, the UI treats live overview routes as optional and falls back to static guidance when `/api/plugins/index-network/overview` is unavailable.

## Data sources

`plugin_api.py` wraps the native Hermes plugin handlers from `../tools.py`:

- `index_agent_me` for authenticated agent identity;
- `index_read_intents` for scoped visible signals;
- `index_read_docs(topic="mcp_agent_guide")` through the forwarded MCP wrapper for protocol presentation guidance.

Do not add direct Index MCP or REST client code in the dashboard API. Keep `tools.py` as the source of truth for authentication headers, scoped MCP forwarding, timeout behavior, and response decoding.

## Verify

From the monorepo root:

```bash
cd packages/hermes-plugin && bun run test
```

For manual Hermes dashboard testing, refresh plugin discovery after installing or changing dashboard files:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Then open `hermes dashboard` and visit the **Index Network** tab. The tab should render even when live plugin API routes are unavailable.
````

#### 2. packages/hermes-plugin/README.md

**File**: `packages/hermes-plugin/README.md`
**Changes**: MODIFY — Update dashboard section and verify instructions for the implemented tab.

````markdown
# Index Network Hermes Plugin

Hermes-native plugin for Index Network. It follows the official Hermes plugin layout from [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin):

```text
plugin.yaml   # manifest: tools, hooks, env requirements
__init__.py   # register(ctx): schemas -> handlers, hooks, commands, plugin skills
schemas.py    # LLM-facing tool schemas
tools.py      # JSON-string-returning tool handlers
```

## Current status

The plugin provides these native Hermes tools:

- `index_read_intents` — calls the canonical Index MCP `read_intents` tool using `INDEX_API_KEY` with argument validation.
- `index_<mcp_tool_name>` — generated pass-through wrappers for the rest of the Index MCP surface, including `index_read_docs`, `index_create_intent`, `index_read_networks`, `index_discover_opportunities`, `index_get_discovery_run`, and `index_list_opportunities`.
- `index_agent_me` — calls `GET /api/agents/me` to return the authenticated personal Index agent for the configured key.
- `index_pickup_negotiation` — calls the personal-agent pickup endpoint to poll and claim one pending negotiation turn.
- `index_respond_negotiation` — submits an autonomous personal-agent negotiation response with action, message, reasoning, and suggested roles.

It also bundles generated, namespaced Hermes plugin skills, an orchestrator hint hook, a slash command, and a read-only dashboard tab:

- `skills/index-orchestrator/SKILL.md` — signal/intent review and discovery preparation guidance for Hermes.
- `skills/index-negotiator/SKILL.md` — autonomous personal-agent negotiation guidance for scheduled Hermes runs.
- `pre_llm_call` hook — nudges Hermes to load `skill_view("index-network:index-orchestrator")` for clear Index/signal/intent/opportunity prompts.
- `/index` command — returns the same skill-loading hint explicitly.
- `dashboard/` — Hermes dashboard tab with static read-only guidance, optional live overview routes, and graceful fallback when Python plugin routes are not mounted for the plugin source.

## Install / enable in Hermes

Install the public plugin with Hermes:

```bash
hermes plugins install indexnetwork/hermes-plugin
```

The manifest declares `requires_env: INDEX_API_KEY`, so `hermes plugins install` prompts for it and saves it to Hermes' `.env`. Use an Index agent-bound API key when running autonomous negotiation tools.

For local development, a Hermes plugin directory must be installed under `~/.hermes/plugins/<plugin-name>/` or a one-level category path. Copy or symlink this directory:

```bash
mkdir -p ~/.hermes/plugins
ln -s /path/to/index/packages/hermes-plugin ~/.hermes/plugins/index-network
hermes plugins enable index-network
```

You can also set the key manually:

```bash
export INDEX_API_KEY="..."
```

Optional environment variables:

- `INDEX_MCP_URL` — defaults to `https://protocol.index.network/mcp`.
- `INDEX_API_URL` — defaults to `https://protocol.index.network/api`.
- `INDEX_MCP_TIMEOUT_SECONDS` — defaults to `30` and is used for both MCP and API requests.
- `INDEX_TELEGRAM_USERNAME` — forwarded as `x-index-telegram-username` when present.

## Tool contract

Handlers intentionally follow Hermes' plugin rules:

- signature: `def handler(args: dict, **kwargs) -> str`
- always return a JSON string
- catch exceptions and return JSON error payloads
- accept `**kwargs` for forward compatibility

### `index_read_intents`

Accepts:

```json
{
  "networkId": "optional Index/network UUID",
  "userId": "optional user UUID",
  "limit": 20,
  "page": 1
}
```

With no arguments, it returns the authenticated caller's own active intents as seen through the scoped Index MCP server.

### `index_<mcp_tool_name>` forwarded wrappers

The plugin registers Hermes wrappers for each canonical Index MCP tool that does not already have a dedicated wrapper. Examples:

- `index_read_docs({"topic":"mcp_agent_guide"})`
- `index_create_intent({"description":"...","autoApprove":true})`
- `index_read_networks({})`
- `index_discover_opportunities({"searchQuery":"..."})`
- `index_get_discovery_run({"discoveryRunId":"..."})`
- `index_list_opportunities({})`

Wrapper names are formed by prefixing the MCP tool name with `index_`; arguments are passed through unchanged to the underlying MCP tool. Tool responses are decoded from the MCP envelope and returned as JSON strings to Hermes.

### `index_agent_me`

Accepts no arguments:

```json
{}
```

Returns the authenticated personal agent identity for the configured `INDEX_API_KEY`.

### `index_pickup_negotiation`

Accepts:

```json
{
  "agentId": "optional personal agent UUID"
}
```

If `agentId` is omitted, the handler resolves it with `/api/agents/me`. A 204/no-work pickup returns:

```json
{ "success": true, "pending": false }
```

A claimed turn returns `pending: true` plus the backend negotiation payload.

### `index_respond_negotiation`

Accepts:

```json
{
  "agentId": "optional personal agent UUID",
  "negotiationId": "required negotiation UUID from pickup",
  "action": "propose | accept | reject | counter | question",
  "message": "required for counter/question; optional but useful for other actions",
  "reasoning": "required private rationale",
  "suggestedRoles": {
    "ownUser": "agent | patient | peer",
    "otherUser": "agent | patient | peer"
  }
}
```

The handler sends the backend body shape expected by the personal-agent negotiation endpoint:

```json
{
  "action": "accept",
  "message": "...",
  "assessment": {
    "reasoning": "...",
    "suggestedRoles": {
      "ownUser": "agent",
      "otherUser": "patient"
    }
  }
}
```

## Autonomous negotiation setup

Hermes can run as the user's personal Index negotiator by invoking the bundled `index-network:index-negotiator` skill on a schedule through Hermes' gateway/cron mechanism.

A minimal scheduled prompt should instruct Hermes to load the negotiator skill and run one autonomous polling pass, for example:

```text
Use skill_view("index-network:index-negotiator") and run one scheduled autonomous Index negotiation pass.
```

The skill's scheduled-run contract is:

1. call `index_pickup_negotiation()`
2. if `pending=false`, respond exactly `[SILENT]`
3. inspect returned context/opportunity/turn history/deadline when a turn is pending
4. choose one cautious action
5. call `index_respond_negotiation(...)`
6. report only the tool-confirmed submission

Run the Hermes gateway/cron often enough to keep the personal-agent heartbeat fresh. A 1 minute interval is recommended. The Index dispatcher falls back to the system negotiator when no personal agent has polled recently, so a slow or stopped cron may cause Hermes to miss turns even though the plugin is installed.

## Hook and command behavior

`__init__.py` registers a defensive `pre_llm_call` hook. When the user message clearly mentions Index Network, signals, intents, opportunities, or discovery, the hook injects a short hint telling Hermes to load `skill_view("index-network:index-orchestrator")`. The hook does not run tools by itself.

The `/index` command returns the same hint for explicit activation. Plugin skills are namespaced, so refer to them as `index-network:index-orchestrator` and `index-network:index-negotiator`.

## Bundled skills

The committed Hermes plugin skills are generated from templates in the monorepo:

```text
packages/protocol/skills/hermes-plugin/<skill-name>.template.md
        ↓ bun run build:skills
packages/hermes-plugin/skills/<skill-name>/SKILL.md
```

Do not edit generated `SKILL.md` files directly. Edit the templates and run `bun run build:skills` from the monorepo root.

`__init__.py` registers each skill directory with `ctx.register_skill()`, so Hermes can load them as `index-network:<skill-name>`. Do not copy plugin skills into `~/.hermes/skills`; Hermes plugin skills are namespaced and read-only.

## Dashboard view

The plugin ships a plugin-local Hermes dashboard tab under `dashboard/`:

```text
dashboard/manifest.json
dashboard/dist/index.js
dashboard/dist/style.css
dashboard/plugin_api.py
```

The tab appears as **Index Network** in Hermes and is read-only. It summarizes protocol guidance for signals and communities, explains autonomous negotiator setup, and never calls the pickup/respond negotiation tools from dashboard UI.

When Hermes mounts dashboard backend routes for this plugin source, `dashboard/plugin_api.py` exposes read-only routes under `/api/plugins/index-network/`:

- `GET /health` — dashboard API health;
- `GET /overview` — summarized agent, signal, protocol-guide, and negotiator setup state.

Hermes route support is source-dependent: user-installed plugins may render static JavaScript/CSS without Python backend routes. The dashboard handles that by treating the live overview as optional and falling back to static guidance instead of failing the tab.

## Verify

From the monorepo root:

```bash
bun run build:skills
bun test scripts/tests/build-skills.spec.ts
cd packages/hermes-plugin && bun run test
```

For manual dashboard checks, run `curl http://127.0.0.1:9119/api/dashboard/plugins/rescan` or restart `hermes dashboard`, then open the **Index Network** tab. The tab should render static guidance even when `/api/plugins/index-network/overview` is unavailable.

For Hermes discovery debugging:

```bash
HERMES_PLUGINS_DEBUG=1 hermes plugins list
hermes logs --level WARNING | grep -i plugin
```
````

### Success Criteria:

#### Automated Verification:
- [ ] Dashboard README mentions optional route support: `grep -q 'live overview routes as optional' packages/hermes-plugin/dashboard/README.md`.
- [ ] Package README documents read-only dashboard scope: `grep -q 'never calls the pickup/respond negotiation tools' packages/hermes-plugin/README.md`.
- [ ] Package README lists all dashboard files: `grep -q 'dashboard/plugin_api.py' packages/hermes-plugin/README.md`.

#### Manual Verification:
- [ ] Docs explain that live routes may be unavailable for user-installed plugins and that the tab falls back to static guidance.
- [ ] Docs preserve generated skill warning and do not tell users to edit generated `SKILL.md` files.
- [ ] Docs do not imply dashboard UI can claim or respond to negotiations.

## Phase 4: Smoke coverage

### Overview

Extends existing smoke tests to lock dashboard file, manifest, and API route contracts. Depends on Phases 1–3 so tests reflect final paths and docs.

### Changes Required:

#### 1. packages/hermes-plugin/tests/smoke.py

**File**: `packages/hermes-plugin/tests/smoke.py`
**Changes**: MODIFY — Add dashboard file syntax, manifest reference, API router, and UI registration checks.

```python
# Add near the existing imports/constants at the top of the file.
import subprocess

PYTHON_FILES = ["__init__.py", "schemas.py", "tools.py", "dashboard/plugin_api.py"]
DASHBOARD_FILES = [
    "dashboard/manifest.json",
    "dashboard/dist/index.js",
    "dashboard/dist/style.css",
    "dashboard/plugin_api.py",
]

# Add after the existing manifest tool parity assertion block.
    for relative_path in DASHBOARD_FILES:
        assert (ROOT / relative_path).exists(), f"missing dashboard file: {relative_path}"

    dashboard_manifest = json.loads((ROOT / "dashboard" / "manifest.json").read_text())
    assert dashboard_manifest["name"] == "index-network"
    assert dashboard_manifest["label"] == "Index Network"
    assert dashboard_manifest["entry"] == "dist/index.js"
    assert dashboard_manifest["css"] == "dist/style.css"
    assert dashboard_manifest["api"] == "plugin_api.py"
    assert dashboard_manifest["tab"]["path"] == "/index-network"
    for key in ("entry", "css", "api"):
        assert (ROOT / "dashboard" / dashboard_manifest[key]).exists(), dashboard_manifest[key]

    dashboard_js_path = ROOT / "dashboard" / "dist" / "index.js"
    subprocess.run(["node", "--check", str(dashboard_js_path)], check=True)
    dashboard_js = dashboard_js_path.read_text()
    assert 'register("index-network"' in dashboard_js
    assert "/api/plugins/index-network/overview" in dashboard_js
    assert "Signals" in dashboard_js
    assert "communities" in dashboard_js
    assert "internal identifiers" in dashboard_js
    assert "raw records" in dashboard_js
    assert "raw JSON" not in dashboard_js
    assert "tool_call" not in dashboard_js
    assert "intentId" not in dashboard_js
    assert "networkId" not in dashboard_js
    assert "opportunityId" not in dashboard_js
    assert "index_pickup_negotiation" not in dashboard_js
    assert "index_respond_negotiation" not in dashboard_js

    dashboard_api = (ROOT / "dashboard" / "plugin_api.py").read_text()
    assert "router = APIRouter()" in dashboard_api
    assert '@router.get("/health")' in dashboard_api
    assert '@router.get("/overview")' in dashboard_api
    assert 'import tools as index_tools' in dashboard_api
    assert 'make_mcp_tool_handler' in dashboard_api
    assert 'index_agent_me' in dashboard_api
    assert 'index_read_intents' in dashboard_api
    assert 'read_docs' in dashboard_api
    assert 'index_pickup_negotiation' not in dashboard_api
    assert 'index_respond_negotiation' not in dashboard_api
    assert 'urllib.request' not in dashboard_api

    dashboard_readme = (ROOT / "dashboard" / "README.md").read_text()
    package_readme = (ROOT / "README.md").read_text()
    assert "live overview routes as optional" in dashboard_readme
    assert "never calls the pickup/respond negotiation tools" in package_readme
    assert "dashboard/plugin_api.py" in package_readme
```

### Success Criteria:

#### Automated Verification:
- [ ] Package smoke test passes: `cd packages/hermes-plugin && bun run test`.
- [ ] Dashboard API syntax is included in smoke parsing: `grep -q 'dashboard/plugin_api.py' packages/hermes-plugin/tests/smoke.py`.
- [ ] Smoke test asserts read-only guard: `grep -q 'index_pickup_negotiation' packages/hermes-plugin/tests/smoke.py && grep -q 'not in dashboard_js' packages/hermes-plugin/tests/smoke.py`.
- [ ] Smoke test asserts manifest file references: `grep -q 'dashboard_manifest\["api"\]' packages/hermes-plugin/tests/smoke.py`.
- [ ] Smoke test syntax-checks dashboard JavaScript: `grep -q 'node", "--check"' packages/hermes-plugin/tests/smoke.py`.

#### Manual Verification:
- [ ] Smoke coverage fails if a dashboard manifest file path is missing or renamed.
- [ ] Smoke coverage fails if dashboard UI or API starts calling negotiation pickup/respond controls.
- [ ] Smoke coverage does not require FastAPI to be installed locally because it parses `plugin_api.py` syntax instead of importing the route module.

## Ordering Constraints

- Phase 1 must happen first because it creates a working static dashboard tab and the assets referenced by the initial manifest.
- Phase 2 must happen after Phase 1 because it adds the optional `api` manifest field and modifies the static tab to call `/api/plugins/index-network/overview`.
- Phase 2 must precede documentation so docs cite real route names and UI behavior.
- Phase 4 should run last so smoke checks validate all dashboard files and docs-facing package state.
- No phases are parallelized in this blueprint; each phase builds on names and behavior introduced by the previous phase.

## Verification Notes

- Run `cd packages/hermes-plugin && bun run test` after Phase 4; this is the package's existing verification command.
- Verify `dashboard/manifest.json` references files that exist: `dist/index.js`, `dist/style.css`, and `plugin_api.py`.
- Verify the JavaScript bundle registers the same plugin name as the manifest (`index-network`) through `window.__HERMES_PLUGINS__.register(...)`.
- Verify `plugin_api.py` exposes a FastAPI `router` and does not directly implement alternate MCP/API request code; it should call existing `tools.py` handlers.
- Verify no dashboard code calls `index_pickup_negotiation` or `index_respond_negotiation` in this read-only version.
- Verify dashboard copy says “signals” and “communities” and avoids raw JSON/internal IDs, matching protocol output rules.
- If checking manually in Hermes, run `curl http://127.0.0.1:9119/api/dashboard/plugins/rescan` or restart `hermes dashboard`, then confirm the tab renders even if backend routes return 404.

## Performance Considerations

- The dashboard should perform at most one overview request on initial load and only reload on explicit user refresh.
- The live overview endpoint should call `index_agent_me`, `index_read_intents(limit=5,page=1)`, and `index_read_docs(topic='mcp_agent_guide')` only; avoid discovery, pickup, or any long-running graph/tool action.
- UI fallback state should be static and local, so user-installed plugins are not slowed by repeated failing route probes.

## Migration Notes

No database schema, protocol API, package export, or persisted data migration is required. The dashboard is additive under an already-published package directory. If Hermes later changes user-installed plugin API route support, the resilient UI continues to work because it treats backend availability as optional.

## Pattern References

- `packages/hermes-plugin/__init__.py:82-123` — native handler registration remains source of truth.
- `packages/hermes-plugin/tools.py:82-92` — JSON success/error response convention for plugin handlers.
- `packages/hermes-plugin/tools.py:383-411` — scoped `index_read_intents` wrapper to reuse.
- `packages/hermes-plugin/tests/smoke.py:103-135` — smoke test parity style to extend.
- `packages/edge-city/agentvillage-controlplane/docs/dashboards/agent-village-edge-esmeralda-analytics.html:1-685` — no-framework dashboard layout and fetch/error rendering precedent.
- Hermes docs `Extending the Dashboard` — manifest, IIFE SDK registration, CSS injection, plugin API route, and user-plugin backend limitation reference.
- Hermes example dashboard `dashboard/dist/index.js` — SDK `React.createElement`, `SDK.fetchJSON`, and `window.__HERMES_PLUGINS__.register(...)` pattern.

## Developer Context

- Research Q (`packages/hermes-plugin/dashboard/README.md:1-14`, AgentVillage proxy/action precedents): Which boundary should this research optimize for — plugin-local dashboard, AgentVillage admin, or both staged? A: Plugin-local dashboard.
- Research Q (`packages/hermes-plugin/tools.py:383-411`, `packages/hermes-plugin/tools.py:428-496`): Which first-use workflow should be load-bearing — signals guide, negotiator status, or balanced overview? A: Balanced overview.
- Direction Q: About to follow Hermes' no-build dashboard plugin pattern from the official example instead of adding Vite/React build tooling. A: Follow IIFE.
- Direction Q: About to extend `packages/hermes-plugin/tests/smoke.py` for dashboard manifest/file/API parity instead of adding a new test runner. A: Extend smoke.
- Ambiguity Q: Hermes docs show dashboard backend routes via `dashboard/plugin_api.py`, but warn user-installed/project plugins do not auto-import Python APIs; which target should the dashboard optimize for first? A: Resilient dynamic.
- Ambiguity Q: Negotiator status has no pure read-only pending-turn endpoint; what controls should the first dashboard include? A: Read-only first.
- Design confirmation: resilient dynamic plugin-local dashboard with read-only live overview and graceful static guidance. A: Proceed.
- Decomposition confirmation: 4 slices: manifest/API foundation, UI bundle, docs, smoke coverage. A: Approve.
- Slice verifier finding before Phase 1 approval: original Phase 1 manifest referenced `dist/index.js`/`dist/style.css` scheduled for Phase 2. Follow-up Q: approve re-slicing so Phase 1 creates a working static tab and Phase 2 adds live API integration? A: Approve.
- Step 9 review triage: all three artifact-code-reviewer concerns were selected as `Apply fix`; Phase 2 gained concurrent dashboard overview collection and React hook fallbacks, and Phase 4 gained a `node --check` JavaScript syntax smoke assertion.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 2 §1 (plugin_api.py) | packages/hermes-plugin/tools.py:121 | concern | code-quality | `overview()` calls three native handlers serially, and each native network call can use the existing 30-second default timeout, so a degraded Index backend can delay dashboard fallback for roughly 90 seconds. | Add a dashboard-level deadline or run the three calls concurrently with a shorter timeout budget. | applied: Phase 2 now collects overview payloads concurrently under `_DASHBOARD_OVERVIEW_TIMEOUT_SECONDS = 12.0`, returning timeout errors per source. |
| code | Phase 2 §3 (index.js) | <n/a> | concern | code-quality | `useOverview()` initializes `loading` from `Boolean(SDK.fetchJSON)` but only starts loading inside `if (useEffect)`, so an SDK with `fetchJSON` but no `SDK.hooks` leaves the status panel permanently stuck on disabled “Checking…”. | Fall back to `React.useState`/`React.useEffect` or initialize the no-hooks path with `loading: false`. | applied: Phase 2 now falls back to `React.useEffect` / `React.useState` when `SDK.hooks` is unavailable. |
| code | Phase 4 §1 (smoke.py) | packages/hermes-plugin/tests/smoke.py:99 | concern | actionability | The proposed smoke extension claims dashboard syntax coverage but only `ast.parse`s Python files; a syntactically broken `dashboard/dist/index.js` containing the asserted strings would still pass. | Add an explicit JavaScript syntax check for `dashboard/dist/index.js` in the smoke test. | applied: Phase 4 now runs `node --check` against `dashboard/dist/index.js` before string assertions. |

## Plan History

- Phase 1: Static dashboard shell — approved as generated
- Phase 2: Live overview API integration — approved as generated
- Phase 3: Documentation alignment — approved as generated
- Phase 4: Smoke coverage — approved as generated
- Step 9 reviewer triage — applied 3 concern fixes: concurrent overview deadline, React hook fallback, and dashboard JS syntax smoke check

## References

- `.rpiv/artifacts/research/2026-06-23_19-07-13_hermes-plugin-dashboard.md`
- `packages/hermes-plugin/dashboard/README.md`
- `packages/hermes-plugin/README.md`
- `packages/hermes-plugin/tools.py`
- `packages/hermes-plugin/tests/smoke.py`
- Hermes dashboard docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard
- Hermes example dashboard manifest: https://raw.githubusercontent.com/NousResearch/hermes-example-plugins/main/example-dashboard/dashboard/manifest.json
- Hermes example dashboard API: https://raw.githubusercontent.com/NousResearch/hermes-example-plugins/main/example-dashboard/dashboard/plugin_api.py
- Hermes example dashboard JS: https://raw.githubusercontent.com/NousResearch/hermes-example-plugins/main/example-dashboard/dashboard/dist/index.js
