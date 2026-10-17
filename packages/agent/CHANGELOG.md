# Changelog

## Unreleased

### Changed
- Runs use the AI SDK tool loop. `Model` is now an AI SDK `LanguageModel`, and `createModel()` replaces `new ModelClient()`. `ModelMessage` and `ToolDefinition` are no longer exported.
- Briefs, decisions, stalls, resolutions and progress carry a `record` tag and no longer start with `Brief: `, `Decision: `, `Stall: `, `Resolved: ` or `Progress: `. Readers classify by `record` only; entries written before it are not read.
- A wake reads settled opportunities as id, counterpart, status and decision, an opportunity whose stall already waits on a question without its turns or brief, and only the last two turns of the rest, listed in that order ahead of the conversation. This cuts the wake prompt by about 40%.
- A wake makes up to three focused `wake.stalls` passes while each one settles some, stalls on the same fact sorted together. Stalls it still owes no longer fail it: the host logs them and they wait for the next event or restart, instead of the whole wake rerunning up to three times.

### Added
- `createModel({ headers })` sends headers on every request, for OpenRouter spend attribution.
- Every run sends OpenRouter `user` (the principal), `session_id` (the intent) and a `trace` and `metadata` (`service: "agent"`, `operation`) named by its operation: `wake`, `wake.morning`, `wake.stalls`, `wake.reply`, `brief`, `screen`, `negotiate` or `summary`. `briefIfMissing` takes an optional operation name. Other providers ignore these fields.
- `Decide` is a provider-neutral decision model: it picks one option for a question about a state. `createDecide()` backs it with OpenRouter's Decisions API and `decideWith(model)` with any chat model. A host passes it as `decide` in the runtime, and discovery then screens each candidate with it instead of a full briefing call; if it fails, the briefing runs as before.
- A host can pass a `negotiate` hook. It runs before the built-in negotiator and can return its own turn or stall, or call `next()` to use the built-in one.

### Fixed
- Brief and negotiate runs require a tool call on their first step, so a prose reply cannot drop the brief or the turn.
