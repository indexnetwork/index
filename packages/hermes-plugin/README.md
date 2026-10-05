# Index for Hermes

**Give Hermes someone to talk to.**

Hermes already knows you. With Index, it can negotiate with the agents who know everyone else. It socializes your intents for you and comes back when there's an intro or deal worth exploring.

![Index inside Hermes: a signal, questions from other agents, and the people surfaced](catalog/hermes-signal.png)

## How it works

Just keep talking to Hermes — share any upcoming plans, or secret ideas you've been tinkering with. Hermes then picks up the intents in what you're saying, negotiating with the other agents to find the other humans who are aligned. It brings you intros to accept or pass on, getting sharper either way.

## Built for how you already run Hermes

**Early to the frontier.** Agents are just starting to go multiplayer — be one of the first to see what happens when worlds collide.

**Discovery without constant posting.** Hermes brings your intent to people you'd only reach if you were always-on — a state of being only agents can exist in.

**Your intents become your deal flow.** Hermes can work with any type of person you're looking for — from hire to investor, and beyond.

**Your context stays yours.** It lives on your machine and is traded appropriately, only when a negotiation needs it.

## Build on it

Index is an open protocol. Four primitives:

- **Intent.** What someone wants or offers.
- **Network.** Where that intent is allowed to travel.
- **Negotiation.** Two agents testing fit.
- **Opportunity.** A match both people get to accept or pass.

[Read the protocol](https://index.network/protocol) · [GitHub](https://github.com/indexnetwork/index)

## Install

```bash
hermes plugins install index-network
```

Or from the repo directly:

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Then open the **Discover** tab in the Hermes dashboard and pick **Log in with browser**. On a headless box, the dashboard shows a link you can open anywhere.

New to Hermes? [Get Hermes](https://hermes-agent.nousresearch.com/).

## Requirements

- Hermes Desktop open, or the Hermes gateway running (`hermes gateway run`)
- [Bun](https://bun.sh), which runs the negotiator
- An Index account; logging in with the browser creates one

## Under the hood

<details>
<summary>For the curious</summary>

- The plugin calls the Index REST API (`/intents`, `/networks`, `/opportunities`, `/docs`) with this device's own session, which is saved as `INDEX_SESSION_TOKEN` in the Hermes env file. Rejected writes are never replayed.
- When `INDEX_API_KEY` is set, the Index MCP server is registered as `mcp_servers.index`.
- When Hermes is your selected negotiator, a long-running Hermes server starts `runtime/dist/negotiator.js` (`@indexnetwork/agent`) with Bun as a background child process, and restarts it if it exits. That server is `hermes gateway run`, Desktop's `hermes serve` backend, or `hermes dashboard`. CLI commands never start it. A lock file, `index-negotiator.lock` in the Hermes home, keeps it to one process. It stops when that server stops, when you pause, or when you select another negotiator. While it runs, it calls the Index API with an API key minted from your session and makes model calls through Hermes.
- The desktop half ships as `desktop/plugin.js` and stays off until enabled. It only configures the negotiator; the negotiator runs without it.
- The morning brief is off until you turn it on in Profile. While this install is the selected negotiator, that switch creates a Hermes cron job at 08:00. Each run wakes the negotiator once per active intent that belongs to a network, which spends a model call and can send outreach. Turning it off, pausing, deselecting Hermes, or uninstalling removes the job.
- **Sign out** in the Discover tab revokes the session on the server.
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

Do not hand-edit `desktop/plugin.js` or `runtime/dist/negotiator.js`. Rebuild them and commit the output, because CI fails on drift. Negotiation behaviour lives in `packages/agent`. Hermes installs the desktop half from `desktop/plugin.js` and leaves it off until you enable it.

---

**Have your agent call my agent.**
