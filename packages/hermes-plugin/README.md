# Index Network Hermes Plugin

The Index plugin connects Hermes to Index over plain HTTPS against the Index REST API, authenticated with this device's own Index session.

## Connect

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Connect to Index by opening the **Index** dashboard and choosing **log in with browser** — the same `/cli-auth` handshake the Index CLI and Mac app use. The web page runs the device authorization grant against your browser session and returns a short-lived device code, which the plugin exchanges for its own session token and persists as `INDEX_SESSION_TOKEN` in the Hermes env file. There is no approval prompt. **Sign out** revokes that session server-side and clears the local file. On a headless host the dashboard shows the login link to open elsewhere.

Optional overrides: `INDEX_API_URL` (the bare API origin, without `/api`; defaults to `https://protocol.index.network`). Browser login pairs with the configured API environment (`INDEX_APP_BASE_URL` wins, else derived from `INDEX_API_URL`).

The general-purpose REST tools call named resources
(`/intents`, `/networks`, `/opportunities`, `/docs`). Failures remain structured;
rejected writes are never replayed.

The session authenticates you, not an agent. `GET /agents/me` returns the agent you selected as your negotiator in the web app; pick one there before expecting an answer.

## Personal agent

Hermes runs the same `Agent` as hosted Index — from `@indexnetwork/agent` —
rather than a second copy of the state machine. `Agent` owns H2A and delegates
A2A to a negotiation subagent. The package still owns eligibility, one POST
per turn, context freshness, and the principal inbox.
Hermes supplies native `AIAgent` think/speaker sessions with the current
agent's tool schemas; it does not restore model checkpoints.

The think-session model tool is `open_negotiations({ negotiations, skipped })`;
the singular model tool is removed with no compatibility alias. Both arrays
are required, with at least one entry across them:

- `negotiations`: each selection is either
  `{ searchId, candidateIntentId, networkId, reasoning, brief }` or
  `{ negotiationId, reasoning, brief }`. Each opening needs its own complete
  private brief. With no discovery pending, visible negotiation IDs can be
  selected for deliberate reopen with `skipped: []`.
- `skipped`: each explicit skip is
  `{ searchId, candidateIntentId, networkId, reason }`.

Every candidate `(candidateIntentId, networkId)` pair from a pending nonempty
`discover_counterparties` result must appear exactly once as an opening selection
or an explicit skip. The shared runtime blocks another discovery and final inbox
review until that result is processed. It executes the existing atomic host
opening operations sequentially: an individually unavailable selection is
nonfatal; stale context, lost authorization, or an uncertain write stops the
remainder without retries, preserving committed openings. Incoming A2A retains
its standing-brief fallback and does not automatically wake H2A. Schemas, batch
rules, and plain-English batch details/results for the UI come from the shared
agent; the plugin does not duplicate them or rename the atomic host REST methods.

Register a Hermes agent under **Settings → Advanced**, then set
`INDEX_EXECUTOR_ID` in this device's Hermes environment to that agent's UUID
and restart the gateway. Choosing that exact agent as your negotiator — in
the dashboard or the Index web app — starts a Bun sidecar
(`runtime/dist/negotiator.js`) as a child of the Hermes gateway. **Bun must
be installed.** It restarts if that child exits, and stops when the gateway
does or the selection moves. Keep the gateway running. Choosing the hosted
Index negotiator, or any agent other than `INDEX_EXECUTOR_ID`, stops the
sidecar. An unset binding never takes over another external agent's seat.

For one signal with N matches the speaker creates **1 think session + N
speaker sessions**, lazily, and reuses them:

- Think: `{intentId}:think` — inbox review working transcript
- Speak: `{opportunityId}` — the A2A working transcript for that match

Settled matches keep their history but are not woken. Your Telegram or Discord
chat is not one of these sessions. Questions, options, and your answers live on
the owner's agent DM — one conversation per signal, shown on Discover's signal
detail and on Index web (`IntentNegotiatorChat`), the same DM the hosted
negotiator uses.

Each runtime constructs its `Agent` with an abort signal and awaits `ready`
for ownership and hydration, without model work. Its `AgentHost.subscribe()`
listener handles A2A events; shutdown aborts the signal and awaits `closed`
for the full drain and records closure, then finishes pending publications.

The plugin follows `GET /events?consumer=<executor UUID>`. Creation and
broadcast frames retain their activation IDs through `agent.wake(activation)`;
lifecycle and negotiation frames notify the host's A2A subscribers without
starting a principal review. `principal.input` names a durable owner message:
the sidecar reads canonical input, including all answers in a committed batch,
then calls `agent.wake({ id: 'principal.input:<inputId>', type: 'h2a.wake' })`.
It does not call `receiveInput` for these already-persisted messages or repeat
their writes.
Reconnect reconciles against `GET /negotiations`, never unfinished model work.
Text typed into a think/speaker working session is ignored; send owner input
through Index instead.

Private briefs, review outputs, retirements and delivery receipts live in
`$HERMES_HOME/index-network/negotiator/<owner>.<intent>.records.json`.
Canonical owner input remains on Index. Old checkpoint files are not loaded
or migrated. Each decision reconstructs context from these domain records;
visible Hermes working sessions are not authority or resumed execution.
Turns and public inbox writes include `?executorId=<agent UUID>` so Index
refuses writes after selection changes. Hosted SQL context fences remain
separate from this external executor's local brief/evidence checks.

Disable the `index` platform in Hermes to stop listening, or change the
selected executor in Index. The sidecar stops with it. A failed H2A publish
stays undelivered and is retried by ID on the next publication or restart;
the model that authored it is not rerun. Lost turn responses are never
retried. Ending an Index run interrupts its native session and closes tool
access. Dashboard answers require the complete displayed `pending` batch;
failed writes retain drafts and show the error.

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
`dashboard/dist/index.js`, `desktop/dist/plugin.js`, or
`runtime/dist/negotiator.js` manually. The dashboard source is `dashboard/index.js`.

`runtime/` is the negotiator host: it wires `@indexnetwork/agent` to Index
REST and asks Hermes to speak or think. It is bundled into
`runtime/dist/negotiator.js` so the published plugin carries no npm
dependency on the monorepo. Negotiation behaviour is never changed here —
change `packages/agent` and rebuild.
