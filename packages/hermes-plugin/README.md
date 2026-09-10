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

Hermes can act as your Index personal agent using its configured model and native
agent loop. Select your external Hermes agent in Index, then in a **private Hermes
gateway conversation** ask Hermes to enable the Index personal agent. It calls
`index_configure_personal_agent` with the selected agent's ID and binds that
conversation as your private channel. Keep the gateway running. No additional
model credential or worker is needed. This requires Index API 0.117.0 or newer
and Hermes with `pre_gateway_dispatch`, `pre_llm_call`, `post_llm_call`,
`pre_tool_call`, `transform_llm_output`, native plugin skills, and
`register_platform`. These interfaces were checked at Hermes commit
`63279301bc`.

The plugin registers an `index` gateway platform that follows your Index event
stream (`GET /events`). A signal that owes a turn produces a frame, and that
frame opens one bounded run in a chat of its own, so background match work never
shares a session with your private conversation. Frames arriving close together
for one signal collapse into a single run. A frame is only a wake-up hint: every
run reads authoritative state over REST before deciding, and each reconnection
reconciles against `GET /negotiations`, so a frame missed while the gateway was
down costs nothing. Selection in Index is owner-wide, so every active signal is
covered. A match awaiting your answer leaves the other matches free to progress.
Only the private inbox review selects questions and meaningful updates for
delivery. An A2A agreement remains a recommendation pending the separate human
approval for a connection in Index.

Ask Hermes to focus an intent (`index_focus_intent`) to discuss its status or
provide instructions. Normal messages in that private conversation then belong
to that intent. Send `Index off` to return to ordinary Hermes conversation; this
leaves background negotiation enabled. Questions include a reply address such as
`Index <intent UUID>/<question UUID>: <your answer>` so replies remain correctly
scoped across fresh sessions and multiple intents. Suggested options and custom
answers are both supported. Recorded owner input is the one change Index
publishes no frame for, so the conversation turn wakes that signal itself.

Human answers are captured from real gateway events, never from model-generated
tool arguments or background completion messages. Enabling and answering the
personal agent through CLI/Desktop-only sessions is not supported; use a private
gateway conversation. Existing Index login, dashboard, desktop, and general tools
remain available on their usual surfaces.

Private state is stored in `$HERMES_HOME/index-network/principal.sqlite3` (default
`~/.hermes/index-network/principal.sqlite3`), separated by Index account and intent.
It contains questions, scoped input history, queued requests, review notes, and
consumed submission attempts. Protect and retain this file when moving a profile.
Decisions also read the existing private Index conversation for their intent, so
previously recorded answers and limits remain available after executor handover.
Every restored decision reads current Index state before receiving a new work ID.
The plugin records a POST attempt before sending it and never retries that work
ID, including after a lost response. Uncertainty remains explicit until a fresh
read reconciles it. Index also checks the selected executor atomically when a
turn includes `?executorId=<agent UUID>`.

Disable the `index` platform in Hermes to stop listening, or change the selected
executor in Index to hand control back to the hosted agent or another external
agent. The old Hermes executor then fails its selection checks. The selected
final result reaches your bound Hermes thread; a failed delivery is not
treated as an answer, consent, or a decline. Read the focused inbox to recover a
displayed question if its delivery was interrupted.

## Development

Build generated desktop output only through its script:

```bash
cd packages/hermes-plugin
bun run build:desktop
python3 -m compileall -q .
hermes plugins doctor . --ci
```

`plugin.yaml` is the static package capability union. Do not edit `desktop/dist/plugin.js` manually.

The shipped `skills/personal-agent/SKILL.md` is generated from the canonical
`packages/agent` prompts. From the monorepo root, regenerate it with
`bun scripts/generate-hermes-instructions.ts` and verify it with
`bun run check:hermes-instructions`. CI checks freshness; the standalone plugin
ships the generated file and does not import or run the TypeScript agent.
