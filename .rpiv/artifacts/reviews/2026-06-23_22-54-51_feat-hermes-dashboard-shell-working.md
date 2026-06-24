---
template_version: 2
date: 2026-06-23T22:54:51+0300
author: Yanek Yuk
repository: index
branch: feat/hermes-dashboard-shell
commit: 4150d08484
review_type: working
scope: "feat/hermes-dashboard-shell worktree changes vs dev (tracked + untracked dashboard files)"
scope_strategy: working-tree
in_scope_files_count: 7
status: ready
severity: { critical: 0, important: 2, suggestion: 6 }
verification: { verified: 8, weakened: 0, falsified: 0 }
blockers_count: 2
tags: [code-review, hermes-plugin, dashboard]
---

# Code Review — feat/hermes-dashboard-shell worktree changes vs dev

**Commit:** `4150d08484` · **Status:** `ready` · **Findings:** 0🔴 · 2🟡 · 6🔵 · **Verification:** 8✓ / 0− / 0✗

## Top Blockers

1. **S1** — Dashboard `/overview` is wired as a backend route without a local auth/dependency guard while returning Index-key-backed data.
2. **S2** — Dashboard `/health` exposes native-handler availability and import errors without a local auth/dependency guard.

---

## Legend

```text
Severity    🔴 fix before merge   🟡 fix soon   🔵 nice to have   💭 discuss
ID prefix   I interaction   Q quality   S security   G gap
Verify      ✓ verified   − weakened (demoted)   ✗ falsified (dropped)
Annotate    [precedent-weighted]   [cascade: <kind>]   [subsumed-by <ID>]
```

---

## 🟡 Important

### S1 🟡 Dashboard overview route lacks a local auth guard

**Where**
`packages/hermes-plugin/dashboard/manifest.json:13`

**Code**
```json
  "api": "plugin_api.py"
```

**Why**
The manifest wires `plugin_api.py` into the dashboard host, and `packages/hermes-plugin/dashboard/plugin_api.py:228` — `@router.get("/overview")` registers the live overview route without a route-local dependency/auth guard. That route collects agent/signals through native handlers backed by the configured Index key.

**Fix**
Add the Hermes-supported dashboard-route auth/dependency mechanism before returning live overview data, or omit the backend API from the manifest until the host guarantees authenticated route access for this plugin source.

---

### S2 🟡 Dashboard health route exposes process details without a local guard

**Where**
`packages/hermes-plugin/dashboard/plugin_api.py:216`

**Code**
```python
@router.get("/health")
```

**Why**
The route has no local dependency/auth guard and returns `nativeHandlersAvailable` plus import error details at `plugin_api.py:223-224`. Even though it does not call Index, it can disclose dashboard process wiring and import failures.

**Fix**
Apply the same route guard as `/overview`, or reduce `/health` to a non-sensitive static success payload when exposed by the dashboard host.

---

## 🔵 Suggestions

### Q1 🔵 Read-only helper can resolve write-capable MCP tools

**Where**
`packages/hermes-plugin/dashboard/plugin_api.py:86`

**Fix**
Add a dashboard-local read-only allowlist for `_call_mcp_tool` so future callers cannot resolve write tools through the shared forwarded MCP factory.

---

### Q2 🔵 Raw `payload` can become signal display text

**Where**
`packages/hermes-plugin/dashboard/plugin_api.py:111`

**Fix**
Drop `row.get("payload")` from the public description fallback, or explicitly synthesize/redact it before returning dashboard signal rows.

---

### Q3 🔵 Non-JSON MCP text is ignored by guidance summarization

**Where**
`packages/hermes-plugin/dashboard/plugin_api.py:180`

**Fix**
Read `data.get("text")` as a fallback when `content` is absent so non-JSON `read_docs` responses can populate the live guidance excerpt.

---

### Q4 🔵 Partial backend failures still render as “Live read-only”

**Where**
`packages/hermes-plugin/dashboard/plugin_api.py:243`

**Fix**
Return `live: false` when any required overview source fails, or add a distinct partial/degraded state that the frontend renders instead of “Live read-only”.

---

### Q5 🔵 Plugin API mutates process-global import resolution

**Where**
`packages/hermes-plugin/dashboard/plugin_api.py:32`

**Fix**
Import `tools.py` via a package-relative/importlib path that does not insert the plugin root at the front of `sys.path` for the whole dashboard process.

---

### Q6 🔵 Smoke tests do not exercise dashboard API behavior

**Where**
`packages/hermes-plugin/tests/smoke.py:177`

**Fix**
Import `dashboard/plugin_api.py` in the smoke test and call `health()` / `overview()` with mocked native handlers to cover redaction, partial-failure, and read-only behavior directly.

---

## Impact

| Consumer | Change | Findings |
| --- | --- | --- |
| `packages/hermes-plugin/dashboard/manifest.json:13` | Hermes dashboard host loads `plugin_api.py` as backend API. | S1, S2 |
| `packages/hermes-plugin/dashboard/dist/index.js:94` | Frontend status badge trusts the backend `live` field. | Q4 |
| `packages/hermes-plugin/dashboard/plugin_api.py:193-195` | Overview route calls native Index handlers for agent, signals, and docs. | S1, Q1, Q3 |
| `packages/hermes-plugin/tests/smoke.py:144-181` | Smoke coverage validates static strings/asset presence but not route execution. | Q6 |

---

## Precedents

| Commit | Subject | Follow-ups |
| --- | --- | --- |
| `79d72fb103` / `d727b711e0` / `5f56d75096` / `c31443dec0` / `4150d08484` | Hermes plugin starter and native Index tools | `d727b711e0` corrected root plugin shape after scaffold drift. |
| `1f575aa` / `3ef8623` / `6408b47` | AgentVillage dashboard proxy + Hermes helper | Follow-ups fixed cookie cleanup, route prefix detection, and token URL leakage. |
| `fd74478` / `77d8b9f` | Hermes response analytics dashboard | Follow-ups hardened endpoint scope and redaction. |
| `1ef6d11` / `ad6bb60` / `5f7d233` / `d8d354a` | Cross-host plugin manifests | Follow-ups fixed missing discovery fields and userConfig/API-key persistence. |
| `2463b36a65` | Intent count consistency across surfaces | No follow-up fixes found; reinforced scoped MCP/native handler usage. |

**Recurring lessons (most → least frequent)**

1. Dashboard failures recur at auth/session/scoping boundaries: token hygiene, cookie handling, API-key provenance, route availability, and MCP scoped visibility.
2. Redaction and minimal endpoint scope need to be in the first dashboard slice, not follow-up hardening.
3. Smoke coverage should execute dashboard route behavior, not only validate static strings and file references.
4. Plugin manifests are brittle integration contracts and need explicit tests for exact file references.

---

## Reconciliation Notes

- Reviewed `feat/hermes-dashboard-shell` worktree changes because the branch has no committed diff beyond `dev`; untracked dashboard files were included manually in the patch.
- Excluded the untracked `.rpiv/artifacts/plans/2026-06-23_19-23-09_hermes-plugin-dashboard.md` from code findings; source review covered the dashboard implementation files.
- In-scope pre-filter dropped 0 reconciled findings.
- No peer-mirror pairs were computed for this diff.
- Precedent weighting did not change severity; related dashboard precedents supported attention to auth/redaction but did not map to two same-symbol 30-day follow-up fixes.
- Advisor path was unavailable; inline reconciliation was used.

---

## Recommendation

| # | ID | Action | Alt / Note |
| - | --- | --- | --- |
| 1 | S1 | Guard `/overview` or remove the backend API manifest entry until route auth is guaranteed. | Highest priority because it returns Index-key-backed data. |
| 2 | S2 | Guard or sanitize `/health`. | Keep import errors out of unauthenticated responses. |
| 3 | Q1 | Add a dashboard-only read allowlist for MCP helper calls. | Prevent future accidental write-tool exposure. |
| 4 | Q2 | Remove/redact `payload` from signal display fallback. | Align runtime with docs/tests. |
| 5 | Q3 | Accept `text` as a docs-content fallback. | Fixes live guidance for markdown/text MCP responses. |
| 6 | Q4 | Represent partial failures distinctly in API/UI. | Avoid false “Live read-only” status. |
| 7 | Q5 | Avoid process-global `sys.path` mutation. | Use importlib or package-relative import. |
| 8 | Q6 | Add route-level smoke tests with mocked handlers. | Covers S1/Q2/Q3/Q4 regressions. |
