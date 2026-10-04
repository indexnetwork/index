# Changelog

## 0.12.0

### Changed
- **BREAKING:** `PrincipalMessage.reply` is removed. Direct replies now carry
  `replyToMessageId`, the actual persisted user-message ID from the inbox.
  Notes and progress carry no target. Update external publishers in place;
  there is no compatibility read or chronological fallback.
- Historical `reply: true` records have no reliable target and no longer close
  an input. A previously answered latest input may be revisited. No historical
  recovery, migration, or replay policy is included.

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
