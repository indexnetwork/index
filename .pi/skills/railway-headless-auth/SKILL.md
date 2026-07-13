---
name: railway-headless-auth
description: >-
  Fix and prevent the Railway "login every 5 minutes" loop: diagnose Unauthorized /
  invalid_grant errors from the railway CLI or the local `railway mcp` server, and set
  up headless auth via RAILWAY_API_TOKEN so agents never depend on browser-session
  tokens. Use when Railway MCP tools return "Unauthorized. Please run railway login
  again", when `railway whoami` fails right after a successful login, when a token
  pasted from the dashboard is rejected, or when deciding between account, team, and
  project tokens for agent/CI use.
---

# railway-headless-auth

## Root cause of the login loop

The local `railway mcp` server (configured in `.mcp.json` as `command: railway, args: [mcp]`)
authenticates from the **browser-session tokens** in `~/.railway/config.json`:
a short-lived `accessToken` (~1 h) plus a **rotating** `refreshToken`. Two failure modes:

1. **Stale long-running process** — the MCP server loads the token at spawn and never
   sees the refreshed value after a terminal `railway login`.
2. **Refresh-token rotation race** — terminal CLI, MCP server, and `railway agent`
   sessions all share one config. When the access token expires, the first process to
   refresh consumes the one-time refresh token; any other process using the stale one
   gets `invalid_grant: grant request is invalid` and **invalidates the whole session**.

Fix: give agents a static token via `RAILWAY_API_TOKEN`; it takes precedence over the
session and removes all refresh behavior.

## Token semantics (all are UUID-shaped — shape tells you nothing)

| Token | Env var | `whoami`/`list` | Project ops | Notes |
|---|---|---|---|---|
| Personal account ("No workspace" at railway.com/account/tokens) | `RAILWAY_API_TOKEN` | ✅ | ✅ all workspaces the user can access | Best for a developer machine |
| Team/workspace-scoped | `RAILWAY_API_TOKEN` | ❌ Unauthorized (no user identity) | ✅ within that workspace | `whoami` failing does NOT mean the token is invalid |
| Project token (project settings) | `RAILWAY_TOKEN` | ❌ | ✅ one project+environment | For CI of a single service |

The dashboard shows the secret **only once at creation**; the UUID in the token list
afterwards is the token's ID, not the secret.

## Setup (this machine's pattern)

```bash
# 1. Store the token outside installer-managed files (~/.railway/env gets overwritten on CLI updates)
printf 'export RAILWAY_API_TOKEN=%s\n' '<token>' > ~/.railway/api-token.env
chmod 600 ~/.railway/api-token.env

# 2. Source it from the shell profile, right after the installer's env line
# (already present in ~/.zprezto/runcoms/zshrc):
#   [ -s "$HOME/.railway/api-token.env" ] && source "$HOME/.railway/api-token.env"
```

New shells, `railway agent`, and any MCP server spawned by pi inherit the var.
**Restart pi** after adding the token — the running MCP process keeps its spawn-time env.

## Verifying a token (discriminate token vs CLI problems)

Test against GraphQL directly — bypasses all CLI/session logic:

```bash
T='<token>'
# account token → returns your user; team token → "Not Authorized" (expected)
curl -s https://backboard.railway.com/graphql/v2 -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d '{"query":"query { me { id email } }"}'
# any valid API token → lists reachable projects; invalid token → error
curl -s https://backboard.railway.com/graphql/v2 -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d '{"query":"query { projects { edges { node { id name } } } }"}'
```

`railway whoami` is only a valid test for **personal account** tokens.

## Gotchas

- With `RAILWAY_API_TOKEN` set, the CLI **ignores** session auth — a fresh
  `railway login` changes nothing in shells that source the token file. For identity
  commands under a team token: `env -u RAILWAY_API_TOKEN railway whoami`.
- "Unauthorized" from `railway list`/`whoami` under a team token is expected behavior,
  not an auth failure — check project-scoped commands (`railway status`) before
  concluding the token is bad.
- A token that transited chat/logs should be rotated: create a new one, rewrite
  `~/.railway/api-token.env`, revoke the old one in the dashboard.

## See also

- `railway-mcp-edge-city` — querying Edge City control-plane/sidecar projects (non-default project IDs, snake_case params).
- `use-railway` (home, read-only) — broad vendor skill for Railway operations; documents `RAILWAY_API_TOKEN`/`RAILWAY_TOKEN` for unattended use and `railway setup agent`.
