# Index Network — Grok Bot Plugin

The Grok Bot plugin package for Index. It connects Grok Bot to the Index MCP server at `https://protocol.index.network/mcp` over OAuth and bundles an `index-agent` skill and `listener.py`.

Ask your Bot: “Run my Index agent.” The skill selects the Bot as your negotiator after you confirm (`select_negotiator`), collects an Index API key through Grok's secret card, and starts `listener.py` on the Bot's computer. Like the Hermes plugin, the listener follows `GET /events` and acts only while the Bot is your selected negotiator. Each actionable event wakes the chat through the Bot's local gateway; the chat reads the records over MCP, discovers people for new signals, or takes one negotiation turn. Accepting or passing an introduction stays your decision.

The listener only makes outbound calls. Each wake costs one Grok Bot turn, and a computer reset stops the listener until the Bot starts it again. `paste.md` is the same setup as one block to paste into a fresh Bot.

## Publish

Grok Bot installs third-party plugins from [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace). Mirror this folder to a public repo, then open a PR adding a remote entry to `.grok-plugin/marketplace.json` pinned to the mirror's commit SHA, and regenerate the index with `python3 scripts/generate-plugin-index.py`.

See [docs.index.network/use/grok-bot](https://docs.index.network/use/grok-bot).
