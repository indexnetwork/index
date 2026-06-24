---
template_version: 1
date: 2026-06-23T22:50:30+0300
author: Yanek Yuk
commit: 4150d08484
branch: dev
repository: index
topic: "Validation of hermes-plugin-dashboard"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-06-23_19-23-09_hermes-plugin-dashboard.md"
tags: [validation, plan, blueprint, hermes-plugin, dashboard, mcp, negotiation]
last_updated: 2026-06-23T22:50:30+0300
---

## Validation Report: hermes-plugin-dashboard

### Implementation Status

- ✗ Phase 1: Static dashboard shell — Not implemented
- ✗ Phase 2: Live overview API integration — Not implemented
- ✗ Phase 3: Documentation alignment — Not implemented
- ✗ Phase 4: Smoke coverage — Not implemented

### Automated Verification Results

- ✗ Phase 1 manifest JSON parses: `python3 -m json.tool packages/hermes-plugin/dashboard/manifest.json >/dev/null` — failed because `packages/hermes-plugin/dashboard/manifest.json` does not exist.
- ✗ Phase 1 assets exist: `test -f packages/hermes-plugin/dashboard/dist/index.js && test -f packages/hermes-plugin/dashboard/dist/style.css` — failed because both dashboard assets are missing.
- ✗ Phase 1 bundle registers plugin: `grep -q 'register("index-network"' packages/hermes-plugin/dashboard/dist/index.js` — failed because `dashboard/dist/index.js` does not exist.
- ✗ Phase 2 API syntax: `python3 -m py_compile packages/hermes-plugin/dashboard/plugin_api.py` — failed because `dashboard/plugin_api.py` does not exist.
- ✗ Phase 2 manifest includes API: `python3 - <<'PY'\nimport json, pathlib\nmanifest=json.loads(pathlib.Path('packages/hermes-plugin/dashboard/manifest.json').read_text())\nassert manifest['api'] == 'plugin_api.py'\nPY` — failed because `dashboard/manifest.json` does not exist.
- ✗ Phase 2 bundle uses overview endpoint: `grep -q '/api/plugins/index-network/overview' packages/hermes-plugin/dashboard/dist/index.js` — failed because `dashboard/dist/index.js` does not exist.
- ✓ Phase 2 read-only guard: `! grep -R "index_pickup_negotiation\|index_respond_negotiation" packages/hermes-plugin/dashboard` — passed only because there is no dashboard implementation beyond the placeholder README.
- ✗ Phase 3 dashboard README route docs: `grep -q 'live overview routes as optional' packages/hermes-plugin/dashboard/README.md` — failed; the README is still a placeholder.
- ✗ Phase 3 package README read-only scope: `grep -q 'never calls the pickup/respond negotiation tools' packages/hermes-plugin/README.md` — failed; the package README still describes a future dashboard placeholder.
- ✓ Phase 3 package README file list: `grep -q 'dashboard/plugin_api.py' packages/hermes-plugin/README.md` — passed because the placeholder lists the intended file, not because the dashboard is implemented.
- ✓ Phase 4 package smoke test: `cd packages/hermes-plugin && bun run test` — passed, but existing smoke coverage does not include dashboard checks.
- ✗ Phase 4 smoke includes API syntax target: `grep -q 'dashboard/plugin_api.py' packages/hermes-plugin/tests/smoke.py` — failed.
- ✗ Phase 4 smoke asserts read-only guard: `grep -q 'index_pickup_negotiation' packages/hermes-plugin/tests/smoke.py && grep -q 'not in dashboard_js' packages/hermes-plugin/tests/smoke.py` — failed because there is no `dashboard_js` guard.
- ✗ Phase 4 smoke asserts manifest API: `grep -q 'dashboard_manifest\["api"\]' packages/hermes-plugin/tests/smoke.py` — failed.
- ✗ Phase 4 smoke syntax-checks dashboard JavaScript: `grep -q 'node", "--check"' packages/hermes-plugin/tests/smoke.py` — failed.

### Code Review Findings

#### Matches Plan:

- `packages/hermes-plugin/package.json` already publishes `dashboard/`, matching the plan's additive package-local boundary.
- `packages/hermes-plugin/README.md:197-199` preserves the generated skill warning and does not tell users to edit generated `SKILL.md` files directly.
- `packages/hermes-plugin/README.md:206-209` lists the planned dashboard files, including `dashboard/plugin_api.py`, but only as future work.

#### Deviations from Plan:

- `packages/hermes-plugin/dashboard/README.md:1-14` still says the dashboard directory is reserved for future work and should remain empty; the plan required this file to document an implemented read-only dashboard, optional live routes, data sources, and verification.
- `packages/hermes-plugin/dashboard/manifest.json` is missing; Phase 1 and Phase 2 required a Hermes dashboard manifest with `name: index-network`, assets, and `api: plugin_api.py`.
- `packages/hermes-plugin/dashboard/dist/index.js` is missing; Phase 1 and Phase 2 required a no-build Hermes SDK IIFE, static fallback guidance, optional live overview loading, and read-only UI copy.
- `packages/hermes-plugin/dashboard/dist/style.css` is missing; Phase 1 required scoped theme-aware dashboard styling.
- `packages/hermes-plugin/dashboard/plugin_api.py` is missing; Phase 2 required FastAPI routes wrapping existing native handlers for agent, signals, and protocol guidance.
- `packages/hermes-plugin/README.md:22-28` still describes only a dashboard placeholder; the plan required a read-only dashboard status section with fallback behavior.
- `packages/hermes-plugin/README.md:201-210` still says “When dashboard work starts”; the plan required the implemented dashboard route behavior and manual verification steps.
- `packages/hermes-plugin/tests/smoke.py:14` parses only `__init__.py`, `schemas.py`, and `tools.py`; the plan required adding `dashboard/plugin_api.py` to syntax coverage.
- `packages/hermes-plugin/tests/smoke.py:96-150` retains existing tool/manifest parity checks only; it lacks the planned dashboard file existence, manifest reference, JS syntax, API route, docs, and read-only guard assertions.

#### Pattern Conformance:

- Existing Hermes plugin code still follows its pre-dashboard patterns: `packages/hermes-plugin/tests/smoke.py` remains a single smoke file and `packages/hermes-plugin/tools.py` remains the handler source of truth. However, the dashboard-specific implementation needed to conform to those patterns is absent.
- A separate worktree implementation was detected under `.worktrees/feat-hermes-dashboard-shell/packages/hermes-plugin/...` that appears broadly aligned with the planned no-build IIFE, native-handler API wrapper, docs, and smoke-test patterns. It is not present in the active `dev` working tree validated by this report.

#### Potential Issues:

- `packages/hermes-plugin/tests/smoke.py` currently allows `cd packages/hermes-plugin && bun run test` to pass even when the entire dashboard implementation is absent. This is a false-positive verification gap until Phase 4 coverage is added.
- The current branch has untracked plan/research artifacts but no implementation diff under `packages/hermes-plugin`, so validating from the repository root cannot verify the likely worktree implementation.

### Manual Testing Required:

Manual criteria are blocked until the dashboard files are implemented in the active working tree. Once implemented, verify:

1. Static dashboard shell:
   - [ ] The dashboard renders read-only static guidance and does not call `/api/plugins/` routes before the live integration path is present.
   - [ ] User-facing copy uses “signals” and “communities” and avoids raw JSON, internal IDs, and raw tool envelopes.
2. Live overview integration:
   - [ ] `/api/plugins/index-network/overview` returns summarized signals, guidance, and agent state when Hermes mounts plugin routes.
   - [ ] If that route is unavailable, the tab falls back to static guidance instead of a blank or error-only page.
   - [ ] The live UI offers no pickup/respond negotiation controls.
3. Documentation and smoke coverage:
   - [ ] Docs explain source-dependent route support and static fallback behavior.
   - [ ] Smoke coverage fails when dashboard files are missing or when dashboard UI/API starts calling negotiation pickup/respond controls.
   - [ ] Smoke coverage syntax-checks dashboard JavaScript and does not require FastAPI to be installed locally.

### Recommendations:

- Do not commit this plan as validated yet; the active `dev` working tree does not contain the implementation.
- If `.worktrees/feat-hermes-dashboard-shell` is the intended implementation, switch validation to that worktree or merge/copy its dashboard changes into the target branch, then re-run `/skill:validate`.
- After the implementation lands in the active tree, rerun all plan automated commands, especially `cd packages/hermes-plugin && bun run test`, to confirm Phase 4 closes the current false-positive smoke gap.
