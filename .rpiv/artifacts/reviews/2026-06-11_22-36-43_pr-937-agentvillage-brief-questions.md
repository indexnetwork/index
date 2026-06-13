---
template_version: 2
date: 2026-06-11T22:36:43+0300
author: Yankı Ekin Yüksel
repository: index
branch: feat/agentvillage-brief-questions
commit: bf791443f4a17f14cd1dd780a22a2f92a12da37a
review_type: pr
scope: "indexnetwork/index PR #937 — feat(agentvillage): daily brief question injection via read_pending_questions MCP tool (d4bbe055..bf791443, submodule 2507e15d..78215c6c)"
scope_strategy: explicit-range
in_scope_files_count: 13
status: ready
severity: { critical: 1, important: 4, suggestion: 3 }
verification: { verified: 9, weakened: 2, falsified: 0 }
blockers_count: 5
tags: [code-review, protocol, mcp-tools, questioner, agentvillage, daily-brief]
---

# Code Review — PR #937: daily brief question injection via `read_pending_questions`

**Commit:** `bf791443` · **Status:** `ready` · **Findings:** 1🔴 · 4🟡 · 3🔵 · **Verification:** 9✓ / 2− / 0✗

## Top Blockers

1. **I2** — Tool-level MCP errors are classified as successful empty fetches; brief silently drops the question and diagnostics claim `questionSource: "mcp"`.
2. **S2** — `read_pending_questions` applies no sourceType/sourceId/indexScope clamp; network-scoped agent keys read all of the user's pending questions.
3. **I1** — The same pending question repeats in every daily brief for up to 7 days; the "Reply to me anytime!" affordance never answers the question record.

---

## Legend

```text
Severity    🔴 fix before merge   🟡 fix soon   🔵 nice to have   💭 discuss
ID prefix   I interaction   Q quality   S security   G gap
Verify      ✓ verified   − weakened (demoted)   ✗ falsified (dropped)
Annotate    [precedent-weighted]   [cascade: <kind>]   [subsumed-by <ID>]
```

Submodule paths (`skills/index-network/...`) are relative to `packages/edge-city/agentvillage/`.

---

## 🔴 Critical

### I2 🔴 Tool-level errors become silent "successful empty" question fetches `[precedent-weighted]`

**Where**
`skills/index-network/scripts/build-daily-brief-context.ts:722,728-729` · `packages/protocol/src/mcp/mcp.server.ts:141,685-686` · `packages/protocol/src/shared/agent/tool.helpers.ts:547`

**Code**
```ts
if (toolResp.error) return { questions: [], source: "unavailable" };
// ...
const parsed = JSON.parse(text) as { success?: boolean; data?: { questions?: unknown[] } };
if (!parsed.data?.questions || !Array.isArray(parsed.data.questions)) return { questions: [], source: "mcp" };
```

**Why**
Protocol tool errors (`error("Question lookup is not available.")`) are serialized as `{success:false,...}` and returned by the MCP server as *text content with an `isError` envelope flag* (`mcp.server.ts:685-686`) — never as a JSON-RPC `error`. The fetcher checks only `toolResp.error` (line 722) and never inspects `parsed.success` or the MCP `isError` flag, so every tool-level failure falls through line 729 and is classified `source: "mcp"` (success). The warning at line 796 fires only for `"unavailable"`, so the brief silently ships without a question while diagnostics report a successful question fetch. Severity bumped 🟡→🔴: two precedent commits on this file's MCP-parsing lineage each required follow-up fixes within 30 days (`fcc62ba`→`9c183f6` "parse digest MCP JSON results"; `b7a9061`→`2507e15`).

**Fix**
In `fetchPendingQuestionsFromMcp`, treat `parsed.success === false` (and/or `result.isError === true`) as `source: "unavailable"` so tool-level errors emit the warning and are distinguishable from a genuine empty result.

**Alt**
Check `result.isError` before parsing the text payload — it is the transport-level signal the MCP server already sets.

---

## 🟡 Important

### S2 🟡 `read_pending_questions` has no scope clamp — scoped agent keys read everything

**Where**
`packages/protocol/src/questioner/questioner.tools.ts:40` · `backend/src/controllers/mcp.controller.ts:633`

**Code**
```ts
const questions = await deps.findPendingQuestions(context.userId);
```

**Why**
The backend dep signature accepts `filters?: { sourceType?: string; sourceId?: string }` (`mcp.controller.ts:633`) but the tool passes none, and unlike other MCP tools it ignores `context.indexScope` (the MCP server clamps scoped keys' `indexScope` at `mcp.server.ts:248`). Negotiation-mode question prompts are derived from opportunity metadata; a network-scoped agent key (the exact deployment shape AgentVillage uses) can therefore read question prompts seeded by out-of-scope opportunities — the same cross-network leak class previously fixed in `getOpportunitiesForUser`. The questions table itself carries no network column (`database.schema.ts:525`), so filtering must happen at the read path.

**Fix**
Filter pending questions against the caller's `indexScope` (e.g. drop negotiation-mode questions whose source opportunity is not visible within scope), or restrict scoped keys to profile/intent-mode questions until a scoped read exists.

### I1 🟡 Rendered question repeats daily with no exit path from the brief channel `[cascade: stranded-state]`

**Where**
`skills/index-network/scripts/stage-daily-brief.ts:179` · `backend/src/adapters/questioner.adapter.ts:144,169` · `skills/index-network/tools.md:41-42`

**Code**
```ts
lines.push(`**One for you:** ${pendingQuestions[0].prompt}`);
```

**Why**
The pending query is oldest-first (`orderBy(questions.createdAt)`), the brief always renders `questions[0]`, and there is no AgentVillage-side tool to answer or dismiss a question — the only transitions are `POST /questions/:id/answer` and the dismiss endpoint (`question.controller.ts:125,142`), both web-app paths. The agent's conversation guidance routes replies into `create_intent`/`create_premise`, never into answering the question record. Result: the user sees the identical question in every brief and "Reply to me anytime!" does nothing to stop it. Weakened from 🔴: questions get a 7-day `expiresAt` (`questioner.adapter.ts:120`), so the loop is bounded — up to 7 consecutive identical briefs per question, then the next-oldest takes its place.

**Fix**
Track delivered question ids in `memory/heartbeat-state.json` (mirroring `readDeliveredIds`/`filterDedupedOpportunities`) and skip already-delivered questions, or rotate by excluding the previously rendered id.

### S1 🟡 Question prompt interpolated into digest markdown without escaping

**Where**
`skills/index-network/scripts/stage-daily-brief.ts:179` · `skills/index-network/scripts/validate-digest-urls.ts:115`

**Code**
```ts
lines.push(`**One for you:** ${pendingQuestions[0].prompt}`);
```

**Why**
Explicit-trust rendering (confidence 8/10): the prompt originates from LLM-generated question payloads stored in the DB (`mcp.controller.ts:638` — `prompt: row.payload.prompt`), which can be seeded by other users' content (negotiation mode). The only post-compose sanitizer, `sanitizeDigestUrls`, rewrites markdown *links* only — it does not escape markdown control characters, so prompt text can inject formatting, headers, or raw URLs into the Hermes/Telegram digest body that `send.md` requires be delivered verbatim.

**Fix**
Escape markdown control characters (or strip to plain text) when interpolating the prompt, and cap its length, before it enters the brief body.

### Q1 🟡 No delivered-question tracking `[subsumed-by I1]`

**Where**
`skills/index-network/scripts/build-daily-brief-context.ts:792` · `skills/index-network/scripts/stage-daily-brief.ts:184`

**Code**
```ts
questions = questionResult.questions;
// ...
return { body: lines.join("\n").replace(/\n{3,}/g, "\n\n"), opportunityIds };
```

**Why**
Opportunities pass through `readDeliveredIds` + `filterDedupedOpportunities` (`build-daily-brief-context.ts:772-774`) and `composeDailyBrief` returns `opportunityIds` for delivered-state persistence; the questions path has neither — rendered question ids are discarded. This is the mechanical constituent of I1, kept separate because the fix (return + persist `questionIds` alongside `opportunityIds`) is independently actionable.

**Fix**
Return rendered question ids from `composeDailyBrief` and persist them in heartbeat state, symmetrical with `opportunityIds`.

---

## 🔵 Suggestions

### Q2 🔵 `limit` validated but never pushed to the data layer

**Where**
`packages/protocol/src/questioner/questioner.tools.ts:40-42` · `backend/src/adapters/questioner.adapter.ts:166-169`

**Fix**
Extend the `findPendingQuestions` dep signature with a `limit` and apply a SQL `LIMIT`, instead of fetching all pending rows and slicing in the handler.

### Q3 🔵 `diagnostics.questionSource` and the unavailable-warning are write-only

**Where**
`skills/index-network/scripts/build-daily-brief-context.ts:818,796` · `skills/index-network/scripts/stage-daily-brief.ts:257`

**Fix**
Either surface `questionSource`/warnings in the staged Kanban task metadata for operator visibility, or document that the context JSON is the sole diagnostic artifact (it currently follows the pre-existing write-only `warnings` pattern).

### Q4 🔵 No `reportToolError` in the new handler

**Where**
`packages/protocol/src/questioner/questioner.tools.ts:40` · `packages/protocol/src/network/network.tools.ts:121`

**Fix**
Wrap the `findPendingQuestions` call and report failures via `deps.reportToolError?.(err, { operation, toolName, userId })` per the network-tools convention; the registry wrapper (`tool.registry.ts:47`) only converts throws to generic error JSON and logs locally.

---

## 💭 Discussion

### Q5 💭 Catch-all conflates malformed payload with transport failure

**Where**
`skills/index-network/scripts/build-daily-brief-context.ts:740`

**Why**
A `JSON.parse` failure of a well-delivered response and a network outage both map to `source: "unavailable"`. This matches the plan's fail-closed requirement, but if I2's fix adds `success:false` discrimination, consider whether parse failures deserve a distinct warning string for debuggability.

### Q6 💭 `title` and `mode` fetched but never rendered

**Where**
`skills/index-network/scripts/build-daily-brief-context.ts:734-736` · `skills/index-network/scripts/stage-daily-brief.ts:179`

**Why**
`BriefQuestion` carries `id`/`title`/`prompt`/`mode` but only `prompt` reaches the brief. Either intentional headroom (id is needed for the Q1 dedup fix; title/mode for future rendering) or dead weight — worth stating which.

### Q7 💭 Minor peer divergence: missing `as const` on the returned tool array

**Where**
`packages/protocol/src/questioner/questioner.tools.ts:48`

**Why**
`network.tools.ts:638` and `utility.tools.ts:301` return `as const`; the new file returns a plain array. Cosmetic — the registry path ignores return values — but cheap to align. (The peer trace-emitter expectation was checked and is inapplicable: non-graph read tools do not emit trace events.)

---

## Pattern Analysis

| Peer                                            | Mirrored | Missing | Diverged | Intentional |
| ----------------------------------------------- | -------: | ------: | -------: | ----------: |
| `packages/protocol/src/network/network.tools.ts` |        7 |       6 |        2 |           0 |

**Missing/Diverged rows drive:** S2, Q4, Q7

**Key divergences from peer**
- No `scopeRestriction` reporting or index-scope awareness in the success payload (→ S2).
- No `deps.reportToolError` on failure paths (→ Q4).
- No `as const` on the returned tool array; trace-emitter rows judged inapplicable for a non-graph read tool (→ Q7).

---

## Impact

| Consumer | Change | Findings |
| --- | --- | --- |
| `packages/protocol/src/mcp/mcp.server.ts:459,611` | registry gains `read_pending_questions`, exposed to every MCP principal | S2 |
| `backend/src/services/tool.service.ts:112,202` | direct tool invocation + cached tool listing gain the new tool | S2 |
| `skills/edge-esmeralda/prompts/prepare.md:25` (02:00 cron) | staged brief now embeds a question section | I1, S1, Q1 |
| `skills/index-network/scripts/send-daily-brief.ts:159` (08:00 cron) | delivers question text verbatim inside `finalBrief` | S1 |
| `packages/protocol/src/shared/agent/tool.factory.ts:224-251` | chat tools unchanged — questioner tool correctly absent (X1 check passed) | — |

---

## Precedents

| Commit | Subject | Follow-ups |
| --- | --- | --- |
| `fcc62ba` | feat: add daily morning brief context builder | 6 in 30d (revert `7f98291`, DST `5f93fb8`, determinism `0aeb75e`/`934a5d3`, MCP parsing `9c183f6`, integration path `2507e15`) |
| `b7a9061` | fix(digest): fetch opportunities from Index HTTP API | 1 in 30d (`2507e15` — switched to MCP JSON-RPC) |
| `631f50de` | feat(protocol): add digest opportunity markers | 5 in 30d (revert + 4 output-shape/self-match fixes) |
| `420c5602` | refactor(auth): share API-key principal resolution | 2 in 30d (hardening `9b81f1b1`, validation doc) |
| `ded6332` / `78215c6` | this PR's submodule commits | none yet |

**Recurring lessons (most → least frequent)**

1. Daily-brief MCP integrations repeatedly break at parsing/boundary seams — JSON-RPC vs tool-level error shapes, deterministic prepare/send separation, env/API-key identity (directly motivated the I2 severity bump).
2. Protocol tool output consumed by digests needs strict shape/content tests; small output changes propagate straight into user-facing briefs.
3. Digest MCP calls are identity-critical: wrong `INDEX_API_KEY` previously delivered another user's content — scope clamps matter (S2).
4. Registration scope needs explicit review: MCP registry yes, chat factory no — verified clean here (X1).

---

## Recommendation

| # | ID | Action | Alt / Note |
| - | -- | ------ | ---------- |
| 1 | I2 | Treat `parsed.success === false` / MCP `isError` as `source: "unavailable"` in `fetchPendingQuestionsFromMcp` so tool errors warn instead of masquerading as empty success. | Check `result.isError` before parsing text |
| 2 | S2 | Clamp `read_pending_questions` to the caller's `indexScope` (filter negotiation-mode questions by visible opportunities) before AgentVillage's network-scoped keys consume it in production. | Restrict scoped keys to profile/intent-mode questions |
| 3 | I1 + Q1 | Persist rendered question ids in heartbeat state and skip delivered questions, symmetrical with `opportunityIds` dedup. | Rotate by excluding the previously rendered id |
| 4 | S1 | Escape/strip markdown in the interpolated prompt and cap its length before composing the brief. | Extend `sanitizeDigestUrls` to escape non-link markdown |
| 5 | Q2/Q4 | Push `limit` into the adapter query; add `reportToolError` on the lookup failure path. | — |

## Reconciliation Notes

- InScopeFiles pre-filter: 0 findings dropped (explicit-range strategy, `InScopeFiles = ChangedFiles`).
- I2 bumped 🟡→🔴 `[precedent-weighted]` (≥2 precedent commits on the same file's MCP-parsing flow with follow-up fixes within 30 days).
- I1 demoted 🔴→🟡 by verification (7-day `expiresAt` at `questioner.adapter.ts:120` and dismiss transition at `question.controller.ts:142` bound the loop).
- Q7 narrowed by verification (trace-emitter peer expectation inapplicable to non-graph tools per `utility.tools.ts:301`).
- CVE lens skipped: manifest change is a version-field-only bump with zero dependency deltas.
- Dependencies context: backend consumes protocol via `workspace:*` (`backend/package.json:51`), so the new tool ships with the next backend deploy without an npm publish gate; `backend/bun.lock`'s stale registry pin (`0.4.0-rc.13.1`) is pre-existing, not introduced here.
