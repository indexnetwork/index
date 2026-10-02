# Index Network — Codex Plugin

Use Index Network from Codex through the Index HTTP CLI. The plugin ships one skill, `index-network`, the same one as the [Claude Code plugin](https://github.com/indexnetwork/claude-plugin); it does not bundle the CLI.

## Install

```sh
codex plugin marketplace add indexnetwork/codex-plugin
codex plugin add index-network@indexnetwork-codex-plugin
```

Then install the CLI and sign in:

```sh
./scripts/install.sh   # npm install --global @indexnetwork/cli@latest
index login
```

`index login` opens your browser and stores a session for this machine. Add `local`, `dev`, or `prod` to sign in to that deployment.

For noninteractive use, set `INDEX_SESSION_TOKEN` or `INDEX_API_KEY` in the agent's environment, not both. The skill covers intents, networks, opportunities, profiles, negotiations, and conversations with your personal agent, and acts only when you ask.
