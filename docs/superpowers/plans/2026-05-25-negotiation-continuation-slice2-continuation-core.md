# Slice 2: Continuation Core — DM Reuse, Lock Gate, Prompt Update, Orphan Heal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the same agent pair meets again in discovery, reuse their existing conversation — load prior turns, apply per-session cap, lock against concurrency, and update the agent prompt for continuation awareness.

**Architecture:** The init node swaps `createConversation` for `getOrCreateDM`, queries the most recent task for a lock gate, loads prior messages, and seeds state. The negotiation agent gets a continuation-aware prompt section. The opportunity graph's persist node detects orphaned `negotiating` opportunities with stale locks and passes their ID through for resumption.

**Tech Stack:** TypeScript, LangGraph, Bun runtime

**Linear issue:** IND-342

**Depends on:** Slice 1 (IND-341) must be merged first — `getOrCreateDM` must be on `NegotiationGraphDatabase`.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/protocol/src/negotiation/negotiation.state.ts` | Modify | Add `isContinuation` annotation |
| `packages/protocol/src/negotiation/negotiation.graph.ts` | Modify | Rewrite init node for DM reuse + lock gate + history loading; handle `busy` in `negotiateCandidates` |
| `packages/protocol/src/negotiation/negotiation.agent.ts` | Modify | Add `isContinuation` to input; add continuation prompt section |
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Modify | Orphan heal in persist node |

---

### Task 1: Add `isContinuation` to negotiation state

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.state.ts`

- [ ] **Step 1: Add isContinuation annotation**

After the `discoveryQuery` annotation (line 119), add:

```typescript
  /** Whether this run is continuing a prior conversation with the same pair. */
  isContinuation: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),
```

- [ ] **Step 2: Verify build**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.state.ts
git commit -m "feat(protocol): add isContinuation to NegotiationGraphState"
```

---

### Task 2: Rewrite init node — DM reuse + lock gate + history seeding

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.graph.ts:30-84`

- [ ] **Step 1: Replace the init node**

Replace the entire `initNode` function body (lines 30–84) with:

```typescript
    const initNode = async (state: typeof NegotiationGraphState.State) => {
      try {
        // Find-or-create the DM conversation for this agent pair (same as user DMs)
        const agentIdA = `agent:${state.sourceUser.id}`;
        const agentIdB = `agent:${state.candidateUser.id}`;
        const conversation = await database.getOrCreateDM(agentIdA, agentIdB, 'agent');

        // --- Lock gate: check for an active task on this conversation ---
        const priorMessages = await database.getMessagesForConversation(conversation.id);

        // Find the most recent negotiation task by scanning messages' task references
        // or by looking up the opportunity's task directly
        let isLocked = false;
        if (state.opportunityId) {
          const priorTask = await database.getNegotiationTaskForOpportunity(state.opportunityId);
          if (priorTask) {
            const activeStates = ['submitted', 'working', 'input_required', 'waiting_for_agent', 'claimed'];
            const isFresh = (Date.now() - new Date(priorTask.updatedAt).getTime()) < 5 * 60 * 1000;
            if (activeStates.includes(priorTask.state) && isFresh) {
              isLocked = true;
            }
          }
        }

        if (isLocked) {
          logger.info('[Graph:Init] Conversation locked by active task, returning busy', {
            conversationId: conversation.id,
            opportunityId: state.opportunityId,
          });
          return { error: 'busy' };
        }

        // --- Load prior messages and determine continuation ---
        const priorTurns: NegotiationTurn[] = priorMessages
          .map((m) => {
            const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === 'data');
            return dataPart?.data as NegotiationTurn;
          })
          .filter(Boolean);

        const isContinuation = priorTurns.length > 0;

        // Determine currentSpeaker from last prior message
        let currentSpeaker: 'source' | 'candidate' = 'source';
        if (isContinuation && priorMessages.length > 0) {
          const lastSender = priorMessages[priorMessages.length - 1].senderId;
          // If the last speaker was source's agent, candidate speaks next
          currentSpeaker = lastSender === agentIdA ? 'candidate' : 'source';
        }

        // Determine scenario-based maxTurns
        const scope = { action: 'manage:negotiations', scopeType: 'network', scopeId: state.indexContext.networkId };
        const [sourceHasAgent, candidateHasAgent] = await Promise.all([
          dispatcher.hasPersonalAgent(state.sourceUser.id, scope),
          dispatcher.hasPersonalAgent(state.candidateUser.id, scope),
        ]);

        let maxTurns = state.maxTurns;
        if (maxTurns == null) {
          if (sourceHasAgent && candidateHasAgent) {
            maxTurns = 0;
          } else if (sourceHasAgent || candidateHasAgent) {
            maxTurns = 8;
          } else {
            maxTurns = 6;
          }
        }

        const task = await database.createTask(conversation.id, {
          type: 'negotiation',
          sourceUserId: state.sourceUser.id,
          candidateUserId: state.candidateUser.id,
          networkId: state.indexContext.networkId,
          ...(state.opportunityId && { opportunityId: state.opportunityId }),
          maxTurns,
          isContinuation,
          priorTurnCount: priorTurns.length,
        });

        if (state.opportunityId) {
          await database.updateOpportunityStatus(state.opportunityId, 'negotiating').catch((err) => {
            logger.error('[Graph:Init] Failed to set opportunity status to negotiating', { opportunityId: state.opportunityId, error: err });
          });
        }

        // Seed messages with prior turns (additive reducer appends new turns on top)
        const seedMessages = isContinuation ? priorMessages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          role: 'agent' as const,
          parts: m.parts,
          createdAt: m.createdAt,
        })) : [];

        return {
          conversationId: conversation.id,
          taskId: task.id,
          currentSpeaker,
          turnCount: 0,
          maxTurns,
          isContinuation,
          ...(seedMessages.length > 0 && { messages: seedMessages }),
        };
      } catch (err) {
        return { error: `Init failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    };
```

- [ ] **Step 2: Update force-propose guard in turn node**

At the force-propose check (around line 169), wrap with continuation guard:

```typescript
// Before
        if (state.turnCount === 0 && turn.action !== "propose") {
          logger.warn("[Graph:Turn] Agent returned unexpected action on turn 0, forcing to propose", { action: turn.action });
          turn.action = "propose";
        }

// After
        if (state.turnCount === 0 && !state.isContinuation && turn.action !== "propose") {
          logger.warn("[Graph:Turn] Agent returned unexpected action on turn 0, forcing to propose", { action: turn.action });
          turn.action = "propose";
        }
```

- [ ] **Step 3: Handle `busy` in `negotiateCandidates`**

In the `negotiateCandidates` function, after the `negotiationGraph.invoke(...)` call, check for the busy error. In the catch block or result handling (around line 490), add:

```typescript
        // After invoke returns
        if (result.outcome === null && result.messages?.length === 0) {
          // Check if the graph returned 'busy' via error state
        }
```

Actually, the `busy` case surfaces as `error: 'busy'` in the graph state, which means `outcome` will be null. The existing flow in `negotiateCandidates` already handles null outcomes by not including the candidate in results. Add a log line in the per-candidate handler:

```typescript
        if (!outcome?.hasOpportunity && state.error === 'busy') {
          logger.info('[negotiateCandidates] Skipping busy pair', {
            sourceUserId: sourceUser.id,
            candidateUserId: candidate.user.id,
          });
        }
```

The exact insertion point depends on how the graph error propagates — inspect the invoke result shape and add the log where null outcomes are handled.

- [ ] **Step 4: Verify build**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds.

- [ ] **Step 5: Run existing negotiation tests**

Run: `cd backend && bun test tests/negotiation.graph.spec.ts`
Expected: Tests pass (fresh flow behavior unchanged — mock databases don't return prior messages).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.graph.ts
git commit -m "feat(protocol): rewrite init node for conversation continuation

Replace createConversation with getOrCreateDM for DM reuse. Add
task-state lock gate (5-min freshness window). Load prior messages
and seed state for continuation. Skip force-propose on continuation.
Per-session turnCount reset to 0."
```

---

### Task 3: Update negotiation agent prompt for continuation

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.agent.ts:30-41,100-137`

- [ ] **Step 1: Add isContinuation to NegotiationAgentInput**

At the `NegotiationAgentInput` interface (line 30), add:

```typescript
export interface NegotiationAgentInput {
  ownUser: UserNegotiationContext;
  otherUser: UserNegotiationContext;
  indexContext: { networkId: string; prompt?: string };
  seedAssessment: SeedAssessment;
  history: NegotiationTurn[];
  isFinalTurn?: boolean;
  isDiscoverer?: boolean;
  discoveryQuery?: string;
  /** Whether this is a continuation of a prior conversation with this counterparty. */
  isContinuation?: boolean;
}
```

- [ ] **Step 2: Add continuation prompt section in invoke method**

In the `invoke` method, after `historyText` is built (line 137), add the continuation context:

```typescript
    const continuationContext = input.isContinuation && input.history.length > 0
      ? `\n\n--- Prior dialogue with this counterparty ---
${historyText}

--- New signal under evaluation ---
${input.discoveryQuery
  ? `Discovery query: "${input.discoveryQuery}"`
  : `Seed assessment: ${input.seedAssessment.reasoning}`
}

Policy: You are continuing a prior dialogue. If this signal is materially the same as one you previously evaluated, you may resolve quickly. If materially different, evaluate on its own merits.`
      : '';
```

Then in the user message construction, when `isContinuation === true`, use `continuationContext` instead of `historyText`:

```typescript
    const effectiveHistory = input.isContinuation ? continuationContext : historyText;
```

Update the user message to use `effectiveHistory` where `historyText` was used.

- [ ] **Step 3: Pass isContinuation from turn node to agent**

In `negotiation.graph.ts`, in the turn node where the agent is invoked (around line 155), add `isContinuation: state.isContinuation` to the agent input:

```typescript
          turn = await systemAgent.invoke({
            ownUser,
            otherUser,
            indexContext: state.indexContext,
            seedAssessment: state.seedAssessment,
            history,
            isFinalTurn,
            isDiscoverer: isSource,
            isContinuation: state.isContinuation,
            ...(state.discoveryQuery && isSource && { discoveryQuery: state.discoveryQuery }),
          });
```

- [ ] **Step 4: Verify build**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.agent.ts packages/protocol/src/negotiation/negotiation.graph.ts
git commit -m "feat(protocol): add continuation-aware prompt to IndexNegotiator

When isContinuation is true, the prompt shows prior dialogue as
relationship context and frames the current signal as new evaluation.
Policy line prevents blind anchoring on prior outcomes."
```

---

### Task 4: Orphan healing in the opportunity graph

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts`

- [ ] **Step 1: Identify the dedup branch in the persist node**

Find the section where `dedupAlreadyAccepted` is tracked (around lines 2830–2835) and where stalled/expired reactivation happens (around lines 2646–2665). The orphan heal goes in the same dedup area.

- [ ] **Step 2: Add orphan-negotiating detection**

In the dedup branch, after the `accepted` status check, add:

```typescript
        // Orphan heal: if prior opportunity is stuck in 'negotiating' with a stale task,
        // resume it instead of creating a duplicate
        if (priorOpp.status === 'negotiating') {
          const priorTask = await database.getNegotiationTaskForOpportunity(priorOpp.id);
          if (priorTask) {
            const activeStates = ['submitted', 'working', 'input_required', 'waiting_for_agent', 'claimed'];
            const isFresh = (Date.now() - new Date(priorTask.updatedAt).getTime()) < 5 * 60 * 1000;
            if (activeStates.includes(priorTask.state) && isFresh) {
              // Still active — skip (lock gate in init node will handle)
            } else {
              // Stale task — resume this opportunity
              candidate.opportunityId = priorOpp.id;
              logger.info('[Persist] Resuming orphaned negotiating opportunity', {
                opportunityId: priorOpp.id,
                priorTaskState: priorTask.state,
              });
            }
          }
        }
```

The exact location and variable names depend on the persist node's structure. The key: when a prior opp is `negotiating` with a stale task, set `candidate.opportunityId` to the existing opp's ID so the finalize step updates it instead of creating a new row.

Note: `getNegotiationTaskForOpportunity` needs to be available on the opportunity graph's database type. Check if `OpportunityGraphDatabase` picks this method; if not, add it to the Pick.

- [ ] **Step 3: Verify build**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds.

- [ ] **Step 4: Run existing opportunity tests**

Run: `cd backend && bun test tests/opportunity.negotiation.spec.ts 2>/dev/null || echo "Run any relevant opportunity tests"`
Expected: Existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts
git commit -m "feat(protocol): add orphan-negotiating heal in persist node

When a prior opportunity is stuck in negotiating with a stale task
(>5 min), the new discovery resumes it instead of creating a duplicate.
The finalize step updates the existing row."
```

---

### Task 5: Final verification

- [ ] **Step 1: Full protocol build**

Run: `cd packages/protocol && bun run build`
Expected: Clean build.

- [ ] **Step 2: Full backend type check**

Run: `cd backend && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run negotiation tests**

Run: `cd backend && bun test tests/negotiation.graph.spec.ts tests/negotiation.e2e.spec.ts`
Expected: All pass. Fresh-flow behavior unchanged (mocks don't return prior messages, so `isContinuation` defaults to false).

- [ ] **Step 4: Commit any remaining fixes**

If type-check or tests revealed issues, fix and commit.
