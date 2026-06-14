---
date: 2026-06-12T00:33:22+0300
author: Yankı Ekin Yüksel
commit: 1d1c539839
branch: dev
repository: index
topic: "PR #937 Brief-Question Remediation — Phase 2 Implementation"
tags: [implementation, plan-execution, questioner, mcp-tools, adapters, agentvillage, daily-brief]
status: complete
last_updated: 2026-06-12T00:33:22+0300
last_updated_by: Yankı Ekin Yüksel
type: feature_development
---

# Handoff: PR #937 remediation — Phases 1-2 done, Phases 3-5 (AgentVillage submodule) pending

## Task(s)

Executing the phased plan `.rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md` (5 phases) via `/skill:implement`, one phase per session.

- **Phase 1 — Protocol tool hardening** (scope clamp + limit pushdown + error reporting + version bump 3.3.2): **completed** in a prior session. Changes are *uncommitted* in the worktree (`packages/protocol/...` modified, including built `dist/`).
- **Phase 2 — Backend SQL-side filters** (adapter modes/limit + dep pass-through ×3 + tests): **completed this session**. All automated success criteria pass and are checked off in the plan. Changes are *uncommitted*.
- **Phase 3 — Digest marker + prompt sanitization infra**: planned, not started. AgentVillage **submodule** change.
- **Phase 4 — Brief context fetch hardening + delivered-question filtering**: planned, not started. Submodule change.
- **Phase 5 — Compose/stage/send wiring**: planned, not started. Submodule change.

**CRITICAL — working tree**: all implementation happens in the PR worktree `/Users/aposto/Projects/index/.worktrees/feat-agentvillage-brief-questions` (branch `feat/agentvillage-brief-questions`, base `bf791443`), NOT the `dev` checkout. AgentVillage paths are inside the submodule `packages/edge-city/agentvillage/` (@ `78215c6`).

## Critical References

- Plan (source of truth, includes full code blocks per phase): `.rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md`
- Design: `.rpiv/artifacts/designs/2026-06-11_23-01-27_pr-937-brief-questions-remediation.md`
- Parent review: `.rpiv/artifacts/reviews/2026-06-11_22-36-43_pr-937-agentvillage-brief-questions.md`

## Recent changes

All paths relative to the worktree `/Users/aposto/Projects/index/.worktrees/feat-agentvillage-brief-questions`:

- `backend/src/adapters/questioner.adapter.ts:93-100` — `AdapterQuestionFilters` gains `modes?: Array<'discovery'|'intent'|'profile'|'negotiation'>` and `limit?: number`
- `backend/src/adapters/questioner.adapter.ts:165-185` — `findPending` adds an OR-condition block over `detection->>'mode'` for `filters.modes`, and applies `filters.limit` via Drizzle `.limit(n)` (SQL-side, no post-fetch slice)
- `backend/src/controllers/mcp.controller.ts:633-641` — `findPendingQuestions` dep signature widened (body unchanged; filters pass straight through to `questionerAdapter.findPending`)
- `backend/src/services/tool.service.ts:93` and `:193` (post-edit lines) — same signature widening at both dep sites
- `backend/tests/questioner.adapter.spec.ts` — `afterAll` also cleans `test-user-2` rows; 2 new tests appended: "filters by a modes set" and "applies the SQL limit preserving oldest-first order"
- `backend/tests/mcp.findPendingQuestions.test.ts` — `ToolDeps` added to type import; compile-time alignment test for the widened filters shape appended
- Plan file: Phase 2 `#### Automated Verification:` checkboxes all flipped to `[x]`

Phase 1 changes (prior session, also uncommitted in the worktree): `packages/protocol/src/shared/agent/tool.helpers.ts:465-475` (widened `findPendingQuestions` contract), `packages/protocol/src/questioner/questioner.tools.ts` (full rewrite: SELF_OWNED_MODES clamp, scopeRestriction, reportToolError, `as const`), `packages/protocol/src/questioner/tests/questioner.tools.spec.ts` (rewrite), `packages/protocol/package.json` (3.3.2), plus rebuilt `packages/protocol/dist/`.

## Learnings

- **Worktree env setup gap**: the worktree backend had no `.env.test`, so the adapter spec failed with `ECONNREFUSED` initially. Fixed by `ln -sf /Users/aposto/Projects/index/backend/.env.test .env.test` inside the worktree's `backend/` (same as `worktree:setup` does; symlink is gitignored). The test DB is the Neon dev instance from the main checkout's `.env.test`.
- The two `findPendingQuestions` sites in `tool.service.ts` are textually identical — a unique-match Edit fails; a `perl -0pi` global replace on the signature line was used instead.
- Backend resolves `@indexnetwork/protocol` to the workspace's built `dist/` — Phase 1's rebuilt dist already carries the widened `ToolDeps` typing, so the Phase 2 alignment test type-checks without rebuilding.
- `bun run lint` in backend reports 66 pre-existing warnings, 0 errors — warnings are not regressions.
- Phase 2's "manual" registration-scope check is actually grep-verifiable and **passes**: `createQuestionerTools` registered in `packages/protocol/src/shared/agent/tool.registry.ts:16,85`, absent from `tool.factory.ts`.

## Artifacts

- `.rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md` — updated (Phase 2 automated checkboxes checked)
- Code changes in worktree (uncommitted) — see Recent changes above
- `.rpiv/artifacts/handoffs/2026-06-12_00-33-22_pr-937-phase-2-backend-sql-filters.md` — this handoff

## Action Items & Next Steps

1. **Commit Phases 1-2** on the monorepo PR branch (`feat/agentvillage-brief-questions` in the worktree) — both phases are currently uncommitted working-tree changes. Plan says Phases 1-2 commit on the monorepo branch; Phases 3-5 commit inside the submodule.
2. **Run Phase 3**: `/skill:implement .rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md Phase 3` — digest marker + sanitizer in `packages/edge-city/agentvillage/skills/index-network/scripts/validate-digest-urls.ts` (submodule; commits go to Edge-City flow).
3. Then Phases 4 and 5 (also submodule). Phase 5's criteria re-run protocol/backend baselines.
4. Outstanding manual verifications (not blocking): Phase 1/2 end-to-end MCP check with a real network-scoped agent key (`scopeRestriction.isScoped: true`, no negotiation questions); Phase 4/5 staging brief run.
5. Cross-repo landing after all phases: commit in submodule → push branch to Edge-City/agentvillage → bump monorepo submodule pointer (see plan "Cross-repo landing" and `docs/guides/agentvillage-submodule.md`).

## Other Notes

- Test commands that verify Phase 2 (run from the worktree): `cd backend && bun run lint` (0 errors), `bun test tests/questioner.adapter.spec.ts` (11 pass), `bun test tests/mcp.findPendingQuestions.test.ts` (2 pass).
- Phase counts for closing blocks: 2 phases completed, 13 tests passing backend-side this session.
- The plan embeds complete code blocks for Phases 3-5 — the next session should follow them verbatim (they already incorporate the Step-5 review triage: URL stripping in `sanitizeQuestionPrompt`, strict `typeof` mapper guards).
- AgentVillage script tests are NOT exercised by monorepo CI — run locally: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/`.
