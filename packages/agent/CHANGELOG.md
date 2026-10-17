# Changelog

## Unreleased

### Changed
- Runs use the AI SDK tool loop. `Model` is now an AI SDK `LanguageModel`, and `createModel()` replaces `new ModelClient()`. `ModelMessage` and `ToolDefinition` are no longer exported.
- Briefs, decisions, stalls, resolutions and progress carry a `record` tag and no longer start with `Brief: `, `Decision: `, `Stall: `, `Resolved: ` or `Progress: `. Readers classify by `record` only; entries written before it are not read.

### Added
- `createModel({ headers })` sends headers on every request, for OpenRouter spend attribution.
- Every run sends OpenRouter `user` (the principal), `session_id` (the intent) and a `trace` named by its operation: `wake`, `wake.morning`, `wake.stalls`, `wake.reply`, `brief`, `screen`, `negotiate` or `summary`. `briefIfMissing` takes an optional operation name. Other providers ignore these fields.
- A host can pass a `negotiate` hook. It runs before the built-in negotiator and can return its own turn or stall, or call `next()` to use the built-in one.

### Fixed
- Brief and negotiate runs require a tool call on their first step, so a prose reply cannot drop the brief or the turn.
