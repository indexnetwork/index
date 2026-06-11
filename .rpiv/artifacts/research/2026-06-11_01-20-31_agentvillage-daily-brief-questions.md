---
date: 2026-06-11T01:20:31+0300
author: Yankı Ekin Yüksel
commit: c5c2c78664
branch: feat/agentvillage-brief-questions
repository: index
topic: "AgentVillage Daily Brief — Pending Questions via MCP Tool"
tags: [research, codebase, agentvillage, daily-brief, questioner, mcp-tool, heartbeat, edge-esmeralda]
status: ready
last_updated: 2026-06-11T01:20:31+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: AgentVillage Daily Brief — Pending Questions via MCP Tool

## Research Question
Add a mechanism for AgentVillage users to receive contextual questions alongside their daily brief, to increase interactivity and opportunity discovery during Edge Esmeralda. Architecture decision: expose backend QuestionerAgent-generated questions via a new `read_pending_questions` MCP tool, pulled by the prepare cron and included in the staged brief body.

## Summary
The daily brief pipeline has two cron jobs (`prepare.md` at 02:00, `send.md` at 08:00) managed by `install_index.ts`. The prepare step builds a deterministic context via `build-daily-brief-context.ts`, composes a Kanban body via `composeDailyBrief()`, stages it under an approval gate, and `send.md` delivers verbatim. Questions should be injected by the prepare step — not send — by calling a new `read_pending_questions` MCP tool via JSON-RPC (same pattern as opportunity fetching), including them in the `DailyBriefContext`, and composing a question section in the Kanban body. The backend already generates questions via `QuestionerAgent`/`QuestionerQueue` and the DB query exists (`QuestionerAdapter.findPending()`); `findPendingQuestions` is already wired into `ToolDeps`. A new `questioner.tools.ts` is the correct home for the tool (not `opportunity.tools.ts` — questions span all modes: profile, intent, negotiation, discovery). `send.md` and `send-daily-brief.ts` require no changes.

## Detailed Findings

### Cron vs Heartbeat architecture
- `install_index.ts:6-10` — only two crons are installed: `Edge — digest prepare` (02:00) and `Edge — daily digest` (08:00)
- `install_index.ts:143-162` — `DIGEST_CRON_SPECS`: prepare uses `prepare.md` (no deliver), send uses `send.md` (deliver telegram)
- `README.md:279-281` — digest runs as cron; heartbeat tasks (accepted-opportunities, signal-elicitation, signal-freshness) run on ~30min OpenClaw tick
- `README.md:294` — references `workspace/HEARTBEAT.md` for cross-backend heartbeat rules, but this file **does not exist** in the current repo — not a blocker for this feature
- `install_index.ts:223-287` — `reconcileDigestCronJobs()` reads prompt files from `skills/edge-esmeralda/prompts/` and syncs their bodies to all existing Hermes cron jobs via `cronEditPromptArgs`; must be run per-resident after any change to `prepare.md` or `send.md`

### Daily brief prepare pipeline
- `skills/edge-esmeralda/prompts/prepare.md:1` — compose step; runs `stage-daily-brief.ts` once, then ends silently
- `prepare.md:19` — `bun skills/index-network/scripts/stage-daily-brief.ts --state-file memory/heartbeat-state.json --context-out memory/daily-brief-context.json`
- `prepare.md:21-23` — script handles all MCP calls deterministically via Index JSON-RPC using `INDEX_API_KEY`; no direct MCP tool calls from the agent
- `skills/index-network/scripts/build-daily-brief-context.ts` — builds `DailyBriefContext` from admin announcements, EdgeOS events, Index MCP opportunities; **new questions fetch goes here**
- `skills/index-network/scripts/stage-daily-brief.ts` — imports `composeDailyBrief(context)`, then stages to Kanban blocked; **`composeDailyBrief` needs a questions section**
- `stage-daily-brief.ts:243` — `stateFile = options.stateFile ?? "memory/heartbeat-state.json"` — heartbeat-state.json is read here for `prepared` key

### Daily brief send pipeline
- `skills/edge-esmeralda/prompts/send.md:5` — hard rule: "Your final assistant reply must be `finalBrief` verbatim and complete — nothing before it, nothing after it"
- `send.md` — also hard rule: "Do not call `list_opportunities` or any other MCP tool — the staging script handles all MCP calls deterministically"
- **Send.md requires no changes** — questions are baked into `finalBrief` by the prepare step; send delivers verbatim

### Backend question infrastructure
- `backend/src/adapters/questioner.adapter.ts:100-170` — `QuestionerAdapter.findPending(userId, filters?)` queries `questions` table: status=pending, actor match (jsonb @>), TTL-gated, orderedBy createdAt
- `questioner.adapter.ts:88-98` — `AdapterQuestionFilters`: mode, sourceType, sourceId, conversationId, noConversation
- `packages/protocol/src/shared/schemas/pending-question.schema.ts` — `PendingQuestionSummary`: id, title, prompt, options (label+description), multiSelect, mode, sourceType, sourceId, createdAt, expiresAt
- `backend/src/queues/questioner.queue.ts` — generates questions via `QuestionerAgent`; triggered by discovery/intent/profile/negotiation events
- `backend/src/events/question.event.ts` — `QuestionEvents.onAnswered` dispatches to mode-specific handlers (profile→premise, intent→refinement, negotiation→metadata, discovery→no-op)

### Protocol tool infrastructure
- `packages/protocol/src/shared/agent/tool.helpers.ts:463` — `findPendingQuestions?` already in `ToolDeps`; signature: `(userId, filters?) => Promise<PendingQuestionSummary[]>`
- `tool.helpers.ts:224` — `questionerDatabase?: QuestionerDatabase` also in `ResolvedToolContext` (separate from findPendingQuestions — used for write ops)
- `packages/protocol/src/shared/agent/tool.factory.ts:227-234` — all tool groups called here: `createUtilityTools`, `createContactTools`, `createAgentTools`, `createNegotiationTools`, `createPremiseTools`; **new `createQuestionerTools` call goes here**
- `tool.factory.ts:18` — import pattern: `import { createPremiseTools } from "../../premise/premise.tools.js";`

### Signal-elicitation precedent (template pattern)
- `skills/index-network/heartbeat.md:32-50` — added by commit `f5ed406` (2026-06-08); 4-step pattern: (1) gate on opps, (2) gate on dedup/suppression, (3) read_intents+read_premises → build question, (4) update heartbeat-state.json
- `heartbeat.md:48` — heartbeat-state.json write: `signalElicitation.lastAskedDate`, `signalElicitation.askCount`, `signalElicitation.recentQuestions` (keep last 5), gate note to `memory/<today>.md`
- **For brief-question via MCP**: dedup not needed per-question-id since backend questions dedup via TTL and status (`pending → answered`); instead, track which question IDs were included in today's brief to avoid re-including answered ones

### heartbeat-state.json canonical schema
All current keys observed across readers/writers:
```json
{
  "prepared": { "taskId": "string", "date": "YYYY-MM-DD" },
  "deliveredToday": { "date": "YYYY-MM-DD", "ids": ["opportunityId"] },
  "signalElicitation": {
    "lastAskedDate": "YYYY-MM-DD",
    "askCount": 0,
    "recentQuestions": ["question text (last 5)"]
  }
}
```
No `briefQuestions` key needed in new architecture (backend manages question lifecycle via status column).

## Code References
- `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/prepare.md:1` — prepare cron prompt; all MCP via script
- `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/send.md:5` — "nothing after finalBrief" hard rule (unchanged)
- `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:1` — context builder; new questions fetch here
- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:1` — `composeDailyBrief(context)` + Kanban staging
- `packages/edge-city/agentvillage/install/install_index.ts:143-162` — DIGEST_CRON_SPECS (2 crons)
- `packages/edge-city/agentvillage/install/install_index.ts:223-287` — `reconcileDigestCronJobs()`; run after prompt file changes
- `backend/src/adapters/questioner.adapter.ts:100-170` — `findPending(userId, filters?)`
- `packages/protocol/src/shared/schemas/pending-question.schema.ts:1` — `PendingQuestionSummary` type
- `packages/protocol/src/shared/agent/tool.helpers.ts:463` — `findPendingQuestions` in ToolDeps
- `packages/protocol/src/shared/agent/tool.factory.ts:227-234` — tool group registration; add `createQuestionerTools` here
- `packages/protocol/src/questioner/questioner.types.ts:1` — `QuestionerInput`, `QuestionMode`
- `packages/protocol/src/intent/intent.tools.ts:76` — `read_intents` as MCP tool definition template

## Integration Points

### Inbound References
- `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/prepare.md` — calls `stage-daily-brief.ts` which will call `build-daily-brief-context.ts` which will call new MCP tool via JSON-RPC
- `packages/protocol/src/opportunity/opportunity.tools.ts:1103-1154` — existing `mergePendingQuestions` consumer; shows how `findPendingQuestions` is already used in tool handlers

### Outbound Dependencies
- `backend/src/adapters/questioner.adapter.ts:139` — `findPending()` DB query
- `packages/protocol/src/shared/schemas/pending-question.schema.ts` — `PendingQuestionSummary` type shape
- `backend/src/controllers/mcp.controller.ts` — composition root; wires `findPendingQuestions` into ToolDeps

### Infrastructure Wiring
- `install_index.ts:164` — `cronCreateArgs` + `cronEditPromptArgs`; prompt body comes from files under `skills/edge-esmeralda/prompts/`
- `install_index.ts:252-257` — prompt file read from disk at reconcile time; `prepare.md` changes must be reconciled
- `packages/protocol/src/shared/agent/tool.factory.ts:227` — all tool group init; `createQuestionerTools` call goes here
- `backend/src/controllers/mcp.controller.ts` — ProtocolDeps assembly point where `findPendingQuestions` is injected; no change needed if `QuestionerAdapter` is already wired

## Architecture Insights
1. **Prompt-file = cron content**: `install_index.ts` reads `prepare.md`/`send.md` from disk at reconcile time and stores the body inside the cron job. Any change to these files requires running `reconcile_digest_crons.ts` per-resident.
2. **Strict script isolation in send**: send.md delivers `finalBrief` verbatim with zero LLM modification. Questions must be baked in by the prepare step via `composeDailyBrief()`, not appended after send.
3. **findPendingQuestions already injected**: The callback is already in `ToolDeps` (`tool.helpers.ts:463`) and used by `mergePendingQuestions` in opportunity tools. A new questioner tool just needs to expose it as a standalone MCP tool.
4. **New tool file needed**: Questions span all modes (profile, intent, negotiation, discovery), so `questioner.tools.ts` under `packages/protocol/src/questioner/` is the correct home — not `opportunity.tools.ts`.
5. **build-daily-brief-context.ts = seam point**: This script uses direct JSON-RPC calls to the Index MCP server for opportunities. Adding a `read_pending_questions` call here is the minimal integration path: add the MCP call, add `questions: PendingQuestionSummary[]` to `DailyBriefContext`, add a question section to `composeDailyBrief()`.
6. **No dedup key in heartbeat-state.json**: Unlike signal-elicitation (which tracks LLM-generated questions), backend questions are deduped via status (`pending → answered/dismissed`). Once a user answers a question, it won't appear again. The prepare step can optionally skip questions that were already included in the previous N briefs by checking IDs against heartbeat-state.json.

## Precedents & Lessons
2 similar past changes analyzed.

### Precedent: signal-elicitation heartbeat task
**Commit**: `f5ed406` — "feat(index-network): re-engage thin-signal users with daily elicitation questions" (2026-06-08)
**Blast radius**: 3 files
  - `skills/index-network/heartbeat.md` — +20 lines (new task)
  - `skills/index-network/SKILL.md` — updated reference
  - `skills/index-network/tools.md` — added capture guidance

**Follow-up fixes**: None observed
**Lessons from docs**: —
**Takeaway**: Heartbeat-only changes (no install, no cron, no backend) are low-blast. The pattern (gate → context → question → state) is battle-tested and should be mirrored for the prepare step.

### Precedent: daily brief pipeline
**Commits**: `80180ef` — "fix: move digest prompts to edge-esmeralda skill", `7b6e679` — "fix(edge-esmeralda): fail closed on staging/send script error"
**Blast radius**: install_index.ts + prompt files
**Follow-up fixes**: `7b6e679` — fail-closed behavior added after initial implementation
**Takeaway**: Prompt-only changes get pushed via `reconcile_digest_crons.ts`. Script changes require a new install; fail-closed on non-zero exits is the required safety pattern.

### Composite Lessons
- Any change to `prepare.md` requires `reconcile_digest_crons.ts` run across all resident installs (prompt is stored in the Hermes cron job, not read at runtime)
- Fail-closed is required: if the new MCP call or question fetch fails, the brief must still deliver with a generic fallback or no questions (not silently block the whole brief)
- `composeDailyBrief()` is the safe injection point — it has existing null-checks for all optional sections (`announcements.length > 0`, `rsvpEvents.length > 0`)

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-11_00-58-19_agentvillage-daily-brief-questions.md` — FRD for this feature; contains the interview decisions and original (LLM-on-the-fly) vs revised (MCP tool) architecture decision

## Developer Context
**Q (discover: Core goal): What does 'more interactive' actually look like?**
A: Both signal AND engagement — richer profiles drive cold-start discovery; engagement nudges drive warm-path throughput for Edge Esmeralda.

**Q (discover: Delivery architecture): What's the right architectural move for question delivery?**
A: All of the above incrementally — brief first (quickest), then relax signal-elicitation gate, then dedicated heartbeat tasks.

**Q (discover: Question source): LLM-generated on the fly or backend question DB?**
A: Originally chosen as LLM-on-the-fly; corrected during research to use `read_pending_questions` MCP tool backed by the existing QuestionerAgent/QuestionerQueue DB.

**Q (discover: Question gate): What gates the question?**
A: Always include questions when pending questions exist for the user; backend TTL and status manage lifecycle.

**Q (research: Delivery path): Modify send.md or new approach?**
A: Questions should be in prepare step, not send. send.md "nothing after it" hard rule stays intact. Questions baked into staged body by `composeDailyBrief()`.

**Q (research: Question tool location): Where does read_pending_questions go?**
A: New `packages/protocol/src/questioner/questioner.tools.ts` — not `opportunity.tools.ts`. Questions span all modes (profile/intent/negotiation/discovery).

**Q (research: Backend scope): Backend changes in scope?**
A: Yes — new MCP tool + wiring required for increment 1.

## Related Research
- (none yet)

## Open Questions
- (Increment 2) What exactly should the relaxed `signal-elicitation` gate condition be? Options: remove the gate entirely, or gate on "no agent reply in last N days" regardless of opportunity count.
- (Increment 3) Should the `engagement-nudge` dedicated task fire on all users or only those with pending opportunities older than X hours?
- How many pending questions should `composeDailyBrief()` include? (cap at 1? show all pending? cap at 3 like `mergePendingQuestions`?)
- Should the prepare step write included question IDs to `heartbeat-state.json` to prevent re-including them in the next day's brief before the user answers?
