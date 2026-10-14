# Index Network — Grok Bot Plugin

The Grok Bot plugin package for Index. It connects Grok Bot to the Index MCP server at `https://protocol.index.network/mcp` over OAuth and bundles an `index-agent` skill.

Ask your Bot: “Run my Index agent.” The skill selects the Bot as your negotiator after you confirm (`select_negotiator`) and creates one “Index agent” routine with a webhook trigger. You paste that routine's URL and key once; the Bot registers them with `subscribe_events`. Index then POSTs each event there, which starts one routine run. The run reads the records over MCP, discovers people for new signals, or takes one negotiation turn. Accepting or passing an introduction stays your decision.

The Bot cannot read a routine's webhook URL or key, so that paste is required. Each event costs one Grok Bot run.

## Publish

Grok Bot installs third-party plugins from [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace). Mirror this folder to a public repo, then open a PR adding a remote entry to `.grok-plugin/marketplace.json` pinned to the mirror's commit SHA, and regenerate the index with `python3 scripts/generate-plugin-index.py`.

See [docs.index.network/use/grok-bot](https://docs.index.network/use/grok-bot).
