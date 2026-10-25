# Changelog

## Unreleased

### Added
- `NegotiationDetail.protocol.remainingTurns` counts the turns left in the round in progress. `maxTurns` now limits a round, not the whole negotiation.
- `resumeNegotiation(id)` takes the first turn of a new round on a negotiation paused with nobody to move.
- `UserEvent` parses `intent.updated`, whose `data.material` says what the intent asks for changed. `wakesHost` is true for a material one.
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
