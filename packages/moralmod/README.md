# @indexnetwork/moralmod

The MoralMod experiment's negotiator-side logic, as a standalone package.
**Nothing in Index loads it**: the hosted agent, API, and schema carry no
MoralMod code. It exists for the runner that executes study residents' turns
(today, the lab's negotiator through the external-executor mechanism —
`agents.handleNegotiations` plus the `?agentId=` fence).

What's inside:

- `selection.ts` — the five v1 selection templates and their statistics
  (ported from Sydney-Levine-Lab/decision-studio custom-negotiator, commit
  196153c, with the lab's cooperation).
- `result.ts` / `context.ts` — assessment-result validation and the private
  per-turn context block (preamble, scores, preferred action; exact top tie →
  no preferred action, hold).
- `publication.ts` — the verbatim disclosure guard: mechanism terminology,
  numeric confidence talk, and run identifiers never reach a counterpart or a
  principal.
- `consult.ts` — the draft `moralmod-consult-0` client (start/poll with
  per-fetch timeouts, in-flight joining, an absolute deadline).
- `hook.ts` — `createMoralmodHook(...)`, a `NegotiateHook`: `on` consults and
  passes `AssessmentGuidance` to an assessment-aware negotiator, `shadow`
  measures off the turn's critical path, `off`/unassigned pass through
  untouched; every failure falls back to the plain negotiator and is recorded
  as a `moralmod-turn-exposure-1` event through the `emit` sink.

The stock Index negotiator ignores the `assessment` field on its input; a host
that wants assessed turns supplies a negotiator that honours it (the lab's
decorator does). The consult wire contract and the exposure event shape are
drafts pending the lab's integration memo; each is isolated in one module.
