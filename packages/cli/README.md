# Index CLI

Command-line interface for [Index Network](https://index.network). Chat with the AI agent, manage signals, and discover opportunities — all from your terminal.

## Installation

```bash
npm install -g @indexnetwork/cli
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

**Rolling deploy order:** v2 clients require the v2 web bridge and intentionally reject callbacks from older web deployments that cannot return the bound state. On dev, this CLI is an RC: wait for both the API and web deployments to succeed before testing v2 login. Do not relax state validation to make a new CLI work against old web.

The v1 login contract (`session_token` callback, Bearer API-key fallback, `--token` manual flow) is removed. So is API-key login: existing `credentials.json` files holding a key are treated as signed out; run `index login` again.

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

Inspect agent negotiations — the autonomous turn-by-turn exchanges between broker agents that evaluate whether an opportunity exists.

```bash
index negotiation list                     # List your agent's negotiations
index negotiation list --limit 10          # Limit results
index negotiation list --since 1d          # Negotiations from the last 24 hours
index negotiation list --since 2026-04-01  # Since a specific date
index negotiation show <id>               # Show turn-by-turn details (accepts short ID)
```

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

Unified conversation command for AI agent chat and human-to-human messaging. Supports streaming responses, inline markdown formatting, tool call indicators, and special blocks (signal proposals, opportunities).

```bash
index conversation                          # Interactive AI chat REPL
index conversation "find me collaborators"  # One-shot message to AI agent
index conversation --session <id>           # Resume an AI chat session
index conversation sessions                 # List AI chat sessions
index conversation list                     # List all conversations (H2A + H2H)
index conversation with <user-id>           # Open or resume a DM
index conversation show <id>               # Show messages
index conversation send <id> <msg>         # Send a message
index conversation stream                  # Real-time SSE stream
```

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
| `--session <id>`     | `-s`  | Resume a specific chat session                                  |
| `--archived`         |       | Include archived signals (intent list)                          |
| `--status <status>`  |       | Filter opportunities by status                                  |
| `--limit <n>`        |       | Limit number of results                                         |
| `--since <date>`     |       | Filter by time: ISO date or duration like `1h`, `2d`, `1w`      |
| `--prompt <text>`    | `-p`  | Network description (for `network create`)                      |
| `--title <text>`     |       | Network title (for `network update`)                            |
| `--objective <text>` |       | Focus objective (for `scrape`)                                  |
| `--json`             |       | Output raw JSON to stdout                                       |
| `--help`             | `-h`  | Show help                                                       |
| `--version`          | `-v`  | Show version                                                    |


## Development

```bash
# Run directly with Bun (no build step)
bun src/main.ts conversation

# Build for all platforms
bun run build

# Build for current platform only (fast dev builds)
bun scripts/build.ts --current

# Run tests
bun test

# Dry-run publish
bun scripts/publish.ts --dry-run
```
