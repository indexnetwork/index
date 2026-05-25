# Negotiation Conversation Continuation

**Date:** 2026-05-25
**Umbrella issue:** IND-274
**Goal:** Reuse prior dialogue between the same agent pair across discovery runs. Target: `discover_opportunities` p95 under 30s (current ~79s).

## Design Decisions

1. **Negotiations are DM conversations.** Agent-to-agent negotiations use the same `getOrCreateDM` infrastructure as user-to-user chats. No separate `NegotiationDatabase` interface — the negotiation graph receives generic conversation primitives plus a small negotiation-specific extension.

2. **Per-session `maxTurns`.** The turn cap governs new turns added in a single invocation. `turnCount` resets to 0 each session. Prior turns are context, not budget.

3. **No predecessor disposition.** Stalled opportunities stay stalled and continue naturally when the pair meets again. The existing `dedupAlreadyAccepted` logic handles accepted pairs. No active state-flipping of predecessors.

4. **History truncation deferred.** With a per-session cap of 6, pairs need 4+ sessions to reach 20 turns. Ship without truncation, watch `priorTurnCount` telemetry (IND-283), revisit when real data warrants it. IND-281 stays on the backlog.

5. **Application-level locking.** Concurrency guard uses task state (active task within 5-minute freshness window), not Postgres advisory locks. Debuggable via direct queries.

## Scope

**In scope:** IND-275, 276, 277, 278, 279, 280, 283, 284, 285 (fused/simplified).
**Deferred:** IND-281 (history truncation).
**Simplified:** IND-282 (predecessor disposition — no-op, stalled continues).

## Slice 1 — Interface Refactor

Replace `NegotiationDatabase` with a composed type. No behavior change.

### New types in `database.interface.ts`

```typescript
/** Negotiation-specific queries not covered by generic conversation ops. */
interface NegotiationQueries {
  setTaskTurnContext(taskId: string, turnContext: Record<string, unknown>): Promise<void>;
  getNegotiationTaskForOpportunity(opportunityId: string): Promise<TaskRecord | null>;
  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<...>;
}

/** Database dependency for the negotiation graph. */
type NegotiationGraphDatabase = Pick<Database,
  | 'getOrCreateDM'
  | 'createMessage'
  | 'getMessagesForConversation'
  | 'createTask'
  | 'updateTaskState'
  | 'createArtifact'
  | 'getTask'
  | 'getTasksForUser'
  | 'getArtifactsForTask'
> & NegotiationQueries;
```

### Changes

- `NegotiationGraphFactory` constructor: `database: NegotiationDatabase` → `database: NegotiationGraphDatabase`.
- `getOrCreateDM` adapter: accept optional `participantType` parameter (default `'user'`).
- Composition root (`mcp.controller.ts`): adapter already implements all picked methods; injection unchanged.
- `HomeGraphDatabase` and other types that picked from `NegotiationDatabase`: update to pick from new structure.
- Delete old `NegotiationDatabase` interface.
- Update test mocks to match new type.

## Slice 2 — Continuation Core

The core feature. When the same agent pair meets again, reuse their conversation.

### Init node (`negotiation.graph.ts`)

1. **DM lookup.** Replace `createConversation(participants)` with `getOrCreateDM(agentIdA, agentIdB)`. The dmPair is computed identically to user DMs (sorted IDs joined by `:`).

2. **Lock gate.** Query the conversation's most recent negotiation task. If it's in an active state (`submitted | working | waiting_for_agent | claimed`) and `updatedAt` is within 5 minutes, return early with `busy` outcome. `negotiateCandidates` handles `busy` by skipping that candidate (log + continue).

3. **Load prior messages.** Call `getMessagesForConversation(conversationId)`. Project raw message parts into `NegotiationTurn[]`. Seed `state.messages`. Set `turnCount = 0` (per-session cap).

4. **Continuation flag.** Add `isContinuation: boolean` to `NegotiationGraphState`. True when prior messages exist.

5. **First-turn behavior.** Skip force-propose constraint when `isContinuation === true`. The agent decides its opening action based on context.

6. **currentSpeaker.** Derived from the last prior message's sender. If the prior conversation ended mid-exchange, the other side picks up.

### Prompt changes (`negotiation.agent.ts`)

When `isContinuation === true`:

- **Prior dialogue section** before the turn history — renders loaded prior turns as relationship context.
- **New signal section** — the fresh `discoveryQuery` and seed assessment that triggered this run.
- **Policy line:** "You are continuing a prior dialogue. If this signal is materially the same as one you previously evaluated, you may resolve quickly. If materially different, evaluate on its own merits."

When `isContinuation === false`: prompt unchanged.

### Orphan healing (`opportunity.graph.ts`)

In the persist node's dedup branch: if a prior opportunity is stuck in `negotiating` and the lock gate says the task is stale (>5 min), pass that opportunity's ID to the negotiate node. The finalize step updates the existing opportunity row instead of creating a new one.

### Already-accepted skip

Existing `dedupAlreadyAccepted` logic unchanged. Pair with accepted opportunity → skip.

## Slice 3 — Observability, Tuning, Tests

### Telemetry (IND-283)

Enrich existing trace events (`negotiation_outcome`, `negotiation_session_end`) with:

- `isContinuation: boolean`
- `turnsAdded: number` (new turns this session)
- `priorTurnCount: number` (messages loaded at init, 0 for fresh)

Same fields emitted as structured log line via `protocolLogger`.

### Progressive maxTurns (IND-285)

Two env vars replacing hardcoded values:

- `NEGOTIATION_MAX_TURNS_CHAT` (default 4) — replaces `isChatPath ? 4` in `opportunity.graph.ts`.
- `NEGOTIATION_MAX_TURNS_AMBIENT` (default 6) — replaces default cap in `negotiation.graph.ts` agent-presence logic.

Rollback = revert env vars. Stage 2 reduction (ambient to 2) is config-only, driven by telemetry.

### E2E tests (IND-284)

Integration tests with deterministic agent mock, real DB:

1. **Fresh flow** — no prior conversation, works as before.
2. **Fresh → stall → resume → accept** — same conversation reused, second run sees prior turns, per-session cap resets.
3. **Already-accepted skip** — pair with accepted opportunity, discovery skips.
4. **Orphan heal** — `negotiating` opportunity with stale task, discovery resumes same row.
5. **Concurrent lock** — two parallel calls for same pair, one runs, other gets `busy`.

Target: all self-contained, total suite under 30s.

## Issue Mapping

| Slice | IND issues covered | Notes |
|-------|-------------------|-------|
| 1 | 275 (partial), 276 (partial) | Interface refactor only, no behavior change |
| 2 | 275, 276, 277, 278, 279, 280, 282 | 282 simplified to no-op |
| 3 | 283, 284, 285 | |
| Deferred | 281 | History truncation — revisit when telemetry warrants |
