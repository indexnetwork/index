---
date: 2026-06-22T18:06:59+0300
author: Yanek Yuk
commit: 2f13f40814
branch: dev
repository: index
topic: "Hermes plugin template generator package"
tags: [plan, blueprint, hermes, plugin, dashboard, template]
status: in-progress
parent: .rpiv/artifacts/research/2026-06-22_18-02-08_hermes-native-plugin-package.md
phase_count: 4
phases:
  - { n: 1, title: Package scaffold and basic plugin preset }
  - { n: 2, title: Index dashboard preset templates }
  - { n: 3, title: Generator CLI with preset selection }
  - { n: 4, title: Tests and documentation }
unresolved_phase_count: 2
last_updated: 2026-06-22T18:06:59+0300
last_updated_by: Yanek Yuk
last_updated_note: "Revised to official Hermes plugin + dashboard template generator with basic and index-dashboard presets"
---

# Hermes Plugin Template Generator Implementation Plan

## Overview
Build `packages/hermes-plugin/` as a Bun-powered template generator for official Hermes plugin directories. It scaffolds populate-able Hermes plugins that follow the documented `plugin.yaml` + Python `register(ctx)` model, and supports both a neutral `basic` preset and an `index-dashboard` preset that creates an Index Network dashboard tab skeleton.

## Requirements
- Add `packages/hermes-plugin/` as an explicit root Bun workspace.
- Ship package metadata for `@indexnetwork/hermes-plugin`; add the `hermes-plugin` bin only when the Phase 3 CLI entrypoint exists.
- Generate plugins under `$HERMES_HOME/plugins/<name>` / `~/.hermes/plugins/<name>` by default, with `--target` override.
- Support `--preset basic` for a neutral Hermes plugin template.
- Support `--preset index-dashboard` for an Index Network dashboard-view template.
- Follow Hermes plugin docs: `plugin.yaml`, `__init__.py register(ctx)`, `schemas.py`, `tools.py`, and plugin-bundled skills registered with `ctx.register_skill()`.
- Follow Hermes dashboard docs: `dashboard/manifest.json`, `dashboard/dist/index.js` IIFE, optional CSS, optional `dashboard/plugin_api.py` FastAPI router.
- Do not configure MCP servers, Index API keys, AgentVillage sidecars, or Hermes cron jobs.
- Do not enable generated plugins by default; `--enable` must be explicit and call `hermes plugins enable <name>` only after generation.
- Include tests for template rendering, name validation, both presets, overwrite protection, and generated Python/dashboard file shape.

## Current State Analysis

### Key Discoveries
- Root workspaces are explicit, not wildcarded: `package.json:4-10`.
- Existing package metadata patterns live in `packages/claude-plugin/package.json:2-11`; Bun package script style appears in `packages/cli/package.json:15-20`.
- Hermes plugin docs define plugins under `~/.hermes/plugins/<name>/` with `plugin.yaml`, `__init__.py`, schemas, and handlers.
- Hermes plugin docs define `ctx.register_tool()`, `ctx.register_hook()`, `ctx.register_command()`, `ctx.register_cli_command()`, and `ctx.register_skill()` inside `register(ctx)`.
- Hermes plugin docs state general plugins are opt-in through `plugins.enabled` / `hermes plugins enable <name>`.
- Hermes plugin docs recommend `ctx.register_skill()` for plugin-bundled skills; copying into `~/.hermes/skills` is legacy and collision-prone.
- Hermes dashboard docs define dashboard extensions as `dashboard/manifest.json`, a pre-built JS bundle, optional CSS, and optional `plugin_api.py`; UI bundles register tabs through `window.__HERMES_PLUGINS__.register(name, Component)` and use `window.__HERMES_PLUGIN_SDK__`.

## Desired End State

```bash
cd packages/hermes-plugin
bun src/main.ts init my-plugin --preset basic
bun src/main.ts init index-network --preset index-dashboard --target /tmp/hermes-plugins
```

Generated `basic` tree:

```text
~/.hermes/plugins/my-plugin/
├── plugin.yaml
├── __init__.py
├── schemas.py
├── tools.py
└── skills/example-skill/SKILL.md
```

Generated `index-dashboard` tree:

```text
~/.hermes/plugins/index-network/
├── plugin.yaml
├── __init__.py
├── schemas.py
├── tools.py
├── skills/example-skill/SKILL.md
└── dashboard/
    ├── manifest.json
    ├── plugin_api.py
    └── dist/
        ├── index.js
        └── style.css
```

## What We're NOT Doing
- No MCP server mutation or `mcp_servers.*` config.
- No `INDEX_API_KEY` handling or Index Network tool calls.
- No Hermes cron jobs or scheduled prompts.
- No AgentVillage sidecar/control-plane integration.
- No pip entry-point packaging in v1.
- No automatic plugin enablement unless `--enable` is passed.

## Decisions

### Package home
Decision: create `packages/hermes-plugin/`, not an AgentVillage subdirectory.
Evidence: User selected root package because it is not specifically for AgentVillage; root workspace membership is explicit in `package.json:4-10`.

### Official Hermes plugin model
Decision: follow Hermes' official plugin docs rather than AgentVillage's previous skills-only workaround.
Evidence: User provided `https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins`; docs specify `plugin.yaml`, `__init__.py`, schemas, handlers, `register(ctx)`, and opt-in enablement.

### Framework shape
Decision: build a template generator, not a concrete plugin or Python package.
Evidence: User selected “Template generator.”

### Presets
Decision: ship both `basic` and `index-dashboard` presets.
Evidence: User selected “Both presets”; dashboard docs support plugin dashboard tabs under the same Hermes plugin directory.

### Dashboard scope
Decision: the `index-dashboard` preset provides an Index Network dashboard-view skeleton only; no Index API/MCP integration in v1.
Evidence: User said it is okay to design the framework and can have an Index Network dashboard view; earlier scope excluded Index Network MCP wiring.

### Enablement
Decision: generated plugins are not enabled by default. `--enable` is explicit and shells out to `hermes plugins enable <name>` after generation.
Evidence: Hermes plugin docs state general plugins are opt-in through `plugins.enabled` / `hermes plugins enable <name>`.

## Phase 1: Package scaffold and basic plugin preset

### Overview
Foundation phase; creates package identity, workspace registration, and the neutral Hermes plugin template files.

### Changes Required:

#### 1. package.json:5-11
**File**: package.json
**Changes**: MODIFY — add `packages/hermes-plugin` to explicit workspace list
```json
"workspaces": [
  "apps/web",
  "services/api",
  "packages/protocol",
  "packages/cli",
  "packages/claude-plugin",
  "packages/hermes-plugin"
]
```

#### 2. packages/hermes-plugin/package.json
**File**: packages/hermes-plugin/package.json
**Changes**: NEW — package metadata, minimal scripts, and published template files before CLI source exists
```json
{
  "name": "@indexnetwork/hermes-plugin",
  "version": "0.1.0",
  "description": "Hermes plugin template generator",
  "license": "MIT",
  "type": "module",
  "homepage": "https://index.network",
  "repository": {
    "type": "git",
    "url": "https://github.com/indexnetwork/index.git",
    "directory": "packages/hermes-plugin"
  },
  "files": [
    "templates/",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest"
  },
  "engines": {
    "bun": ">=1.0.0"
  }
}
```

#### 3. packages/hermes-plugin/LICENSE
**File**: packages/hermes-plugin/LICENSE
**Changes**: NEW — MIT license for package distribution
```text
MIT License

Copyright (c) 2026 Index Network

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### 4. packages/hermes-plugin/templates/basic/plugin.yaml
**File**: packages/hermes-plugin/templates/basic/plugin.yaml
**Changes**: NEW — Hermes plugin manifest template
```yaml
name: __PLUGIN_NAME__
version: 0.1.0
description: __PLUGIN_DESCRIPTION__
provides_tools:
  - hello_world
provides_hooks: []
```

#### 5. packages/hermes-plugin/templates/basic/__init__.py
**File**: packages/hermes-plugin/templates/basic/__init__.py
**Changes**: NEW — Python registration template using `ctx.register_tool()` and `ctx.register_skill()`
```python
"""__PLUGIN_TITLE__ Hermes plugin — registration."""

from pathlib import Path

from . import schemas, tools


def _register_skills(ctx):
    """Register bundled plugin skills as namespaced plugin skills."""
    skills_dir = Path(__file__).parent / "skills"
    if not skills_dir.exists():
        return
    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            ctx.register_skill(child.name, skill_md)


def register(ctx):
    """Wire schemas to handlers and register bundled skills."""
    ctx.register_tool(
        name="hello_world",
        toolset="__PLUGIN_NAME__",
        schema=schemas.HELLO_WORLD,
        handler=tools.hello_world,
        description="Return a friendly greeting for a provided name.",
    )
    _register_skills(ctx)
```

#### 6. packages/hermes-plugin/templates/basic/schemas.py
**File**: packages/hermes-plugin/templates/basic/schemas.py
**Changes**: NEW — example LLM-facing tool schema template
```python
"""Tool schemas — what the LLM sees."""

HELLO_WORLD = {
    "name": "hello_world",
    "description": "Return a friendly greeting for the provided name.",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Name to greet.",
            },
        },
        "required": ["name"],
    },
}
```

#### 7. packages/hermes-plugin/templates/basic/tools.py
**File**: packages/hermes-plugin/templates/basic/tools.py
**Changes**: NEW — example JSON-string-returning handler template
```python
"""Tool handlers — what runs when the LLM calls each tool."""

import json


def hello_world(args: dict, **kwargs) -> str:
    """Return a friendly greeting.

    Hermes tool handlers should accept **kwargs for forward compatibility and
    return a JSON string for both success and error cases.
    """
    del kwargs
    name = str(args.get("name") or "World").strip() or "World"
    return json.dumps({"success": True, "greeting": f"Hello, {name}!"})
```

#### 8. packages/hermes-plugin/templates/basic/skills/example-skill/SKILL.md
**File**: packages/hermes-plugin/templates/basic/skills/example-skill/SKILL.md
**Changes**: NEW — bundled plugin skill example loaded as `plugin:example-skill`
```md
---
name: example-skill
description: Use when you want to demonstrate a bundled Hermes plugin skill.
---

# Example Plugin Skill

This skill is bundled inside the generated plugin and registered with `ctx.register_skill()`.
Load it from Hermes with the namespaced skill name:

```text
skill_view("__PLUGIN_NAME__:example-skill")
```

Replace this file with your plugin-specific workflow instructions.
```

#### 9. packages/hermes-plugin/README.md
**File**: packages/hermes-plugin/README.md
**Changes**: NEW — initial docs for the template generator package
```md
# Hermes Plugin Template Generator

Scaffold a Hermes plugin directory with `plugin.yaml`, Python registration code, tool schemas, handlers, and bundled skill examples.

This package follows Hermes' documented plugin model. Generated plugins are meant to live under `$HERMES_HOME/plugins/<name>` or another directory you choose, then be explicitly enabled with `hermes plugins enable <name>`.

## Scope

- Generates a neutral Hermes plugin template.
- Includes an example tool and an example bundled skill.
- Does not configure MCP servers.
- Does not create scheduled cron jobs.
- Does not enable generated plugins unless you pass `--enable`.
```

### Success Criteria:

#### Automated Verification:
- [ ] Root workspace includes the Hermes package: `grep -n 'packages/hermes-plugin' package.json`
- [ ] Package metadata is valid JSON: `bun -e "JSON.parse(await Bun.file('packages/hermes-plugin/package.json').text()); console.log('ok')"`
- [ ] Phase 1 does not declare a dangling CLI before `src/main.ts` exists: `! grep -q '"bin"' packages/hermes-plugin/package.json && ! grep -q 'src/main.ts' packages/hermes-plugin/package.json`
- [ ] Basic template files exist: `test -f packages/hermes-plugin/templates/basic/plugin.yaml && test -f packages/hermes-plugin/templates/basic/__init__.py && test -f packages/hermes-plugin/templates/basic/schemas.py && test -f packages/hermes-plugin/templates/basic/tools.py`
- [ ] Basic template contains no Index MCP wiring: `! grep -R "mcp_servers\|INDEX_API_KEY\|index-network" packages/hermes-plugin/templates/basic`

#### Manual Verification:
- [ ] Confirm basic template names are neutral and populate-able.
- [ ] Confirm bundled skills are registered through plugin `ctx.register_skill()` rather than copied into `$HERMES_HOME/skills`.

## Phase 2: Index dashboard preset templates

### Overview
Depends on Phase 1; adds the `index-dashboard` preset that extends the basic plugin template with Hermes dashboard extension files.

### Changes Required:

#### 1. packages/hermes-plugin/templates/index-dashboard/plugin.yaml
**File**: packages/hermes-plugin/templates/index-dashboard/plugin.yaml
**Changes**: NEW — preset manifest for an Index Network dashboard plugin skeleton
```yaml
name: __PLUGIN_NAME__
version: 0.1.0
description: __PLUGIN_DESCRIPTION__
provides_tools: []
provides_hooks: []
```

#### 2. packages/hermes-plugin/templates/index-dashboard/__init__.py
**File**: packages/hermes-plugin/templates/index-dashboard/__init__.py
**Changes**: NEW — registration template preserving skill registration and leaving dashboard discovery to Hermes
```python
"""__PLUGIN_TITLE__ Hermes plugin — dashboard preset registration."""

from pathlib import Path


def _register_skills(ctx):
    """Register bundled plugin skills as namespaced plugin skills."""
    skills_dir = Path(__file__).parent / "skills"
    if not skills_dir.exists():
        return
    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            ctx.register_skill(child.name, skill_md)


def register(ctx):
    """Register plugin-bundled skills.

    The dashboard tab is discovered from dashboard/manifest.json by Hermes'
    dashboard plugin loader; no Python registration is required for the UI.
    """
    _register_skills(ctx)
```

#### 3. packages/hermes-plugin/templates/index-dashboard/schemas.py
**File**: packages/hermes-plugin/templates/index-dashboard/schemas.py
**Changes**: NEW — minimal placeholder schemas for future Index-specific tools
```python
"""Tool schemas for __PLUGIN_TITLE__.

This dashboard preset does not register tools by default. Add schemas here if
future versions of your plugin expose LLM-callable tools via ctx.register_tool().
"""
```

#### 4. packages/hermes-plugin/templates/index-dashboard/tools.py
**File**: packages/hermes-plugin/templates/index-dashboard/tools.py
**Changes**: NEW — minimal placeholder handlers for future Index-specific tools
```python
"""Tool handlers for __PLUGIN_TITLE__.

This dashboard preset does not register tools by default. If you add handlers,
return JSON strings and accept **kwargs for forward compatibility.
"""
```

#### 5. packages/hermes-plugin/templates/index-dashboard/skills/example-skill/SKILL.md
**File**: packages/hermes-plugin/templates/index-dashboard/skills/example-skill/SKILL.md
**Changes**: NEW — dashboard preset bundled skill placeholder
```md
---
name: index-dashboard
description: Use when you want to explain or extend the generated Index Network dashboard view.
---

# Index Network Dashboard Skill

This bundled skill accompanies the generated dashboard view. Use it to document
what the dashboard tab shows and how to extend it.

The dashboard files live under:

```text
dashboard/manifest.json
dashboard/dist/index.js
dashboard/dist/style.css
dashboard/plugin_api.py
```

Replace this placeholder with Index Network-specific dashboard guidance as the
view becomes connected to real data.
```

#### 6. packages/hermes-plugin/templates/index-dashboard/dashboard/manifest.json
**File**: packages/hermes-plugin/templates/index-dashboard/dashboard/manifest.json
**Changes**: NEW — Hermes dashboard plugin manifest
```json
{
  "name": "__PLUGIN_NAME__",
  "label": "Index Network",
  "description": "Index Network dashboard view template",
  "icon": "Network",
  "version": "0.1.0",
  "tab": {
    "path": "/__PLUGIN_NAME__",
    "position": "after:skills"
  },
  "entry": "dist/index.js",
  "css": "dist/style.css",
  "api": "plugin_api.py"
}
```

#### 7. packages/hermes-plugin/templates/index-dashboard/dashboard/dist/index.js
**File**: packages/hermes-plugin/templates/index-dashboard/dashboard/dist/index.js
**Changes**: NEW — IIFE dashboard tab bundle using Hermes dashboard SDK
```js
(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) {
    console.warn("[__PLUGIN_NAME__] Hermes dashboard plugin SDK is unavailable");
    return;
  }

  const { React } = SDK;
  const { useEffect, useState } = SDK.hooks;
  const { Card, CardHeader, CardTitle, CardContent, Badge, Button } = SDK.components;

  function IndexDashboardView() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);

    useEffect(function () {
      SDK.fetchJSON("/api/plugins/__PLUGIN_NAME__/status")
        .then(setStatus)
        .catch(function (err) {
          setError(err instanceof Error ? err.message : String(err));
        });
    }, []);

    return React.createElement(
      "div",
      { className: "index-dashboard-grid" },
      React.createElement(
        Card,
        null,
        React.createElement(
          CardHeader,
          null,
          React.createElement(CardTitle, null, "Index Network"),
        ),
        React.createElement(
          CardContent,
          { className: "index-dashboard-stack" },
          React.createElement(
            "p",
            { className: "text-sm text-muted-foreground" },
            "A dashboard view template for Index Network context, signals, and opportunities.",
          ),
          React.createElement(Badge, { variant: "secondary" }, "Template"),
          status
            ? React.createElement("pre", { className: "index-dashboard-code" }, JSON.stringify(status, null, 2))
            : React.createElement("p", { className: "text-xs text-muted-foreground" }, error || "Loading plugin status…"),
          React.createElement(
            Button,
            { type: "button", onClick: function () { window.location.reload(); } },
            "Refresh",
          ),
        ),
      ),
    );
  }

  window.__HERMES_PLUGINS__.register("__PLUGIN_NAME__", IndexDashboardView);
}());
```

#### 8. packages/hermes-plugin/templates/index-dashboard/dashboard/dist/style.css
**File**: packages/hermes-plugin/templates/index-dashboard/dashboard/dist/style.css
**Changes**: NEW — theme-aware dashboard CSS
```css
.index-dashboard-grid {
  display: grid;
  gap: 1rem;
}

.index-dashboard-stack {
  display: grid;
  gap: 0.75rem;
}

.index-dashboard-code {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-muted);
  color: var(--color-muted-foreground);
  padding: 0.75rem;
  overflow: auto;
  font-size: 0.75rem;
}
```

#### 9. packages/hermes-plugin/templates/index-dashboard/dashboard/plugin_api.py
**File**: packages/hermes-plugin/templates/index-dashboard/dashboard/plugin_api.py
**Changes**: NEW — optional FastAPI router placeholder for dashboard backend routes
```python
"""Dashboard backend routes for __PLUGIN_TITLE__."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/status")
async def status():
    """Return placeholder status for the generated dashboard tab."""
    return {
        "ok": True,
        "plugin": "__PLUGIN_NAME__",
        "message": "Replace this route with your Index Network dashboard data source.",
    }
```

### Success Criteria:

#### Automated Verification:
- [ ] Index dashboard preset includes Hermes dashboard manifest and bundle: `test -f packages/hermes-plugin/templates/index-dashboard/dashboard/manifest.json && test -f packages/hermes-plugin/templates/index-dashboard/dashboard/dist/index.js`
- [ ] Dashboard bundle registers the plugin through the Hermes dashboard registry: `grep -n '__HERMES_PLUGINS__\.register' packages/hermes-plugin/templates/index-dashboard/dashboard/dist/index.js`
- [ ] Dashboard bundle uses the Hermes dashboard SDK instead of bundling React: `grep -n '__HERMES_PLUGIN_SDK__' packages/hermes-plugin/templates/index-dashboard/dashboard/dist/index.js`
- [ ] Dashboard preset has no MCP/API-key/cron wiring: `! grep -R "mcp_servers\|INDEX_API_KEY\|hermes cron\|DIGEST_CRON" packages/hermes-plugin/templates/index-dashboard`
- [ ] Dashboard backend route exports a FastAPI router: `grep -n 'router = APIRouter()' packages/hermes-plugin/templates/index-dashboard/dashboard/plugin_api.py`

#### Manual Verification:
- [ ] Confirm the dashboard preset is clearly an Index Network view skeleton, not a wired production integration.
- [ ] Confirm the dashboard tab path and manifest name are placeholder-rendered from the plugin name.

## Phase 3: Generator CLI with preset selection

### Overview
Depends on Phases 1 and 2; adds the executable TypeScript generator with preset selection, target resolution, rendering, overwrite protection, explicit enablement, and package `bin` activation.

### Changes Required:

#### 1. packages/hermes-plugin/src/paths.ts
**File**: packages/hermes-plugin/src/paths.ts
**Changes**: NEW — resolve `$HERMES_HOME/plugins`, package root, and preset template directories
```ts
```

#### 2. packages/hermes-plugin/src/template.ts
**File**: packages/hermes-plugin/src/template.ts
**Changes**: NEW — name validation, placeholder rendering, recursive template copy, and preset validation
```ts
```

#### 3. packages/hermes-plugin/src/main.ts
**File**: packages/hermes-plugin/src/main.ts
**Changes**: NEW — `hermes-plugin init <name>` CLI with `--preset`, `--target`, `--force`, and `--enable`
```ts
```

#### 4. packages/hermes-plugin/package.json
**File**: packages/hermes-plugin/package.json
**Changes**: MODIFY — add `bin`, `src/` publish files, and CLI scripts once `src/main.ts` exists
```json
```

### Success Criteria:

#### Automated Verification:

#### Manual Verification:

## Phase 4: Tests and documentation

### Overview
Depends on Phases 1-3; adds focused Bun tests and final documentation for both plugin and dashboard template behavior.

### Changes Required:

#### 1. packages/hermes-plugin/tests/template.test.ts
**File**: packages/hermes-plugin/tests/template.test.ts
**Changes**: NEW — unit tests for validation/rendering helpers
```ts
```

#### 2. packages/hermes-plugin/tests/generator.test.ts
**File**: packages/hermes-plugin/tests/generator.test.ts
**Changes**: NEW — end-to-end generator tests for both presets
```ts
```

#### 3. packages/hermes-plugin/README.md
**File**: packages/hermes-plugin/README.md
**Changes**: MODIFY — final docs for plugin generation, dashboard preset, enablement, and troubleshooting
```md
```

### Success Criteria:

#### Automated Verification:

#### Manual Verification:

## Ordering Constraints
- Phase 1 must land first because it creates the package and neutral template baseline.
- Phase 2 depends on Phase 1 template conventions and adds a second preset.
- Phase 3 depends on Phase 1 and Phase 2 templates so the CLI can validate and render both presets.
- Phase 4 depends on the CLI and both presets to test and document the complete generator.
- No phases are parallelizable because each builds on prior package structure.

## Verification Notes
- Verify root workspace registration because workspaces are explicit in `package.json:4-10`.
- Verify generated plugins contain `plugin.yaml` and `__init__.py` with `register(ctx)`, matching Hermes plugin docs.
- Verify bundled skills use `ctx.register_skill()` rather than copying into `$HERMES_HOME/skills`.
- Verify dashboard preset contains `dashboard/manifest.json`, `dashboard/dist/index.js`, and registration through `window.__HERMES_PLUGINS__.register(...)`.
- Verify generated plugins are not enabled by default; only `--enable` should invoke `hermes plugins enable <name>`.
- Verify no Index MCP, `mcp_servers`, `INDEX_API_KEY`, cron, or AgentVillage sidecar assumptions remain.
- Verify handlers return JSON strings and accept `**kwargs`, matching Hermes handler guidance.

## Performance Considerations
- Generator copies small template trees and performs string substitution only.
- Generated example plugin has no network calls, no background workers, and no cron jobs.
- Dashboard bundle is a plain IIFE that uses Hermes' provided SDK and does not bundle React.

## Migration Notes
- No database or application schema changes.
- This plan supersedes the earlier Index MCP installer direction in this artifact.
- Existing Claude plugin/generated skill workflows remain untouched.

## Pattern References
- `package.json:4-10` — explicit root workspace registration pattern.
- `packages/claude-plugin/package.json:2-11` — package metadata style.
- `packages/cli/package.json:15-20` — Bun package script style.
- Hermes Plugins docs — plugin discovery, opt-in `plugins.enabled`, `plugin.yaml`, `register(ctx)`, `ctx.register_skill()`.
- Hermes Build a Plugin guide — complete plugin tree, handler return contract, bundled skill registration, and common mistakes.
- Hermes Extending the Dashboard docs — dashboard manifest, SDK, IIFE bundle, plugin API routes, slots, and plugin discovery.

## Developer Context
**Q (`packages/edge-city/agentvillage/skills/README.md:69-109`, `packages/claude-plugin/.codex-plugin/plugin.json:13-14`, `packages/edge-city/agentvillage/skills/openclaw.plugin.json:2-6`): Should the new `hermes-plugin` research assume a Hermes-native package only, or a cross-host package?**
A: Hermes-native. Later corrected to use Hermes' official plugin docs instead of AgentVillage's skills-only workaround.

**Q: Should `hermes-plugin` live as a new root workspace package under `packages/`, inside the Edge-City AgentVillage submodule, or as a standalone repo mirrored into this monorepo?**
A: `packages/hermes-plugin` because it is not specifically for AgentVillage this time.

**Q (`packages/edge-city/agentvillage/install/install_index.ts:200-243`, `packages/edge-city/agentvillage/install/install_index.ts:340-429`): Should v1 include scheduled Hermes cron prompts, or stay interactive-only?**
A: No crons in v1.

**Correction (Hermes plugins docs): User pointed to `https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins` and asked not to reference AgentVillage as the source model.**
A: Revised blueprint to follow Hermes official plugin model: `plugin.yaml`, Python `register(ctx)`, schemas, handlers, plugin-bundled skills, and opt-in enablement.

**Q (`https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins`): Should `packages/hermes-plugin` be a template generator or concrete starter plugin?**
A: Template generator.

**Dashboard addition (`https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard`): User noted we can have an Index Network dashboard view as well.**
A: Add both presets: neutral `basic` and `index-dashboard`.

**Q: Revised design with two presets ready to proceed?**
A: Proceed.

**Q: Approve revised 4-slice decomposition?**
A: Approve.

## Plan History
- Previous Phase 1/2 work — reopened and superseded after user corrected source model to official Hermes plugin docs.
- Phase 1: Package scaffold and basic plugin preset — approved as generated
- Phase 2: Index dashboard preset templates — approved as generated
- Phase 3: Generator CLI with preset selection — pending
- Phase 4: Tests and documentation — pending

## References
- `.rpiv/artifacts/research/2026-06-22_18-02-08_hermes-native-plugin-package.md` — parent research artifact; superseded where it inferred AgentVillage-specific behavior.
- `https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins` — official Hermes plugin feature docs.
- `https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin` — official Hermes plugin authoring guide.
- `https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard` — official Hermes dashboard extension docs.
