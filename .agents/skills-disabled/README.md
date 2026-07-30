# skills-disabled

Inactive skill versions. Nothing in this directory is discovered by pi or checked by
`bun run skills:validate` (both only scan `.agents/skills/`).

- `run-agent-orchestration/` — disabled 2026-07-27: directed the removed
  `pi-herdr-orchestrator` extension (`orchestrator_start`/`status`/`reconcile`/
  `report`/`delegate`). Restore only if that extension is reinstalled.
- `create-worktree/`, `run-worktree-session/`, `finish-pr/` — archived copies of the
  pre-cleanup versions that still referenced the orchestrator extension. The active,
  cleaned versions live in `.agents/skills/`.
