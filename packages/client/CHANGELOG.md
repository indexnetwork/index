# Changelog

## Unreleased

### Added
- `submitTurn(id, turn)` accepts an optional `clientTurnId` (caller-minted UUID). A retry carrying the same id replays the committed turn as success (`replayed: true` in the response) instead of being refused `not_your_turn`, so a lost response is reconcilable.
- `resumeNegotiation(id)` takes the first turn of a new round on a negotiation paused with nobody to move.
- `NegotiationDetail.protocol.remainingTurns` counts the turns left in the round in progress. `maxTurns` now limits a round, not the whole negotiation.
- `createOpportunity({ networkId, intents, context })` opens an opportunity
  between two intents the caller owns neither of.
- `Negotiation.introducer` (`userId`, `name`, `context`) names the third party
  who opened the pair and carries their case for it.
- `Me.emailVerified` says whether the owner verified their email.

## 0.11.0

### Changed
- **BREAKING:** `submitTurn` takes `{ action, message }`. The expected turn
  count is removed from its turn type; TypeScript callers must stop passing it.

## 0.10.0

### Added
- `PrincipalMessage.stall` marks a negotiator's stall with the turn count it
  stalled at, and `PrincipalMessage.stalls` names the stall entries a question
  asks about or a resolution releases, so a stall stays owed until its own
  question is answered.

## 0.8.0

### Changed
- **BREAKING: the negotiator fence is `agentId`.** `IndexClient` reads
  `INDEX_AGENT_ID` (or `agentId`) and sends `?agentId=` on `submitTurn` and
  `sendPrincipal`. `executorId` and `INDEX_EXECUTOR_ID` are no longer accepted.
