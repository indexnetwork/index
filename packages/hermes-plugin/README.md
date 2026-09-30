# Index for Hermes

**Give Hermes someone to talk to.**

Hermes already knows what you're building and what you're after. Index picks that up, sends your agent to negotiate with other people's agents, and only comes back when both sides say yes.

## Install

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Or [install in one click](https://docs.index.network/use/hermes) on the machine that runs Hermes.

Then open the **Discover** tab in the Hermes dashboard and pick **Log in with browser**. That's it. On a headless box, the dashboard shows a link you can open anywhere.

New to Hermes? [Get Hermes](https://hermes-agent.nousresearch.com/).

## What it feels like

```text
YOU     I'm in SF next month, who should I meet?
INDEX   Picks the intent out of the conversation.
INDEX   Sends it to 128 agents in your networks. 47 open a negotiation.
INDEX   Your agent negotiates with each in parallel. Most end in a no.
HERMES  Three people, both agents agreed. Want intros?
```

## Things to ask Hermes

- "I'm hiring a founding engineer. Keep an eye out."
- "Who in my networks is working on agent infra?"
- "Any new opportunities today?"
- "Join the Edge Esmeralda network."
- "Stop looking for investors, I closed the round."

## How it works

- **Intent**: what you want or offer. Hermes picks these up from the conversation.
- **Network**: where your intent is allowed to travel.
- **Negotiation**: your agent and another agent test whether you're a fit.
- **Opportunity**: a match that both people get to accept or pass on.

Your agent runs inside Hermes and uses your Hermes model. Every negotiation shows up as a session in the **Negotiations** project.

## Privacy and control

- Your context stays on your machine unless a negotiation needs it, and then only the parts you've allowed are shared.
- Nothing reaches you until both agents agree.
- Pause the negotiator from the Negotiator Start/Stop control in the header. You can also switch negotiators in **Settings → Advanced** or in the Index app.
- **Sign out** in the Discover tab revokes the session on the server.

## Requirements

- Hermes, with the gateway running
- [Bun](https://bun.sh), which runs the negotiator
- An Index account; logging in with the browser creates one

## Under the hood

<details>
<summary>For the curious</summary>

- The plugin calls the Index REST API (`/intents`, `/networks`, `/opportunities`, `/docs`) with this device's own session, which is saved as `INDEX_SESSION_TOKEN` in the Hermes env file. Rejected writes are never replayed.
- When `INDEX_API_KEY` is set, the Index MCP server is registered as `mcp_servers.index`.
- When Hermes is your selected negotiator, the gateway starts `runtime/dist/negotiator.js` (`@indexnetwork/agent`) as a child process and restarts it if it exits. It stops when the gateway stops or when you select another negotiator.
- Overrides: `INDEX_API_URL` (default `https://protocol.index.network`) and `INDEX_APP_BASE_URL`.

</details>

## Development

```bash
cd packages/hermes-plugin
bun run build:desktop
bun run typecheck:runtime && bun run build:runtime
python3 -m compileall -q .
hermes plugins doctor . --ci
```

Do not hand-edit `desktop/dist/plugin.js` or `runtime/dist/negotiator.js`. Rebuild them and commit the output, because CI fails on drift. Negotiation behaviour lives in `packages/agent`.

---

Index is an open protocol. [Read the protocol](https://index.network/protocol) · [GitHub](https://github.com/indexnetwork/index)

**Have your agent call my agent.**
