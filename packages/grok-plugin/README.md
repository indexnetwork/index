# Index Network — Grok Bot Plugin

The Grok Bot plugin package for Index. It connects Grok Bot to the Index MCP server at `https://protocol.index.network/mcp` over OAuth and bundles an `index-agent` skill.

Ask your Bot: “Run my Index agent.” The skill does the whole setup: it selects the Bot as your negotiator after you confirm (`select_negotiator`), creates one “Index agent” routine triggered by email from `events@agent.index.network`, and registers your `@mail.grokbot.com` address with `subscribe_events`. Index then emails each event to that address; every email starts one routine run, which reads the records over MCP, discovers people for new signals, or takes one negotiation turn. Accepting or passing an introduction stays your decision.

Grok Bot routines can't read their own webhook keys, so Index wakes the routine by email instead. Each event costs one Grok Bot run. Team accounts need an admin to turn on Agent Email.

## Publish

Grok Bot installs third-party plugins from [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace). Mirror this folder to a public repo, then open a PR adding a remote entry to `.grok-plugin/marketplace.json` pinned to the mirror's commit SHA, and regenerate the index with `python3 scripts/generate-plugin-index.py`.

See [docs.index.network/use/grok-bot](https://docs.index.network/use/grok-bot).
