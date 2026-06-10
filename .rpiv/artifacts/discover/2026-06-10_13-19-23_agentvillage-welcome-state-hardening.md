---
date: 2026-06-10T13:19:23+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "AgentVillage welcome state hardening"
tags: [intent, frd, agentvillage, welcome-gate, installer]
status: ready
last_updated: 2026-06-10T13:19:23+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: AgentVillage welcome state hardening

## Summary
Returning AgentVillage residents who have already received the Edge Esmeralda welcome should not receive it again after normal updates, gateway restarts, daily/idle session resets, or reinstalls that do not explicitly wipe user state. The fix should harden the local welcome marker path and update/install behavior so the existing `memory/welcome-state.json` invariant remains reliable.

## Problem & Intent
"Returning residents" are the people who hit this bug: "I have been sent welcome message previously, and we even made a patch for it, yet I still get the welcome message from time to time (probably after updates)."

The problem is not that the first-install welcome exists. The problem is that a resident who has already been welcomed can later see the same onboarding-style welcome again, which makes the agent feel reset or forgetful after updates.

## Goals
- Returning residents should not see the AgentVillage welcome again after routine package updates, hosted refreshes, gateway restarts, daily/idle session resets, or reinstall/update runs that do not pass `--wipe-user`.
- Preserve the current local marker invariant: `memory/welcome-state.json` with `welcomeSent: true` is the source of truth for suppressing the welcome.
- Keep AgentVillage welcome suppression independent from Index Network profile onboarding state.
- Add automated coverage for the normal-update preservation path so the bug does not regress.

## Non-Goals
- Do not prevent the welcome from reappearing after an explicit `--wipe-user` reset; that behavior remains intentional.
- Do not couple the welcome gate to server-side Index `onboardingComplete` or profile setup.
- Do not attempt broad recovery for residents whose welcome marker was already lost before this patch.
- Do not solve unrelated onboarding, profile, cron, or morning-brief behavior unless it directly deletes or bypasses the welcome marker during normal updates.

## Functional Requirements
1. The system SHALL preserve an existing `memory/welcome-state.json` marker during normal install/update flows that do not pass `--wipe-user`.
2. The system SHALL keep `welcomeSent: true` as the condition that suppresses the welcome for returning residents.
3. The system SHALL continue to reset the welcome gate when `install/install.ts --wipe-user` or `install/reset.ts --wipe-user` intentionally removes local user memory.
4. The system SHALL not use Index Network `onboardingComplete` to decide whether to show the AgentVillage welcome.
5. The system SHALL include an automated test or scripted simulation proving that a normal update preserves the marker and therefore does not create a first-install welcome condition.
6. The system SHALL verify the hosted update/reinstall path, if separate from `install/install.ts`, invokes the installer in a non-wiping mode for routine updates.

## Non-Functional Requirements
- **Performance**: No specific latency requirement; the fix must not add network calls to the first-message welcome gate.
- **Security**: Do not move the welcome decision into shared/server state or expose resident-local memory contents. Continue treating the marker as local state.
- **UX / Accessibility**: Returning residents should experience continuity: a normal message should receive a direct answer, not the full welcome block.
- **Reliability**: Normal updates must be idempotent with respect to welcome state. Session resets, gateway restarts, and content-only prompt updates must not erase or bypass the marker.

## Constraints & Assumptions
- The current canonical welcome gate lives in `packages/edge-city/agentvillage/workspace/AGENTS.md` and reads/writes `memory/welcome-state.json` before sending the welcome.
- The installer resolves the runtime workspace through `HERMES_HOME` or `~/.hermes`; update paths that change this root can bypass the prior marker and must be checked.
- `--wipe-user` remains the explicit operator action that removes local markers and allows first-install gates to run again.
- The FRD is forward-looking: it prevents future normal updates from causing repeats, but does not require reconstructing missing markers for already-affected residents.

## Acceptance Criteria
- [ ] Running `cd packages/edge-city/agentvillage && bun test install/tests/welcome_state.test.ts` exits 0 and includes a case where an existing `memory/welcome-state.json` survives a normal install/update without `--wipe-user`.
- [ ] Running `cd packages/edge-city/agentvillage && bun test install/tests/welcome_state.test.ts` exits 0 and includes a case where `--wipe-user` intentionally removes or resets the welcome marker.
- [ ] A reviewer can inspect the normal update/install path and see that it does not delete `memory/welcome-state.json` unless `--wipe-user` is set.
- [ ] A reviewer can inspect the welcome instructions and see that `onboardingComplete` is not used as the welcome suppression condition.
- [ ] In a simulated returning-resident workspace containing `{ "welcomeSent": true }`, a normal package update leaves that marker in place; the next private DM should answer the user's message directly rather than emitting the welcome block.

## Recommended Approach
Harden the AgentVillage installer/update seam around the existing local `memory/welcome-state.json` marker, with targeted automated tests under `packages/edge-city/agentvillage/install/tests/`. Keep the prompt-level welcome gate as the user-facing instruction, but make state preservation deterministic in code and verify any hosted update path uses the non-wiping install mode for routine updates.

## Decisions

### Affected user framing
**Question**: For this recurring welcome-message bug, what problem are you solving and who hits it?
**Recommended**: n/a — intent question
**Chosen**: Returning residents
**Rationale**: Developer framed the issue around people who have already been welcomed but still receive the welcome again later.

### Keep local welcome marker
**Question**: From the probe I inferred the current intended behavior: returning residents should be suppressed by `memory/welcome-state.json`, where `welcomeSent: true` skips the welcome (`packages/edge-city/agentvillage/workspace/AGENTS.md:35-38`). Keep this invariant, or change the durable source?
**Recommended**: Keep local marker
**Chosen**: Keep local marker
**Rationale**: evidence: `packages/edge-city/agentvillage/workspace/AGENTS.md:35-38` + confirmed; the bug is update/reset bypass or deletion, not the marker concept.

### Keep Index onboarding separate
**Question**: From the probe I inferred that Index `onboardingComplete` should stay separate and must not decide whether the welcome appears (`packages/edge-city/agentvillage/workspace/AGENTS.md:40`, `README.md:253-255`). Keep that separation?
**Recommended**: Keep separate
**Chosen**: Keep separate
**Rationale**: evidence: `packages/edge-city/agentvillage/workspace/AGENTS.md:40`, `packages/edge-city/agentvillage/README.md:253-255` + confirmed; welcome suppression and profile setup are different gates.

### Preserve explicit wipe reset
**Question**: From the probe I inferred `--wipe-user` intentionally resets first-install gates by deleting `memory/welcome-state.json` (`install/install.ts:124`, `README.md:271-274`). Should this remain intentional and out of scope for the bug?
**Recommended**: Keep reset
**Chosen**: Keep reset
**Rationale**: evidence: `packages/edge-city/agentvillage/install/install.ts:124`, `packages/edge-city/agentvillage/README.md:271-274` + confirmed; explicit wipe is a deliberate reset path, not the reported normal-update bug.

### Normal-update guarantee
**Question**: For returning residents, what should the fix guarantee?
**Recommended**: Normal updates only — guarantee the welcome never repeats after routine package updates, gateway restarts, daily/idle session resets, or reinstall without `--wipe-user`; explicit wipe remains allowed.
**Chosen**: Normal updates only
**Rationale**: Matches the reported recurrence "probably after updates" while preserving the documented reset mechanism.

### Implementation seam
**Question**: Which implementation shape should the later research/design optimize for: deterministic installer/state hardening or minimal prompt-only change?
**Recommended**: State hardening — optimizes deterministic suppression across normal updates by preserving/migrating `memory/welcome-state.json` in install/update seams (`install/install.ts:119-129`, `paths.ts:4-11`), costs code/tests beyond markdown.
**Chosen**: State hardening
**Rationale**: The welcome rule already exists in markdown; repeated welcomes after updates require deterministic state preservation and regression coverage.

### Proof of fix
**Question**: What proof should the FRD require before this bug is considered fixed?
**Recommended**: Automated update test — require a test or scripted simulation showing reinstall/update without `--wipe-user` preserves `memory/welcome-state.json` and does not trigger a repeated welcome.
**Chosen**: Automated update test
**Rationale**: A prior patch did not eliminate recurrence; automated coverage is needed to catch future update regressions.

### Existing affected residents
**Question**: Should the fix include recovery for residents whose local welcome marker was already lost before this patch?
**Recommended**: Forward-only — prevent future normal updates from causing repeats; if a marker is already gone, the next private DM may still behave like first install unless an operator restores state.
**Chosen**: Forward-only
**Rationale**: Keeps the fix focused on preventing recurrence from normal updates without adding risky inference from unrelated local files or logs.

## Open Questions
- None.

## Suggested Follow-ups
- Hosted/control-plane update behavior may be a separate seam to inspect: the README notes post-merge sync calls each sidecar's `/update` endpoint and reruns the installer (`packages/edge-city/agentvillage/README.md:343`). Research should verify whether that path can accidentally pass `--wipe-user` or change `HERMES_HOME`.
- Documentation still contains some OpenClaw-era path wording while the installer code now resolves Hermes paths via `HERMES_HOME`/`~/.hermes` (`packages/edge-city/agentvillage/README.md:245`, `packages/edge-city/agentvillage/install/paths.ts:4-11`). If this confuses operators about where the marker lives, update docs as a separate cleanup.

## References
- User-provided bug transcript and context: `packages/edge-city/agentvillage/`
- `packages/edge-city/agentvillage/workspace/AGENTS.md`
- `packages/edge-city/agentvillage/install/install.ts`
- `packages/edge-city/agentvillage/install/reset.ts`
- `packages/edge-city/agentvillage/install/paths.ts`
- `packages/edge-city/agentvillage/README.md`
