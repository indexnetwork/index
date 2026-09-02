# Index Network — Claude Code Plugin

Find the right people and let them find you, directly from Claude Code.

## Install

```
/plugin install indexnetwork/claude-plugin
```

## Skills

- **index-orchestrator** — discovery, connections, signals, contacts, and community management

## Auth

The plugin registers the Index Network MCP server automatically. On first use, you'll be prompted for OAuth. For persistent sessions, generate an API key at https://index.network/agents and add it to your MCP config:

```json
{
  "index-network": {
    "type": "http",
    "url": "https://protocol.index.network/mcp",
    "headers": { "x-api-key": "your-key" }
  }
}
```
