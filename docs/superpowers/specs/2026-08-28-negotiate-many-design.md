# Fan-out negotiations: `negotiate_many`, escalation, digest

Date: 2026-08-28. Analysis behind this spec: "Management by Exception"
(https://claude.ai/code/artifact/b6dfb18f-6117-4f5e-8ee1-7aa44f53091a).

## Problem

The agent loop is the pump for every negotiation. Each `negotiate_turn`
takes one turn and puts its full payload in the transcript; nothing
advances without another main-model call, and `runLoop` awaits tool calls
serially. With N negotiations of T turns that is N·T serial main-model
calls over N·T retained payloads interleaved by task id. At N = 10 the main
model is overwhelmed — not by one big result, but by many small ones each
demanding a decision that is almost always "continue, no guidance".

## Design

Each negotiation runs as its own loop, concurrently, and crosses back to
the agent loop only on an **event**. The agent loop gets one **digest** per
tool call, not one result per turn. Same principle as Claude Code's
subagents: isolate the work, return only the summary, surface only what
the child cannot decide alone.

### Decisions made

- **Concurrency:** inside one tool call. `negotiate_many` returns once
  every negotiation has reached an event. No in-flight state outlives a
  run, so "the agent holds no state" holds and resume-in-another-process
  keeps working. Cost: the call waits for the slowest counterparty.
- **Escalation:** an `ask` action, intercepted before send.
- **Coalescing:** by the model, from the digest. No clustering code.

### 1. Escalation

When a negotiation runs under the sub-loop — and only then — the
negotiator's `allowedActions` are extended with one non-terminal action:

```
{ action: "ask", description: "Use only when your next move depends on
  something the party you act for has not told you — a limit, a date, a
  preference. State what you need to know. Nothing is sent to the
  counterparty." }
```

The agent wraps its `DecisionStrategy` for these turns: if the decision's
action is `ask`, it throws `Escalation { decision }` before
`A2ANegotiationClient.sendTurn` reaches the wire. The sub-loop catches
it, sets `session.pending = { question: decision.message }`, saves the
session, and returns an `asking` event.

`negotiate_open` and `negotiate_turn` never offer `ask`: in one-vs-one
the agent loop is the escalation mechanism. Their behaviour is unchanged.

A negotiation parked before its first turn has no A2A Task and therefore
no id. It receives a provisional id `local:<uuid>` at open, used as its
key in `context.negotiations` and the store, and is re-keyed to the Task
id when the Task exists.

### 2. The sub-loop

```
runNegotiation(session, context): Promise<NegotiationEvent>
```

Generalises `negotiate()`'s while-loop: take turns until
`done || settlement || Escalation || turns >= maxTurns || error`. Returns
exactly one event:

| kind      | when                                   | carries                                   |
|-----------|----------------------------------------|-------------------------------------------|
| `settled` | Task terminal, or a settlement verdict | `settlement`, `state`, `turns`            |
| `asking`  | `Escalation` thrown                    | `question`, last peer decision, `turns`   |
| `budget`  | `maxTurns` spent                       | last peer decision, `turns`               |
| `failed`  | any other throw                        | `error` message, `turns`                  |

Errors are events so one failing peer does not sink the others. N
sessions run under `Promise.all`, sharing the run's `AbortSignal`.
`negotiate()` becomes a thin wrapper over `runNegotiation` plus the
transcript collection it does today.

Turn counting: `turns` counts this side's sent turns; an escalation does
not consume one.

### 3. Tools

Added to `negotiationTools()` (so `defaultTools()` gains them):

**`negotiate_many({ targets: [{ url, objective }] })`** — opens every
target concurrently (card discovery included, per `discover` option), runs
each to an event, returns a digest.

**`negotiate_resume({ ids: string[], guidance: string })`** — for each id:
- parked (`pending` set): append `guidance` to `session.guidance`, clear
  `pending`, run to the next event.
- settled: a digest line "already ended (state) — open a new negotiation
  if the terms need to change". Not an error.
- unknown / inbound: a digest line saying so.
Runs the resumable ones concurrently, returns a digest.

`session.guidance` is standing: it is folded into the objective for every
later turn of that session (`objective + "\n\nGuidance from your party:
..."`), unlike `negotiate_turn`'s per-turn `guidance`, which stays
per-turn.

Both tools use the run's `context.negotiations` and `context.signal`,
same as the existing pair.

### 4. The digest

Plain text. One line per negotiation, grouped, empty groups omitted:

```
Settled (2):
- 61b3061c with Alice's Agent — agreed: {"price":460,"collection":"Wednesday"}
- 9f2a1c3d with Bob's Agent — declined
Waiting on you (3) — ask your party once with ask_user, then call negotiate_resume with every id the answer applies to:
- 1a2b3c4d with Carol's Agent — asks: "What is the latest pickup day?" (their last offer: "$480, pickup Saturday" {"amount":480})
- ...
Out of turns (1):
- 5e6f7a8b with Dan's Agent — 10 turns, still open (their last offer: ...)
Failed (1):
- local:… https://dan.example — fetch failed: ECONNREFUSED
```

The settled line is `record()`'s line; the digest reuses that formatter.
`record()` in the system prompt shows a parked session as
`waiting on your guidance: "<question>"` instead of "still open".

### 5. State

`NegotiationSession` gains:

```ts
pending?: { question: string };   // parked on an escalation
guidance?: string[];              // standing guidance, oldest first
```

Parked sessions live on `context.negotiations` → `RunResult.negotiations`
and in the `NegotiationStore`. Nothing else is held; a fresh `Agent` with
the same store can `negotiate_resume` a session parked by another process.

### Invariants (CLAUDE.md) — how each holds

- Task is the record: `settled` is read from `task.status.state` /
  `verifyAgreement`, as `negotiate()` does.
- Settled stays settled: the sub-loop stops on `done || settlement`;
  `negotiate_resume` refuses ended sessions per line.
- Agent holds no state: parked sessions ride `RunResult.negotiations`.
- One clock, retries in `ModelClient` only: the sub-loop calls the same
  negotiator with the same `now`, adds no retry.
- Index ops host-injected: fan-out is a negotiation tool, not Index
  knowledge.
- One question at a time at the human boundary: the digest tells the
  model to `ask_user` once; the loop's existing single-suspend rule holds.

## Testing

Existing pattern: scripted `negotiator.decide`, ephemeral counterparties.
Per CLAUDE.md, break the code and check each test notices.

1. `negotiate_many` with N = 3 settling → one digest, one line each, and
   the main model was called exactly once for the tool round.
2. A negotiation deciding `ask` → parked with `pending`; the counterparty
   server recorded zero `message/send` calls for it; `Escalation` did
   not propagate.
3. `negotiate_resume` with two ids and one guidance → guidance appears in
   the party objective of every subsequent `decide` call for both, not in
   a third untouched session.
4. One target whose URL refuses connections → `failed` line; the other
   targets' events are unaffected.
5. `negotiate_resume` on a settled id → the "already ended" line; the Task
   state is unchanged afterward.
6. Park in one `Agent`, resume in a fresh `Agent` sharing the store.
7. `ask` on the first turn → `local:` id, re-keyed to the Task id after
   resume; `context.negotiations` has one entry, not two.
8. `negotiate_open`/`negotiate_turn` never pass `ask` in `allowedActions`.

## Out of scope

Background execution across runs; deterministic question clustering;
console commands for fan-out (the model can call the tool from chat);
inbound escalation.
