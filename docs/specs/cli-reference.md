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
3. Starts a temporary local HTTP server (ephemeral port), generates a 32-byte one-time state, and includes the strict loopback callback, exact `version=2`, and state in the browser URL.
4. The web bridge validates and preserves the exact v2 request through authentication, then calls the project-JWT-authenticated `POST /api/auth/cli-credential` endpoint with only `{protocolVersion:2}`. The session-only endpoint fixes the name, 90-day expiry, and `{client:'cli', protocolVersion:2}` metadata, and returns the secret and exact key ID for the restricted loopback callback.
5. After exact state validation, stores the credential, key ID, API-key auth kind, and API base URL in `~/.index/credentials.json`. Requests send the key through `x-api-key`, which classifies them as the agent surface rather than creating a session-authenticated browser bypass. On re-login, the replacement is stored first and calls the constrained CLI revocation endpoint as the active caller while supplying the captured prior raw secret and exact prior row ID; failure keeps the replacement valid and prints a truthful cleanup warning.
6. **No version downgrade:** the web bridge fails every non-v2 request shape closed. There is no `session_token` callback field and no Bearer API-key fallback on the server; released v1 CLI binaries must upgrade and run `index login` again.
7. Prints confirmation with the authenticated user's name and email.
8. The local server shuts down after receiving the callback (or after a 120-second timeout).

### `index logout`

Calls `POST /api/auth/cli-credential/revoke` with strict `{keyId,targetKey}` proof, using the current CLI key in `x-api-key` and again as `targetKey` for self-revocation. The endpoint accepts only authoritative, unbound, server-issued CLI rows and returns success only after deletion. Revocation failures retain credentials and exit nonzero. If revocation succeeds but local cleanup fails, logout also exits nonzero and warns that the server key is revoked while the local credential file still needs manual removal. A legacy `credentials.json` without an exact key ID loads as signed out; logout never lists or guesses another key to revoke.

---

## Conversation

The `index conversation` command is the entry point for **Human-to-Human (H2H)
direct messaging** — the `list`/`with`/`show`/`send`/`stream` subcommands backed
by `/api/conversations/*`.

Human-to-Agent chat from the CLI has been removed. It ran on the retired
`orchestrator` persona, and API-key callers can no longer start a chat without
naming one; the persona that remains (`signal`) is web-only.
Invoking `index conversation` with no subcommand — or with a bare message —
prints an error pointing at the app and exits 1.

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
4. Render a styled profile card showing: name, intro/bio, location, socials, and member-since date.

### `index profile show <user-id>`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Call `GET /api/users/:userId` directly with the provided user ID.
3. Render the same styled profile card.

### `index profile sync`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Call `POST /api/enrichment/enrich` exactly once to synchronously enrich the authenticated user's public profile.
3. Return `{ enriched, profile }`, where `profile` contains the current resolved identity, social links, and avatar data. Formatted output prints the resolved name, location, and social-link count.

### `index profile create [--linkedin <url>] [--github <url>] [--twitter <url>]`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Calls `create_user_context` tool via Tool HTTP API with the provided social links.
3. Prints confirmation message on success.

### `index profile update <action> [--details <text>]`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Calls `update_user_context` tool via Tool HTTP API with `{ action, details }`.
3. Prints confirmation message on success.

### `index profile search <query>`

1. Load credentials via `requireAuth`. Exit with error if not logged in.
2. Calls `read_user_contexts` tool via Tool HTTP API with the search query.
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

1. Calls `update_intent` tool via Tool HTTP API with `{ intentId, description }`.
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
2. Resolves the opportunity and calls the REST acceptance preflight.
3. When no uptake advisory exists, accepts and prints confirmation.
4. When unresolved preparatory questions exist, prints each question and leaves the opportunity pending. Answer or dismiss them through a question-capable surface, then retry normally.
5. To explicitly continue without resolving them, retry with `--acknowledge-uptake <question-id[,question-id...]>` using the complete ID set printed by the latest advisory. This is an advisory override, not an answer.

With `--json`, structured advisory responses are printed unchanged.

### `index opportunity reject <id>`

1. Reads credentials. Exits with error if not logged in.
2. Calls `PATCH /api/opportunities/:id/status` with `{ status: "rejected" }`.
3. Prints confirmation message.


---

## Network

The `index network` command manages networks (the user-facing term for indexes) through eight subcommands. All commands require authentication and communicate with the protocol API over HTTP.

### `index network list`

Lists networks the authenticated user is a member of. Calls `GET /api/networks`. Renders a table with columns: title, member count, role (owner/admin/member), join policy, created date. Personal networks (`isPersonal: true`) are filtered from the display.

### `index network create <name>`

Creates a network directly for eligible staff or submits an early-access request for other users. The command first calls `POST /api/networks` with `{ title, prompt? }`; a successful direct creation returns `{ kind: "created", network }` and prints the network summary. The fallback is restricted to a `403` response whose structured `error` string starts with `Network creation is in early access.`. Only for that exact early-access denial, the command calls `POST /api/network-requests` with `{ name: title, purpose?: prompt }`, returns `{ kind: "requested", request }`, and prints the request status and ID. Every unrelated `403` and all other errors are surfaced without submitting a request.

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

Invites directly by any valid email through the server invitation flow. Calls `POST /api/networks/:id/members/invite` with `{ email }`; the server resolves existing users or provisions the pending invitee as needed. Prints whether the invitation was sent or the user was already a member.

---

## Contact

### `index contact list`

Lists the authenticated user's contacts. Calls the `list_contacts` MCP tool via the Tool HTTP API. Renders a table of contacts with name, email, and added date.

### `index contact remove <email>`

Removes a contact by email. First calls `list_contacts` to resolve the email to a `userId`, then calls the `remove_contact` MCP tool with `{ contactUserId }`.

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

### Conversation
4. `index conversation` (no subcommand) prints the agent-chat retirement error and exits 1.
5. `index conversation list` displays a formatted table of conversations.
9. `index conversation with <user-id>` gets or creates a DM and prints the conversation summary.
10. `index conversation show <id>` displays messages in chronological order.
11. `index conversation send <id> <message>` sends a message and prints confirmation.
12. `index conversation stream` opens an SSE connection and prints real-time events.

### Profile
13. `index profile` displays the current user's profile card.
14. `index profile show <user-id>` displays another user's profile card.
15. `index profile sync` synchronously enriches the public profile and returns the resolved identity, social, and avatar data.
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
33. `index opportunity accept <id>` runs the uptake preflight; it accepts immediately when clear, otherwise prints preparatory questions and the explicit `--acknowledge-uptake` retry.
34. `index opportunity reject <id>` sends rejected status and prints confirmation.

### Network
36. `index network list` displays non-personal networks.
37. `index network create <name>` creates directly when eligible; otherwise it submits an early-access request only after the exact early-access denial.
38. `index network show <id>` displays network details and member table.
39. `index network join <id>` joins a public network.
40. `index network leave <id>` leaves a network.
41. `index network update <id> --title <t>` updates network settings.
42. `index network delete <id>` deletes a network.
43. `index network invite <id> <email>` invites directly by any valid email through the server invitation flow.

### General
44. All commands exit with code 1 and a helpful message when not authenticated.
45. 401 responses trigger the standard "Session expired" message.
46. Network errors produce clear error messages.
47. Bare command with no subcommand prints usage help.
