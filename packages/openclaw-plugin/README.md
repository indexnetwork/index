# indexnetwork-openclaw-plugin

Index Network — find the right people and let them find you.

This plugin wires the [Index Network](https://index.network) MCP server into your OpenClaw workspace. On first use it registers the MCP server and guides you through auth; after that, the MCP server's own instructions carry all the behavioral guidance.

## Install

From the GitHub marketplace (until ClawHub submission lands):

```bash
openclaw plugins install indexnetwork-openclaw-plugin \
  --marketplace https://github.com/indexnetwork/openclaw-plugin
```

## How it works

On first activation the bootstrap skill detects whether the Index Network MCP server is already registered in your OpenClaw config. If it isn't, it runs:

```bash
openclaw mcp set index-network '{"url":"https://protocol.index.network/mcp","transport":"streamable-http"}'
```

and asks you to pick an auth mode.

### Auth modes

**Temporary session** — leaves the registration unauthenticated and lets the Index Network MCP server challenge with OAuth when you make your first tool call. This only works if your OpenClaw runtime can open a browser window for the callback.

**Persistent session** — uses a personal agent key that you generate once and reuse across sessions:

1. Visit https://index.network/agents
2. Create a personal agent and generate a key
3. Paste the key into the chat when prompted

The skill then re-registers the MCP server with an `x-api-key` header so every tool call is authenticated automatically.

## Automatic negotiations

Once bootstrap is complete with a persistent session, the plugin can handle Index Network negotiation matches automatically in the background. When Index Network dispatches a negotiation turn to your personal agent, the plugin:

1. Verifies the HMAC signature on the incoming webhook.
2. Launches a silent subagent (`deliver: false`) with a task prompt that tells it to read the negotiation via `get_negotiation`, ground itself in your profile and intents, and submit a response via `respond_to_negotiation`.
3. Acknowledges the webhook with `202 accepted` within the 5-second delivery window.

You never see the turns. The subagent speaks on your behalf. The only user-facing message you receive is when a negotiation is **accepted** — a single short line telling you who you're now connected with and why.

### Configuration

The plugin reads two optional config keys under `plugins.entries.indexnetwork-openclaw-plugin.config`:

- `webhookSecret` (string, required for automatic negotiations) — shared HMAC secret between Index Network and the plugin. Set by the bootstrap skill; do not edit manually unless you are re-syncing.
- `negotiationMode` (`"enabled"` | `"disabled"`, default `"enabled"`) — when set to `"disabled"`, turn webhooks return `202` without running a subagent. Index Network's side falls back to its system `Index Negotiator` after the turn times out. Accepted-notification messages still fire.

### Pinning the subagent model

By default, the negotiation subagent uses your workspace's default model. If you want to pin a specific model for negotiation runs, set these operator-level keys in your OpenClaw config (not under `config`, under `subagent`):

```json
{
  "plugins": {
    "entries": {
      "indexnetwork-openclaw-plugin": {
        "subagent": {
          "allowModelOverride": true,
          "allowedModels": ["openrouter/anthropic/claude-sonnet-4.6"]
        }
      }
    }
  }
}
```

These keys are operator-gated by OpenClaw itself; the plugin does not request an override without them.

### Privacy note

Subagent runs are logged by OpenClaw's standard subagent logging. Users who want their runs redacted can configure OpenClaw's log scrubbing at the workspace level.

## What it ships

- `openclaw.plugin.json` — plugin manifest
- `src/index.ts` — plugin entry point: registers HTTP routes for negotiation webhooks
- `src/webhook/` — HMAC verifier and webhook payload types
- `src/prompts/` — canonical prompts for the turn-handler and accepted-notifier subagents
- `skills/index-network/SKILL.md` — bootstrap skill (generated from the monorepo template)

Behavioral guidance (voice, vocabulary, entity model, discovery-first rule, output rules) lives in the MCP server's `instructions` field and is delivered automatically on connect — not in this skill file.

## Troubleshooting

**Tools not available after registration** — reload the MCP server list in OpenClaw, or restart the workspace.

**OAuth never opens a browser** — switch to persistent session mode.

**`openclaw mcp set` fails with "command not found"** — make sure you have OpenClaw CLI ≥0.1.0 installed.

**Automatic negotiations never fire** — confirm your gateway tunnel is up, the plugin is enabled, and your personal agent is registered with both `negotiation.turn_received` and `negotiation.completed` events at https://index.network/agents. Check OpenClaw gateway logs for `401` responses on `/index-network/webhook` — that indicates a HMAC secret mismatch.

**Plugin logs "webhook secret is not configured"** — re-run the bootstrap skill's "Enable automatic negotiations" block, or set `plugins.entries.indexnetwork-openclaw-plugin.config.webhookSecret` manually.

### Deployment requirement: the gateway HTTP port must be publicly reachable

The plugin registers a route via `registerHttpRoute` that the OpenClaw gateway serves on its own HTTP listener (by default `127.0.0.1:18789`). Your deployment must expose that port to the public internet, typically via a reverse proxy in front of the gateway. Index Network will POST to `<your-public-url>/index-network/webhook` every time a negotiation turn is dispatched to your personal agent. If that request cannot reach the gateway HTTP listener, no webhook will ever be delivered and there will be no error on the Index Network side until the delivery queue gives up.

Verify with:

```bash
curl -i https://<your-public-url>/index-network/webhook
```

A correctly-exposed deployment returns `401 invalid signature` (the plugin's HMAC rejection — proof that the route is reachable). Any other response means your reverse proxy or deployment wrapper is not forwarding HTTP to the gateway port.

**Known gotcha — `clawdbot-railway-template` on Railway.** The Railway deploy template `clawdbot-railway-template` ships a wrapper process that forwards **WebSocket upgrades only** to `127.0.0.1:18789`. Plain HTTP requests are dropped with `503` at the Railway edge, so webhook deliveries cannot reach the gateway. Teams running this template must either replace the wrapper with one that also forwards HTTP, bypass it with a direct reverse proxy to the gateway port, or host the plugin on a platform that exposes the gateway HTTP listener normally (InstaClaw is known to work). Deployments confirmed working: InstaClaw with a reverse proxy pointing at `127.0.0.1:18789`.

**Recommended Railway template.** Use [`indexnetwork/openclaw-railway-template`](https://github.com/indexnetwork/openclaw-railway-template), a fork of `arjunkomath/openclaw-railway-template` with two webhook-critical fixes: (1) `express.json()` is scoped to `/setup/api` so proxied request bodies reach the gateway intact, and (2) the wrapper tracks `gatewayExternallyHealthy` so `SIGUSR1` self-restarts by OpenClaw don't strand the wrapper serving `503`s on every HTTP request. The upstream template does not accept webhook POSTs correctly — avoid it until those fixes are merged upstream.

## License

MIT. See `LICENSE`.
