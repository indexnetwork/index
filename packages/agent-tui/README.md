# @indexnetwork/agent-tui

A terminal testing platform for personal agents. It displays one pane per selected
user, with an intent selector and an independent H2A conversation for each
user–intent pair. A two-user board can also display its selected intents' A2A
conversation. Agent behavior is
owned by `@indexnetwork/agent`; participation rules belong to
`@indexnetwork/protocol`.

## Run a scenario

From the repository root:

```bash
bun install
bun --env-file=.env.development run agent:tui
```

Requires `OPENROUTER_API_KEY` and an interactive terminal. Choose a JSON scenario
with Up/Down + Enter or a click. The default roster has 12 users, two intents per
user, and 264 simulated matches between different users' intents. All 24 personal
agents and their matches run independently of the visible board. Changing users,
intents, or collapsed panes only changes what you see.

Override the shared model client's ordered model list with one to three IDs:

```bash
bun --env-file=.env.development run agent:tui google/gemini-3.8-flash anthropic/claude-haiku-4.5
```

The model client owns rate-limit waiting and model switching. No HTTP server,
Redis, or database are required for the scenario host. Ctrl+C stops
all agents and saves a private Markdown transcript in a temporary directory.
Each scenario launch starts fresh.

## Run against the API database

```bash
bun run --cwd services/api agent:tui
```

This local development command loads the root `.env.development`. It uses the
API's Postgres and Redis connections and real existing users, intents, matches,
and H2A messages. Run this standalone command with the normal API server stopped
so it can acquire the selected sessions. The normal server now starts agents
automatically; both entry points use the same exclusive session leases.

Choose principal/intent sessions with Space or a click, then Enter to start.
Select intents belonging to at least two users. Select every intent you want to
switch between: the board's intent selectors offer these startup selections.
Only selected personal agents run; an unselected counterparty needs its own
runtime to respond. Each selected agent handles all its existing and newly
received matches independently of the visible board. Normal API discovery creates new matches; the TUI does not seed
users or bypass matching.

The command calls API services as the selected principals directly. This is a
trusted local testing entry point; HTTP authentication, scope checks, and human
consent gates remain enforced. A principal with a selected external negotiation
executor must release that binding before its local agent can run.

H2A messages and checkpoints are persisted in the same transaction. Restarting
restores the conversation, pending question, related requests, and outstanding
work, then rereads the A2A records. Session leases prevent two local processes
from running the same principal/intent. Ctrl+C releases leases and retains state;
a crashed process's lease expires after 60 seconds.

For single-user testing through normal HTTP authentication and the web app,
see [the API's live testing instructions](../../services/api/README.md#personal-agents-and-live-web-testing).

## Controls

| Control | Action |
| --- | --- |
| Users button / Ctrl+U | Open the board roster; Space/click toggles users, Enter applies, Esc cancels |
| Click the intent header / Ctrl+T | Choose that user's intent with Up/Down + Enter or a click; Esc cancels |
| Header [−] / Ctrl+O | Collapse a chat, keeping at least one expanded |
| Click a collapsed user | Expand and focus their selected intent |
| Up/Down, Enter | Select and confirm a suggested answer |
| Tab / Shift+Tab | Cycle users in roster order, expanding collapsed chats; include A2A only when visible |
| Ctrl+N | Cycle matches between the selected intents while A2A is visible |
| Enter in the text box | Answer the displayed question, or message the personal agent when none is active |
| Custom reply / click the text box | Write an answer in your own words |
| Esc | Return from custom editing to choices, or close a selector |
| Ctrl+J | Insert a newline |
| Mouse wheel / PgUp / PgDn | Scroll the selected history |
| Ctrl+C | Stop the local run |

Every supplied user starts on the board with their first supplied intent selected.
The roster requires at least two distinct users. Expanded chats share the width
equally, targeting at least 40 columns each. Overflow collapses from the end of
roster order while preserving the focused user. A 24-column scrollable list shows
collapsed users, their selected intent, and counts of pending and queued questions
across their intents. Selecting a collapsed user displaces another chat if needed.
Widening restores automatically collapsed chats; manually collapsed chats stay
collapsed until selected.

A2A appears between two expanded users at 122 columns or wider. It hides before
H2A chats collapse, and always stays hidden with three or more users on the board,
including collapsed users. An unmatched pair shows an empty A2A pane.

Each user–intent pair retains its agent, draft, history and scroll position,
suggested-answer selection, pending questions, and in-flight sends through intent,
roster, and layout changes. Questions keep their ID, wording, scope, and match
references while you answer. Related requests for an intent-wide fact can join an
existing question internally; approvals remain specific to a match. The personal
agent decides which questions and outcomes deserve an H2A message.

## Scenario format

Add a JSON file under `scenarios/`:

```json
{
  "users": [
    {
      "id": "alice", "name": "Alice",
      "instructions": "I am a frontend engineer. Ask before committing me to work.",
      "intents": [
        { "id": "prototype", "intent": "Find a design partner" },
        { "id": "research", "intent": "Find a researcher for an accessibility prototype" }
      ]
    },
    {
      "id": "bob", "name": "Bob",
      "instructions": "I am a product designer. Ask before committing me to work.",
      "intents": [
        { "id": "prototype", "intent": "Find an engineering partner" },
        { "id": "content", "intent": "Find a plain-language content designer" }
      ]
    }
  ]
}
```

User IDs must be unique, and intent IDs must be unique within each user. All shown
fields are required, with at least two users and at least one intent per user.
The `intents` array replaces the previous single `intent` field. Scenario
`instructions` are shared private context for that user's intent agents, injected
as each agent's `principalContext`. The API host
instead supplies confirmed profile fields, the current intent, and that intent's
stored H2A conversation. Neither host invents profile facts from an intent.

## Host injection

`mountNegotiationTui(renderer, host)` takes a `NegotiationTuiHost`: selectable
principal/intent entries, agent conversation/input handles, observed match records,
and a change event. It neither selects models nor schedules negotiations.
`NegotiationLab` implements this interface with in-memory storage and the protocol
capability. `ApiNegotiationHost` in `services/api` implements it with API services
and durable agent sessions. The libraries do not import one another; each host
composes them.

The protocol advertises available actions, validates submissions against the
current turn count, enforces 12 total A2A turns, and leaves an exhausted match
undecided. A2A agreement moves an opportunity to pending human review.

```bash
bun run --cwd packages/agent check
bun run --cwd packages/protocol build
bun run --cwd packages/agent-tui check
bun run --cwd packages/agent-tui build
```
