---
title: "CLI Reference"
type: spec
tags: [cli, auth, conversation, h2a, h2h, sse, intent, signal, profile, negotiation, opportunity, network, contact, command]
created: 2026-03-30
updated: 2026-04-27
---

# CLI Reference

Complete behavior specification for the `index` CLI. For user-facing quick-start and examples, see `packages/cli/README.md`. For npm distribution details, see `cli-npm-publish.md`.

The `index` CLI is a standalone Bun-based binary in `packages/cli/`. It communicates with the Index Network protocol server over HTTP/SSE. Distribution is via npm using platform-specific prebuilt binaries.

---

## Login / Logout

### `index login`

1. Prints a URL pointing to the protocol's Better Auth OAuth flow (Google provider).
2. Opens the user's default browser to that URL.
3. Starts a temporary local HTTP server (ephemeral port) to receive the OAuth callback.
4. On callback, exchanges the authorization parameters for a session token via the protocol's Better Auth endpoints.
5. Stores the session credentials (bearer token + API base URL) in `~/.index/credentials.json`.
6. Prints confirmation with the authenticated user's name and email.
7. The local server shuts down after receiving the callback (or after a 120-second timeout).

### `index login --token <token>`

Manual token flow — skips the browser entirely. Stores the token and verifies it via `GET /api/auth/me`.

### `index logout`

Clears stored credentials from `~/.index/credentials.json`.

---

## Conversation

The `index conversation` command is the unified entry point for the conversation surface. It serves both:

- **Human-to-Agent (H2A) chat** — the default mode: an SSE-streaming REPL against the Index chat orchestrator (`/api/chat/stream`), plus session listing and one-shot messages via positional args.
- **Human-to-Human (H2H) direct messaging** — via the `list`/`with`/`show`/`send`/`stream` subcommands backed by `/api/conversations/*`.

### `index conversation [message]`

**One-shot mode** (message provided as positional argument):

1. Reads credentials from `~/.index/credentials.json`. Exits with error if not logged in.
2. Sends `POST /api/chat/stream` with `{ message }` and `Authorization: Bearer <token>`.
3. Reads the SSE stream, printing assistant text tokens to stdout as they arrive.
4. On `done` event, prints the session ID for future reference and exits 0.
5. On `error` event, prints the error to stderr and exits 1.

**Interactive REPL mode** (no subcommand, no message argument):

1. Reads credentials. Exits with error if not logged in.
2. Enters a read-eval-print loop with a `>` prompt.
3. Each user input is sent to `POST /api/chat/stream` with the current `sessionId`.
4. Streamed tokens are printed. After `done`, the loop resumes.
5. The user exits with Ctrl+C or typing `exit`/`quit`.

### `index conversation --session <id>`

Resumes a specific AI chat session. Works in both one-shot and REPL modes. The session ID is passed as `sessionId` in the stream request body.

### `index conversation sessions`

1. Calls `GET /api/chat/sessions` with auth header.
2. Prints a table of AI chat sessions: ID, title, created date.
3. Exits 0.

### `index conversation list`

1. Calls `GET /api/conversations` with auth header.
2. Renders a table of conversations: ID (truncated), participants, last message preview, created date.
3. Exits 0.

### `index conversation with <user-id>`

1. Calls `POST /api/conversations/dm` with `{ peerUserId }`.
2. If a DM already exists, returns the existing conversation. Otherwise creates a new one.
3. Prints the conversation ID and participant info.
4. Exits 0.

### `index conversation show <id>`

1. Calls `GET /api/conversations/:id/messages` with optional `--limit <n>` (default 20).
2. Renders messages in chronological order showing sender, timestamp, and text content.
3. Exits 0.

### `index conversation send <id> <message>`

1. Calls `POST /api/conversations/:id/messages` with `{ parts: [{ type: "text", text: message }] }`.
2. Prints confirmation with the sent message ID.
3. Exits 0.

### `index conversation stream`

1. Opens `GET /api/conversations/stream` as an SSE connection.
2. Prints real-time events (new messages, conversation updates) to stdout.
3. Runs until interrupted with Ctrl+C.

---

## Profile

The `index profile` command lets users view, create, update, and search profiles from the terminal.

### `index profile` (no args)

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Call `GET /api/auth/me` to get the current user's ID.
3. Call `GET /api/users/:userId` to get the full profile.
4. Render a styled profile card showing: name, intro/bio, location, socials, ghost status, and member-since date.

### `index profile show <user-id>`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Call `GET /api/users/:userId` directly with the provided user ID.
3. Render the same styled profile card.

### `index profile sync`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Calls the `read_user_profiles` MCP tool via the Tool HTTP API to check whether a profile exists.
3. If one exists, calls `update_user_profile` with `{ action: "regenerate" }`; otherwise calls `create_user_profile` with `{ confirm: true }`.
4. Print a success confirmation message.

### `index profile create [--linkedin <url>] [--github <url>] [--twitter <url>]`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Calls `create_user_profile` tool via Tool HTTP API with the provided social links.
3. Prints confirmation message on success.

### `index profile update <action> [--details <text>]`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Calls `update_user_profile` tool via Tool HTTP API with `{ action, details }`.
3. Prints confirmation message on success.

### `index profile search <query>`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Calls `read_user_profiles` tool via Tool HTTP API with the search query.
3. Renders a heading followed by each match as `name (userId)` with a short bio snippet — the output is a list rather than a formatted table.

---

## Intent

The `index intent` command exposes subcommands for managing intents (user-facing: "signals") from the CLI.

### `index intent list`

1. Calls `POST /api/intents/list` with optional pagination/filter body.
2. Renders a table with columns: ID (short), signal (description truncated to 50 chars), status, source, created date.
3. Flags: `--archived` includes archived intents, `--limit <n>` sets page size (backend default applies if omitted).

### `index intent show <id>`

1. Calls `GET /api/intents/:id`.
2. Renders a detailed card with: full description (payload), summary, confidence, source type, status, intent mode, speech act type, timestamps (created, updated, archived), and index assignments if present in the response.

### `index intent create <content>`

1. Calls `create_intent` tool via Tool HTTP API with `{ description }`. The tool returns one or more `intent_proposal` blocks (each with a `proposalId` and `description`) rather than a persisted intent.
2. Confirms each proposal via `POST /api/intents/confirm` with `{ proposalId, description }`, which persists the active signal.
3. Prints "Signal created." with the confirmed description.
4. Content is the remaining positional arguments joined with spaces.

### `index intent update <id> <content>`

1. Calls `update_intent` tool via Tool HTTP API with `{ intentId, newDescription }`.
2. Prints confirmation message on success, error on failure.
3. Content is the remaining positional arguments joined with spaces.

### `index intent archive <id>`

1. Resolves short ID to full UUID via `GET /api/intents/:id`.
2. Calls `delete_intent` tool via Tool HTTP API with `{ intentId }`.
3. Prints confirmation message on success, error on failure.

### `index intent link <id> <network-id>`

1. Resolves short ID to full UUID via `GET /api/intents/:id` (the tool rejects non-UUID intent IDs).
2. Calls `create_intent_index` tool via Tool HTTP API with `{ intentId, networkId }`.
3. Prints "Signal linked to network." on success, error on failure.

### `index intent unlink <id> <network-id>`

1. Resolves short ID to full UUID via `GET /api/intents/:id` (the tool rejects non-UUID intent IDs).
2. Calls `delete_intent_index` tool via Tool HTTP API with `{ intentId, networkId }`.
3. Prints "Signal unlinked from network." on success, error on failure.

---

## Negotiation

The `index negotiation` command exposes subcommands for inspecting agent negotiations. Negotiations are autonomous turn-by-turn exchanges between broker agents that evaluate whether an opportunity exists between two users.

### `index negotiation list`

1. Reads credentials. Exits with error if not logged in.
2. Resolves the authenticated user via `GET /api/auth/me`, then calls `GET /api/users/:userId/negotiations` with optional query params (`limit`, `since`).
3. Renders a table with columns: ID (short), counterparty name, outcome (opportunity/no match), role (helper/seeker/peer), turns, created date.
4. Supports `--limit <n>` and `--since <date|duration>` (ISO date or human-friendly duration like `1h`, `2d`, `1w`).

### `index negotiation show <id>`

1. Reads credentials. Exits with error if not logged in.
2. Fetches negotiations and matches by ID prefix.
3. Renders a detailed card with: ID, counterparty, outcome, role, turn count, created date.
4. Below the card, renders a turn-by-turn log showing: turn number, speaker name, action (accept/reject/continue), suggested roles, and reasoning text.

---

## Opportunity

The `index opportunity` command exposes subcommands for managing opportunities from the terminal.

### `index opportunity list`

1. Reads credentials from `~/.index/credentials.json`. Exits with error if not logged in.
2. Calls `GET /api/opportunities` with optional query params (`status`, `limit`).
3. Renders a table with columns: ID (short), counterparty name, category, status, confidence, createdAt.
4. Supports `--status <pending|accepted|rejected|expired>` filter and `--limit <n>`.

### `index opportunity show <id>`

1. Reads credentials. Exits with error if not logged in.
2. Calls `GET /api/opportunities/:id` which returns the opportunity with LLM-generated presentation.
3. Renders a detailed card with:
   - Parties: names and valency roles displayed as human-readable labels (agent = Helper, patient = Seeker, peer = Peer) with color coding.
   - Reasoning text.
   - Category, confidence (with visual bar), status.
   - Timestamps (createdAt, updatedAt).
   - Presentation text (if available).

### `index opportunity accept <id>`

1. Reads credentials. Exits with error if not logged in.
2. Calls the `update_opportunity` MCP tool via the Tool HTTP API with `{ opportunityId, status: "accepted" }`.
3. Prints confirmation message.

### `index opportunity reject <id>`

1. Reads credentials. Exits with error if not logged in.
2. Calls the `update_opportunity` MCP tool via the Tool HTTP API with `{ opportunityId, status: "rejected" }`.
3. Prints confirmation message.

### `index opportunity discover <query>`

1. Reads credentials. Exits with error if not logged in.
2. Calls the `discover_opportunities` MCP tool via the Tool HTTP API with `{ searchQuery }`.
3. Renders a table of discovered opportunities.

Supports optional flags:
- `--target <uid>` — Discover opportunities for a specific user (on behalf of)
- `--introduce <userA> <userB>` — Discover an introduction opportunity between two users. The flag takes the first user ID; the second is a trailing positional argument.

---

## Network

The `index network` command manages networks (the user-facing term for indexes) through eight subcommands. All commands require authentication and communicate with the protocol API over HTTP.

### `index network list`

Lists networks the authenticated user is a member of. Calls `GET /api/networks`. Renders a table with columns: title, member count, role (owner/admin/member), join policy, created date. Personal indexes (`isPersonal: true`) are filtered from the display.

### `index network create <name>`

Creates a new network. Calls `POST /api/networks` with `{ title }`. Supports optional `--prompt <text>` flag for the network description/prompt. Prints the created network summary (title, ID, join policy).

### `index network show <id>`

Shows detailed network information. Calls `GET /api/networks/:id` for the network, then `GET /api/networks/:id/members` for the member list. Renders a detail card with: title, prompt, join policy, member count, owner. Below the card, renders a member table with: name, email, role, joined date.

### `index network join <id>`

Joins a public network. Calls `POST /api/networks/:id/join`. Prints confirmation with the network title. Returns an error for invite-only networks (403).

### `index network leave <id>`

Leaves a network. Calls `POST /api/networks/:id/leave`. Prints confirmation. Returns an error if the user is the owner (cannot leave own network).

### `index network update <id> [--title <t>] [--prompt <p>]`

Updates network settings. Calls the `update_network` MCP tool via the Tool HTTP API with `{ networkId, settings: { title?, prompt? } }`, populating only the fields supplied as flags. Prints confirmation with the updated network title.

### `index network delete <id>`

Deletes a network. Calls the `delete_network` MCP tool via the Tool HTTP API. Prints confirmation on success.

### `index network invite <id> <email>`

Invites a user to a network by email. Two-step process:
1. Search for the user: `GET /api/networks/search-users?q=<email>&networkId=<id>`
2. If found, add them: `POST /api/networks/:id/members` with `{ userId }`
Prints confirmation or "User not found" if the search returns no results.

---

## Contact

### `index contact list`

Lists the authenticated user's contacts. Calls the `list_contacts` MCP tool via the Tool HTTP API. Renders a table of contacts with name, email, and added date.

### `index contact add <email>`

Adds a contact by email. Calls the `add_contact` MCP tool with `{ email, name? }`. Supports optional `--name <name>` flag for display name.

### `index contact remove <email>`

Removes a contact by email. First calls `list_contacts` to resolve the email to a `userId`, then calls the `remove_contact` MCP tool with `{ contactUserId }`.

### `index contact import --gmail`

Imports contacts from the user's connected Gmail account. Calls the `import_gmail_contacts` MCP tool via the Tool HTTP API.

---

## Scrape

### `index scrape <url>`

Extracts content from a URL. Supports optional `--objective <text>` to focus extraction on a specific topic.

---

## Sync

### `index sync`

Syncs all user context (profile, networks, intents, contacts) to `~/.index/context.json`.

### `index sync --json`

Outputs the synced context to stdout as JSON instead of writing to file.

---

## Onboarding

### `index onboarding complete`

Marks the user's onboarding as complete.

---

## Shared Constraints

- The CLI is a pure HTTP client. It must not import any protocol internals.
- Auth tokens are stored in `~/.index/credentials.json` via `CredentialStore`.
- 401 responses produce "Session expired or invalid. Run `index login` to re-authenticate."
- Network errors produce a clear error message.
- No external CLI framework — argument parsing uses a hand-rolled parser in `args.parser.ts`.
- The CLI must work on macOS and Linux. Windows is not required.
- The binary name is `index`. Distributed via `npm install -g @indexnetwork/cli`.
- User-facing copy uses "signal" for intents and "network" for indexes.
- SSE parsing must handle partial chunks (tokens may arrive mid-line).
- Valency role display uses friendly labels: agent = "Helper", patient = "Seeker", peer = "Peer".
- Each command handler follows the `handleX(client, subcommand, ...)` pattern.

## Acceptance Criteria

### Login / Logout
1. `index login` completes an OAuth flow and stores valid credentials.
2. `index login` fails gracefully if the browser cannot be opened (prints URL for manual copy).
3. `index login --token <token>` stores the token and verifies it.

### Conversation
4. `index conversation "hello"` sends a message and prints the streamed response.
5. `index conversation` (no args) enters REPL mode and supports multi-turn conversation.
6. `index conversation --session <id>` resumes an existing AI chat session.
7. `index conversation sessions` prints a formatted table of AI chat sessions.
8. `index conversation list` displays a formatted table of conversations.
9. `index conversation with <user-id>` gets or creates a DM and prints the conversation summary.
10. `index conversation show <id>` displays messages in chronological order.
11. `index conversation send <id> <message>` sends a message and prints confirmation.
12. `index conversation stream` opens an SSE connection and prints real-time events.

### Profile
13. `index profile` displays the current user's profile card.
14. `index profile show <user-id>` displays another user's profile card.
15. `index profile sync` triggers regeneration and prints confirmation.
16. `index profile create` generates a profile from social links and prints confirmation.
17. `index profile update <action>` updates the profile and prints confirmation.
18. `index profile search <query>` displays matching profiles.

### Intent
19. `index intent list` displays a formatted table of active signals.
20. `index intent list --archived` includes archived signals.
21. `index intent show <id>` displays full signal details.
22. `index intent create <content>` processes the content and prints a result.
23. `index intent archive <id>` archives the signal and prints confirmation.
24. `index intent link <id> <network-id>` links the signal and prints confirmation.
25. `index intent unlink <id> <network-id>` unlinks the signal and prints confirmation.
26. `index intent links <id>` displays linked networks.

### Negotiation
27. `index negotiation list` displays a table of negotiations with outcome and role.
28. `index negotiation list --since 1d` filters to the last 24 hours.
29. `index negotiation show <id>` displays turn-by-turn negotiation details.

### Opportunity
30. `index opportunity list` displays a table of opportunities.
31. `index opportunity list --status pending` filters by status.
32. `index opportunity show <id>` displays a detailed card with parties, roles, and reasoning.
33. `index opportunity accept <id>` sends accepted status and prints confirmation.
34. `index opportunity reject <id>` sends rejected status and prints confirmation.
35. `index opportunity discover <query>` discovers and displays opportunities.

### Network
36. `index network list` displays non-personal networks.
37. `index network create <name>` creates a network and prints summary.
38. `index network show <id>` displays network details and member table.
39. `index network join <id>` joins a public network.
40. `index network leave <id>` leaves a network.
41. `index network update <id> --title <t>` updates network settings.
42. `index network delete <id>` deletes a network.
43. `index network invite <id> <email>` invites a user.

### General
44. All commands exit with code 1 and a helpful message when not authenticated.
45. 401 responses trigger the standard "Session expired" message.
46. Network errors produce clear error messages.
47. Bare command with no subcommand prints usage help.
