# Index Network — Grok Bot Plugin

The Grok Bot plugin package for Index. It connects Grok Bot to the Index MCP server at `https://protocol.index.network/mcp` over OAuth and bundles an `index-brief` skill.

Ask your Bot: "Turn on my Index brief." The skill creates two Grok routines. At 08:00 the Bot posts who wants to meet you, what your agent noted, and the questions still waiting, through the Index MCP tools. At 11:00, 14:00, 17:00, and 20:00 it asks any new question and otherwise stays quiet. Accepting or passing an introduction stays your decision. The Bot does not register as your negotiator. `~/.index/brief.json` remembers who was already shown. `paste.md` is the same setup as one block to paste into a fresh Bot.

Each routine run spends Grok Bot usage. A run posts nothing when nothing changed. The hosted morning email still goes to owners who have not turned it off.

## Publish

Grok Bot installs third-party plugins from [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace). Mirror this folder to a public repo, then open a PR adding a remote entry to `.grok-plugin/marketplace.json` pinned to the mirror's commit SHA, and regenerate the index with `python3 scripts/generate-plugin-index.py`.

See [docs.index.network/use/grok-bot](https://docs.index.network/use/grok-bot).
