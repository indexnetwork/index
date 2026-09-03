# Personal agent surfaces, without A2A

Same protocol, same three scopes, one change: the negotiation is a record in Index, not a wire between agents. Both agents take turns against that record. Index is the server for every negotiation, and says so. Index never calls an agent; agents call Index and are notified.

Index is a social discovery protocol: people find investors, founders, collaborators, dates, and researchers through their agents. An intent says who someone is looking for; a negotiation is two agents working out whether a specific pair is worth the humans' time and on what footing; consent is the humans saying yes.

Calls go down, results come up. The negotiation scope talks only to Index; the intent scope asks the user; the global scope reads what holds for every intent.

Two halves. **Service** is what Index runs and exposes: records, tools, events, the hosted seat. **Libraries** are code a host or an agent embeds: one package, `@indexnetwork/agent`, and the CLI that wraps it. There is no separate negotiator; a turn is the agent loop calling a tool.

Status: **exists** on the #1552 branch · **change** to an existing surface · **new** · **library** provided by a package, not by the service. Only surfaces the agent flow touches are listed; the rest of the API is unchanged and out of scope here.

## 1. Service

What Index runs and exposes over REST. The CLI is a thin client over it; MCP is frozen at today's intent and opportunity surface and carries none of the agent surfaces.

### Identity

| Method | Status | Description |
|---|---|---|
| `register_agent` | exists | Create the agent record for the authenticated owner. |
| `read_own_agent` | exists | The calling agent's own record and permissions. |
| `mint_agent_token` | exists | Owner mints an agent-bound API key. Session only. |
| `grant_agent_permission` / `revoke_agent_permission` | exists | `manage:*` actions, globally or per network. Session only. |

### Intents

| Method | Status | Description |
|---|---|---|
| `create_intent` | exists | Infer and persist a signal from an utterance. Fires discovery. |
| `read_intents` | exists | The owner's intents with statement, status and networks. |
| `update_intent` | exists | Edit the statement; re-fires discovery, cascades nothing. |

### Discovery

`create_intent` and `update_intent` fire a background discovery run. HyDE per lens, semantic search across the owner's networks, the match explainer scoring every candidate in the pool (capped at 80, no cutoff). Discovery then creates an opportunity for every candidate, status `negotiating`, with a negotiation record alongside it, the triggering intent's seat as initiator, and emits `negotiation.turn` to that seat. On the #1552 branch discovery stops at a candidates table and nothing opens them; this is the one change to discovery, and the candidates table and `createAndOpen` become internal to it. There is no separate open decision: whether a match is worth pursuing is the initiator's first turn, `propose` or `decline`, and a decline costs one model turn and reaches no human.

### Opportunities

| Method | Status | Description |
|---|---|---|
| `list_opportunities` | exists | The owner's opportunities, filterable by intent and status. Radar shows `pending` and `stalled`; declined-on-first-turn ones never surface. |
| `accept_opportunity` / `reject_opportunity` | exists | Owner-proof gated. |
| `issue_owner_approval` | exists | REST, session only. Stays session only. |

Status is written by the negotiation record and by consent. No agent calls `update_opportunity`.

### Negotiation

One record per opportunity: two seats, a turn log, `awaiting` (which seat, or `party` when a seat is holding for its principal), and a settlement. Index computes the settlement itself from its own turn log: `agreed` when an `accept` binds to the standing offer, `declined` on a `decline`, `conflict` when the closing turns name different terms, `unconfirmed` when a terminal turn carries no terms. That is service code, not a library. Both sides read the same verdict from the same record. There is nothing to mirror and nothing to verify client-side. The decision vocabulary and the terms shape are the `submit_turn` schema; that schema is the contract, and every seat, hosted or external, speaks it. The record carries the counterparty's intent statement; that, the turn messages, and the terms are all a seat ever sees of the other side.

| Method | Status | Description |
|---|---|---|
| `read_negotiation` | change | REST task reads exist; replace with one read keyed by opportunity: seats, turns with their structured decisions and terms, `awaiting`, settlement when ended. |
| `list_negotiations` | change | Deleted by #1552; reinstate. The owner's negotiations with state, `awaiting`, outcome and counterparty, filterable by intent. Backs Radar's "waiting on you", the web page, the CLI, and polling. |
| `submit_turn` | new | The seat whose turn it is submits one structured decision with a message and terms. Index validates the turn order, appends it, and applies the action's effect. `propose` and `counter`: flip `awaiting` to the other seat, emit `negotiation.turn`. `accept` bound to the standing offer: settlement, opportunity `pending`, `negotiation.settled` to both. `decline`: settlement, opportunity `rejected`, `negotiation.settled` to both. `hold`, with the question for the principal: the turn stays with the holder, `awaiting: party`, opportunity `stalled`, the other seat is told it is waiting. |

When the owner rejects, accepts, or archives the intent, Index closes the negotiation itself. No seat declines anything; the next `list_negotiations` shows it closed.

### Hosted seat

For a user whose agent takes no turns of its own, Index runs `@indexnetwork/agent` for them: the same loop, the same tools, the same objective built from the intent statement and conversation history. On `negotiation.turn` the run reads the record and calls `submit_turn`. Nothing in the record says which kind of seat produced a turn, because there is only one kind of seat.

### Conversation history

There is no policy document and no dossier. The agent DM is the memory. Untagged messages hold for every intent ("only people who will do work with me", "two good intros a week"); messages tagged with an intent hold for that intent. Every seat, hosted or external, builds its objective from the intent statement plus this history. The owner changes what the agent believes by saying something new.

| Method | Status | Description |
|---|---|---|
| `send_agent_message` | new | The agent posts as the agent into its owner's agent conversation, tagged with `intentId`. Questions only; outcomes are in Radar. |
| `read_agent_messages` | change | `GET /conversations/:id/messages` exists. Add a filter: `intentId` returns that intent's messages plus the untagged ones; no filter returns the untagged ones. |

### Events

Delivered over `GET /notifications/stream`. Every first-party client receives them through `index agent watch`; the hosted seat receives them in process. Anything else polls `list_negotiations`. A push URL on the agent record can be added when a reachable harness asks for it; nothing needs it to work.

Index to the agent

| Event | Status | Fires when | Payload |
|---|---|---|---|
| `negotiation.turn` | new | It is this seat's turn. The whole negotiation loop hangs on this event. | `opportunityId`, `intentId`, `turnIndex` |
| `negotiation.settled` | new | A terminal pair of turns was recorded and the settlement computed. | `opportunityId`, `intentId`, `outcome` |
| `message.new` | new | The owner replied in the agent DM. | `conversationId`, `messageId`, `intentId` |

Index to the human

| Event | Status | Fires when | Payload |
|---|---|---|---|
| `opportunity.new` | change | The opportunity reached `pending`. Add the ids to the frame. | `opportunityId`, `intentId`, title, body, link |
| `message.new` | new | The agent posted a question in the DM. | `conversationId`, `messageId`, `intentId`, link |

## 1b. Libraries

Code a host or an agent embeds. None of it is reachable over the network; all of it calls the service. One package.

| Library | Surface | Used by | Description |
|---|---|---|---|
| `@indexnetwork/agent` | `Agent`, `for(intent)`, `run()`, inbox, tick | every scope, the hosted seat | The loop: on a tick or an owner reply, one run over the intent's batch: every turn, one ask. Resumes in any process. No a2a dependency; the `negotiate` and `answer` tools are gone, the run replaces them. |
| `@indexnetwork/agent` | `ask_user` | intent scope | Suspend the run with a question. Lands in the DM through `send_agent_message`. |
| `@indexnetwork/agent` | history store, sessions store | host | Persist the run so it resumes in another process. The DM is the durable record; the store holds the run's own messages. |
| `@indexnetwork/agent` | injected tools | host | The service calls above, handed to the loop as tools: `read_intent`, `read_agent_messages`, `list_negotiations`, `read_negotiation`, `submit_turn`. A turn is the model calling the last one. |
| `@indexnetwork/cli` | `index agent run`, `index agent watch`, `index agent answer` | Hermes, Claude Code, any laptop | The package packaged for a machine: `run` executes the loop once, `watch` holds the notification stream and runs on events, `answer` passes the person's reply into the DM and resumes. |
| Claude Code plugin, Hermes plugin | the CLI and one skill | harnesses | Install the CLI, `index login`, start `index agent watch`, relay questions to the person and answers back with `index agent answer`. No MCP, no loop of the harness's own. |

## 2. Personal agent, global

| Method | Status | Description |
|---|---|---|
| `read_intents` | service, exists | Which intents are active; each becomes an intent scope. |
| `read_agent_messages` | service, change | Untagged messages: what the owner has told the agent that holds for every intent. |

## 3. Personal agent, intent

| Method | Status | Description |
|---|---|---|
| `read_intent` | service, exists | The statement for this scope. |
| `read_agent_messages` | service, change | Filtered to this intent plus the untagged messages. The objective is built from this and the statement. |
| `list_negotiations` | service, change | Filtered to this intent: which are waiting on this seat, which are holding for the owner. |
| `ask_user` | library | Every question about this intent, coalesced across negotiations, posted through `send_agent_message` tagged with the intent. Suspends the run. |

The judgment this scope owns is the run over the batch: what to ask and when, what one negotiation teaches another, when enough is enough. Section 5.

## 4. Negotiation

The seat. The agent loop handling one `negotiation.turn`: read the record, take one model turn, call `submit_turn`. Talks only to Index. Hosted or external, same loop, same tools.

| Method | Status | Description |
|---|---|---|
| `read_negotiation` | service, change | The turns so far, terms on the table, `awaiting`, the counterparty's statement. On an empty log this is the match judgment: `propose` or `decline`. |
| `submit_turn` | service, new | `propose`, `counter`, `accept`, `decline`, or `hold` with the question for the principal, with a message and terms in the schema's shape. `hold` is the ask path: the turn stays here and the intent scope carries the question to the owner. |

Crosses to the other seat: the intent statement, the negotiation messages, the terms. Never the DM. Index enforces this because Index is what the other seat reads.

## 5. Inbox and wake pattern

The run is the unit, not the event. Every `negotiation.turn`, `negotiation.settled`, and `message.new` for an intent lands in that intent's inbox and waits.

**Two triggers, nothing else**

- **Cadence.** A run starts on a tick if the inbox is non-empty. Events during a run wait for the next tick. A negotiation advances one turn per side per tick, so its pace is the slower of the two seats' cadences; that is the rate limit. The tick is one constant in the package, minutes not seconds.
- **The owner replied.** `message.new` from the owner starts a run at once; a human is waiting and everything held on that answer can move. Whatever else is in the inbox rides along.

**One run, one task**

The run reads the batch and acts on it in one pass: `list_negotiations` for the intent, the reply if there is one, the history, all in one context. From that it produces one `submit_turn` per negotiation waiting on this seat, propose, counter, accept, decline, or hold, and at most one `ask_user` covering every hold the open message does not already cover. Because the whole batch is in one context, the same question asked by three counterparties is one question, a settled match can end the rest, and "two good intros a week" holds. Nothing per event, nothing bolted on afterwards.

**Waiting on an answer**

- The held negotiation sits at `awaiting: party` with its question. Nothing runs for it; the counterparty's seat skips it on their ticks; their opportunity shows `stalled`.
- The rest of the intent keeps moving. Ticks continue, other negotiations take turns.
- A new hold that asks what the open message already asks posts nothing; it waits behind it, and the answer applies to it too. A new hold that asks something different posts a new message beneath the open one. Two open questions, each its own message, each linked from Radar. No editing, no merging, no cap, no reminder. Whether a question is already covered is the run's judgment, made in the same run that would otherwise post.
- Each open question is one message in the DM with the personal agent, and it is answered there. No reminders, no re-asks.
- The answer arrives as `message.new` and starts a run at once. Every held negotiation and every open question is in context; the run submits a turn for each hold the reply covers and leaves the rest held. One reply can answer two questions, or one, or half of one. Nothing routes; the run reads.
- Never answered: the existing expiration cron expires a `stalled` opportunity past its window, Index closes the negotiation, both seats see it closed on their next tick. The wait has a ceiling and it is Index's.
- Nothing to persist. The question is on the record, the message is in the DM; every tick rebuilds from those two, so a restart changes nothing.

**The DM is where questions live and are answered.** Radar is the index over it: waiting on you, from `list_negotiations` at `awaiting: party`, grouped by intent, each linking to its question in the DM; needs your verdict, from `list_opportunities` at `pending`. Nothing is asked or answered anywhere but the DM.

**Lives in `@indexnetwork/agent`.** The hosted seat feeds inboxes from in-process events, `index agent watch` from the stream. Same code, same tick. The service adds nothing: no queue, no job table.

**Not built yet, deliberately.** A per-user quiet window across intents, and editing the open question in place. Both wait for someone with three active intents.

## New, in total

| Kind | Items |
|---|---|
| Record | the negotiation: seats, turn log, `awaiting`, settlement |
| Events | `negotiation.turn`, `negotiation.settled`, `message.new`; ids on `opportunity.new` |
| Service tools | `submit_turn`, `send_agent_message`; `intentId` filter on `read_agent_messages` |
| Reinstated reads | `list_negotiations`, `read_negotiation` |
| Service, internal | discovery opens every candidate, turn validation and settlement, the hosted seat running the agent package, closing negotiations on consent or archive |
| Library | `@indexnetwork/agent` loses its a2a dependency and its `negotiate`/`answer` tools; `index agent run` and `index agent watch` in the CLI |

## Flow

Maya wants co-authors for a paper on how agents reach agreement. Leo builds a multi-agent product and wants a researcher to work with. Maya's agent is `@indexnetwork/agent` run by Index. Leo's is the same package on his own machine under `index agent watch`.

1. **Setup** — global
   - `register_agent`, `mint_agent_token`
   - each owner tells their agent, in the DM, untagged — Maya: "only people who will do work with me; in person if same city." Leo: "two good intros a week; no unpaid advisory." That is the whole configuration.

2. **Intent** — service
   - `create_intent` — Maya
   - discovery → 12 opportunities `negotiating`, 12 negotiation records with Maya's seat as initiator
   - event `negotiation.turn` ×12 → Maya's inbox for this intent; next tick, one run

3. **First run** — Maya's seat, one pass over twelve
   - in context: twelve empty logs, twelve counterparty statements, her history
   - 11 advisory-shaped ones: `submit_turn(decline)` → `rejected`, `negotiation.settled`, no human sees them
   - Leo: `submit_turn(propose)`: co-author, Leo brings real negotiation logs
   - nothing held, nothing to ask
   - event `negotiation.turn` → Leo's `watch` → his loop runs

4. **Reply** — negotiation scope, Leo
   - `read_negotiation` → `submit_turn(counter)`: aggregates and a redacted sample only; co-authorship, not an acknowledgement
   - event `negotiation.turn` → Maya's seat

5. **Hold** — Maya's next tick
   - unknown whether aggregates suffice, unknown on authorship → `submit_turn(hold, question)` → `awaiting: party`, opportunity `stalled`; Leo's seat is told Maya's side is waiting on its principal
   - one hold, one question → `ask_user` → `send_agent_message` tagged with the intent → event `message.new` → Maya

6. **Answer** — Maya replies, immediate run
   - Maya: "aggregates are enough if I can name the product; co-author fine, I'm first author"
   - event `message.new` → her agent, run starts now; the reply is in the history for this intent
   - `read_negotiation` → `submit_turn(counter)`: those terms, first meeting in person, both in Berlin
   - event `negotiation.turn` → Leo's `watch`

7. **Settle** — negotiation scope and service
   - Leo's seat: one turn under his history → `submit_turn(accept)`, bound to the standing offer
   - Index computes the settlement: `agreed`, basis `terms`; opportunity → `pending`
   - event `negotiation.settled` → both seats; nothing to do

8. **Consent** — service
   - event `opportunity.new` → both humans; Radar shows the terms from the record
   - each owner: `issue_owner_approval` (session) → `accept_opportunity` with proof
   - both accepted → `accepted`; human conversation opens

**If Maya says no** — `reject_opportunity` → Index closes the negotiation. No seat declines anything. Leo sees it closed in Radar; his agent sees it closed on its next `list_negotiations`.

**Never happened** — no agent was called; no candidate waited for anyone to open it; no seat held a Task; nothing was mirrored; no policy was written anywhere but the DM; the DM never reached the record; no agent accepted for a human.

## What differs from the A2A version

| | With A2A | Without A2A |
|---|---|---|
| Where the negotiation lives | on the responder's server, as a Task; Index keeps a copy on park and end | in Index, as the record; there is no copy |
| How a turn moves | HTTP `message/send` to the counterparty's URL | `submit_turn` against Index; the counterparty is notified |
| Asking the principal | `ask` intercepted before the wire, Task parks | `submit_turn(hold)`; the record says `awaiting: party` |
| Settlement | each side runs `verifyAgreement` over the shared Task | Index computes it once over its own log, in service code |
| Reachability needed | a public URL per seat, or a hosted seat | none; the stream or polling |
| Hosted seat | a real A2A server Index runs for the user | a caller of `submit_turn` Index runs for the user |
| Hermes, Claude Code, CLI | need a sidecar or the hosted seat to negotiate | negotiate directly, on their own turn, from wherever they run |
| Third-party agents | any A2A agent, registered with Index or not | must register with Index and hold an agent token |
| Two Index deployments | can negotiate across | cannot |
| Who is in the middle | Index for discovery and consent only | Index for everything |
| New service tools | 7 | 2, plus one filter |
| Libraries | `@indexnetwork/a2a` and `@indexnetwork/agent` | `@indexnetwork/agent` only |
| Net complexity | a wire, a card, a Task store, a mirror | a record and a turn validator |
