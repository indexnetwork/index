---
title: "Negotiation"
type: domain
tags: [negotiation, bilateral, agents, opportunity, a2a, roles]
created: 2026-03-26
updated: 2026-07-18
proposal: "Negotiations v2 — The Client-Advocate Protocol: see the visual proposal attached to IND-395 (https://linear.app/indexnetwork/issue/IND-395/)"
---

# Negotiation

> **Design rationale:** the v2 (client-advocate) behaviors described throughout this doc — rigid initiator seats, the outreach screen, `ask_user`, negotiator chat, and negotiator memory — are motivated and illustrated in the visual proposal attached to [IND-395](https://linear.app/indexnetwork/issue/IND-395/) (self-contained HTML).

Negotiation is a bilateral agent-to-agent protocol that acts as a quality gate over proposed matches. Two AI agents -- one representing each user -- debate whether a connection genuinely serves both parties. An opportunity is created before negotiation begins (with `negotiating` status) so users have real-time visibility; the negotiation then gates whether it transitions to `pending` (awaiting human acceptance), `rejected`, or `stalled` (turn cap hit without consensus).

This mechanism prevents the system from surfacing low-quality connections that passed the initial scoring threshold but would not withstand scrutiny from an advocate for each side.

---

## Why Negotiation Exists

The opportunity evaluator assigns scores based on profile and intent analysis, but it operates from a neutral third-party perspective. It cannot fully represent either user's interests. Negotiation adds an adversarial quality check: each agent critically evaluates whether the proposed match serves their user, advocating for that user's specific goals and constraints.

This catches failure modes that single-pass evaluation misses:
- Superficial keyword overlap without genuine alignment
- Vague matches that sound good but lack concrete mutual benefit
- Matches where one side benefits much more than the other

---

## Roles

### Index Negotiator

A single **Index Negotiator** agent represents each user in the negotiation. The same agent type is used for both participants — it adapts its stance based on the user context and the turn sequence, not a fixed personality.

On the first turn, the initiating side presents the match case. On subsequent turns, the agent evaluates arguments from the other side, advocates for its user's specific interests, and decides whether to accept, reject, counter, or (for personal agents) ask a clarifying question. The agent is instructed to be honest: it should not accept matches that do not genuinely serve its user, and it should not reject out of stubbornness when objections have been adequately addressed.

---

## Turn-Based Protocol

Negotiation proceeds in alternating turns.

> **Formal framing:** the turn protocol is a formal *dialogue game* in the McBurney & Parsons (2001) sense — the actions below are its locutions, `allowedActionsFor` its combination rules, the persisted turn history its commitment store, and `isTerminalAction` + the turn cap its termination rules. The full mapping lives in [docs/design/negotiation-dialogue-game.md](../design/negotiation-dialogue-game.md).

### Protocol versions

Each negotiation task carries a `protocolVersion` (`v1` | `v2`) in its metadata. The version is **inherited, never re-stamped**: continuations copy the version from the prior task on the conversation, so an in-flight v1 conversation stays v1 even after the environment moves to v2. Only genuinely fresh negotiations stamp from the `NEGOTIATION_PROTOCOL_VERSION` env switch (default `v1`); rollback is the same single switch.

Under **v2 (client-advocate seat rules)** the action vocabulary is scoped by seat, keyed on `metadata.initiatorUserId` (the rigid stamp from discovery time — never turn parity):

- **Initiator seat** (`outreach | counter | question | withdraw`): the side that surfaced the match. It reaches out and may walk away, but it can **never accept** — this is schema-enforced, not prompt-enforced.
- **Counterparty seat** (`accept | decline | counter | question`): the receiving side. Acceptance is this seat's decision alone.
- **Final turn**: initiator `withdraw | counter`; counterparty `accept | decline` (must decide).

Outcome mapping is version-independent: `accept` → `pending`, `reject`/`withdraw`/`decline` → `rejected`, turn cap → `stalled`.

### Actions (v1)

Each v1 turn produces one of five actions:

| Action | When used |
|---|---|
| **propose** | First turn only. The initiating agent presents the match case. (v2: **outreach**, initiator seat only.) |
| **counter** | The agent partially agrees but has specific objections. States what is missing or weak. |
| **accept** | The agent is convinced the match genuinely benefits their user. (v2: counterparty seat only.) |
| **reject** | The agent concludes the match does not serve their user's needs. (v2: split into **withdraw** for the initiator / **decline** for the counterparty.) |
| **question** | Personal agents only. A clarifying question for the other party. Routes the same as counter (non-terminal, awaits response). |

Every turn may also include an optional **message** field: free-form text accompanying the action (e.g. a note to the other user, context for a question, or elaboration beyond the structured reasoning).

### Turn structure

Each turn produces a structured assessment:

- **action**: The action taken this turn (v1: `propose`, `counter`, `accept`, `reject`, `question`; v2: `outreach`, `counter`, `question`, `withdraw` for the initiator / `accept`, `decline`, `counter`, `question` for the counterparty)
- **assessment.reasoning**: Why the agent took this action
- **assessment.suggestedRoles**: What roles each user should play
  - `ownUser`: agent, patient, or peer
  - `otherUser`: agent, patient, or peer
- **message** *(optional)*: Free-form text accompanying the action

### Screen gate (shadow / enforce)

Between init and the first turn, **fresh negotiations only** (continuations skip it) pass through an outreach gate: one structured LLM call from the reaching client's perspective deciding `reach_out | pass` — is this match worth the client's name before any turn is exchanged? Inputs: the client's intents + discovery query, the counterparty's `user_contexts` paragraph + active intents, and the seed assessment.

Controlled by `NEGOTIATION_SCREEN_MODE`:

- `off` *(code default)* — node skipped entirely; no LLM call, no telemetry.
- `shadow` — the decision is recorded (`tasks.metadata.screenDecision`, a `negotiation_screen` trace event, and a log line) but **never blocks**: every negotiation proceeds to its first turn. Used to measure pass rates against observed reject rates before enforcement.
- `enforce` *(P2.2)* — a `pass` blocks the negotiation **before the first turn**: the graph routes straight to finalize with outcome `reason: "screened_out"` — zero turns, zero counterparty involvement, zero notifications, no questioner, no reflection. Init had already flipped the opportunity to `negotiating`, so finalize quietly transitions it to `rejected` (hidden from default lists). `reach_out` proceeds normally.

A screen failure (LLM error/timeout) **fails open** in every mode (including enforce): the negotiation proceeds as `reach_out` with `failedOpen: true` recorded, so failed screens are excluded from pass-rate queries.

**`screened_out` is the client's private gate decision, not a negotiation.** Presentation treats it as never-happened: the negotiation-context loader returns `null` for screened-out outcomes (so no card/feed/digest surface can frame it as "counterparty declined"), and the mutual-viewer negotiations list excludes screened-out rows — the counterparty never learns a gate decision was made. The owner still sees the row in their own negotiations list, and the summarizer/question-generator digests carry `outcomeReason: "screened_out"` with client-appropriate copy.

### Client consultation (`ask_user`, flag-gated)

With `NEGOTIATION_ASK_USER_ENABLED=true`, v2 negotiators gain one extra non-final action per seat: **`ask_user`** — pause the negotiation to consult **their own client** (not the counterparty; `question` covers that). The turn carries `askUser: { disclosureSubject, draftQuestion }`.

IND-508 adds `NEGOTIATION_CONSULTATION_POLICY_MODE=off|shadow|on` (default/invalid `off`) as an independent, centralized deterministic admission policy. In `shadow`, it evaluates and emits only content-free eligibility telemetry while preserving the legacy spontaneous `ask_user` path exactly (it cannot itself ask, persist, park, arm a timer, or enqueue continuation work). In `on`, it requires the existing ask-user master gate and may authorize exactly one safe consultation for the exact acting seat/task when structured action/role/history state indicates one of four stable categories: unresolved owner-controlled constraint, consequential disclosure/permission choice, repeated non-convergence, or insufficient authority to commit. The disclosure category is independently reachable from a patient-side counter, rather than requiring an invalid action. It never reads free-form turns, evaluator reasoning, identities/profiles, match rationale, or counterparty data; it replaces the prompt input with fixed safe labels before the existing safety/persistence choke points. `off` preserves the legacy spontaneous model path. `delivered` telemetry is emitted only after Questioner persistence succeeds; enqueue/generation acknowledgement is not delivery.

Flow: the `ask_user` turn is persisted → an exact settlement key and recipient/intent/opportunity/network binding are parked on the task → the **24 h answer window** is armed (`NEGOTIATION_ASK_USER_WINDOW_MS` overridable) → the task transitions to `input_required` → only validated structured `askUser` fields may be refined by the questioner's `negotiation_inflight` preset. Missing or unsafe fields, Redis enqueue failure, empty model output, and final-admission rejection create no card, but the armed timeout still closes and resumes the exact task. Raw turn text, assessment/evaluator reasoning, match reason, counterparty identity/profile/intent, community/event claims, and internal IDs never become Questioner prompt context or visible copy.

The graph exits at the turn boundary, so chat-triggered runs never block a stream on a question. Cards carry a server-only versioned provenance envelope binding the exact recipient, owned opportunity actor intent, opportunity, non-personal network, and task. The API proves current ownership, ACTIVE lifecycle/fingerprint, assignment, membership, actor visibility, and exact task state before generation and again under one deterministic advisory/cohort/provenance lock order immediately before insertion.

- **Answer in time**: one locked transaction stores the answer, appends established shared `metadata.userAnswers` context, closes only the stamped `input_required` task, and writes a durable deterministic continuation request into that task's metadata. Enqueue happens afterward with the exact task+settlement ID; a caller retry or the still-armed timeout reconciles enqueue failure.
- **Dismissal or window expiry**: the same protocol writes the conservative no-disclosure default and settles any existing exact-task card cohort. Expiry does not require a question row. Answer, sibling answer, dismiss, and timeout serialize on the full cohort; no selected-card lock cycle exists.
- **Continuation delivery**: `negotiation-run-existing` has one deterministic job per settlement, validates the exact canceled task, and idempotently creates/reuses that settlement's successor. Worker/Bull redelivery resumes a submitted/working successor and terminal successors no-op; a newer/latest opportunity task is never selected. Completion is stamped back on the original durable settlement.
- **Lock**: while a task is `input_required` it holds the conversation lock for the full answer window (+1 h slack), not the usual 5-minute freshness — ambient rediscovery cannot start a fresh negotiation past the pause.
- **Rationing**: at most **one client consultation per negotiation per side**, checked against the full turn history (continuations count prior sessions). Opening turns and final-cap turns never offer the action.
- The 5-min park/claim timeout machinery ignores paused tasks: those workers only act on `waiting_for_agent`/`claimed` states.

The action is only offered when the full pause loop is wired (questioner enabled, answer-window timer available, an opportunity to resume against); it is not accepted from the external polling `respond` surface — polling agents have their own channel to their user.

### Deadlock detection & bargaining shift (flag-gated)

With `NEGOTIATION_DEADLOCK_SHIFT_ENABLED=true` (strict literal, default off), **v2** negotiations detect stalemate deterministically — pure inspection of the persisted turn history, no LLM in the decision. When the trailing run of consecutive `counter`/`question` turns reaches `NEGOTIATION_DEADLOCK_THRESHOLD` (integer ≥ 2, default **4**; invalid values fall back to the default), subsequent **system-agent** turns are drafted in a **bargaining stance** — the Wells & Reed (2006) persuasion→negotiation shift: stop re-arguing merits, offer a concrete concession or scope reduction, make the remaining objection priceable, escalate to `ask_user` only where that action is already legally available on the turn, or conclude decisively with a seat-legal terminal action. Openings (`propose`/`outreach`), terminal actions, `ask_user`, and unreadable actions **reset** the run; continuation histories count prior sessions' turns.

Constraints (by design):

- **Stance, not rules** — seat vocabularies (`allowedActionsFor`), termination rules, and turn-cap behavior are untouched; the shift never invents an action.
- **System agent only** — externally dispatched (polling/local personal-agent) turns never receive the stance.
- **Fail-open** — a detection or persistence error means "no deadlock"; the negotiation proceeds on the legacy path. With the flag off, drafting inputs and prompts are byte-identical to before.
- **Private analytics** — the first applied shift per session is recorded to internal task metadata (`metadata.deadlockShift`, like `screenDecision` never projected by API surfaces) and emitted as a `negotiation_deadlock_shift` trace event.

See [docs/design/negotiation-dialogue-game.md](../design/negotiation-dialogue-game.md) for the formal framing.

### Flow

1. **Init**: An opportunity is created with `negotiating` status. A conversation and task are created in the A2A system to track the negotiation.
1a. **Screen** *(fresh negotiations, `NEGOTIATION_SCREEN_MODE` ≠ `off`)*: the reaching client's gate records `reach_out | pass` on task metadata; in shadow mode the flow always continues.
2. **Initiating agent's turn**: The agent presents the case (action: propose)
3. **Responding agent's turn**: The agent evaluates and responds (accept, reject, counter, or question)
4. **Alternation**: If the responding agent countered or asked a question, the other agent responds; turns alternate until resolution
5. **Finalize**: When a terminal action occurs or the turn cap is reached, the outcome is computed and the opportunity status is updated accordingly. An `ask_user` pause exits before finalization — the task stays `input_required` until the client answers or the window expires, then the dialogue resumes as a continuation.

### Turn cap

The turn cap is resolved at init from whether each side has an external (polling) agent authorized for `manage:negotiations` on the negotiation's network:

| Scenario | Turn cap |
|---|---|
| At least one side has no external agent | `NEGOTIATION_MAX_TURNS_AMBIENT` (default **6**) |
| Both sides have external agents | Uncapped (`maxTurns = 0`) |

The resolved value is stamped on the task metadata; the polling respond path falls back to 6 if the stamp is missing. If the cap is reached without a terminal action, the opportunity transitions to `stalled` and the outcome records `reason: "turn_cap"` to distinguish this from explicit rejection.

⚠️ **Uncapped runs have no wall-clock bound today.** Termination relies on one side eventually taking a terminal action — the park-window timeout (below) guarantees *turns keep happening* (the system negotiator takes over abandoned turns), not that the dialogue ends. A wall-clock cap for uncapped external-vs-external runs is an open item tracked on the v2 master issue (IND-395, open question 3).

---

## Outcome Determination

The finalization logic examines the negotiation history to determine the outcome:

- **Has opportunity**: The last action was "accept". The opportunity transitions to `pending` (awaiting human acceptance via the UI). Under v2 only the counterparty seat can produce this action.
- **Rejected**: The last action was "reject" (v1) or "withdraw"/"decline" (v2). The opportunity transitions to `rejected`.
- **Turn cap**: The maximum turns were exhausted. The opportunity transitions to `stalled`; `reason: "turn_cap"`.
- **Screened out** *(v2, enforce mode)*: The client's own outreach gate declined before any turn. The opportunity transitions to `rejected`; `reason: "screened_out"`.

### Outcome fields

| Field | Description |
|---|---|
| `hasOpportunity` | Whether a real opportunity was produced |
| `agreedRoles` | Roles for each user (derived from the last two turns' `suggestedRoles`) |
| `reasoning` | Summary of why the negotiation concluded this way |
| `turnCount` | Number of turns taken |
| `reason` *(optional)* | `"turn_cap"` when the cap ended the negotiation, or `"screened_out"` when the outreach gate blocked it. (`"timeout"` remains in the schema for legacy artifacts, but no current finalize path writes it — the trace layer separately emits a `timed_out` outcome when a graph run dies on a timeout error.) |

### Agreed roles

When an opportunity is produced, the final roles are derived from the last two turns (the accept turn and the preceding turn). Each side's `suggestedRoles.ownUser` from their respective last turns becomes the agreed role for that user.

### Reflection (memory write path, flag-gated)

When `NEGOTIATOR_MEMORY_WRITE_ENABLED=true`, the finalize node fire-and-forgets a `reflect` job (via the injected `reflectEnqueue` callback — same pattern as `questionerEnqueue`). The `negotiation-reflect` queue worker replays the turn history from **both sides' perspectives** and distills ≤ 3 private `negotiator_memories` entries per side (playbooks, disclosure rules, counterparty dossiers, thresholds), each citing the evidencing turn indexes in its `sourceRefs`. Reflection failure never affects the outcome — the negotiation finalized before the job runs. Two companion write paths: negotiator-DM turns debounce-schedule a `chat_reflect` job that distills the client's stated preferences once the session goes idle, and `ask_user` answers are recorded immediately as high-confidence disclosure rules (an answer is already a distilled policy). Anti-poisoning: per-kind entry caps with lowest-confidence eviction, one dossier per (agent, subject) with reinforce-on-repeat, and a daily confidence-decay cron.

### Memory injection (read path, flag-gated)

When `NEGOTIATOR_MEMORY_INJECT=true`, the negotiator reads its own accumulated memories back into every surface where it argues or reports (P5.3). The negotiation graph takes an optional injected `memoryRetrieve` callback (composition-root pattern, like `reflectEnqueue`); retrieval is keyed on the **acting user's** id, so an agent can only ever see its own client's memories — the counterparty's are unreachable by construction. Retrieved entries render as a `PRIVATE NEGOTIATOR MEMORY` prompt section in four places: the **screen gate** (which reflects the influence into `evidence.memoryHints`), the **turn agent** system prompt, the **polling pickup** payload (`negotiatorMemory`, claiming user's own memory only), and the **negotiator DM persona** (where the audience is the client, so entries are shared context rather than secrets). Disclosure rules are **hard constraints** ("never disclose X") that override every other goal including reaching a deal, and are always included regardless of similarity; dossier notes are looked up directly by counterparty; playbooks and thresholds ride top-k embedding similarity against the seed assessment + counterparty context. The prompt section leads with a leak guard — memory text must never be quoted or referenced in anything counterparty-visible — and per-side retrieval is cached in graph state so a multi-turn session pays for it at most once per side. Retrieval failure (or the flag being off, or empty memory) yields prompts **byte-identical** to the pre-P5.3 build — memory can never break a negotiation.

### Memory inspection & control (P5.4)

It's the user's agent — everything it remembers is inspectable and editable. `GET|PATCH|DELETE /users/:userId/negotiator/memories(/:memoryId)` is **strictly self-only** (403 for any non-self caller, mutuals included — deliberately stricter than the neighbor negotiations route, which permits mutual viewers); the web app surfaces it as the **Memory tab** on the agent page, with disclosure rules listed first and labelled as *standing consent*. Content edits re-embed the row so similarity retrieval never serves stale meaning; deletes take effect for the very next retrieval (P5.3 reads live rows per session). Inspection and deletion are **not** gated on `NEGOTIATOR_MEMORY_WRITE_ENABLED` — they are the user's standing rights over already-accumulated rows. The negotiator DM additionally registers two persona-exclusive tools while the write flag is on: **`remember`** (persist a standing rule the client just stated — confidence 0.95, chat provenance, kind caps enforced) and **`forget`** (delete by id or by the client's description; a clear similarity winner is deleted, close calls come back as candidates to disambiguate). Both are appended after the persona allowlist filter and never enter the shared tool registry, so the orchestrator cannot see them.

---

## Seed Assessment

Each negotiation begins with a seed assessment from the opportunity evaluator:

- **score**: The evaluator's initial score (0-100)
- **reasoning**: Why the evaluator thinks this is a match
- **valencyRole**: The evaluator's initial role suggestion
- **actors**: Optional array of `{userId, role}` pairs

Both agents receive this seed assessment as context. They are instructed to use it as a starting point but form their own independent judgment.

---

## Turn Delivery (Polling)

When a negotiation graph reaches a turn the system cannot resolve synchronously — typically because the next speaker is a personal agent rather than an in-process system agent — the turn is **parked for polling** rather than pushed. The graph persists a `tasks` row in state `waiting_for_agent` with the full absolute turn context (source/candidate user context, index context, seed assessment, optional discovery query) in its metadata, then suspends.

### Parked-turn lifecycle

A parked turn lives on a **single response-window budget** that is armed once at park time and *carried across* the `waiting_for_agent → claimed` transition — the park timer and the claim timer never stack. The budget depends on how the negotiation was triggered:

| Trigger | Park-window budget |
|---|---|
| Ambient / background queue | `AMBIENT_PARK_WINDOW_MS` = **5 minutes** |
| Chat-driven, external agent authorized on every candidate network | 5 minutes (same ambient budget — the agent polls) |
| Chat-driven, no external agent somewhere | **30 seconds** (the system negotiator kicks in without stalling the chat) |
| Orchestrator (chat-driven a2h fan-out) | **60 seconds** (the user is watching the stream) |

1. The negotiation graph writes the turn into `tasks.state = 'waiting_for_agent'` and enqueues the park-window timeout with the trigger's budget.
2. The user's personal agent polls `POST /api/agents/:id/negotiations/pickup` (authenticating with its API key). The backend atomically CAS's the oldest pending task for the caller's user from `waiting_for_agent` to `claimed`, cancels the park timeout, and enqueues a **claim timeout with the remaining budget** — `computeRemainingBudgetMs(parkStart, AMBIENT_PARK_WINDOW_MS)`, clamped to a 1-second floor — not a fresh window. The agent receives the turn number, a `deadline` (= park start + the 5-minute budget), counterparty action, full turn history, the projected own/other user context, and — since v2 — the caller's `seat`, the task's `protocolVersion`, and the `allowedActions` for that seat.
3. The agent deliberates and submits its decision via `POST /api/agents/:id/negotiations/:negotiationId/respond` with `{ action, message?, assessment: { reasoning, suggestedRoles } }`. The backend CAS's the task from `claimed` (scoped to this `agentId`) to `working`, persists the turn as a message on the negotiation conversation, and cancels the claim timeout.
4. The submitted action is validated against the caller's seat + the task's protocol version before any state changes — an out-of-seat action (e.g. a v2 initiator submitting `accept`) returns HTTP 400 and leaves the claim intact for a retry. If the action is terminal (`accept`, `reject`, `withdraw`, `decline`) or pushes the turn count over the cap, the task is completed and an outcome artifact is written. Otherwise the task returns to `waiting_for_agent` and a **fresh 5-minute park window** is enqueued for the counterparty.
5. When the budget expires — whether the turn was never picked up (park timeout) or was claimed and abandoned (claim timeout) — the in-process system `Index Negotiator` takes the turn as a fallback. Under v2 the fallback is **seat-scoped**: an initiator-seat fallback can never accept on the user's behalf. If the fallback's action is terminal or hits the cap, the negotiation finalizes; if it counters under the cap, a fresh 5-minute park window is armed for the next speaker. An expired claim is *not* re-parked for another pickup attempt.

`ask_user`-paused tasks (`input_required`) are invisible to both timeout workers — they run on the separate 24-hour answer window described above.

Agent resolution uses the agent registry — the claiming agent is identified by the API key's `metadata.agentId`, and `assertAgentOwnership` checks that the agent belongs to the polling user.

### Why polling

Polling decouples turn delivery from the backend's request path. The graph does not hold any open connections waiting for an agent response, personal agents do not need to expose a public HTTPS endpoint, and there is no shared secret to manage. Agents work at their own cadence within the shared budget; the remaining-budget claim timeout bounds how long a claimed turn can block progress, and the park-window timeout guarantees every parked turn is eventually taken — by the polling agent or by the system negotiator fallback.

### Personal agent reference implementation

A personal agent polls `POST /api/agents/:id/negotiations/pickup` on a fixed interval. On a successful pickup it runs a subagent with a session key prefixed `index:negotiation:`. The subagent connects to the Index Network MCP server using the same personal-agent API key, detects the `index:negotiation:` prefix, and follows the **Negotiation turn mode** instructions baked into `MCP_INSTRUCTIONS`. It reads profile and intent context, then submits its response via `POST /api/agents/:id/negotiations/:negotiationId/respond` (exposed through the `respond_to_negotiation` MCP tool).

Running the turn as a silent subagent (rather than inline in the poller) lets the personal agent use its full LLM loop and tool stack to deliberate — fetching negotiation history, reading profile and intent context, applying the user's voice — without tying up the polling HTTP request.

### Turn mode behavioral contract

The turn-mode behavioral contract lives in the **`respond_to_negotiation` tool description** (the "silent-subagent response contract"), not in the server-level `MCP_INSTRUCTIONS` (which carries voice/output rules and points agents at per-tool guidance). It directs the subagent to:

- Submit exactly **one** `respond_to_negotiation` call per dispatch, with an action from its seat's allowed set and the full assessment (reasoning + suggestedRoles).
- Not ask the user clarifying questions (it is authorized to act on their behalf within the agent's granted scope).
- If the decision is ambiguous, pick the most conservative action — usually `counter` with specific objections.

The tool description also carries the seat-scoped v2 vocabulary (initiator `outreach | counter | question | withdraw`, counterparty `accept | decline | counter | question`) and instructs the agent to call `get_negotiation` first — its `seat`, `protocolVersion`, and `allowedActions` fields announce exactly what may be submitted. Because this contract ships in the tool metadata itself, every MCP-connected runtime (Claude Code, Codex, …) picks it up automatically; plugin skill files do not need to repeat it.

---

## A2A Conversation Integration

Negotiations are tracked as A2A (Agent-to-Agent) conversations:

- A **conversation** is created with two agent participants (`agent:{userId}`)
- A **task** is created within the conversation with type "negotiation" and metadata linking source and candidate user IDs
- Each turn is persisted as a **message** with the turn data in a DataPart (`kind: "data"`)
- Task state transitions through: `submitted` -> `working` -> `waiting_for_agent` (if yielding) -> `completed`
- When finalized, an **artifact** is created on the task containing the negotiation outcome

This integration means negotiation history is stored in the same conversation/message infrastructure used by the rest of the system, enabling future features like letting users review the reasoning that led to their opportunities.

---

## Relationship to Opportunity Persistence

Negotiation gates whether a proposed match becomes a visible opportunity:

1. The opportunity evaluator identifies candidates with scores above threshold
2. Each qualifying candidate is persisted immediately as an opportunity with `negotiating` status (for real-time visibility)
3. Bilateral negotiation runs over the candidate
4. If negotiation produces an outcome with `hasOpportunity: true`, the opportunity transitions to `pending` with the agreed roles, awaiting a human to confirm acceptance
5. If negotiation rejects, the opportunity transitions to `rejected`. If it stalls (turn cap or timeout without consensus), it transitions to `stalled`

Negotiation does not re-score the opportunity. The evaluator's score remains as the opportunity's initial score; negotiation only determines accept/reject and the agreed roles.

If negotiation is skipped or not available for a particular discovery path, the evaluator's assessment is used directly.

---

## MCP Tools

Personal agents interact with the negotiation protocol via MCP tools:

### `respond_to_negotiation`

Called by a personal agent to submit a turn response.

**Input fields:**
- `negotiationId`: The negotiation to respond to
- `action`: One of `propose`, `counter`, `accept`, `reject`, `question` (v1) or the caller's seat vocabulary under v2 (`outreach`/`counter`/`question`/`withdraw` for the initiator, `accept`/`decline`/`counter`/`question` for the counterparty) — `get_negotiation` announces `seat`, `protocolVersion`, and `allowedActions`
- `reasoning`: Why the agent took this action
- `suggestedRoles`: Role suggestions for own user and other user
- `message` *(optional)*: Free-form text accompanying the action

### `list_negotiations`

Lists current and historical agent negotiations for the authenticated owner. A task status of `completed` means only that the agent negotiation concluded; it does not mean the owner accepted a connection.

Each row includes an additive `lifecycle` narration contract:

- `agentNegotiation`: whether agents are still working, awaiting an agent, or concluded.
- `opportunityStatus` and `connectionState`: the current opportunity lifecycle, preserving `pending`, `rejected`, `stalled`, `draft`, `expired`, and accepted states rather than grouping them as completed connections.
- `ownerAction`: `accepted` only when the authenticated owner is the persisted human acceptor; otherwise `not_recorded`. A rejected opportunity alone does not prove that the owner passed.
- `lifecycleLabel`: deterministic lifecycle-accurate wording. In particular, a concluded negotiation whose opportunity is `pending` is labeled as agents having found a potential match awaiting owner review.
- `directConversationEvidence`: currently always `not_provided`. Negotiation completion and opportunity status never establish that an H2H message thread exists.

Turn `action` / `latestAction` values are agent-side negotiation vocabulary, made explicit by `actionActor` / `latestActionActor = agent`. Agent `accept` and `outcome.hasOpportunity` must not be narrated as owner acceptance. `get_negotiation.conversationType = agent_negotiation` also makes clear that its `conversationId` belongs to the A2A transcript, not an H2H message thread. Reporting remains read-only; accepting or passing an opportunity still requires an explicit owner instruction through `update_opportunity`.

**Status filters:**
- `waiting_for_agent`: Negotiations where it is this agent's turn to respond
- `completed`: Concluded agent negotiations across all opportunity outcomes; not completed connections

### `get_negotiation`

Returns the full negotiation state including all turns.

**Turn fields returned:**
- `action`
- `assessment.reasoning`
- `assessment.suggestedRoles`
- `message` *(optional)*

---

## Trace Instrumentation

Each negotiation turn is instrumented for the TRACE panel. The trace summary for a turn is the action name (e.g. `accept`, `counter`, `reject`). No score is included in the summary.

---

## Negotiation Insights

The weekly digest and opportunity analysis surfaces patterns across negotiations:

- Which match types most frequently reach accept vs. reject
- Common objection themes raised by agents
- Turn count distributions across negotiation scenarios

Digest analysis does not reference scores produced during negotiation — it focuses on the qualitative reasoning and action patterns.
