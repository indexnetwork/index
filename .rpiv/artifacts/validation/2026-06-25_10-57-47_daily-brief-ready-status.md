---
template_version: 1
date: 2026-06-25T10:57:47+0300
author: Yanek Yuk
commit: 8304e875a0
branch: dev
repository: index
topic: "Validation of daily-brief-ready-status"
status: ready
verdict: fail
parent: ".rpiv/artifacts/plans/2026-06-25_10-24-01_daily-brief-ready-status.md"
tags: [validation, agentvillage, daily-brief, kanban]
last_updated: 2026-06-25T10:57:47+0300
---

## Validation Report: daily-brief-ready-status

### Implementation Status

- ⚠️ Phase 1: Runtime staging behavior — Partially implemented (existing protected-card idempotency and send gate are present, but new cards are still blocked instead of promoted to send-ready)
- ✗ Phase 2: Operator-facing guidance — Not implemented

### Automated Verification Results

- ✓ Targeted staging tests: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts` — 11 pass, 0 fail; however, these are still the old tests and one asserts `kanban block`.
- ✓ Send gate regression: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/send-daily-brief.test.ts` — 10 pass, 0 fail; blocked cards remain silent and ready cards send.
- ✗ No post-create block call remains: `rg -n "kanban.*block|create/block" packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts` — failed; matches remain at lines 8 and 331.
- ✗ Staging script promotes and verifies sendable status: `rg -n "kanban.*promote|ready-for-send|not promoted to a sendable status|promotedStatus" packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts` — failed; no matches.
- ✗ Stale blocked-review instructions are gone: `rg -n "held for review|blocks it for review|Always stage the brief \*\*blocked\*\*|Never assign it or move it to Ready|human has approved by unblocking|stages each brief as a \*\*blocked\*\*|operator approves it by unblocking" packages/edge-city/agentvillage/skills/edge-esmeralda/prompts packages/edge-city/agentvillage/README.md` — failed; stale prompt/README matches remain.
- ✓ Runtime staging and send regressions combined: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts skills/index-network/scripts/tests/send-daily-brief.test.ts` — 21 pass, 0 fail; still validating legacy behavior.

### Code Review Findings

#### Matches Plan:

- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:28` — `PROTECTED_DIGEST_STATUSES` includes `blocked`, `ready`, `todo`, and `done`, preserving old staged cards on rerun.
- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:256` and `:288` — prepare and stage paths both skip an existing protected card before creating or mutating a new card.
- `packages/edge-city/agentvillage/skills/index-network/scripts/send-daily-brief.ts:209` — send gate remains limited to `ready`/`todo`; `blocked` continues to return silent `not-approved:<status>`.
- `packages/edge-city/agentvillage/skills/index-network/scripts/tests/send-daily-brief.test.ts:55` and `:68` — tests still cover blocked silence and ready-card delivery.

#### Deviations from Plan:

- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:331` — newly-created daily brief cards are still followed by `kanban block`, directly contradicting the planned `kanban promote` + `kanban show` sendable-status verification.
- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:8` — header comment still describes `Kanban create/block` instead of send-ready promotion.
- `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief.test.ts:121` and `:162` — primary staging test still names and asserts the blocked-review flow instead of promote/show/no-block assertions.
- `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts:27` and `:59` — idempotency test comment/assertions mention create/block only; they do not assert no `promote` mutation for protected cards.
- `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/prepare.md:111` and `:124` — prepare prompt still says the script blocks for review and must always stage **blocked**.
- `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/send.md:35` — send prompt still frames `ready`/`todo` as human-unblock approval rather than the automatic send gate for newly-created cards.
- `packages/edge-city/agentvillage/README.md:12` and `:252` — README still documents held-for-review/manual-unblock as the normal daily brief workflow.

#### Pattern Conformance:

- ✓ `stage-daily-brief.ts` and `send-daily-brief.ts` use the established injected `HermesRunner` pattern for testable Hermes command execution.
- ✓ Idempotency tests follow the existing pattern of recording Hermes calls and asserting no status mutation for protected cards.
- Minor observation: stage tests often return `{}` for unhandled Hermes calls, while send tests generally fail fast on unexpected calls; stricter stage mocks would make the planned promote/show sequence easier to validate. This is an acceptable testing improvement, not the cause of the failure.

#### Potential Issues:

- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:168` — existing-card protection depends on `memory/heartbeat-state.json` containing today’s `prepared.taskId`; if state is missing but the Kanban idempotency key returns an existing card, the current implementation would still apply its post-create mutation to the returned task.

### Manual Testing Required:

1. Phase 1 runtime behavior:
   - [ ] Update and review `stage-daily-brief.ts` to confirm it creates the Kanban card, extracts its id, promotes it to ready, verifies shown status is `ready`/`todo`, records `state.prepared`, and returns the same `StageResult` shape.
   - [ ] Update and review idempotency tests to confirm existing `blocked`, `ready`, `todo`, and `done` cards remain protected and receive no `create`, `promote`, or `block` calls.
2. Phase 2 operator guidance:
   - [ ] Update and review `prepare.md` to confirm exactly one context build, one staging script call, no manual Kanban operations, no delivery, no durable draft body, and no blocked-for-review instruction.
   - [ ] Update and review `send.md` to confirm legacy blocked cards remain silent while `ready`/`todo` cards remain deliverable.
   - [ ] Update and review `README.md` to confirm it documents auto-ready staging without implying the end user can change cron schedules from chat.

### Recommendations:

- Implement the Phase 1 runtime change: replace the post-create `kanban block` with `kanban promote`, then `kanban show`, and throw unless the resulting status is `ready` or `todo`.
- Update staging and idempotency tests to assert `promote`, `show`, no `block`, and no status mutation for protected existing cards.
- Update `prepare.md`, `send.md`, and `README.md` to remove blocked-for-review/manual-unblock as the normal new-card workflow while preserving legacy blocked-card silence.
- Re-run `/skill:validate .rpiv/artifacts/plans/2026-06-25_10-24-01_daily-brief-ready-status.md` after fixing these gaps.
