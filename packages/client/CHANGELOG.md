# Changelog

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
