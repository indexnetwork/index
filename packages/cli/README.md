# Index CLI

Command-line interface for [Index Network](https://index.network). Chat with the AI agent, manage signals, and discover opportunities — all from your terminal.

## Installation

```bash
npm install -g @indexnetwork/cli
```

## Quick Start

Index helps you find the right people—and helps the right people find you—based on what you are actually trying to do, not just a profile headline. The value is grounded intros: suggestions come from communities you share (syndicates, founder groups, firm networks), not from spraying the open web.

The flow below is one complete story—shape a room, invite people, publish what you need, run discovery inside that context, watch broker negotiations, then accept a match.

```bash
# login + setup
index login
index profile

# 1. express intent (signals)
index intent create "federated learning collaboration"

# 2. discovery = sourcing + negotiations
index opportunity discover "federated learning collaboration"

# 3. check what the agents negotiated
index negotiation list --since 1h
index negotiation show <negotiation-id>

# 4. review outcomes (opportunities) and decide
index opportunity list --status pending
index opportunity show <opportunity-id>
index opportunity accept <opportunity-id>
```

Words you will see elsewhere in this doc: **network** = a community you are in; **intent** = your “what I am looking for” post; **opportunity** = a suggested introduction between you and someone else.

## Commands

### `index login`

Authenticate with Index Network. Opens a browser window that uses your existing session (or a fresh OAuth flow) to call the session-only, fixed-shape CLI credential endpoint, which mints a 90-day API key while keeping CLI requests on the non-web compatibility surface.

```bash
index login                     # Browser-based auth (default)
index login --token <jwt>       # Legacy manual session token (skip browser)
index login --api-url <url>     # Custom server URL
```

Credentials are stored in `~/.index/credentials.json`. Current browser login explicitly requests protocol v2, binds the loopback callback with a one-time state, and stores both the API-key secret and its exact revocation ID. It sends the key with `x-api-key`. Re-login stores the successful replacement first, then calls the constrained CLI revocation endpoint with the replacement as caller plus the captured previous raw secret and exact row ID; cleanup failures leave the new login usable but print a warning directing the user to remove the prior key in web settings.

**Rolling deploy order:** v2 clients require the v2 web bridge and intentionally reject callbacks from older web deployments that cannot return the bound state. On dev, this CLI is an RC: wait for both the API and web deployments to succeed before testing v2 login. Do not relax state validation to make a new CLI work against old web.

**Temporary compatibility:** the already-released v1 CLI can still recover with `index login`; the web bridge asks the custom session-only endpoint for a separately tagged 90-day v1 API key and returns it under the old `session_token` callback field, and the API accepts only that tag as a Bearer fallback. An upgraded v2 CLI transparently exchanges a still-valid stored browser JWT through the same endpoint for a tagged v2 key before making any compatibility request; an old binary must re-login because its ordinary session JWT must remain on the web/Signal surface. Remove the v1 bridge only after released clients have aged out.

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
index opportunity discover "query"         # Discover opportunities by search
index opportunity discover --target <id>   # Discover with a specific user
index opportunity discover --introduce <a> <b>  # Introduce two users
```

Status values: `pending`, `accepted`, `rejected`, `expired`.

### `index network`

Manage networks (communities). List, create, join, leave, and invite members.

```bash
index network list                     # List your networks
index network create "My Network"      # Create a network
index network create "AI" --prompt "AI researchers"  # Create with description
index network show <id>                # Show details and members
index network update <id> --title "New Name"  # Update a network
index network delete <id>              # Delete a network
index network join <id>                # Join a public network
index network leave <id>               # Leave a network
index network invite <id> user@email   # Invite a user by email
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

View user profiles and trigger profile regeneration.

```bash
index profile                       # Show your own profile
index profile show <user-id>        # Show another user's profile
index profile sync                  # Regenerate your profile
index profile search <query>        # Search profiles by name or keyword
index profile create                # Generate profile from social links
index profile update <action> [--details <text>]  # Update profile (action is the verb-phrase, e.g. "add interests")
```

### `index contact`

Manage your contacts. Add, list, remove, or import contacts.

```bash
index contact list                     # List your contacts
index contact add user@email           # Add a contact by email
index contact add user@email --name "Name"  # Add with display name
index contact remove user@email        # Remove a contact
index contact import --gmail           # Import contacts from Gmail
```

### `index scrape`

Scrape and extract content from a URL.

```bash
index scrape https://example.com                    # Scrape a URL
index scrape https://example.com --objective "..."   # Scrape with focus
```

### `index sync`

Sync all user context (profile, networks, intents, contacts) to a local file.

```bash
index sync                             # Sync to ~/.index/context.json
index sync --json                      # Output to stdout as JSON
```

## Examples: Opportunity Discovery

The `opportunity discover` command supports multiple modes for creating connections. Each mode can be combined with flags to customize the discovery.

### Search-based discovery

Find people whose intents match a search query. The protocol runs HyDE-powered semantic search across your networks.

```bash
index opportunity discover "looking for an AI engineer with privacy expertise"
```

### Targeted discovery

Scope discovery to a specific user. Use when you already know who you want to connect with.

```bash
# First, find the user
index profile search "Jane Smith"

# Then create a direct opportunity with them
index opportunity discover "collaborate on open-source LLM tooling" --target <user-id>
```

### Introduction

Introduce two people you think should connect. You become the introducer — both parties see you as the connector. The CLI automatically finds shared networks, gathers profiles and intents, then creates the introduction.

```bash
# Introduce two users to each other
index opportunity discover --introduce <user-id-a> <user-id-b>

# Provide a reason for the introduction
index opportunity discover --introduce <user-id-a> <user-id-b> "both working on privacy-preserving ML"
```

### Complex social flows

Use this when you want to propose an opportunity outright instead of running discovery: pick the community (`--network`), list each person (`--party`, two or more), and when it matters, tie a person to one of their signals with `userId:intentId` on that line and add why it fits (`--reason`). Here Alice and Bob carry explicit signals; Carol does not. This command is not in the CLI yet; it is the shape we intend to ship.

```bash
index opportunity create \
  --network <network-id> \
  --party <alice-id>:<alice-intent-id> \
  --party <bob-id>:<bob-intent-id> \
  --party <carol-id> \
  --reason "Alice, Bob, and Carol are all working on federated learning from different angles" \
  --category "collaboration" \
  --confidence 0.9
```

### Review and act

After discovery creates draft opportunities, review and accept/reject them.

```bash
# List pending opportunities
index opportunity list --status pending

# See full details (reasoning, scores, mutual intents)
index opportunity show <id>

# Accept — starts a conversation thread
index opportunity accept <id>

# If preparatory questions are returned, resolve them first or explicitly continue
index opportunity accept <id> --acknowledge-uptake <question-id[,question-id...]>

# Or reject
index opportunity reject <id>
```

## Options


| Flag                 | Short | Description                                                     |
| -------------------- | ----- | --------------------------------------------------------------- |
| `--api-url <url>`    |       | Override API server (default: `https://protocol.index.network`) |
| `--app-url <url>`    |       | Override app URL for login (default: `https://index.network`)   |
| `--token <token>`    | `-t`  | Provide bearer token directly                                   |
| `--session <id>`     | `-s`  | Resume a specific chat session                                  |
| `--archived`         |       | Include archived signals (intent list)                          |
| `--status <status>`  |       | Filter opportunities by status                                  |
| `--limit <n>`        |       | Limit number of results                                         |
| `--since <date>`     |       | Filter by time: ISO date or duration like `1h`, `2d`, `1w`      |
| `--prompt <text>`    | `-p`  | Network description (for `network create`)                      |
| `--title <text>`     |       | Network title (for `network update`)                            |
| `--name <name>`      |       | Display name (for `contact add`)                                |
| `--gmail`            |       | Import from Gmail (for `contact import`)                        |
| `--target <id>`      |       | Target user ID (for `opportunity discover`)                     |
| `--introduce <id>`   |       | Introduce two users (for `opportunity discover`)                |
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

