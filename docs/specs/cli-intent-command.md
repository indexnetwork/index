---
title: "CLI intent command — list, show, create, archive"
type: spec
tags: [cli, intent, signal, api]
created: 2026-03-30
updated: 2026-04-06
---

## Behavior

The `index intent` command exposes subcommands for managing intents (user-facing: "signals") from the CLI.

### `index intent list`

1. Calls `POST /api/intents/list` with optional pagination/filter body.
2. Renders a table with columns: ID (short), signal (description truncated to 50 chars), status, source, created date.
3. Flags: `--archived` includes archived intents, `--limit <n>` sets page size (backend default applies if omitted).

### `index intent show <id>`

1. Calls `GET /api/intents/:id`.
2. Renders a detailed card with: full description (payload), summary, confidence, source type, status, intent mode, speech act type, timestamps (created, updated, archived), and network assignments if present in the response.

### `index intent create <content>`

1. Calls `create_intent` tool via Tool HTTP API with `{ description }`.
2. Prints the processing result summary.
3. Content is the remaining positional arguments joined with spaces.

### `index intent update <id> <content>`

1. Calls `update_intent` tool via Tool HTTP API with `{ intentId, newDescription }`.
2. Prints confirmation message on success, error on failure.
3. Content is the remaining positional arguments joined with spaces.

### `index intent archive <id>`

1. Resolves short ID to full UUID via `GET /api/intents/:id`.
2. Calls `delete_intent` tool via Tool HTTP API with `{ intentId }`.
3. Prints confirmation message on success, error on failure.

### `index intent link <id> <network-id>`

1. Calls `create_intent_network` tool via Tool HTTP API with `{ intentId, networkId }`.
2. Prints "Signal linked to network." on success, error on failure.

### `index intent unlink <id> <network-id>`

1. Calls `delete_intent_network` tool via Tool HTTP API with `{ intentId, networkId }`.
2. Prints "Signal unlinked from network." on success, error on failure.

### `index intent links <id>`

1. Calls `read_intent_networks` tool via Tool HTTP API with `{ intentId }` and lists titles via `GET /api/networks` for display.
2. Renders a table of linked networks (title, ID). Prints "No linked networks." if none.

## Constraints

- The CLI is a pure HTTP client. No protocol internals may be imported.
- User-facing copy uses "signal" (per IND-144). Internal code uses "intent" for variable names, API paths, and types.
- Auth tokens are loaded from `~/.index/credentials.json` via the existing `CredentialStore`.
- 401 responses produce "Session expired or invalid. Run `index login` to re-authenticate."
- No external CLI framework — argument parsing uses the existing hand-rolled parser in `args.parser.ts`.

## Acceptance Criteria

1. `index intent list` displays a formatted table of the user's active signals.
2. `index intent list --archived` includes archived signals in the listing.
3. `index intent list --limit 5` limits results to 5 items.
4. `index intent show <id>` displays full signal details in a card format.
5. `index intent show <nonexistent>` prints a "not found" error.
6. `index intent create "Looking for a technical co-founder"` processes the content and prints a result.
7. `index intent archive <id>` archives the signal and prints confirmation.
8. `index intent link <id> <network-id>` links the signal to the network and prints confirmation.
9. `index intent unlink <id> <network-id>` unlinks the signal from the network and prints confirmation.
10. `index intent links <id>` displays a table of linked networks.
11. All subcommands exit with code 1 and a helpful message when not authenticated.
12. `index intent` (no subcommand) prints usage help for the intent command.
13. Unit tests cover: argument parsing for intent subcommands, API client methods, output formatting.
