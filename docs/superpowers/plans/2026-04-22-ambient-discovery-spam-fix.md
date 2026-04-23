# Reduce Ambient Discovery Message Spam

## Current status (how it works today)

```mermaid
sequenceDiagram
    participant Sched as Scheduler Timer
    participant Route as HTTP Route Handler
    participant Poller as ambient-discovery.poller
    participant Backend as Index Network Backend
    participant Subagent as OpenClaw Subagent
    participant Telegram as Telegram Chat

    Note over Sched: Plugin boot -> first trigger at 5s
    Sched->>Route: POST /poll/ambient-discovery (every 5m * backoff)
    Route->>Poller: handle(api, config)
    Poller->>Backend: GET /api/agents/{id}/opportunities/pending (max 20)
    Backend-->>Poller: { opportunities: [...] }

    alt No opportunities / no delivery config / batch hash unchanged
        Poller-->>Route: return false
        Route->>Sched: increaseBackoff() 5m->10m->20m->40m->80m
    else New batch of candidates
        Poller->>Subagent: subagent.run({deliver:true, message:evaluatorPrompt})
        Subagent->>Subagent: LLM calls read_intents + read_user_profiles
        Subagent->>Subagent: LLM evaluates each candidate
        Subagent->>Backend: confirm_opportunity_delivery(id) per surfaced opp
        Subagent->>Telegram: ALL output text delivered to user
        Poller-->>Route: return true
        Route->>Sched: resetBackoff() -> back to 5 min
    end
```

**Timing**: Base interval 5 min. Backoff doubles on `false` return (5m->10m->...->80m max). Resets to 5 min after successful dispatch.

**Key files**:
- Scheduler: [`ambient-discovery.scheduler.ts`](../../packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.scheduler.ts) -- timer loop, backoff logic
- Poller: [`ambient-discovery.poller.ts`](../../packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts) -- fetches pending opps, dedup via batch hash, launches subagent
- Prompt: [`opportunity-evaluator.prompt.ts`](../../packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts) -- LLM instructions for evaluating candidates
- Route registration: [`index.ts`](../../packages/openclaw-plugin/src/index.ts) (lines 175-201) -- wires scheduler result to backoff/reset
- Backend filter: [`opportunity-delivery.service.ts`](../../backend/src/services/opportunity-delivery.service.ts) (lines 290-353) -- SQL query for pending candidates, LIMIT 20, dedup via `opportunity_deliveries` ledger
- Config: [`openclaw.plugin.json`](../../packages/openclaw-plugin/openclaw.plugin.json) -- plugin config schema
- Delivery dispatcher: [`delivery.dispatcher.ts`](../../packages/openclaw-plugin/src/lib/delivery/delivery.dispatcher.ts) -- builds session key, dispatches pre-rendered cards via `deliver: true`
- Delivery prompt: [`delivery.prompt.ts`](../../packages/openclaw-plugin/src/lib/delivery/delivery.prompt.ts) -- simple relay prompt: "deliver faithfully, don't add commentary"

**Deduplication layers**:
1. Backend: `opportunity_deliveries` table prevents re-delivering the same opportunity at the same status
2. Poller: `lastOpportunityBatchHash` skips subagent if the set of opportunity IDs hasn't changed
3. Subagent: `idempotencyKey` per `agentId:date:batchHash` prevents duplicate subagent runs

**What the LLM is told**: Evaluate candidates against user's intents/profile. Call `confirm_opportunity_delivery` for winners. Format as bold headline + summary for Telegram. "If no opportunity passes the bar: produce absolutely no output and call no tools."

**What actually happens**: The LLM narrates its entire evaluation process (which candidates it rejected and why), and `deliver: true` sends all of that text straight to Telegram. After a successful dispatch, backoff resets to 5 min, so the next poll fires quickly, finds a slightly changed batch, and the cycle repeats.

## Problem diagnosis

The plugin sent **6 messages in ~10 minutes** (18:16-18:24). Most of them are the LLM "thinking out loud" about why candidates were rejected.

Root causes:

1. **Agent runs on every poll, not just new opportunities**: The batch hash dedup only catches "exact same set of IDs." If one new opp appears, the entire batch (up to 20) is re-evaluated from scratch, re-triggering LLM reasoning about already-seen candidates.

2. **No separation between evaluation and delivery**: The subagent both evaluates AND delivers in one step with `deliver: true`. There's no system gate between the agent's decision and the user's notification.

3. **Backoff logic is inverted**: Successful dispatch resets to 5 min (aggressive). Benign no-ops increase backoff (relaxed). Exactly backwards.

4. **The LLM ignores the "no output" instruction**: The prompt says "produce absolutely no output" for rejections, but the model narrates its reasoning. With `deliver: true`, all of it goes to Telegram.

## Proposed architecture

```mermaid
flowchart TD
    Sched["Scheduler (5 min)"] --> Poll
    Poll["Poller: fetch pending opps"] --> Diff
    Diff{"new IDs not in seenSet?"} -->|"none"| NoOp["No-op (no LLM cost)"]
    Diff -->|"1+ new"| Cap
    Cap{"Daily cap exceeded?"} -->|"yes"| MarkSeen["Mark seen, digest handles rest"]
    Cap -->|"no"| Evaluate
    Evaluate["Evaluator subagent (deliver: false)"] --> Deliver
    Deliver["Aggregate all new opps into one message"] --> Dispatch["dispatchDelivery (deliver: true, pre-rendered)"]
    Dispatch --> Mark["Mark all as seen, persist to file"]
```

Two subagent runs per cycle, each with a distinct job:

1. **Evaluator** (`deliver: false`): runs silently, calls `confirm_opportunity_delivery` for worthy opportunities (ledger cleanup -- confirmed ones won't appear in future polls or digest). Verbose LLM text is discarded.
2. **Delivery** (`deliver: true`): relays all new opportunities as one aggregated, pre-rendered message. Uses the existing `dispatchDelivery` with the simple "relay faithfully" prompt. No LLM evaluation, no narration risk.

### Layer 1 -- Poller (cheap, no LLM)

Replace batch hash with a **`seenOpportunityIds` set**, persisted to a JSON file so it survives restarts.

- Maintain `Set<string>` of all IDs the poller has fetched (reset daily)
- `newOpps = fetched.filter(id => !seenSet.has(id))`
- If empty: no-op, no LLM cost
- If non-empty: evaluate + deliver
- After processing: add all IDs to seen set and persist to file
- On startup: load seen set from file (if same date)

### Layer 2 -- Evaluator (deliver: false, ledger only)

The evaluator subagent runs silently. Its text output never reaches the user.

The agent receives **decision context** to make informed calls:
- **Deliveries so far today**: how many notifications already sent today
- **Time since last notification**: minutes since the last ambient delivery
- **Time of day**: so it can avoid notifying at odd hours
- **Total pending count**: how many opportunities are waiting

The agent's job:
1. Call `read_intents` and `read_user_profiles` to ground itself
2. Evaluate each new opportunity against the user's profile and intents
3. For each opportunity worth surfacing: call `confirm_opportunity_delivery` (this removes it from the pending list, so the digest won't re-surface it)
4. For everything else: do nothing (stays pending, digest will show it)

The evaluator curates the **ledger** -- it decides what disappears from pending (handled by ambient) vs. what stays for the daily digest to highlight.

### Layer 3 -- Aggregated delivery (deliver: true, pre-rendered)

After the evaluator completes, the poller delivers **all new opportunities** as one aggregated message via `dispatchDelivery()`. No re-fetch needed.

The pre-rendered cards come from the Index Network backend (headline, personalizedSummary, suggestedAction). They're already curated -- only opportunities that passed backend-level filtering (status, actor match, visibility) appear in the pending list.

One evaluation cycle = one Telegram message, regardless of how many new opportunities appeared.

### Layer 4 -- System safety net (hard cap only)

The only system-level gate is a **hard daily cap** (configurable, default **5**).

- Tracked in the poller, persisted alongside seen IDs
- If cap exceeded: mark IDs as seen, skip both evaluator and delivery, digest handles them
- No cooldown timer, no system-level throttling

## Implementation

### 1. Replace batch hash with seen-IDs set in `ambient-discovery.poller.ts`

```typescript
let seenOpportunityIds = new Set<string>();
let seenDateStr: string | null = null;
let deliveriesToday = 0;
let lastDeliveryTimestamp: number | null = null;

// In handle():
const today = new Date().toISOString().slice(0, 10);
if (seenDateStr !== today) {
  seenOpportunityIds = new Set();
  deliveriesToday = 0;
  seenDateStr = today;
}

const allIds = body.opportunities.map(o => o.opportunityId);
const newOpps = body.opportunities.filter(o => !seenOpportunityIds.has(o.opportunityId));

if (newOpps.length === 0) {
  for (const id of allIds) seenOpportunityIds.add(id);
  return 'no_new';
}

// Hard daily cap -- safety net only
const maxDaily = parseInt(readConfig(api, 'ambientMaxDaily') || '5', 10);
if (deliveriesToday >= maxDaily) {
  for (const id of allIds) seenOpportunityIds.add(id);
  api.logger.info('Ambient discovery: daily cap reached, deferring to digest');
  return 'no_new';
}
```

### 2. Persist seen-IDs to file

Store `{ date, seenIds, deliveriesToday, lastDeliveryTimestamp }` in a JSON file. Load on startup. Implementation detail (file location, write strategy) left to implementer.

### 3. Evaluate silently + deliver all new opps

```typescript
// Step 1: Evaluator runs silently -- curates the ledger
await api.runtime.subagent.run({
  sessionKey,
  idempotencyKey: `index:eval:opportunity-batch:${config.agentId}:${dateStr}:${evalHash}`,
  message: opportunityEvaluatorPrompt(newOpps, decisionContext),
  deliver: false,
  model,
});

// Step 2: Deliver all new opportunities as one aggregated message
const aggregatedBody = newOpps
  .map(o => `**${o.headline}**\n${o.personalizedSummary}\n→ ${o.suggestedAction}`)
  .join('\n\n');

await dispatchDelivery(api, {
  rendered: {
    headline: newOpps.length === 1
      ? newOpps[0].headline
      : `${newOpps.length} new connections`,
    body: aggregatedBody,
  },
  idempotencyKey: `index:delivery:ambient:${config.agentId}:${dateStr}:${evalHash}`,
});

// Update state
for (const id of allIds) seenOpportunityIds.add(id);
deliveriesToday++;
lastDeliveryTimestamp = Date.now();
```

### 4. Decision context for the evaluator prompt

```typescript
opportunityEvaluatorPrompt(newOpps, {
  deliveriesToday,
  minutesSinceLastDelivery: lastDeliveryTimestamp
    ? Math.round((Date.now() - lastDeliveryTimestamp) / 60_000)
    : null,
  totalPendingCount: body.opportunities.length,
  currentTime: new Date().toLocaleTimeString(),
});
```

### 5. Redesign the evaluator prompt

In `opportunity-evaluator.prompt.ts`:

- Agent role: "You run silently. Your text output is discarded."
- Provide decision context (deliveries today, time since last, time of day, etc.)
- Agent calls `confirm_opportunity_delivery` for worthy opportunities -- this is ledger management, not delivery gating
- Opportunities the agent confirms are removed from the pending list (handled). Unconfirmed ones stay pending for the daily digest.

### 6. Change `handle()` return type

Return `'no_new' | 'dispatched' | 'error'` instead of boolean.

### 7. Fix backoff in route handler

- `'error'` -> `increaseBackoff`
- `'dispatched'` or `'no_new'` -> leave interval as-is (no reset to 5 min)

### 8. Add config to `openclaw.plugin.json`

- `ambientMaxDaily` (default `"5"`) -- hard daily cap, safety net only

## Files to change

- `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` -- seen-IDs set (persisted), daily cap, two-step evaluate+deliver, new return type
- `packages/openclaw-plugin/src/polling/ambient-discovery/opportunity-evaluator.prompt.ts` -- redesign: silent ledger curator with decision context
- `packages/openclaw-plugin/src/index.ts` -- fix backoff for new return type
- `packages/openclaw-plugin/openclaw.plugin.json` -- add `ambientMaxDaily`
- `packages/openclaw-plugin/src/tests/opportunity-batch.spec.ts` -- update tests for new behavior
