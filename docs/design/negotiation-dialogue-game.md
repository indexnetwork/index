---
title: "The Negotiation Protocol as a Formal Dialogue Game"
type: design
tags: [negotiation, dialogue-game, protocol, locutions, commitment-store, termination, academic-grounding]
created: 2026-07-18
updated: 2026-07-18
---

# The Negotiation Protocol as a Formal Dialogue Game

The bilateral negotiation protocol (`packages/protocol/src/negotiation/`) is a de-facto **formal dialogue game** in the sense of McBurney & Parsons (2001): a rule-governed interaction where autonomous agents exchange a fixed vocabulary of locutions under legality constraints, accumulate public commitments, and terminate under explicit rules. It was built as engineering, not as an implementation of the literature — this document supplies the missing formal framing so the correspondence is explicit and checkable against code.

This is backlog item 6 of the [Academic Grounding Enhancement Backlog](../../packages/protocol/src/docs/Academic%20Grounding%20Enhancement%20Backlog.md), grounded in Chapter 8 of [Theoretical Foundations of the Index Network Protocol](../../packages/protocol/src/docs/Theoretical%20Foundations%20of%20the%20Index%20Network%20Protocol.md). Reader-facing protocol behavior is documented in [docs/domain/negotiation.md](../domain/negotiation.md); this doc maps that behavior onto the game formalism.

## The game tuple

McBurney & Parsons define a dialogue game by five rule classes (the canonical formulation — the Theoretical Foundations doc's Ch. 8 tuple lists four components; its preamble carries the correction):

| Rule class | Formal role | Where it lives in code |
|---|---|---|
| **Commencement rules** | When a dialogue may begin, and with what opening move | `initNode` in `negotiation.graph.ts`: lock gate, seat stamping, forced opening action; screen gate (`negotiation.screen.ts`) |
| **Locutions** | The legal utterance vocabulary | Turn actions in `negotiation.protocol.ts` seat schemas + `NEGOTIATION_ACTIONS` in `shared/schemas/negotiation-state.schema.ts` |
| **Combination rules** | Which locution may follow which, for whom | `allowedActionsFor(version, seat, isFinalTurn, opts)` + `turnSchemaFor` in `negotiation.protocol.ts` |
| **Commitment rules** | How utterances update the public commitment stores | Persisted turns: A2A messages with `DataPart` payloads (`turnsFromMessages`), outcome artifact at finalize |
| **Termination rules** | When the dialogue ends | `isTerminalAction` in `negotiation.protocol.ts`; turn cap routing in `evaluateNode`; `screened_out` |

The sections below walk each class.

## Commencement rules

A negotiation dialogue can only begin when:

1. **A topic exists** — discovery produced a candidate match with a `seedAssessment` (the evaluator's reasoning), and usually an opportunity row in `negotiating` status. Agents never free-range into dialogue; every game has a traceable "why" (see [agent-negotiation-boundaries.md](./agent-negotiation-boundaries.md) §B2).
2. **The floor is free** — the init node's lock gate refuses to start while an active, fresh task holds the conversation (`isActiveAndFresh`), so at most one game runs per pair/opportunity at a time.
3. **Seats are fixed** — under v2 the initiator seat is stamped rigidly per match (`metadata.initiatorUserId`, inherited by continuations, never re-derived from turn parity). Seat assignment is a commencement-time fact, not a per-turn negotiation.
4. **The opening move is forced** — turn 0 of a fresh game must be the opening locution: v1 `propose`, v2 initiator `outreach`. The graph coerces any other action (`turnNode`'s turn-0 check). This is the game's sole legal commencement locution.
5. **Screen gate (v2, `NEGOTIATION_SCREEN_MODE`)** — before the first turn, the reaching client's own gate decides `reach_out | pass`. In enforce mode a `pass` means the game never commences (outcome `screened_out`, zero turns). This is a lightweight analogue of McBurney & Parsons' *commencement dialogue*: a pre-game decision about whether to interact at all — though here it is unilateral (the client's own counsel), not a mutual-consent subdialogue.

## Locutions

The locution set is versioned and, under v2, **seat-indexed** — the same physical vocabulary partitions into per-seat legal subsets:

| Locution | Speech-act class | v1 | v2 initiator | v2 counterparty | Terminal |
|---|---|---|---|---|---|
| `propose` | assertive (open) | turn 0 only | — | — | no |
| `outreach` | assertive (open) | — | turn 0 only | — | no |
| `counter` | assertive (challenge) | ✓ | ✓ | ✓ | no |
| `question` | directive (request info) | ✓ (personal agents) | ✓ | ✓ | no |
| `accept` | commissive | ✓ | **never** | ✓ | yes |
| `reject` | declarative (close) | ✓ | — | — | yes |
| `withdraw` | declarative (close) | — | ✓ | — | yes |
| `decline` | declarative (close) | — | — | ✓ | yes |
| `ask_user` | dialogue-suspension (consult principal) | — | flag-gated | flag-gated | no (suspends) |

Every locution carries mandatory propositional content: `assessment.reasoning` (the argument) and `assessment.suggestedRoles` (the proposed role assignment), plus an optional free-text `message`. There is no bare move — each utterance both moves the game and argues.

## Combination rules

Legality is computed by one pure function:

```
allowedActionsFor(version, seat, isFinalTurn, opts?) → readonly NegotiationAction[]
```

- **v1**: seat-symmetric — `propose | accept | reject | counter | question`, narrowing to `accept | reject` on the final-cap turn.
- **v2**: seat-asymmetric — initiator `outreach | counter | question | withdraw` (acceptance structurally impossible), counterparty `accept | decline | counter | question`. Final-cap turns narrow to initiator `withdraw | counter`, counterparty `accept | decline` (must decide, never pause).
- **`ask_user`** is an opt-in extension (`opts.askUser`) granted per surface only when the full pause loop is wired — never on final turns, never under v1.

Crucially the combination rules are **structurally enforced**, not prompt-suggested, at every ingress:

- the in-process system agent's LLM output is constrained by the seat-scoped Zod schema (`turnSchemaFor`) and validated with retry → conservative fallback (`fallbackActionFor`);
- locally-dispatched personal-agent turns are coerced to the fallback when out-of-seat (`turnNode`);
- the external polling `respond` surface rejects out-of-seat actions with HTTP 400 before any state change (`seatViolationMessage`);
- an `ask_user` that slipped past availability gating is coerced before persisting — an illegal move can never enter the commitment store.

Turn-taking is strict alternation with one deliberate exception: an `ask_user` suspension does not pass the floor — the asker speaks again on resume, now informed by its principal.

## Commitment rules

The commitment store is the **persisted turn history**: each turn is an A2A message whose `DataPart` carries the full structured turn. Properties that make it a genuine commitment store in the dialogue-game sense:

- **Public to the game** — both agents receive the full history every turn (`turnsFromMessages`); there is no private move.
- **Append-only** — turns are never edited or deleted; continuations seed the new session with all prior turns, so commitments survive across sessions.
- **Binding within the game** — the finalize node computes the outcome from the store (last action, `agreedRoles` derived from the last two turns' `suggestedRoles`), and writes it as an immutable `negotiation-outcome` artifact.
- **Not binding on principals** — a negotiation `accept` commits the *agents'* joint recommendation (opportunity → `pending`), never the humans: human approval remains the terminal gate ([agent-negotiation-boundaries.md](./agent-negotiation-boundaries.md) §B4). In dialogue-game terms, the commitment stores scope to the game; exiting commitments require a separate human move outside the game.

Internal analytical annotations on the task row (e.g. `metadata.screenDecision`, parked `turnContext`) are *not* part of the commitment store: API surfaces project specific fields and never return task metadata verbatim.

## Termination rules

The game ends in exactly one of these ways:

1. **Terminal locution** — `isTerminalAction`: `accept` (opportunity → `pending`), or `reject`/`withdraw`/`decline` (→ `rejected`). Version-independent mapping.
2. **Turn cap** — `evaluateNode` routes to finalize when `turnCount >= maxTurns` (scenario-resolved at init; ambient default 6). Outcome `reason: "turn_cap"`, opportunity → `stalled`. This is the game's guarantee against infinite dialogue — with the documented caveat that both-sides-external runs are uncapped (`maxTurns = 0`, open item on IND-395).
3. **Screened out** — the game never commenced (enforce-mode `pass`); outcome `reason: "screened_out"`.
4. **Suspension is not termination** — `ask_user` (`input_required`) and `waiting_for_agent` park the game without an outcome; timers guarantee eventual resumption (system-negotiator fallback / conservative-default answer), after which one of rules 1–2 fires. Negotiations always terminate.

## Dialogue typology and the known gap

In Walton & Krabbe's (1995) typology the game as shipped is a **persuasion dialogue**: both agents argue the merits of one fixed proposition ("this connection serves both clients") from symmetric public context. There is no priced bargaining, no offer/counter-offer over a divisible good — `counter` challenges reasons, it does not move a price (see [agent-negotiation-boundaries.md](./agent-negotiation-boundaries.md) §6 on why reservation-value risks don't map).

Wells & Reed (2006), *Knowing When to Bargain*, formalize what a persuasion-typed game needs when the merits are exhausted: a **legal shift** from persuasion (PP0 — justify standpoints with evidence) to negotiation (NP0 — trade concessions that need not pertain to the original standpoint). The shipped protocol has the shift's precondition detector's raw material (the commitment store makes "N consecutive challenges without convergence" decidable from state) but historically had no stalemate rule: a deadlocked game simply ran to the turn cap.

That gap is closed by the second half of backlog item 6 (IND-428), under a hard constraint from the game framing: **the shift changes drafting stance, not the game rules.**

### The shipped shift (IND-428)

- **Detection** (`negotiation.deadlock.ts`, `assessDeadlock`): the maximal *trailing* run of `counter`/`question` turns in the persisted history — the commitment store makes this decidable without any LLM. Openings, terminal actions, `ask_user` (fresh principal input incoming), and unreadable actions reset the run. Deadlock at run ≥ `NEGOTIATION_DEADLOCK_THRESHOLD` (integer ≥ 2, default 4).
- **Gate**: `NEGOTIATION_DEADLOCK_SHIFT_ENABLED === "true"` (strict, default off), applied only under protocol v2 — checked alongside the version plumbing so v1 semantics stay untouched. Detection errors fail open to "no deadlock".
- **Shift**: the turn node passes a `bargaining` stance to the *system agent's* prompt only (concessions/scope reductions; `ask_user` escalation only when the action is already legally held on the turn; conclude decisively otherwise). Locutions, combination rules (`allowedActionsFor`), commitment rules, and termination rules are untouched — a shifted agent still speaks only its seat's vocabulary, and externally dispatched turns never receive the stance.
- **Record**: the first applied shift per session is persisted to internal task metadata (`metadata.deadlockShift`, never projected by API surfaces — same posture as `screenDecision`) and emitted as a `negotiation_deadlock_shift` trace event.

## Readings

- McBurney, P., & Parsons, S. (2001). *Agent ludens: Games for agent dialogues.* AAAI Technical Report.
- Wells, S., & Reed, C. (2006). *Knowing when to bargain: The roles of negotiation and persuasion in dialogue.* In Grasso, Kibble & Reed (eds.), Proc. CMNA VI.
- Walton, D., & Krabbe, E. (1995). *Commitment in Dialogue: Basic Concepts of Interpersonal Reasoning.* SUNY Press.
