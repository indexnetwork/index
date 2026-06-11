---
date: 2026-06-11T00:58:19+0300
author: Yankı Ekin Yüksel
commit: c5c2c78664
branch: dev
repository: index
topic: "AgentVillage Daily Brief — Contextual Question Injection"
tags: [intent, frd, agentvillage, heartbeat, daily-brief, signal-elicitation, edge-esmeralda]
status: ready
last_updated: 2026-06-11T00:58:19+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: AgentVillage Daily Brief — Contextual Question Injection

## Summary
Users attending Edge Esmeralda are too passive — they're not providing enough signal or engaging with pending connections, so the opportunity graph can't find good matches. We'll append one contextually-generated question at the end of every user's daily brief in AgentVillage, generated fresh by the heartbeat agent after reading the user's current state via MCP tools. This is the first increment of a broader interactivity push; later increments will relax the signal-elicitation gate and add dedicated engagement heartbeat tasks.

## Problem & Intent
"We just need the users to be more interactive with the model because we aren't finding enough opportunities during Edge Esmeralda event."

Two failure modes cause this: (1) thin-signal users who never gave us enough intent/premise context for the discovery graph to match them, and (2) users who have live opportunities but aren't engaging with them (stalling negotiations). The daily brief is the one message that reaches every user every morning — it's the right forcing function to inject a question that prompts a reply.

## Goals
- Increase the rate at which users reply to the agent, providing new signal or engaging with pending opportunities
- Every user who receives a daily brief also receives one contextually-tailored question at the end of the same message
- Questions are personalized: the heartbeat agent reads the user's current intents, premises, and opportunities before generating
- Questions avoid repetition: deduplicated against the last 5 questions asked in `memory/heartbeat-state.json`
- Increments 2 and 3 (signal-elicitation gate relaxation, dedicated engagement tasks) land after this increment stabilizes

## Non-Goals
- Building a new MCP `read_pending_questions` tool or exposing the backend QuestionerAgent/QuestionerQueue question DB through a new endpoint (deferred to later — the heartbeat LLM-generation approach is faster and adequate for the event)
- Persisting the heartbeat-generated questions to the backend question DB (answers arrive as normal conversation turns and are captured via the existing `create_intent`/`create_premise` signal capture mechanism)
- Modifying the daily brief's Kanban/approval gate — the question is appended by the heartbeat agent after brief delivery, not staged into Kanban

## Functional Requirements
1. After delivering the daily brief content, the heartbeat agent SHALL call `read_intents()` and `read_premises()` (and optionally `list_opportunities()`) to load the user's current state.
2. The heartbeat agent SHALL generate exactly one contextual question grounded in the user's current state: if thin-signal, ask a signal-sharpening or opener question; if live opportunities exist, ask an engagement nudge about a pending connection.
3. The generated question SHALL be appended to the brief delivery message, separated from the brief content (e.g., with a line break or a brief transition phrase).
4. The question SHALL be deduplicated against the last 5 questions tracked in `memory/heartbeat-state.json` under a new key (e.g., `briefQuestions.recentQuestions`).
5. After asking, the heartbeat agent SHALL update `memory/heartbeat-state.json`: append the question to `briefQuestions.recentQuestions` (keep last 5), increment `briefQuestions.askCount`, and set `briefQuestions.lastAskedDate` to today's date. Preserve all other keys.
6. The user's reply arrives as a normal conversation turn and is captured by the existing signal capture mechanism (`create_intent`/`create_premise`) — no special answer-handling is needed.
7. (Increment 2) Relax the `signal-elicitation` gate condition so it also fires for users who have live opportunities but no recent agent replies, not just users with zero live opportunities.
8. (Increment 3) Add a dedicated `engagement-nudge` heartbeat task (separate from the brief) for mid-negotiation users to prompt action on pending connections without bundling it into the brief message.

## Non-Functional Requirements
- **Performance**: The extra MCP calls (read_intents, read_premises, list_opportunities) are already used by other heartbeat tasks — no new latency concern. The question must fit within Telegram's message size limits (4096 chars); one question is always safe.
- **Security**: No new data exposure — the heartbeat agent is already authenticated and operates within the user's MCP scope. No new endpoints are added.
- **UX / Accessibility**: One question per brief, maximum. Calm and direct — no preamble ("Great question!", filler). Consistent tone with the rest of the brief. The question should feel natural, not interrogative.
- **Reliability**: If MCP calls fail, the heartbeat agent falls back to a generic question ("What are you working on this week?") rather than silencing the entire brief delivery. State-file update failures are non-fatal.

## Constraints & Assumptions
- Edge Esmeralda is live now — the first increment must be shippable without backend changes (heartbeat.md edit only)
- The daily brief flows through a Kanban approval gate; the question must be appended by the heartbeat agent AFTER the approved content is delivered, not staged into the brief body
- The AgentVillage submodule (`packages/edge-city/agentvillage`) is Edge-City-owned canonical — changes to heartbeat.md must go through a PR to `Edge-City/agentvillage`
- Users may not reply to the question; the heartbeat must not block, re-ask in the same day, or treat no-reply as failure
- Assumes the signal capture section of tools.md (create_intent/create_premise after a user message) covers answer processing without additional wiring

## Acceptance Criteria
- [ ] The daily brief heartbeat task in `heartbeat.md` includes a "brief-question" step after brief delivery that calls read_intents/read_premises and appends one question to the message
- [ ] Running the heartbeat cron on a user with existing intents produces a Telegram message ending with a contextual question
- [ ] Running it again the same day does NOT ask the same question (dedup fires from heartbeat-state.json)
- [ ] `memory/heartbeat-state.json` after a run contains `briefQuestions.recentQuestions` with the question that was asked
- [ ] Running on a fresh user with no intents produces a generic opener question ("What are you working on this week?" or equivalent), not a silent skip
- [ ] The existing `send-daily-brief.ts` script is unchanged — question generation is a prompt step, not a script change

## Recommended Approach
Modify the `daily-brief` cron prompt in `packages/edge-city/agentvillage/skills/index-network/heartbeat.md` to add a question-generation step after the `send-daily-brief.ts` call, mirroring the existing `signal-elicitation` task's pattern (read state → generate question → dedup check → append → update state file). No backend changes required for increment 1.

## Decisions

### Core goal
**Question**: What does 'more interactive' actually look like in terms of outcome?
**Recommended**: n/a — intent question
**Chosen**: Both signal AND engagement — richer profiles drive cold-start discovery; engagement nudges drive warm-path throughput for Edge Esmeralda.
**Rationale**: Developer's framing: "We just need the users to be more interactive with the model because we aren't finding enough opportunities during Edge Esmeralda event."

### Delivery architecture
**Question**: The existing signal-elicitation task already asks one question per day but only when users have zero live opportunities. What's the right architectural move?
**Recommended**: Append questions to the daily brief
**Chosen**: All of the above, incrementally — brief first (quickest), then relax signal-elicitation gate, then dedicated heartbeat tasks
**Rationale**: Event is live; brief-first requires only heartbeat.md changes and no backend deployment.

### Question source
**Question**: Where should the questions in the daily brief come from — LLM-generated on the fly or surfaced from the backend question DB via a new MCP tool?
**Recommended**: LLM-generated on the fly in the heartbeat
**Chosen**: LLM-generated on the fly
**Rationale**: Matches existing signal-elicitation pattern; no backend changes needed; answers flow back through normal conversation capture.

### Question gate
**Question**: For increment 1 (questions in the daily brief), what gates the question?
**Recommended**: Always append one question, every user
**Chosen**: Always append one question, every user, every day
**Rationale**: Maximum reach during the event; no opportunity-count gating needed at this stage.

### Question UX & dedup
**Question**: Two quick details — dedup and context richness for the generated question.
**Recommended**: Dedup (last 5 in heartbeat-state.json) + rich context (read intents/premises/opportunities first)
**Chosen**: Dedup + rich context
**Rationale**: Prevents repetition over the multi-day event; richer context produces more useful questions.

### Pre-resolution: signal-elicitation baseline
**Question**: Pre-resolved from codebase evidence — confirmed in interview
**Recommended**: n/a
**Chosen**: `signal-elicitation` (heartbeat.md:32) is the baseline; it asks only when user has zero live opportunities. New brief-question runs unconditionally alongside it (not replacing it).
**Rationale**: evidence: packages/edge-city/agentvillage/skills/index-network/heartbeat.md:32 + confirmed

### Pre-resolution: daily brief delivery mechanism
**Question**: Pre-resolved from codebase evidence — confirmed in interview
**Recommended**: n/a
**Chosen**: Daily brief is delivered via Hermes/Telegram from `send-daily-brief.ts` through a Kanban approval gate. Questions must be generated and appended by the heartbeat agent prompt, not injected into the staged brief body.
**Rationale**: evidence: packages/edge-city/agentvillage/skills/index-network/scripts/send-daily-brief.ts + confirmed

## Open Questions
- (Increment 2) What exactly should the relaxed `signal-elicitation` gate condition be? Options: remove the gate entirely, or gate on "no agent reply in last N days" regardless of opportunity count.
- (Increment 3) Should the `engagement-nudge` dedicated task fire on all users or only those with pending opportunities older than X hours?

## Suggested Follow-ups
- The backend QuestionerAgent/QuestionerQueue system (`backend/src/queues/questioner.queue.ts`) generates DB-persisted questions with modes (profile/intent/negotiation). These are currently only accessible through chat (`InjectedQuestions`) or bundled in `discover_opportunities` results. A future `read_pending_questions` MCP tool could expose them to heartbeat agents for higher-quality, system-driven questions.
- `mergePendingQuestions` (packages/protocol/src/opportunity/opportunity.pending-questions.ts) caps at 3 pending questions per tool result. If the backend question DB fills up for a user, some questions may never surface. Worth auditing during Edge Esmeralda.
- The `signal-freshness` heartbeat task (heartbeat.md:22) runs every 7 days and prunes stale intents. Consider whether the new question step should be suppressed on the same day as a signal-freshness run to avoid double-asking.

## References
- packages/edge-city/agentvillage/skills/index-network/heartbeat.md
- packages/edge-city/agentvillage/skills/index-network/scripts/send-daily-brief.ts
- packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts
- packages/edge-city/agentvillage/skills/index-network/tools.md
- backend/src/queues/questioner.queue.ts
- backend/src/events/question.event.ts
- packages/protocol/src/opportunity/opportunity.pending-questions.ts
