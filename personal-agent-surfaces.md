# Personal agent surfaces

Index is a social discovery protocol: people find investors, founders, collaborators, dates, and researchers through their agents. An intent says who someone is looking for; a negotiation is two agents working out whether a specific pair is worth the humans' time and on what footing; consent is the humans saying yes. The surfaces below exist to carry that, and nothing else.

Three scopes, one owner per surface. Calls go down, results come up. The negotiation scope never calls Index; the intent scope writes to Index through one call and asks the user about its own intent; the global scope owns the DM and speaks only about the agent itself. The live Task stays where A2A puts it; Index keeps its own copy on park and on end so the owner's history survives counterparties.

Status legend: **exists** on the PR #1552 branch · **change** to an existing surface · **new** · **package** provided by `@indexnetwork/agent` or `@indexnetwork/a2a`.

## 1. Protocol

What Index exposes over MCP and REST. Records, gates, refuses the impossible. No judgment.

### Identity

| Method | Status | Description |
|---|---|---|
| `register_agent` | exists | Create the agent record for the authenticated owner. |
| `read_own_agent` | exists | The calling agent's own record, permissions and transports. |
| `update_agent` | exists | Name, description, metadata. |
| `delete_agent` | exists | Remove the agent and everything keyed to it. |
| `list_agents` | exists | The owner's agents. |
| `grant_agent_permission` | exists | Grant `manage:*` actions, globally or per network. Session only. |
| `revoke_agent_permission` | exists | Revoke one grant. Session only. |
| `add_agent_transport` | change | REST today with channel `mcp` only. Add channel `a2a` with config `{ url }`. This is how the agent becomes reachable. |
| `remove_agent_transport` | exists | Delete one transport. |
| `mint_agent_token` | exists | Owner mints an agent-bound API key. Session only. |

### Intents

| Method | Status | Description |
|---|---|---|
| `create_intent` | exists | Infer and persist a signal from an utterance. |
| `read_intents` | exists | The owner's intents with statement, status and networks. |
| `update_intent` | exists | Edit the statement; re-fires discovery, cascades nothing. |
| `delete_intent` | exists | Archive the intent. |
| `search_intents` | exists | Semantic search across intents the agent may see. |

### Networks

| Method | Status | Description |
|---|---|---|
| `read_networks` | exists | Networks the owner belongs to. |
| `create_network` / `update_network` / `delete_network` | exists | Network lifecycle. |
| `read_network_memberships` | exists | Memberships for the owner or a network. |
| `create_network_membership` / `delete_network_membership` | exists | Join and leave. |

### Discovery and candidates

`create_intent` and `update_intent` fire a background discovery run. The graph generates HyDE documents per lens, searches intents across the owner's networks, asks the match explainer for a score and reasoning on every candidate in the pool (capped at 80, no cutoff), and upserts one row per pair into `discovery_match_candidates`, keyed by pair so two runs never race. Discovery creates no opportunity. Opening a candidate is a separate decision, and on the #1552 branch nothing makes it: the adapter's `createAndOpen` exists with no caller.

| Method | Status | Description |
|---|---|---|
| `list_candidates` | new | Pending discovery candidates for one of the owner's intents: the counterparty's intent statement in their words, their `agent.url`, score, reasoning, evidence, network. Backed by `discovery_match_candidates`. |
| `open_opportunity` | new | Open one candidate. Calls the existing `createAndOpen`: creates the opportunity as `negotiating` under the pair-key lock, stamps the candidate, returns the opportunity. The caller's agent is the initiator. Emits `opportunity.created` to both owners' agents. |

### Opportunities

| Method | Status | Description |
|---|---|---|
| `list_opportunities` | change | Opportunities for the owner, filterable by intent and status. Add `counterpart.intent` (the counterparty's statement in their words) and `counterpart.agent.url` (resolved from their active `a2a` transport). |
| `read_opportunity` | change | REST `GET /opportunities/:id` exists; expose over MCP with the same two fields. |
| `update_opportunity` | exists | Status only. Not called by the agent; `record_negotiation` sets status from the settlement. |
| `accept_opportunity` | exists | Owner-proof gated. The agent relays the challenge, never self-approves. |
| `reject_opportunity` | exists | Owner-proof gated. |
| `issue_owner_approval` | exists | REST, session only. The human approves one exact interaction. Stays session only. |

### Negotiation record

Index keeps its own copy of every negotiation, independent of which A2A server holds the live Task, so the owner's history is listable and readable after counterparties are gone.

| Method | Status | Description |
|---|---|---|
| `record_negotiation` | new | Write the A2A Task JSON (id, status, turn history, artifacts), the settlement from `verifyAgreement` (`outcome`, `terms`, `basis`, `reason`), our side, and the counterparty URL, keyed by opportunity. Called by the intent scope once on park and once on end, never per turn. Sets the opportunity status from the settlement: parked or out of turns is `stalled`, agreed is `pending`, declined or conflict is `rejected`. `accepted` stays reachable only through `accept_opportunity`. |
| `read_negotiation` | change | REST `GET /conversations/:id/tasks/:taskId` exists; expose over MCP keyed by opportunity, returning the stored Task and settlement. |
| `list_negotiations` | change | Deleted by #1552. Reinstate as read-only: the owner's negotiations with outcome, last settlement and counterparty, filterable by intent. Backs the web negotiations page and the CLI. |

### Agent memory

| Method | Status | Description |
|---|---|---|
| `read_agent_policy` | new | One document per agent: the owner's standing rules ("never accept on my behalf", "two great intros beat ten okay ones"). |
| `update_agent_policy` | new | Owner edits from the web; the agent reads at the start of every run. |

### Agent DM

| Method | Status | Description |
|---|---|---|
| `send_agent_message` | new | The agent token posts as the agent into its owner's agent conversation. One conversation per owner; every message tagged with `intentId`. |
| `read_agent_messages` | exists | `GET /conversations/:id/messages`. |
| `stream_conversation` | exists | `GET /conversations/stream`, live messages. |

### Events

Two directions. To the agent: over `GET /notifications/stream` for an agent outside the host, direct event hooks inside it. To the human: the same stream, feeding desktop toasts and the web. Inbound A2A messages from a counterparty reach the agent's handler directly and never pass through Index. An intent edit re-fires discovery, so the next `candidates.ready` follows it and needs no event of its own.

Index to the agent

| Event | Status | Fires when | Payload |
|---|---|---|---|
| `candidates.ready` | new | A discovery run for one of the owner's intents finished and upserted candidates. The intent scope starts a run to decide which to open. Emitted by discovery at the end of `emitCandidates`. | `intentId`, `candidateCount` |
| `opportunity.created` | new | An agent opened a candidate with `open_opportunity`. Both owners' agents receive it; the opener already has the id, the responder needs it to record against. The existing transition hook never fires on creation, so `open_opportunity` emits it. | `opportunityId`, `intentId`, `initiatorAgentId`, `counterpart.agent.url` |
| `message.new` | new | The owner replies in the agent DM. The run resumes with the answer. | `conversationId`, `messageId`, `intentId` |
| `opportunity.resolved` | new | The owner accepts or rejects in Radar, or the opportunity expires. The agent closes any live or parked negotiation and tells the counterparty. Backed by the existing status-transition hook. | `opportunityId`, `intentId`, `status` |
| `intent.archived` | new | The owner archives or deletes the intent. The scope is dropped and open negotiations declined. | `intentId` |

Index to the human

| Event | Status | Fires when | Payload |
|---|---|---|---|
| `opportunity.new` | change | The opportunity needs the owner's verdict, meaning it reached `pending`. Already wired to the actionable hook. Add the ids to the frame. | `opportunityId`, `intentId`, title, body, link |
| `message.new` | new | The agent posts a question or a message in the DM. Same event as above; consumers filter by sender. | `conversationId`, `messageId`, `intentId`, link |

## 2. Personal agent, global

Tools injected into `new Agent({ identity, systemPrompt, tools })`. One identity per owner. Owns the DM as a container; every question about an intent is asked from the intent scope and tagged with it.

| Method | Status | Description |
|---|---|---|
| `read_intents` | exists | Which intents are active; each becomes a `for(intent)` scope. |
| `read_agent_policy` | new | Standing rules, prepended to every objective. |
| `message_user` | new | Agent-level notices only: set up, policy applied, an intent archived. Never a question about an intent. |
| `agent.card()` | package | The public A2A AgentCard served at the registered `a2a` URL. |
| `agent.handler()` | package | The inbound A2A handler mounted at that URL. |

## 3. Personal agent, intent

Tools available inside `agent.for(intent)`. One run per owner and intent. The only scope that writes to Index, through one call. Memory across runs is the package's history store plus the agent DM; there is no separate dossier.

| Method | Status | Description |
|---|---|---|
| `read_intent` | exists | The statement for this scope. |
| `read_agent_messages` | exists | The agent DM filtered by this intent, loaded at the start of the run. It is the record of what the owner has said; the objective is built from it. |
| `list_candidates` | new | Pending candidates for this intent, with counterpart statement, agent URL, score and reasoning. |
| `open_opportunity` | new | The judgment this scope owns: which candidates are worth a negotiation, under the policy. Opening makes this agent the initiator. |
| `list_opportunities` | change | Open opportunities for this intent, with counterpart intent and agent URL; the responder side finds the opportunity it was opened into here. |
| `negotiate` | package | Opens every target concurrently, runs each to an event, returns one digest. |
| `answer` | package | Folds the owner's reply into every negotiation it applies to; standing for the rest of each. |
| `ask_user` | package | Every question about this intent. Coalesces same-kind questions across negotiations into one ask; posted into the DM tagged with the intent. |
| `message_user` | new | Settlement summaries and other intent-level notices, into the DM tagged with the intent. |
| `record_negotiation` | new | Once on park, once on end. The only write to Index from this scope; it sets the opportunity status. |

## 4. Negotiation

The negotiator's vocabulary inside one A2A task. No Index calls. Reports one event upward: settled, waiting on the party, or out of turns.

| Method | Status | Description |
|---|---|---|
| `propose` | package | Open with terms. |
| `counter` | package | Reply with different terms. |
| `accept` | package | Bind to the offer named. Reads as the agents' joint recommendation, never the human's consent. |
| `decline` | package | End without a deal. |
| `ask` | package | Offered only under `negotiate`. Intercepted before the wire; parks the task with its question. |
| `message/send` | package | A2A wire call to the counterparty's URL. |
| `tasks/get` | package | Read the shared Task from the server side. |
| `verifyAgreement` | package | Settlement verdict computed from the Task, same on both sides. |

Crosses the wire: the intent statement and the terms. Never the DM transcript or the policy.

## New, in total

| Kind | Items |
|---|---|
| Enum value | transport channel `a2a` |
| Card fields | `counterpart.intent`, `counterpart.agent.url` |
| Events | `candidates.ready`, `opportunity.created`, `message.new`, `opportunity.resolved`, `intent.archived`; ids added to `opportunity.new` |
| Tools | `list_candidates`, `open_opportunity`, `record_negotiation`, `read_agent_policy`, `update_agent_policy`, `send_agent_message`, `message_user` |
| Reinstated reads | `list_negotiations`, `read_negotiation` |

## Flow

Maya wants co-authors for a paper on how agents reach agreement. Leo builds a multi-agent product and wants a researcher to work with. Same flow for investors, founders, dates, collaborators; only statements, policies and terms change.

1. **Setup** — global
   - `register_agent`, `mint_agent_token`, `add_agent_transport { a2a, url }`
   - `update_agent_policy` — Maya: "only people who will do work with me; in person if same city." Leo: "two good intros a week; no unpaid advisory."

2. **Intent** — protocol
   - `create_intent` — "co-authors for a workshop paper on agent agreement, six weeks"
   - discovery: HyDE per lens → semantic search across networks → match explainer scores every candidate
   - `discovery_match_candidates` ← 12 rows, Leo among them. No opportunity yet.
   - event `candidates.ready` → Maya's agent

3. **Decide** — intent scope
   - `read_intent`, `read_agent_policy`, `read_agent_messages` (this intent, empty)
   - `list_candidates` → 12 cards: statement, agent URL, score, reasoning
   - judgment under policy: Leo fits, the advisory ones do not
   - `open_opportunity(Leo)` → opportunity `negotiating`; Maya's agent is initiator
   - event `opportunity.created` → both agents. Leo's agent notes the id, waits for the wire.

4. **Negotiate** — negotiation scope
   - `negotiate` → `propose` over `message/send` to Leo's URL: co-author, Leo brings real negotiation logs
   - Leo's `agent.handler()` → his negotiator → `counter`: aggregates and a redacted sample only; co-authorship, not an acknowledgement

5. **Park** — negotiation → intent scope
   - Maya's negotiator: unknown whether aggregates suffice, unknown on authorship → `ask`
   - intercepted before the wire; Task parks; Leo's agent sees nothing
   - `negotiate` returns: 1 waiting on the party
   - `record_negotiation` → `stalled`
   - `ask_user` → run suspends, nothing held open

6. **Ask** — intent scope, via the agent DM
   - `send_agent_message` (tagged with the intent) → event `message.new` → Maya
   - Maya replies: "aggregates are enough if I can name the product; co-author fine, I'm first author"
   - event `message.new` → Maya's agent

7. **Resume and settle** — intent + negotiation scopes
   - run resumes with the reply → `answer` → standing guidance for this negotiation
   - `counter`: those terms, first meeting in person, both in Berlin
   - Leo's negotiator checks policy → `accept`, bound to that offer
   - `verifyAgreement` on Maya's side: `agreed`, basis `terms`
   - both agents: `record_negotiation` (final Task) → `pending`; `message_user` one-line summary; run ends `done`

8. **Consent** — protocol
   - event `opportunity.new` → both humans; Radar shows the terms
   - each owner: `issue_owner_approval` (session) → `accept_opportunity` with proof. No agent can do this.
   - both accepted → `accepted`; human conversation opens
   - event `opportunity.resolved` → both agents; nothing left to do

**If Maya says no** — `reject_opportunity` → `opportunity.resolved` → her agent sends `decline` over the wire, records the final Task. Leo hears from his own agent, without a reason.

**Never happened** — discovery created no opportunity; the negotiation scope never called Index; the DM never crossed the wire; no agent accepted for a human; Index set only `negotiating` at open and `accepted` at consent.
