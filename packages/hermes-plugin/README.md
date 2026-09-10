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

Hermes runs the same negotiator as hosted Index — the `@indexnetwork/agent`
package — rather than a second implementation of it. Hermes is the execution
environment: it supplies the model, the owner's conversation, and this machine,
while the negotiation state machine, prompts, tools, question flow, and
checkpoints stay inside the agent package. Choosing Hermes as your negotiator —
in the dashboard under **Settings → Advanced**, or in the Index web app — starts
it on this machine: background turns begin as soon as the reader connects. Keep
the gateway running. Choosing the hosted Index negotiator, or another registered
agent, stops it.

The negotiator runs as a Bun process (`runtime/dist/negotiator.js`) supervised by
the plugin, so **Bun must be installed** on this machine. It reaches Hermes over
loopback for two things only: one tool-capable completion per model call, and
delivery of the entries it selected for you. Model calls go through the host's
`auxiliary_client.call_llm`, so provider choice, credentials, and fallback remain
Hermes's — no additional model credential or worker is needed.

To also receive questions and reply to them, ask Hermes in a **private Hermes
gateway conversation** to enable the Index personal agent. It calls
`index_configure_personal_agent` with the selected agent's ID and binds that
conversation as your private channel. Until then, questions and updates wait
undelivered and are offered again once a conversation exists. This requires Index
API 0.117.0 or newer and Hermes with `pre_gateway_dispatch`, `pre_llm_call`,
`register_platform`, and a tool-capable `auxiliary_client.call_llm`. These
interfaces were checked at Hermes commit `63279301bc`.

The plugin registers an `index` gateway platform that follows your Index event
stream (`GET /events`). A signal that owes a turn produces a frame, which wakes
the negotiator for that signal; the work happens in the negotiator process, not
in a Hermes session. Frames arriving close together for one signal collapse into
a single wake. A frame is only a wake-up hint: the negotiator reads authoritative
state over REST before deciding, and each reconnection reconciles against
`GET /negotiations`, so a frame missed while the gateway was down costs nothing.
Selection in Index is owner-wide, so every active signal is covered. A match
awaiting your answer leaves the other matches free to progress. Only the agent's
own inbox review selects questions and meaningful updates for delivery. An A2A
agreement remains a recommendation pending the separate human approval for a
connection in Index.

Ask Hermes to focus an intent (`index_focus_intent`) to discuss its status or
provide instructions. Normal messages in that private conversation then belong
to that intent. Send `Index off` to return to ordinary Hermes conversation; this
leaves background negotiation enabled. Questions include a reply address such as
`Index <intent UUID>/<question UUID>: <your answer>` so replies remain correctly
scoped across fresh sessions and multiple intents. Suggested options and custom
answers are both supported.

Human answers are captured from real gateway events, never from model-generated
tool arguments. A message that belongs to a focused signal is handed straight to
the negotiator and reported consumed, so Hermes never reasons about it or answers
on your behalf; if the negotiator is unreachable or refuses it — a stale answer to
a question that already moved on — the message falls through to ordinary Hermes
conversation instead of being swallowed. Enabling and answering the personal agent
through CLI/Desktop-only sessions is not supported; use a private gateway
conversation. Existing Index login, dashboard, desktop, and general tools remain
available on their usual surfaces.

Which account and agent this machine negotiates for is stored in
`$HERMES_HOME/index-network/principal.sqlite3`. The negotiation state itself —
the private inbox, the H2A transcript, questions, and match progress — is the
agent package's own checkpoint, one JSON file per signal under
`$HERMES_HOME/index-network/negotiator/`. Protect and retain both when moving a
profile; the plugin does not interpret the checkpoints. Every restored match reads
current Index state before deciding, and a turn is attempted at most once, so a
lost response is reconciled by the next read rather than retried. Index also
checks the selected executor atomically because turns include
`?executorId=<agent UUID>`.

Questions raised by this negotiator are delivered to your bound Hermes
conversation, not to the Index web agent thread — that thread belongs to the
hosted negotiator, which Index stops while an external executor is selected.

Disable the `index` platform in Hermes to stop listening, or change the selected
executor in Index to hand control back to the hosted agent or another external
agent. The negotiator process stops with it, and Index refuses turns fenced to the
agent that is no longer selected. A failed delivery is not treated as an answer,
consent, or a decline: the entry stays undelivered and is offered again.

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

`runtime/` is the negotiator: a thin host that wires `@indexnetwork/agent` to
Hermes's model, this machine's checkpoints, and the Index REST protocol. It is
bundled into `runtime/dist/negotiator.js` so the published plugin carries no npm
dependency on the monorepo. Negotiation behaviour is never changed here — change
`packages/agent` and rebuild.
