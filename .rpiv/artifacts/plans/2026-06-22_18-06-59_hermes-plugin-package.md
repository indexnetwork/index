---
date: 2026-06-22T18:06:59+0300
author: Yanek Yuk
commit: 79d72fb103
branch: dev
repository: index
topic: "Hermes plugin starter package"
tags: [plan, hermes, plugin, dashboard, mcp, starter]
status: superseded
parent: .rpiv/artifacts/research/2026-06-22_18-02-08_hermes-native-plugin-package.md
phase_count: 1
phases:
  - { n: 1, title: Empty Hermes plugin starter }
unresolved_phase_count: 0
last_updated: 2026-06-22T21:20:00+0300
last_updated_by: Yanek Yuk
last_updated_note: "Superseded generator/preset plan; package is now an empty Hermes plugin starter to fill in later with Index Network MCP and dashboard work."
---

# Hermes Plugin Starter Package Plan

## Overview

`packages/hermes-plugin/` should be an actual empty Hermes plugin starter, not a template generator. It keeps the official Hermes plugin file shape in place so future work can fill in Index Network MCP-backed tools, bundled skills, and a dashboard extension.

## Requirements

- Keep `packages/hermes-plugin/` as a root Bun workspace package.
- Do not keep a `templates/` source tree.
- Do not add a generator CLI or presets.
- Keep root-level Hermes plugin files:
  - `plugin.yaml`
  - `__init__.py`
  - `schemas.py`
  - `tools.py`
  - `skills/`
  - `dashboard/`
- The plugin should be intentionally empty for now:
  - no registered tools yet,
  - no MCP server configuration,
  - no Index API key handling,
  - no cron jobs,
  - no dashboard tab implementation yet.
- Add comments/TODOs that make future fill-in points obvious for Index Network MCP and dashboard work.

## Desired Shape

```text
packages/hermes-plugin/
├── plugin.yaml
├── __init__.py
├── schemas.py
├── tools.py
├── skills/
│   └── README.md
├── dashboard/
│   └── README.md
├── README.md
├── LICENSE
└── package.json
```

## Phase 1: Empty Hermes plugin starter

### Changes Required

1. Replace generator-oriented package metadata with starter plugin metadata.
2. Remove `packages/hermes-plugin/templates/`.
3. Add root-level Hermes plugin files with fillable comments and TODOs.
4. Keep verification lightweight: Python stubs should compile and the package script should pass.
5. Update README to clarify this is a fill-in-later plugin, not a generator.

### Success Criteria

#### Automated Verification

- [x] Package metadata is valid JSON: `bun -e "JSON.parse(await Bun.file('packages/hermes-plugin/package.json').text()); console.log('ok')"`
- [x] Root-level Hermes plugin files exist: `test -f packages/hermes-plugin/plugin.yaml && test -f packages/hermes-plugin/__init__.py && test -f packages/hermes-plugin/schemas.py && test -f packages/hermes-plugin/tools.py`
- [x] Generator template tree is removed: `test ! -d packages/hermes-plugin/templates`
- [x] Package verification passes: `cd packages/hermes-plugin && bun run test`
- [x] Plugin declares no tools yet: `grep -n 'provides_tools: \[\]' packages/hermes-plugin/plugin.yaml`
- [x] No MCP/API-key/cron wiring exists yet: `! grep -R "mcp_servers\|INDEX_API_KEY\|hermes cron\|DIGEST_CRON" packages/hermes-plugin --exclude='README.md'`

#### Manual Verification

- [x] Confirm files are root-level Hermes plugin files, not source templates.
- [x] Confirm TODO comments clearly indicate where to add Index Network MCP-backed tools and dashboard files later.

## What We're NOT Doing

- No generator CLI.
- No `basic` or `index-dashboard` preset directories.
- No MCP implementation yet.
- No dashboard implementation yet.
- No plugin enablement automation.

## Notes

This plan supersedes the earlier generator/preset direction that merged in PR #1043. The package remains useful as a starter plugin scaffold, but future work should fill in the plugin directly rather than generate another plugin from it.
