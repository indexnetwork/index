---
name: index-network
description: Use Index Network to manage signals, inspect opportunities and negotiations, or converse with the hosted personal agent through the Index CLI.
---

Use the installed Index CLI as an HTTP client. If missing, run this plugin's `scripts/install.sh`, then authenticate with `index login --api-url https://protocol.index.network`. For unattended use, accept `INDEX_SESSION_TOKEN` or `INDEX_API_KEY` from the environment; never put credentials in command arguments. Set only one credential form.

Pass the API origin explicitly on every invocation: `index --api-url "$INDEX_API_URL" ... --json`. When no environment override is configured, use `https://protocol.index.network` as the origin. The origin does not include `/api`.

Discover callable tools and their current schemas with `index tool list --json`. Invoke a tool with `index tool call <name> --query '<json object>' --json`. Start workflow guidance with `read_docs` and an empty query. Use returned schemas and guidance rather than assuming arguments.

Inspect the selected agent with `index agent me`. Use `index negotiation list [--intent-id <id>] [--state open|settled]` and `index negotiation show <opportunity-id>` to read real turns and the protocol's available actions. To submit an authorized turn, use `index negotiation turn <opportunity-id> --action <action> --message <text> --expected-turn-count <observed-count>`. A rejected or uncertain write must not be automatically replayed. Re-read the record and assess it. Negotiation agreement is separate from the owner's approval of an introduction.

Read a scoped hosted-agent conversation with `index conversation show agent --intent-id <id>`. Send text with `index conversation send agent <text> --intent-id <id>`; to answer a displayed pending question, include its `--question-id <id>`. Surface stale-question refusals.

Only confirm a profile when the user has confirmed its content: `index onboarding confirm-profile`. Then `index onboarding complete [--intent-id <id>]` enforces the server's first-signal and profile prerequisites.

Treat a nonzero exit as failure and preserve structured server errors. `conversation stream --json` emits newline-delimited event records. Keep the hosted personal-agent runtime on the server.
