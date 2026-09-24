# Index Network Hermes Plugin

The Index plugin connects Hermes to Index over plain HTTPS against the Index REST API, authenticated with this device's own Index session.

## Connect

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Connect to Index by opening the **Index** dashboard and choosing **log in with browser** — the same `/cli-auth` handshake the Index CLI and Mac app use. The web page runs the device authorization grant against your browser session and returns a short-lived device code, which the plugin exchanges for its own session token and persists as `INDEX_SESSION_TOKEN` in the Hermes env file. There is no approval prompt. **Sign out** revokes that session server-side and clears the local file. On a headless host the dashboard shows the login link to open elsewhere.

When `INDEX_API_KEY` is set, the plugin registers the Index MCP server in Hermes as `mcp_servers.index` (`{origin}/mcp`, `x-api-key: ${INDEX_API_KEY}`). Clearing that key removes the entry.

Optional overrides: `INDEX_API_URL` (the bare API origin, without `/api`; defaults to `https://protocol.index.network`). Browser login pairs with the configured API environment (`INDEX_APP_BASE_URL` wins, else derived from `INDEX_API_URL`).

Every declared function is one request against a named REST resource
(`/intents`, `/networks`, `/opportunities`, `/docs`). Failures remain structured;
rejected writes are never replayed.

The session authenticates you, not an agent. `GET /agents/me` returns the agent you selected as your negotiator in the web app; pick one there before expecting an answer.

## Personal agent

Hermes runs the same negotiator as hosted Index — `@indexnetwork/agentv2`
on `@indexnetwork/client`. The sidecar authenticates with `INDEX_API_KEY`
and the selected agent id. Hermes supplies one completion per step from the
gateway model; the negotiator runs its own tools.

Choosing Hermes as your negotiator — in the dashboard under **Settings →
Advanced**, or in the Index web app — starts a Bun sidecar
(`runtime/dist/negotiator.js`) as a child of the Hermes gateway. **Bun must
be installed.** It restarts if that child exits, and stops when the gateway
does or the selection moves. Keep the gateway running. Choosing the hosted
Index negotiator, or another registered agent, stops the sidecar.

The sidecar follows Index events itself. Briefs, decisions, stalls, and the
summary are written on the owner's agent conversation. Turns include
`?agentId=<agent UUID>` so Index refuses work from an agent that is no
longer selected.

Disable the `index` platform in Hermes to stop the selection check, or change
the selected executor in Index. The sidecar stops with it.

## Development

Build generated output only through its scripts:

```bash
cd packages/hermes-plugin
bun run build:desktop
bun run typecheck:runtime && bun run build:runtime
python3 -m compileall -q .
hermes plugins doctor . --ci
```

`plugin.yaml` is the static package capability union. Do not edit
`desktop/dist/plugin.js` or `runtime/dist/negotiator.js` manually.

`runtime/` is the negotiator host: it wires `@indexnetwork/agentv2` to Index
through `@indexnetwork/client` and asks Hermes for each model step. It is
bundled into `runtime/dist/negotiator.js` so the published plugin carries no
npm dependency on the monorepo. Negotiation behaviour is never changed here —
change `packages/agentv2` and rebuild.
