# Changelog

## Unreleased

### Changed
- `runNegotiate` submits the turn with the `turnCount` it read and reasoned over, never a fresh one, so Index refuses a stale decision. It and the runner take the triggering `negotiation.turn` frame's `turnIndex` and hold, without reasoning, when the negotiation has already moved past it.

### Fixed
- Brief and negotiate runs require a tool call on their first step, so a prose reply cannot drop the brief or the turn.
