---
template_version: 1
date: 2026-06-12T00:35:53+0300
author: Yankı Ekin Yüksel
commit: 1d1c539839
branch: dev
repository: index
topic: "Validation of AgentVillage PR #84 review fixes — daily-brief question delivery loop"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-11_23-54-57_agentvillage-pr84-review-fixes.md"
tags: [validation, agentvillage, daily-brief, mcp, digest, code-review-fixes]
last_updated: 2026-06-12T00:35:53+0300
---

## Validation Report: AgentVillage PR #84 review fixes — daily-brief question delivery loop

### Implementation Status

- ✓ Phase 1: Fetcher hardening (Q2, Q1, S1) — Fully implemented
- ✓ Phase 2: Cooldown filter + end-to-end wiring tests (I1 read-side, Q4) — Fully implemented
- ✓ Phase 3: Question marker utilities (I1 foundation) — Fully implemented
- ✓ Phase 4: Gated postscript + marker emission (I2, I1 stage-side) — Fully implemented
- ✓ Phase 5: Send-pass question bookkeeping (I1) — Fully implemented
- ✓ Phase 6: Contract documentation (I1/I2) — Fully implemented

B1 prerequisite satisfied: submodule `packages/edge-city/agentvillage` is checked out on `feat/agentvillage-brief-questions` at PR tip `78215c6`; the implementation lives as uncommitted working-tree changes across exactly the 10 files the plan touches (559 insertions, 34 deletions).

### Automated Verification Results

- ✓ Full digest-script suite: `bun test skills/index-network/scripts/tests/` — 61 pass, 0 fail, 167 expect() calls across 4 files (covers all per-phase targeted test commands)
- ✓ P1 `success:false` guard: `grep -n "success === false" …/build-daily-brief-context.ts` — match at line 807
- ✓ P1 reason threading (template literal): `grep -n 'questions MCP unavailable: ' …/build-daily-brief-context.ts` — match at line 879
- ✓ P1 sanitizer wired: `grep -c "sanitizeQuestionPrompt"` — 2 (definition + call)
- ✓ P2 Q4 closed: `grep -c 'questionSource).toBe("mcp")'` — 3 (≥ 2 required)
- ✓ P2 absence flow asserted: `grep -c 'questions).toEqual(\[\])'` — 4 (≥ 2 required)
- ✓ P2 cooldown constant exported: `export const QUESTION_COOLDOWN_DAYS = 3` at line 140
- ✓ P2 cooldown wired: `filterCooldownQuestions(questionResult.questions, …)` at line 876
- ✓ P3 extractor exported: `export function extractDigestQuestionIds` at validate-digest-urls.ts:110
- ✓ P3 shared strip regex: `digest-(?:opportunity|question)` at validate-digest-urls.ts:51
- ✓ P3 marker-leak CLI guard: `echo '<!-- digest-question:id=q-1 -->hi' | bun …/validate-digest-urls.ts --strip-digest-metadata` — prints `hi`, no marker text
- ✓ P4 marker emitted: `digest-question:id=` at stage-daily-brief.ts:187
- ✓ P4 gate present: `hasVerifiedContent ? pendingQuestions` at stage-daily-brief.ts:181
- ✓ P4 fallback regression pinned: "omits the question postscript" test at stage-daily-brief.test.ts:293
- ✓ P5 extractor wired: `grep -c "extractDigestQuestionIds" …/send-daily-brief.ts` — 2 (import + call)
- ✓ P5 cooldown constant shared: `QUESTION_COOLDOWN_DAYS` imported from `./build-daily-brief-context` at send-daily-brief.ts:16, not duplicated
- ✓ P5 sibling-key preservation pinned: `signalElicitation` asserted at send-daily-brief.test.ts:98, 127
- ✓ P6 postscript sanctioned: "One for you" in prepare.md (lines 17, 41)
- ✓ P6 cooldown documented in both contracts: `questionDelivery` present in prepare.md and send.md
- ✓ P6 send JSON shape updated: `questionIds` ×2 in send.md (shape line 24 + step-4 rule line 27)
- ✓ P6 no question-confirmation tool invented: `confirm_question_delivery` grep returns nothing (exit 1)
- ✓ No regressions detected — all 4 pre-existing test files pass, including the unchanged "questions absent / empty array" compose tests

### Code Review Findings

#### Matches Plan:

- build-daily-brief-context.ts:134-138 — `QUESTION_FETCH_LIMIT = 5`, `QUESTION_PROMPT_MAX_LENGTH = 300`, `QUESTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/` (Step-5 triage guard included)
- build-daily-brief-context.ts:754-761 — `sanitizeQuestionPrompt` drops HTML-comment sequences, collapses whitespace, caps at 300 chars with `…`
- build-daily-brief-context.ts:773-826 — `fetchPendingQuestionsFromMcp` never throws; `success:false` → `unavailable` with `read_pending_questions: <detail>` reason; JSON-RPC errors threaded as `MCP initialize: …` / `MCP read_pending_questions: …`; ids filtered by `QUESTION_ID_PATTERN` and non-empty prompt (lines 812-820)
- build-daily-brief-context.ts:416-462 — `daysBetween`, `readQuestionDelivery` (defensive, tolerates missing/malformed state), exported `filterCooldownQuestions` (3-day boundary re-offers, future-dated dropped via negative day counts)
- build-daily-brief-context.ts:873-879 — fetch → readQuestionDelivery → filterCooldownQuestions wiring with `reason ?? "unknown"` warning
- validate-digest-urls.ts:42, 51, 110-131 — `DIGEST_QUESTION_MARKER`, shared `DIGEST_METADATA_MARKER`, `extractDigestQuestionIds` (first-seen unique order), generalized `stripDigestMetadata`
- stage-daily-brief.ts:87, 173-192 — `composeDailyBrief` returns `questionIds`; postscript gated on `hasVerifiedContent`, placed after sign-off with `---` separator, marker emitted, "Reply to me anytime!" line
- stage-daily-brief.ts:258-297, 308 — `stageDailyBrief` threads `questionIds` through return type, `state.prepared`, and `main()` diagnostics
- send-daily-brief.ts:16-17, 22, 58-66, 161-192 — shared-constant import, `SendResult.questionIds`, `withinQuestionCooldown` (future-dated counts as within cooldown), bookkeeping inserted between deliveredToday update and the single `writeJson`, marker-stripped `finalBrief`
- Tests — all plan-specified tests present and passing: fetcher failure-shape ×3 (P1), `filterCooldownQuestions` unit + 3 e2e `buildDailyBriefContext` tests + absence-flow assertions on the opportunitySource test (P2), marker extraction/strip/CLI ×3 (P3), gated-render + pointer-only-omission (P4), send bookkeeping with pruning and sibling-key preservation (P5)

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan, including both Step-5 triage additions (QUESTION_ID_PATTERN guard, absence-flow e2e assertions).

#### Pattern Conformance:

- ✓ Marker extraction, defensive state reads, send-pass single-write state mutation, and test env-save/restore + `globalThis.fetch` mock patterns all mirror the established opportunity-loop conventions (verified by codebase-pattern-finder against `fetchOpportunitiesFromMcp`, `extractDigestOpportunityIds`, `readDeliveredIds`, `deliveredToday` bookkeeping)
- Minor observation: `fetchPendingQuestionsFromMcp` catches internally and returns `{ source: "unavailable", reason }` whereas `fetchOpportunitiesFromMcp` throws and lets the caller catch — acceptable variation, not a deviation: the plan's code fence explicitly specifies "NEVER throws" with reason threading (that contract is the point of finding Q1)

#### Potential Issues:

- send-daily-brief.ts:176-185 — the prune loop's date regex (`/^\d{4}-\d{2}-\d{2}$/`) accepts calendar-invalid strings like `2026-99-99`, which `Date.UTC` normalizes to a far-future date that then counts as within-cooldown forever; keys are also not re-validated against `QUESTION_ID_PATTERN` on the send side. Matches the plan's specified code exactly, and only script-generated dates are ever written — hand-corrupted state is the only path in. Non-blocking; defense-in-depth hardening candidate for a follow-up.

### Manual Testing Required:

1. Fetcher diagnostics (P1):
   - [ ] On a dev box with a bad `INDEX_API_KEY`, `memory/daily-brief-context.json` diagnostics carry `questions MCP unavailable: <detail>` (not the bare string)
2. Cooldown filtering (P2):
   - [ ] With a hand-seeded `questionDelivery` entry dated yesterday in `memory/heartbeat-state.json`, a dev-box run of `bun skills/index-network/scripts/build-daily-brief-context.ts --state-file memory/heartbeat-state.json` omits that id from `questions[]` while `diagnostics.questionSource` stays `"mcp"`
3. Staged draft rendering (P4):
   - [ ] With verified content and a pending question, the staged Kanban draft body shows the `---` P.S. with the `digest-question` marker after the sign-off
   - [ ] With nothing verified, the staged draft is the pointer-only fallback with no question section
4. Send-pass bookkeeping (P5):
   - [ ] After approving and sending a digest containing a question, `memory/heartbeat-state.json` gains `questionDelivery` with today's date for that question id, and the delivered Telegram message contains no marker text
5. Contract coherence (P6):
   - [ ] Read both prompts end-to-end: the postscript rule does not contradict any existing hard rule (esp. "Never expose internal IDs / marker comments" — markers are stripped pre-delivery, and the rules now say so)

### Recommendations:

- Ready to commit — implementation is complete and validated. Note the changes live as uncommitted working-tree modifications inside the `packages/edge-city/agentvillage` submodule; commit there on `feat/agentvillage-brief-questions` (the PR branch), not in the index superproject.
- Optional follow-up (non-blocking): tighten the send-side prune to validate calendar-real dates and marker-safe keys (see Potential Issues).
- Cross-repo follow-up already tracked by the design: Index-side `confirm_question_delivery` MCP tool is explicitly out of scope.
