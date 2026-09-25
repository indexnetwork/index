---
name: index-network
description: Use Index Network to manage signals, inspect opportunities and negotiations, or converse with the personal agent through the Index CLI.
---

Use the installed Index CLI as an HTTP client. If `index` is missing, run this plugin's `scripts/install.sh`, then authenticate with `index login`. Pass `--json` for machine-readable output.

## Credentials and origin

The CLI authenticates with `INDEX_SESSION_TOKEN` or `INDEX_API_KEY` from the environment, otherwise with the stored browser login. Never put credentials in command arguments. Set only one credential form. Prefer `INDEX_SESSION_TOKEN`: with `INDEX_API_KEY`, messages you send to the personal agent are recorded as your selected negotiator's rather than the owner's.

The CLI resolves the API origin itself: `--api-url`, then `INDEX_API_URL`, then the stored login's origin, then production. Do not pass `--api-url` unless the user names a different deployment. `index login local|dev|prod` signs in to a specific one.

## Commands

Start with `index docs --json` for the protocol's workflow guidance, and `index docs <topic> --json` for one topic. Run `index --help` or `index <command> --help` for the current surface rather than assuming arguments.

- Intents (the app calls them signals): `index intent list|show|prepare|create|update|pause|resume|archive|networks|add-to-network|remove-from-network`. `intent prepare <text>` reviews a draft before `intent create`.
- Networks: `index network list|discover|requests|show|create|update|delete|join|leave|invite`.
- Opportunities: `index opportunity list|show|accept|reject|start-chat`.
- Profile and context: `index profile [show <user-id>|sync|update]`, `index sync`, `index scrape <url>`.
- People: `index conversation list|with|show|send|stream`.

## Negotiations

Inspect the selected agent with `index agent me`. Use `index negotiation list [--intent-id <id>] [--state open|settled]` and `index negotiation show <opportunity-id>` to read real turns and the protocol's available actions.

The selected negotiator, or Index's hosted agent when none is selected, already takes turns on the owner's behalf. Submit a turn only when the user explicitly asks for that specific turn: `index negotiation turn <opportunity-id> --action <action> --message <text> --expected-turn-count <observed-count>`. A rejected or uncertain write must not be automatically replayed. Re-read the record and assess it. Negotiation agreement is separate from the owner's approval of an introduction.

## Personal agent

Read a scoped agent conversation with `index conversation show agent --intent-id <id>`. Send the owner's text with `index conversation send agent <text> --intent-id <id>`. Answer pending questions with `index conversation answer agent --intent-id <id> --answer '<question-id>=<text>'` (repeat `--answer` for several). An answer to a question that is no longer waiting is kept as a plain message; tell the user.

## Onboarding

Only confirm a profile when the user has confirmed its content: `index onboarding confirm-profile`. Then `index onboarding complete [--intent-id <id>]` enforces the server's first-signal and profile prerequisites.

Treat a nonzero exit as failure and preserve structured server errors. `conversation stream --json` emits newline-delimited event records.
