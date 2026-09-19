# @indexnetwork/agentv2

An independent, stateless first-contact agent. This is not the API's hosted
default; that remains [`@indexnetwork/agent`](../agent/README.md).

## Run

Register an external agent, select it as your negotiation executor, and use
that exact agent UUID on this device:

```sh
export INDEX_API_URL=http://localhost:3001
export INDEX_API_KEY=your-api-key
export INDEX_EXECUTOR_ID=your-selected-agent-uuid
export OPENROUTER_API_KEY=your-model-key
bun run --cwd packages/agentv2 start
```

Opening negotiations, publishing principal messages, and submitting turns are
fenced against executor handover. The runner refuses an unset executor ID.

## Workflow

- `src/wake.ts`: react to an event, ask independent questions, and revise affected
  briefs/decisions. The model has no search, selection, skip, or opening tool.
- `src/brief.ts`: brief one new opportunity from principal facts and conversation,
  without reviewing siblings or addressing the principal.
- `src/negotiate.ts`: negotiate first-contact suitability from that brief and the
  negotiation record only. Stall for missing substantive facts or authority;
  leave scheduling, prices, and project specifics to the humans.
- `src/host.ts`: reconstruct readable `Brief:`, `Decision:`, and `Stall:` records
  from the agent DM; publish results and use the API's authoritative actions.
  After persisting a successful plan, `runWake` calls
  `client.discover(intent.id, signal)` exactly once, even for a silent plan.
  Index uses TypeSafe to score every eligible public intent/network pair, returns
  all still-eligible scores to its opening loop in descending order, and walks
  that ranking until up to **10 new negotiations per intent per matching run**
  are created or candidates are exhausted. There is no pass/fail threshold or
  `0.8` cutoff, no query or embedding retrieval, and no model-selected subset.
  Existing/reused, terminal, and unavailable sessions do not consume the
  new-opening budget. The host schedules each returned new opportunity through
  `onNegotiate` for separate briefing and negotiation. Provider or opening failures are reported without
  erasing the already-persisted questions, notes, or retirements. No automatic
  retry is made, and cancellation propagates through matching and opening.
- `runner/runner.ts`: adopt existing signals without an initial think pass,
  negotiate on passive openings/turns, coalesce newly observed stalls into a
  principal wake, and release stall holds on principal input. No timer schedules
  reasoning. Explicit creation, broadcast, revision, and resume events refresh
  the signal and wake it. The shared client recovers retained events and current
  owed work.

These are v2's policies, not the hosted agent's exact-question-batch or explicit
H2A-activation policies. Both obey the same API ownership and negotiation
protocol: only the original responder may accept, and agent agreement remains
pending separate human approval.

**Breaking in 0.4.0:** wakes now match automatically rather than asking the model
for queries or limiting outreach to selected people. They require the client
0.7.0 discovery contract. Failed planning, failed brief persistence, or cancellation
stops the wake before matching; a silent successful plan does not. `WakeInput`
no longer accepts `client` or `onOpened`; automatic matching is owned by `runWake`. Existing
sessions are preserved, and terminal sessions require deliberate reopening rather
than automatic matching. Intent lifecycle embedding
generation is unrelated and remains on the API.

Run `bun run --cwd packages/agentv2 check` for type checking and build verification.
That does not evaluate model judgment against a live provider.
