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
| `--limit <n>`        |       | Limit number of results                                         |
| `--prompt <text>`    | `-p`  | Network description (for `network create`)                      |
| `--title <text>`     |       | Network title (for `network update`)                            |
| `--objective <text>` |       | Focus objective (for `scrape`)                                  |
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
