# Railway Authentication for Agents and CI

How to stop the Railway "login every 5 minutes" loop, and how to give agents headless
auth that never depends on a browser session.

## Root cause of the login loop

The local `railway mcp` server (configured in `.mcp.json` as `command: railway`,
`args: [mcp]`) authenticates from the **browser-session tokens** in
`~/.railway/config.json`: a short-lived `accessToken` (~1 h) plus a **rotating**
`refreshToken`. Two failure modes follow:

1. **Stale long-running process** — the MCP server reads the token at spawn and never
   sees the refreshed value after a later terminal `railway login`.
2. **Refresh-token rotation race** — the terminal CLI, the MCP server, and any
   `railway agent` session share one config file. When the access token expires, the
   first process to refresh consumes the one-time refresh token; every other process
   still holding the stale one gets `invalid_grant: grant request is invalid`, which
   **invalidates the whole session**.

The fix is to give agents a static token via `RAILWAY_API_TOKEN`. It takes precedence
over the session and removes refresh behavior entirely.

## Token semantics

All three are UUID-shaped — the shape tells you nothing about which kind you hold.

| Token | Env var | `whoami` / `list` | Project ops | Notes |
|---|---|---|---|---|
| Personal account (railway.com/account/tokens, "No workspace") | `RAILWAY_API_TOKEN` | ✅ | ✅ every workspace the user can access | Best for a developer machine |
| Team / workspace-scoped | `RAILWAY_API_TOKEN` | ❌ Unauthorized (carries no user identity) | ✅ within that workspace | `whoami` failing does **not** mean the token is invalid |
| Project token (project settings) | `RAILWAY_TOKEN` | ❌ | ✅ one project + environment | For CI of a single service |

The dashboard shows the secret **only once, at creation**. The UUID visible in the token
list afterwards is the token's ID, not the secret.

## Setup

```bash
# 1. Store the token outside installer-managed files —
#    ~/.railway/env is overwritten on CLI updates.
printf 'export RAILWAY_API_TOKEN=%s\n' '<token>' > ~/.railway/api-token.env
chmod 600 ~/.railway/api-token.env

# 2. Source it from the shell profile, right after the installer's own env line:
#    [ -s "$HOME/.railway/api-token.env" ] && source "$HOME/.railway/api-token.env"
```

New shells, `railway agent`, and any MCP server spawned afterwards inherit the variable.
**Restart the agent process** after adding the token — a running MCP server keeps its
spawn-time environment.

## Verifying a token

Test against GraphQL directly; this bypasses all CLI and session logic, so it
discriminates a bad token from a bad CLI state.

```bash
T='<token>'

# Account token → returns your user. Team token → "Not Authorized" (expected).
curl -s https://backboard.railway.com/graphql/v2 -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d '{"query":"query { me { id email } }"}'

# Any valid API token → lists reachable projects. Invalid token → error.
curl -s https://backboard.railway.com/graphql/v2 -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d '{"query":"query { projects { edges { node { id name } } } }"}'
```

`railway whoami` is a valid test only for **personal account** tokens.

## Gotchas

- With `RAILWAY_API_TOKEN` set, the CLI **ignores** session auth — a fresh
  `railway login` changes nothing in shells that source the token file. For identity
  commands under a team token: `env -u RAILWAY_API_TOKEN railway whoami`.
- "Unauthorized" from `railway list` / `whoami` under a team token is expected, not an
  auth failure. Check a project-scoped command (`railway status`) before concluding the
  token is bad.
- Rotate any token that transited chat or logs: create a new one, rewrite
  `~/.railway/api-token.env`, then revoke the old one in the dashboard.

## See also

- [Feature flags](./feature-flags.md) — there are none; what to do instead.
- The `use-railway` skill covers broad Railway operations and `railway setup agent`.
