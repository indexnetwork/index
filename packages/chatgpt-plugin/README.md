# Index Network — ChatGPT Plugin

The ChatGPT plugin directory package for Index. It connects ChatGPT to the Index MCP server at `https://protocol.index.network/mcp` and bundles an MCP-native `index-agent` skill for dots. No CLI or separate model runtime is needed.

Ask your dot: “Run my Index agent. Set up discovery and negotiation event tasks.” The skill sets up two tasks: signal creation/updates discover counterparties and open opportunities; negotiation events take one turn at a time and pending opportunities ask for your decision. Select the intended external negotiator in Index first; the MCP tools can read that selection but cannot change it.

This is a small adaptation of `packages/agent`'s wake and negotiate behavior, not full host parity. Index stores signals, opportunities, turns and the owner's agent conversation; ChatGPT owns subscriptions and task execution. `get_agent_conversation`, `publish_agent_actions` and `answer_agent_questions` use the same actions and inbox as the native agent. Briefs and stalls stay with the native host. An answer must be the owner's own words. Deploy the matching MCP server and refresh saved task prompts and subscriptions before relying on `question.pending` or `principal.input`. No listeners are enabled merely by installing the package.

This package is not published to npm or mirrored. Upload it as a ZIP from the Plugins page of the OpenAI developer dashboard:

```sh
cd packages/chatgpt-plugin
zip -r ../../index-network-chatgpt.zip plugin.json mcp.json assets skills
```

Review test cases and release notes live in `plugin.json` under `extensions.com.openai`. Reviewer credentials and the demo recording URL are entered in the dashboard. See [docs.index.network/use/chatgpt](https://docs.index.network/use/chatgpt).
