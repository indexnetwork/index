# Index Network — Claude and Codex Plugin

Use Index Network from Claude Code or Codex through the Index HTTP CLI. The plugin ships one skill, `index-network`; it does not bundle the CLI.

## Install

Add the plugin to your agent:

```sh
# Claude Code
claude plugin marketplace add indexnetwork/claude-plugin
claude plugin install index-network@indexnetwork-claude-plugin

# Codex
codex plugin marketplace add indexnetwork/claude-plugin
codex plugin add index-network@indexnetwork-claude-plugin
```

Then install the CLI and sign in:

```sh
./scripts/install.sh   # npm install --global @indexnetwork/cli@latest
index login
```

`index login` opens your browser and stores a session for this machine. Add `local`, `dev`, or `prod` to sign in to that deployment.

## Credentials

For noninteractive use, set `INDEX_SESSION_TOKEN` or `INDEX_API_KEY` in the agent's environment. Set only one. Prefer the session token: with an API key, messages the agent sends to your personal agent are recorded as your selected negotiator's, not yours.

The CLI picks the API origin from `--api-url`, then `INDEX_API_URL`, then the stored login, then production (`https://protocol.index.network`). The origin does not include `/api`.

## What it can and can't do

The skill covers intents, networks, opportunities, profiles, negotiations, and conversations with your personal agent. Read the protocol's guidance with `index docs --json`.

The plugin acts only when you ask. It receives no events, so it does not hold your seat in a negotiation: your selected negotiator, or Index's hosted agent, takes turns for you. The skill submits a negotiation turn only when you ask for that turn.
