# @indexnetwork/agent-tui

A terminal testing platform for personal agents. It displays one H2A conversation
per principal/intent and a separate A2A conversation per match. Agent behavior is
owned by `@indexnetwork/agent`; participation rules belong to
`@indexnetwork/protocol`.

## Run a scenario

From the repository root:

```bash
bun install
bun --env-file=.env.development run agent:tui
```

Requires `OPENROUTER_API_KEY` and an interactive terminal. Choose a JSON scenario
with Up/Down + Enter or a click. The default roster has 12 users and 66 simulated
matches. All matches start automatically in the background. Changing a pane only
changes what you see.

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
Select intents belonging to at least two users. Only selected personal agents
run; an unselected counterparty needs its own runtime to respond. Each selected
agent handles all its existing and newly received matches independently of the
visible pair. Normal API discovery creates new matches; the TUI does not seed
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
| Click a name / Ctrl+U | Choose the principal/intent for that side |
| Up/Down, Enter | Select and confirm a user or suggested answer |
| Tab | Move between H2A, A2A, and H2A panes |
| Ctrl+N | Cycle through matches between the selected intents |
| Enter in the text box | Answer the displayed question, or message the personal agent when none is active |
| Custom reply / click the text box | Write an answer in your own words |
| Esc | Return from custom editing to choices, or close a selector |
| Ctrl+J | Insert a newline |
| Mouse wheel / PgUp / PgDn | Scroll the selected history |
| Ctrl+C | Stop the local run |

Drafts follow their principal/intent. Questions keep their ID, wording, scope,
and match references while you answer. Related requests for an intent-wide fact
can join an existing question internally; approvals remain specific to a match.
Routine A2A progress stays in the center; the principal agent decides which
questions and outcomes deserve an H2A message. An unmatched pair shows an empty
A2A pane.

## Scenario format

Add a JSON file under `scenarios/`:

```json
{
  "users": [
    { "id": "alice", "name": "Alice", "intent": "Find a design partner", "instructions": "I am a frontend engineer. Ask before committing me to work." },
    { "id": "bob", "name": "Bob", "intent": "Find an engineering partner", "instructions": "I am a product designer. Ask before committing me to work." }
  ]
}
```

IDs must be unique; all four fields are required. Scenario `instructions` are
private fixture context injected as the agent's `principalContext`. The API host
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
