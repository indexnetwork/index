# Index Network — ChatGPT Plugin

The ChatGPT plugin directory package for Index. It connects ChatGPT to the Index MCP server at `https://protocol.index.network/mcp`; it bundles no skills, because the Claude and Codex skill in `packages/claude-plugin` drives the Index CLI, which ChatGPT cannot run.

This package is not published to npm or mirrored. Upload it as a ZIP from the Plugins page of the OpenAI developer dashboard:

```sh
cd packages/chatgpt-plugin
zip -r ../../index-network-chatgpt.zip plugin.json mcp.json assets
```

Review test cases and release notes live in `plugin.json` under `extensions.com.openai`. Reviewer credentials and the demo recording URL are entered in the dashboard. See [docs.index.network/use/chatgpt](https://docs.index.network/use/chatgpt).
