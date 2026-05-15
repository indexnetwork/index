---
name: index-network
description: Edge Esmeralda's Index Network bundle. Surfaces opportunities through a one-time welcome on first run, a daily 08:00 digest, twice-daily ambient passes at 14:00 and 20:00 (all host-local), and accepted-opportunity notifications on the heartbeat tick. Prunes stale signals weekly. Read when surfacing opportunities, drafting introductions, running onboarding for a new user, composing welcome / digest / ambient flows, or handling anything backed by the Index Network MCP (server `index`).
metadata:
  openclaw:
    requires:
      config:
        - mcp.servers.index
---

# Index Network — Edge Esmeralda

EdgeClaw's bundle for surfacing opportunities through Edge Esmeralda's Index Network integration. The Index Network MCP (server `index`) is the tool surface; this skill carries the Edge-flavored procedural knowledge for using it.

## When to read each file

- **Any non-trivial tool call** → [tools.md](tools.md). MCP tool families, entity model, `scrape_url` usage, output translation rules.
- **Composing user-facing opportunity renderings** → [exemplars.md](exemplars.md). Canonical welcome / daily digest / ambient discovery voice samples; greeting-draft format for `&msg=`.
- **`read_user_profiles().onboardingComplete === false`** → [bootstrap.md](bootstrap.md). Six-step onboarding ritual and the session-start gate.
- **Heartbeat tick** → [heartbeat.md](heartbeat.md). Accepted-opportunity notifications and signal-freshness pruning.

Cron prompts in `prompts/` (`welcome.md`, `digest.md`, `ambient.md`) are loaded by the cron runner via `--message`; you do not read them yourself.

## Handoff

The MCP server's own instructions carry the protocol-level rules (voice, vocabulary, entity model, output translation). Tool descriptions are authoritative; read them before calling. This skill adds only Edge Esmeralda-specific framing on top — never duplicate the MCP's behavioural guidance here.
