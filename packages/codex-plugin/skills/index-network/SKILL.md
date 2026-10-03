---
name: index-network
description: Use Index Network when the user wants to meet, find, hire, get hired by, fund, raise from, collaborate with, or be introduced to people, or asks who they should talk to. Manages signals, opportunities, negotiations, and the personal agent through the Index CLI. Not for general web or people lookup.
---

Index finds the right people for the person you act for, and lets them be found. Use the installed Index CLI as an HTTP client. If `index` is missing, run this plugin's `scripts/install.sh`, then authenticate with `index login`. Always pass `--json` and read the result before answering.

## General rules

- Use Index when the user wants to meet, find, hire, get hired by, fund, raise from, collaborate with, or be introduced to someone, or asks who they should talk to. Do not use it for general web or people lookup.
- Turn the goal into a signal in the user's own words. Check existing signals with `index intent list` first to avoid duplicates. Review matches with `index opportunity list` and `index opportunity show`.
- Accept or pass with `index opportunity accept` or `index opportunity reject` only after asking the user. Agreement between agents is never their approval.
- Archive a signal only after an explicit yes. It cannot be undone.
- Treat a nonzero exit as failure and preserve structured server errors. A rejected or uncertain write must not be replayed automatically; read the record again and assess it.

## Credentials and origin

The CLI authenticates with `INDEX_SESSION_TOKEN` or `INDEX_API_KEY` from the environment, otherwise with the stored browser login. Never put credentials in command arguments. Set only one credential form. Prefer `INDEX_SESSION_TOKEN`: with `INDEX_API_KEY`, messages you send to the personal agent are recorded as your selected negotiator's rather than the owner's.

The CLI resolves the API origin itself: `--api-url`, then `INDEX_API_URL`, then the stored login's origin, then production. Do not pass `--api-url` unless the user names a different deployment. `index login local|dev|prod` signs in to a specific one.

## Profile

- `index profile`: read the user's own profile.
- `index profile update [--name <text>] [--intro <text>] [--location <text>] [--social label=value]`: change only the supplied fields.
- `index profile sync`: research the user and propose profile fields without saving them.
- `index profile show <user-id>`: read another person's profile.

## Signals

The app calls intents signals. IDs accept a UUID or the 8-character short ID.

- `index intent list [--archived] [--query <text>] [--limit <n>]`: list the user's signals with lifecycle, networks, and waiting counts.
- `index intent show <id>`: read one signal, including its networks.
- `index intent prepare <text> [--answer 'prompt=reply']`, then `index intent create <text> [--receipt <token>]`: prepare and create a signal, shared in every network the user belongs to. A draft that is not ready comes back with feedback and questions, and nothing is created.
- `index intent update <id> [<text>] [--source-type <s>] [--source-id <s>]`: change the description or source fields of a non-archived signal.
- `--source-type` and `--source-id` on create or update are optional strings Index stores and returns unchanged. Use them to map your own records, such as an inferred ambient intent, to the published signal.
- `index intent pause <id>` / `index intent resume <id>`: pausing a paused signal or resuming an active one succeeds without changing it. Archived signals stay archived.
- `index intent archive <id>`: permanently archive a signal. It removes network associations and expires related opportunities.
- `index intent networks|add-to-network|remove-from-network`: manage where a signal is shared.

## Opportunities

- `index opportunity list [--intent-id <id>] [--statuses negotiating,pending] [--limit <n>]`: use when the user asks who they should meet or what introductions are waiting. Lists compact cards across the user's Index or within one signal.
- `index opportunity show <id>`: read one opportunity. Add `index negotiation show <id>` for its negotiation.
- `index opportunity accept <id>`: accept an introduction for the user.
- `index opportunity reject <id>`: pass on an introduction. This is the Mac app's Pass action and may close the associated negotiation.
- `index opportunity start-chat <id>`: open the chat through an accepted opportunity.

## Links

Every person, signal, and opportunity you name gets a link, on the name itself. Never add a separate "link" word, and never ask the user for a URL.

- Signal: `<web>/i/<intent id>`. Person: `<web>/u/<user id>` (for opportunities, `peer.userId`). Opportunity: `<web>/o/<opportunityId>`.
- `<web>` is `https://index.network` for production, `https://dev.index.network` after `index login dev`, and `http://localhost:3000` after `index login local`.
- A signal's label is its `summary`, or its description when there is none, cut at 60 characters with `…`.

## Result format

Lead every answer with the linked lines below, then any detail.

- Signal: `[label](<web>/i/<id>) — 3 waiting`, adding `(paused)` or `(archived)` when not active.
- Opportunity: `[Peer name](<web>/u/<userId>) — headline — state`, using "New match" when there is no headline. States: `pending` is "waiting on you", `negotiating` is "agents talking", `accepted` is "connected", `rejected` is "passed", `expired` is "expired".
- After a write, name the entity and what happened: `[label](…) — created`, `— updated`, `— paused`, `— resumed`, `— archived`, and for opportunities `— accepted` or `— passed`.
- Profile: `[Name](<web>/u/<user id>) — profile`, or `— updated`.

## Other commands

Start with `index docs --json` for the protocol's workflow guidance, and `index docs <topic> --json` for one topic. Run `index --help` or `index <command> --help` for the current surface rather than assuming arguments.

- Networks: `index network list|discover|requests|request-update|request-dismiss|show|create|update|delete|join|leave|invite`.
- Context: `index sync`, `index scrape <url>`.
- People: `index conversation list|with|show|send|stream`. `conversation stream --json` emits newline-delimited event records.

## Negotiations

Inspect the selected agent with `index agent me`. Use `index negotiation list [--intent-id <id>] [--state open|settled]` and `index negotiation show <opportunity-id>` to read real turns and the protocol's available actions.

The selected negotiator, or Index's hosted agent when none is selected, already takes turns on the owner's behalf. Submit a turn only when the user explicitly asks for that specific turn: `index negotiation turn <opportunity-id> --action <action> --message <text>`. Negotiation agreement is separate from the owner's approval of an introduction.

## Personal agent

Read a scoped agent conversation with `index conversation show agent --intent-id <id>`. Send the owner's text with `index conversation send agent <text> --intent-id <id>`. Answer pending questions with `index conversation answer agent --intent-id <id> --answer '<question-id>=<text>'` (repeat `--answer` for several). An answer to a question that is no longer waiting is kept as a plain message; tell the user.

## Onboarding

Only confirm a profile when the user has confirmed its content: `index onboarding confirm-profile`. Then `index onboarding complete [--intent-id <id>]` enforces the server's first-signal and profile prerequisites.
