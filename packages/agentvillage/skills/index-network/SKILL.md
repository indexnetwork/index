---
name: index-network
description: Edge Esmeralda's Index Network bundle. Surfaces opportunities through a morning 08:00 digest (composed ahead by a prepare pass, delivered by a send pass) and accepted-opportunity notifications on the heartbeat tick. Prunes stale signals weekly. Read when surfacing opportunities, drafting introductions, running onboarding for a new user, composing the digest flow, or handling anything backed by the Index Network MCP (server `index`).
metadata:
  openclaw:
    requires:
      config:
        - mcp.servers.index
---

# Index Network — Edge Esmeralda

Edge's bundle for surfacing opportunities through Edge Esmeralda's Index Network integration. The Index Network MCP (server `index`) is the tool surface; this skill carries the Edge-flavored procedural knowledge for using it.

## When to read each file

- **Any non-trivial tool call** → [tools.md](tools.md). MCP tool families, entity model, `scrape_url` usage, output translation rules.
- **Composing user-facing opportunity renderings** → [exemplars.md](exemplars.md). Canonical morning-digest voice samples; greeting-draft format for `&msg=`.
- **`read_user_profiles().onboardingComplete === false`** → [bootstrap.md](bootstrap.md). Five-step Index Network onboarding ritual and the session-start gate.
- **Heartbeat tick** → [heartbeat.md](heartbeat.md). Accepted-opportunity notifications and signal-freshness pruning.

Cron prompts in `prompts/` (`prepare.md`, `send.md`) are loaded by the cron runner via `--message`; you do not read them yourself. The crons are fixed Edge infrastructure — their schedule is not user-configurable.

## Handoff

The MCP server's own instructions carry the protocol-level rules (voice, vocabulary, entity model, output translation). Tool descriptions are authoritative; read them before calling. This skill adds only Edge Esmeralda-specific framing on top — never duplicate the MCP's behavioural guidance here.
