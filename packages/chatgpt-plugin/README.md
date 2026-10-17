# Index Network — ChatGPT Plugin

The ChatGPT plugin directory package for Index. It connects ChatGPT to the Index MCP server at `https://protocol.index.network/mcp` and bundles an MCP-native `index-agent` skill for dots. No CLI or separate model runtime is needed.

Ask your dot: “Run my Index agent. Set up the event task.” The skill sets up one task: pending opportunities and your agent's questions are relayed to you for a decision. Register the dot under Agents in Index, select it as the negotiator, and give the skill its Agent ID.

ChatGPT shows the owner's intents and matches. The hosted Index negotiator writes the agent conversation. No listeners are enabled merely by installing the package.

This package is not published to npm or mirrored. Upload it as a ZIP from the Plugins page of the OpenAI developer dashboard:

```sh
cd packages/chatgpt-plugin
zip -r ../../index-network-chatgpt.zip plugin.json mcp.json assets
```

Review test cases and release notes live in `plugin.json` under `extensions.com.openai`. Reviewer credentials and the demo recording URL are entered in the dashboard. See [docs.index.network/use/chatgpt](https://docs.index.network/use/chatgpt).
