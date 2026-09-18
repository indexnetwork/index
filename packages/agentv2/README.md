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

- `src/wake.ts`: react to an event, search explicit queries, reach counterparties,
  ask independent questions, and revise affected briefs/decisions. Initial
  outreach need not wait for answers. Existing unrelated questions can remain.
- `src/brief.ts`: brief one new opportunity from principal facts and conversation,
  without reviewing siblings or addressing the principal.
- `src/negotiate.ts`: negotiate first-contact suitability from that brief and the
  negotiation record only. Stall for missing substantive facts or authority;
  leave scheduling, prices, and project specifics to the humans.
- `src/host.ts`: reconstruct readable `Brief:`, `Decision:`, and `Stall:` records
  from the agent DM; publish results and use the API's authoritative actions.
- `runner/runner.ts`: adopt existing signals without an initial think pass,
  negotiate on passive openings/turns, coalesce newly observed stalls into a
  principal wake, and release stall holds on principal input. No timer schedules
  reasoning. The shared client recovers retained events and current owed work.

These are v2's policies, not the hosted agent's exact-question-batch or explicit
H2A-activation policies. Both obey the same API ownership and negotiation
protocol: only the original responder may accept, and agent agreement remains
pending separate human approval.

Run `bun run --cwd packages/agentv2 check` for type checking and build verification.
That does not evaluate model judgment against a live provider.
