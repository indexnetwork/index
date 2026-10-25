# Changelog

## Unreleased

### Changed
- A decline passes for now instead of ending the negotiation: the pair stays in talks with nobody to move. `toOpportunity` reports `awaiting: "nobody"` and `paused: true` between rounds, and counts `remainingTurns` for the round in progress. A wake weighs the principal's message against each paused opportunity and reopens only the ones it bears on, with the new `resume_negotiation` tool, which takes the first turn of a new round and briefs its negotiator. `set_brief` refuses a paused opportunity.
- Runs use the AI SDK tool loop. `Model` is now an AI SDK `LanguageModel`, and `createModel()` replaces `new ModelClient()`. `ModelMessage` and `ToolDefinition` are no longer exported.
- Briefs, decisions, stalls, resolutions and progress carry a `record` tag and no longer start with `Brief: `, `Decision: `, `Stall: `, `Resolved: ` or `Progress: `. Readers classify by `record` only; entries written before it are not read.
- A wake reads settled opportunities as id, counterpart, status and decision, an opportunity whose stall already waits on a question without its turns or brief, and only the last two turns of the rest, listed in that order ahead of the conversation. This cuts the wake prompt by about 40%.
- A wake makes up to three focused `wake.stalls` passes while each one settles some, stalls on the same fact sorted together. Stalls it still owes no longer fail it: the host logs them and they wait for the next event or restart, instead of the whole wake rerunning up to three times.

- The decision model alone decides who is reached; the brief only writes. `screens()` is now just the `Decide` call and returns whether to reach: it skips only when the model puts at least 0.8 on `skip`, and reaches the person on any error or when no `decide` is configured. Retries happen inside `Decide`: once, with backoff on 429 and 5xx, and never on a refusal. A wrongful skip loses a match while a wrongful pass costs one negotiator turn, so a borderline person is reached. On the last 30 intents this skipped 2 to 5 of the 52 negotiations that went on to agree (4 to 9% across runs), against 17 for the earlier argmax screen.
- `Decide` returns `{ choice, probabilities? }` instead of a string.
- `createDecide()` goes through the AI SDK's `experimental_decide` and the OpenRouter provider's evaluation model instead of a hand-written request.
- `briefIfMissing(input, decision, operation?)` takes the decision from the caller (`continue`, or `decline` when the screen skipped). The model only writes the brief and its `set_brief` has no `decision` parameter.
- An opportunity is always briefed as `continue`, including one someone else opened. The screen was tried on 400 of those and could not tell them apart: at a 0.9 threshold it skipped 5% of the ones that agreed for 12% of the ones that were declined, so the negotiator's own turn decides.

### Added
- `createModel({ headers })` sends headers on every request, for OpenRouter spend attribution.
- Every run sends OpenRouter `user` (the principal), `session_id` (the intent) and a `trace` and `metadata` (`service: "agent"`, `operation`) named by its operation: `wake`, `wake.morning`, `wake.stalls`, `wake.reply`, `brief`, `screen`, `negotiate` or `summary`. `briefIfMissing` takes an optional operation name. Other providers ignore these fields.
- `Decide` is a provider-neutral decision model: it picks one option for a question about a state. `createDecide()` backs it with OpenRouter's Decisions API and `decideWith(model)` with any chat model. A host passes it as `decide` in the runtime, and discovery then screens each candidate with it instead of a full briefing call; if it fails, the briefing runs as before.
- A host can pass a `negotiate` hook. It runs before the built-in negotiator and can return its own turn or stall, or call `next()` to use the built-in one.

### Fixed
- The negotiator no longer says "we" for itself and its principal.
- Brief and negotiate runs require a tool call on their first step, so a prose reply cannot drop the brief or the turn.
