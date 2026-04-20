---
title: "CLI network command"
type: spec
tags: [cli, network, commands]
created: 2026-03-30
updated: 2026-04-20
---

## Behavior

The `index network` command manages networks through eight subcommands. All commands require authentication and communicate with the protocol API over HTTP.

### `index network list`

Lists networks the authenticated user is a member of. Calls `GET /api/networks`. Renders a table with columns: title, member count, role (owner/admin/member), join policy, created date. Personal networks (`isPersonal: true`) are filtered from the display.

### `index network create <name>`

Creates a new network. Calls `POST /api/networks` with `{ title }`. Supports optional `--prompt <text>` flag for the network description/prompt. Prints the created network summary (title, ID, join policy).

### `index network show <id>`

Shows detailed network information. Calls `GET /api/networks/:id` for the network, then `GET /api/networks/:id/members` for the member list. Renders a detail card with: title, prompt, join policy, member count, owner. Below the card, renders a member table with: name, email, role, joined date.

### `index network join <id>`

Joins a public network. Calls `POST /api/networks/:id/join`. Prints confirmation with the network title. Returns an error for invite-only networks (403).

### `index network leave <id>`

Leaves a network. Calls `POST /api/networks/:id/leave`. Prints confirmation. Returns an error if the user is the owner (cannot leave own network).

### `index network update <id> [--title <t>] [--prompt <p>]`

Updates network settings. Calls the `update_network` MCP tool via the Tool HTTP API with the provided fields (`title`, `prompt`). Prints confirmation with the updated network title.

### `index network delete <id>`

Deletes a network. Calls the `delete_network` MCP tool via the Tool HTTP API. Prints confirmation on success.

### `index network invite <id> <email>`

Invites a user to a network by email. Two-step process:
1. Search for the user: `GET /api/networks/search-users?q=<email>&networkId=<id>`
2. If found, add them: `POST /api/networks/:id/members` with `{ userId }`
Prints confirmation or "User not found" if the search returns no results.

## Constraints

- The CLI is a pure HTTP client; it must not import protocol internals.
- API routes for networks live under `/api/networks/*`.
- Personal networks must be filtered from the `list` output.
- Auth is required for all subcommands; missing credentials produce "Not logged in. Run `index login` first."
- 401 responses produce "Session expired. Run `index login` to re-authenticate."
- Network errors produce a clear error message.
- No external CLI framework; argument parsing extends the existing custom parser.

## Acceptance Criteria

1. `index network list` displays a formatted table of the user's non-personal networks.
2. `index network create <name>` creates a network and prints a summary.
3. `index network create <name> --prompt <text>` creates a network with a prompt.
4. `index network show <id>` displays network details and a member table.
5. `index network join <id>` joins a public network and prints confirmation.
6. `index network join <id>` on an invite-only network prints an appropriate error.
7. `index network leave <id>` leaves a network and prints confirmation.
8. `index network leave <id>` as owner prints an error.
9. `index network update <id> --title <t>` updates the network title and prints confirmation.
10. `index network delete <id>` deletes a network and prints confirmation.
11. `index network invite <id> <email>` invites a found user and prints confirmation.
12. `index network invite <id> <email>` with unknown email prints "User not found."
13. `index network` with no subcommand prints network help text.
14. Argument parser correctly routes "network" command with all subcommands and positional args.
15. API client methods send correct HTTP requests with auth headers.
16. Unit tests cover: argument parsing for all subcommands, API client methods, output formatting.
