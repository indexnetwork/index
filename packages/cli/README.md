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

Authenticate with Index Network. Opens a browser window that uses your existing session (or a fresh OAuth flow) to call the session-only, fixed-shape CLI credential endpoint, which mints a 90-day API key while keeping CLI requests on the non-web compatibility surface.

```bash
index login                     # Browser-based auth
index login --api-url <url>     # Custom server URL
```

Credentials are stored in `~/.index/credentials.json`. Current browser login explicitly requests protocol v2, binds the loopback callback with a one-time state, and stores both the API-key secret and its exact revocation ID. It sends the key with `x-api-key`. Re-login stores the successful replacement first, then calls the constrained CLI revocation endpoint with the replacement as caller plus the captured previous raw secret and exact row ID; cleanup failures leave the new login usable but print a warning directing the user to remove the prior key in web settings.

**Rolling deploy order:** v2 clients require the v2 web bridge and intentionally reject callbacks from older web deployments that cannot return the bound state. On dev, this CLI is an RC: wait for both the API and web deployments to succeed before testing v2 login. Do not relax state validation to make a new CLI work against old web.

The v1 login contract (`session_token` callback, Bearer API-key fallback, `--token` manual flow) is removed. Released v1 binaries and legacy `credentials.json` files without a key ID are treated as signed out; upgrade and run `index login`.

### `index logout`

Revoke the exact stored CLI API key through `POST /api/auth/cli-credential/revoke`, proving both the active `x-api-key` caller and strict `{keyId,targetKey}` self target, then clear local credentials. If server revocation succeeds but local cleanup fails, logout exits nonzero and asks you to remove the local file manually. The released v1 CLI can only remove its credential locally because it did not store a server key ID; its temporary server key expires after 90 days. Legacy API-key credentials without a revocation ID are retained by the new CLI with a non-success warning that directs you to remove the old key in web settings first rather than implying another login revokes it.

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
index intent link <id> <network-id>         # Link a signal to a network
index intent unlink <id> <network-id>       # Unlink a signal from a network
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
index profile sync                  # Enrich your profile now and return the resolved identity
index profile search <query>        # Search profiles by name or keyword
index profile create                # Generate profile from social links
index profile update <action> [--details <text>]  # Update profile (action is the verb-phrase, e.g. "add interests")
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
