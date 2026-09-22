# Index Network Hermes Plugin

The Index plugin connects Hermes to Index over plain HTTPS against the Index REST API, authenticated with this device's own Index session.

## Connect

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Connect to Index by opening the **Index** dashboard and choosing **log in with browser** — the same `/cli-auth` handshake the Index CLI and Mac app use. The web page runs the device authorization grant against your browser session and returns a short-lived device code, which the plugin exchanges for its own session token and persists as `INDEX_SESSION_TOKEN` in the Hermes env file. There is no approval prompt. **Sign out** revokes that session server-side and clears the local file. On a headless host the dashboard shows the login link to open elsewhere.

Optional overrides: `INDEX_API_URL` (the bare API origin, without `/api`; defaults to `https://protocol.index.network`). Browser login pairs with the configured API environment (`INDEX_APP_BASE_URL` wins, else derived from `INDEX_API_URL`).

Every declared function is one request against a named REST resource
(`/intents`, `/networks`, `/opportunities`, `/docs`). Failures remain structured;
rejected writes are never replayed.

The session authenticates you, not an agent. `GET /agents/me` returns the agent you selected as your negotiator in the web app; pick one there before expecting an answer.

## Personal agent

Hermes runs the same negotiator as hosted Index — `@indexnetwork/agent` —
rather than a second copy of its policy. One principal-scoped `AgentRunner`
owns scheduling, stalls, questions, discovery, briefs, and negotiations. Index
REST records are authoritative. Hermes implements the package's bounded
`Execute` calls through native `AIAgent` sessions.

Choosing Hermes as your negotiator — in the dashboard under **Settings →
Advanced**, or in the Index web app — starts a Bun sidecar
(`runtime/dist/negotiator.js`) as a child of the Hermes gateway. **Bun must
be installed.** It restarts if that child exits, and stops when the gateway
does or the selection moves. Keep the gateway running. Choosing the hosted
Index negotiator, or another registered agent, stops the sidecar.

For one signal with N matches the speaker creates **1 think session + N
speaker sessions**, lazily, and reuses them:

- Think: `{intentId}:think` — inbox review working transcript
- Speak: `{opportunityId}` — the A2A working transcript for that match

Settled matches keep their history but are not woken. Your Telegram or Discord
chat is not one of these sessions. Questions, options, and your answers live on
the owner's agent DM — one conversation per signal, shown on Discover's signal
detail and on Index web (`IntentNegotiatorChat`), the same DM the hosted
negotiator uses.

The plugin follows `GET /events?consumer=<agent UUID>` and forwards persisted
principal, intent, and negotiation changes to the runner in order. On every
connection the runner reconciles active intents, unresolved stalls, and
eligible first turns from Index. Type on a think or negotiation session is
ignored.

The runtime has no private negotiation checkpoints. Existing JSON files under
`$HERMES_HOME/index-network/negotiator/` are ignored and left untouched. H2A
writes and negotiation turns include `?executorId=<agent UUID>` so Index
refuses work from an agent that is no longer selected. A successful terminal
tool ends the Hermes run immediately.

Disable the `index` platform in Hermes to stop listening, or change the
selected executor in Index. The sidecar stops with it.

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

`runtime/` is the negotiator host: it wires `@indexnetwork/agent` to Index
REST and asks Hermes to speak or think. It is bundled into
`runtime/dist/negotiator.js` so the published plugin carries no npm
dependency on the monorepo. Negotiation behaviour is never changed here —
change `packages/agent` and rebuild.
