# Index Network — Claude and Codex Plugin

Use Index Network through its HTTP CLI, with the included `index-network` skill.

Install the plugin in your agent, then provision its matching CLI release:

```sh
./scripts/install.sh
index login --api-url https://protocol.index.network
```

For noninteractive authentication, provide `INDEX_SESSION_TOKEN` or `INDEX_API_KEY` in the agent process environment. Set only one. Pass `--api-url` explicitly; use your API origin without `/api` (production: `https://protocol.index.network`). Browser login/logout remain available.

Read the protocol's guidance with `index docs --json`; every resource has its own command (`index intent`, `index network`, `index opportunity`, `index scrape`). The skill explains negotiation and personal-agent commands and how to handle refusals.
