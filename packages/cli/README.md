# Index CLI

Command-line interface for [Index Network](https://index.network). Message your hosted personal agent, manage signals, and discover opportunities — all from your terminal.

## Installation

```bash
npm install -g @indexnetwork/cli@0.24.0
```

## Quick Start

Index helps you find the right people—and helps the right people find you—based on what you are actually trying to do, not just a profile headline. The value is grounded intros: suggestions come from communities you share (syndicates, founder groups, firm networks), not from spraying the open web.

The flow below is one complete story—shape a room, invite people, publish an approved signal, let broker agents evaluate in the background, then review a persisted match.

```bash
# login + setup
index login
index profile

# 1. express intent (signals)
index intent create "federated learning collaboration"

# 2. broker agents evaluate approved signals in the background
index negotiation list

# 3. wait for persisted opportunities, then review outcomes
index opportunity list --status pending
index opportunity show <opportunity-id>
index opportunity accept <opportunity-id>
```

Words you will see elsewhere in this doc: **network** = a community you are in; **intent** = your “what I am looking for” post; **opportunity** = a suggested introduction between you and someone else.

## Commands

### Command reference

Every exposed CLI command is listed below. Add `--json` for machine-readable
results; `conversation stream --json` emits one event per line. Command-specific
flags are listed in [Options](#options), and examples follow this reference.

| Command | Function |
| --- | --- |
| `index help` | Show global help; also available as `index`, `index --help`, or `index -h`. |
| `index version` | Show the installed version; also available as `index --version` or `index -v`. |
| `index login` | Sign in through the browser and store this device's session. |
| `index logout` | Revoke and clear the stored device session. |
| `index tool list` | List the API's protocol functions, descriptions, and input schemas. |
| `index tool call <name> --query '<json object>'` | Invoke any function in the [protocol tool reference](#protocol-tool-reference). |
| `index agent me` | Read the agent selected to handle your negotiations. |
| `index profile` | Show your own profile. |
| `index profile show <user-id>` | Show another user's accessible profile. |
| `index profile sync` | Research public profile information and return a suggested profile without persisting it. |
| `index intent list` | List signals, with optional archived and result-limit filters. |
| `index intent show <id>` | Show one signal. |
| `index intent create <text>` | Create a signal from its description. |
| `index intent update <id> <text>` | Update and reprocess a signal's description. |
| `index intent archive <id>` | Archive a signal so it stops participating in discovery. |
| `index intent add-to-network <id> <network-id>` | Share a signal in a network. |
| `index intent remove-from-network <id> <network-id>` | Stop sharing a signal in a network. |
| `index negotiation list` | List negotiations, optionally filtered by intent or open/settled state. |
| `index negotiation show <opportunity-id>` | Read the negotiation's turns, current state, and available actions. |
| `index negotiation turn <opportunity-id> --action <action> --message <text> --expected-turn-count <n>` | Submit one `propose`, `counter`, `accept`, or `decline` turn against the observed turn count. |
| `index opportunity list` | List persisted opportunities, with optional status and result-limit filters. |
| `index opportunity show <id>` | Show an opportunity's presentation and participants. |
| `index opportunity accept <id>` | Request acceptance through the server's owner-approval flow. |
| `index opportunity reject <id>` | Reject an opportunity. |
| `index network list` | List your networks. |
| `index network create <title>` | Create a network when eligible, or submit an early-access creation request. |
| `index network show <id>` | Show a network and its members. |
| `index network update <id> --title <text>` | Change a network's title. |
| `index network delete <id>` | Delete a network you own. |
| `index network join <id>` | Join an open network. |
| `index network leave <id>` | Leave a network. |
| `index network invite <id> <email>` | Invite a member by email. |
| `index conversation list` | List your conversations. |
| `index conversation with <user-id>` | Open or resume a human DM. |
| `index conversation show <id>` | Read messages; use `agent --intent-id <id>` for the personal agent's scoped messages and pending question. |
| `index conversation send <id> <text>` | Send a message; for `agent`, supply `--intent-id` and the displayed `--question-id` when answering a question. |
| `index conversation stream` | Subscribe to conversation, negotiation, opportunity, and intent events over SSE. |
| `index conversation help` | Show conversation-specific help. |
| `index onboarding confirm-profile` | Confirm that the owner has reviewed their profile. |
| `index onboarding complete` | Complete onboarding once profile confirmation and first-signal prerequisites are met. |
| `index scrape <url>` | Extract text from a URL, optionally guided by an objective. |
| `index sync` | Read your profile, networks, and signals into `~/.index/context.json`, or stdout with `--json`. |

### `index login`

Authenticate with Index Network. Opens a browser window that runs the device authorization grant against your existing session (or a fresh login), then hands this machine a session of its own.

```bash
index login                     # Browser-based auth
index login --api-url <url>     # Custom server URL
```

Credentials are stored in `~/.index/credentials.json`. Browser login explicitly requests protocol v2 and binds the loopback callback with a one-time state. Only a short-lived device code travels through the redirect; the CLI exchanges it at `/api/auth/device/token` for its own session token and sends that as `Authorization: Bearer`. There is no approval prompt, because the web page mints and approves the code itself — no code from anywhere else can enter the grant. A re-login revokes the session it replaces, so logins do not pile up.

For noninteractive calls, set exactly one credential:

```bash
export INDEX_API_URL='https://protocol.index.network'
export INDEX_API_KEY='<api-key>'
index --api-url "$INDEX_API_URL" tool list --json
```

`INDEX_SESSION_TOKEN` uses Bearer authentication; `INDEX_API_KEY` uses `x-api-key`.
Setting both fails. Environment credentials take precedence over stored browser
login. The API origin resolves from `--api-url`, then `INDEX_API_URL`, then the
stored credential URL, then `https://protocol.index.network`. Integrations pass
the origin explicitly. Agent management and other session-only operations still require a session.

### `index tool` and `index agent`

```bash
index tool list --json
index tool call read_docs --query '{}' --json
index tool call read_docs --query '{"topic":"workflows"}' --json
index agent me --json
```

Tool discovery includes the actual input schemas. `--query` must be a JSON
object; tool failures produce a structured error and a nonzero exit status.

#### Protocol tool reference

The API in this release exposes these 20 functions through `index tool call`.
Run `index tool list --json` against your selected API to read each function's
current input schema. The API enforces ownership, membership, and permission
checks when a function is invoked.

| Function | Purpose |
| --- | --- |
| `research_profile` | Research public identity information and return a suggested profile without persisting it. |
| `read_intents` | Read accessible signals with user, network, and pagination filters. |
| `create_intent` | Create a signal and link it to the explicitly supplied networks. |
| `update_intent` | Revise and reprocess a signal's description. |
| `delete_intent` | Archive a signal. |
| `add_intent_to_network` | Share a signal in a network. |
| `list_intent_networks` | List the networks a signal is shared in. |
| `remove_intent_from_network` | Remove a signal's link to a network. |
| `search_intents` | Search accessible signals by semantic similarity. |
| `read_networks` | Read accessible networks and their details. |
| `read_network_memberships` | Read network memberships and member information. |
| `update_network` | Update a network's settings. |
| `create_network` | Create a network, subject to the API's creation permissions. |
| `delete_network` | Delete a network you own. |
| `create_network_membership` | Join an open network or add a member when authorized. |
| `delete_network_membership` | Remove a member from a network you own. |
| `list_opportunities` | Read persisted opportunities and their presentation. |
| `update_opportunity` | Request an opportunity status transition under the server's lifecycle rules. |
| `scrape_url` | Extract text from a URL with an optional objective. |
| `read_docs` | Read canonical protocol guidance, optionally narrowed to a topic. |

Agent identity, negotiation turns, conversations, and onboarding use their
dedicated commands above and the corresponding REST endpoints.

### `index logout`

Revoke this machine's session server-side, then clear the local credential file. A session can revoke itself, so sign-out takes effect immediately without needing your browser. If the server cannot be reached the local file is still cleared, and logout tells you to revoke the device in Index web settings. If local cleanup fails, logout exits nonzero and asks you to remove the file manually.

```bash
index logout
```

### `index intent`

Manage your signals (intents). Create signals from natural language, list active signals, view details, and archive signals you no longer need.

```bash
index intent list                           # List active signals
index intent list --archived                # Include archived signals
index intent list --limit 5                 # Limit to 5 results
index intent show <id>                      # Show full signal details
index intent create "Looking for a CTO"     # Create from natural language
index intent update <id> "revised text"     # Update a signal (runs full pipeline)
index intent archive <id>                   # Archive a signal
index intent add-to-network <id> <network-id>      # Add a signal to a network
index intent remove-from-network <id> <network-id> # Remove a signal from a network
```

### `index negotiation`

Read current negotiations and submit structured turns using full opportunity IDs.

```bash
index negotiation list [--intent-id <id>] [--state open|settled]
index negotiation show <opportunity-id> --json
index negotiation turn <opportunity-id> --action propose --message "..." --expected-turn-count 0 --json
```

Actions are `propose`, `counter`, `accept`, and `decline`. Read the detail's
`protocol.availableActions` and current `turnCount` before submitting. The
server enforces eligibility and stale-count protection. The CLI preserves all
turns and protocol guidance and never retries a rejected or uncertain write.
Agreement between agents remains separate from the owner's opportunity approval.
`--limit`, `--since`, and `--status` are unsupported negotiation filters.

### `index opportunity`

Browse and manage discovered opportunities.

```bash
index opportunity list                     # List all opportunities
index opportunity list --status pending    # Filter by status
index opportunity list --limit 5           # Limit results
index opportunity show <id>                # Show full details
index opportunity accept <id>              # Accept an opportunity
index opportunity reject <id>              # Reject an opportunity
```

Status values: `pending`, `accepted`, `rejected`, `expired`.

### `index network`

Manage networks (communities). Network creation is direct for eligible staff; otherwise the command submits an early-access request. Invitations accept any valid email and use the server invitation flow.

```bash
index network list                     # List your networks
index network create "My Network"  # Create directly when eligible; otherwise submit an early-access request
index network create "AI" --prompt "AI researchers"  # Create or request with a description
index network show <id>                # Show details and members
index network update <id> --title "New Name"  # Update a network
index network delete <id>              # Delete a network
index network join <id>                # Join a public network
index network leave <id>               # Leave a network
index network invite <id> user@email # Invite directly by email
```

### `index conversation`

Read and message the hosted personal agent within a signal, or use human DMs.

```bash
index conversation show agent --intent-id <id> --json
index conversation send agent "..." --intent-id <id> --json
index conversation send agent "..." --intent-id <id> --question-id <pending-question-id> --json
index conversation list
index conversation with <user-id>
index conversation show <conversation-id> [--limit <n>]
index conversation send <conversation-id> "..."
index conversation stream --json
```

Agent reads include availability and the pending question. An answer must carry
the current question ID and its intent scope; stale refusals are surfaced directly.
Human messages retain their existing conversation IDs. SSE emits one JSON event
record per line. There is no local agent runtime or interactive chat session.

### `index onboarding`

```bash
index onboarding confirm-profile --json
index onboarding complete [--intent-id <id>] --json
```

Confirm a profile only after the owner reviews it. Completion uses the server's
profile-confirmation and first-signal prerequisites; it does not bypass them.

### `index profile`

View user profiles and synchronously enrich your public identity, social, and avatar data.

```bash
index profile                       # Show your own profile
index profile show <user-id>        # Show another user's profile
index profile sync                  # Run public profile research prefill (does not persist)
```

### `index scrape`

Scrape and extract content from a URL.

```bash
index scrape https://example.com                    # Scrape a URL
index scrape https://example.com --objective "..."   # Scrape with focus
```

### `index sync`

Sync profile, networks, and intents to a local file.

```bash
index sync                             # Sync to ~/.index/context.json
index sync --json                      # Output to stdout as JSON
```

`--json` emits one parseable result or error on stdout. Progress goes to stderr;
HTTP and tool failures exit nonzero. Sync fails if any required context read
fails, without saving partial context.

## Examples: Reviewing Opportunities

Approved signals are evaluated in the background. `opportunity list` only reviews persisted results; it does not start evaluation.

### Review and act

```bash
# Inspect agent negotiations
index negotiation list

# List persisted pending opportunities
index opportunity list --status pending

# See full details
index opportunity show <id>

# Accept or reject
index opportunity accept <id>
index opportunity reject <id>
```

## Options


| Flag                 | Short | Description                                                     |
| -------------------- | ----- | --------------------------------------------------------------- |
| `--api-url <url>`    |       | Override API server (default: `https://protocol.index.network`) |
| `--app-url <url>`    |       | Override app URL for login (default: `https://index.network`)   |
| `--archived`         |       | Include archived signals (intent list)                          |
| `--status <status>`  |       | Filter opportunities by status                                  |
| `--limit <n>`        |       | Positive result limit for intent/opportunity lists or conversation messages |
| `--prompt <text>`    | `-p`  | Network description (for `network create`)                      |
| `--title <text>`     |       | Network title (for `network update`)                            |
| `--objective <text>` |       | Focus objective (for `scrape`)                                  |
| `--query <json>`     |       | Required JSON object for `tool call`                            |
| `--intent-id <id>`   |       | Filter negotiations, scope agent conversations, or select onboarding's first signal |
| `--state <state>`    |       | Filter negotiations by `open` or `settled`                       |
| `--action <action>`  |       | Required negotiation turn action: `propose`, `counter`, `accept`, or `decline` |
| `--message <text>`   |       | Required message for a negotiation turn                         |
| `--expected-turn-count <n>` | | Required observed nonnegative integer turn count for a negotiation turn |
| `--question-id <id>` |       | Identify the displayed question when answering the personal agent |
| `--json`             |       | Output raw JSON to stdout                                       |
| `--help`             | `-h`  | Show help                                                       |
| `--version`          | `-v`  | Show version                                                    |


## Development

```bash
# Run directly with Bun (no build step)
bun src/main.ts tool list --json

# Build for all platforms
bun run build

# Build for current platform only (fast dev builds)
bun scripts/build.ts --current

# Dry-run publish
bun scripts/publish.ts --dry-run
```
