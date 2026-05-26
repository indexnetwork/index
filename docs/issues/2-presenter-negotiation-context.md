# Issue 2: Negotiation context in opportunity presenter

**Spec:** [`docs/superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md` § Issue 2](../superpowers/specs/2026-04-15-openclaw-opportunity-delivery-design.md#issue-2--negotiation-context-in-opportunity-presenter)
**Plan:** [`docs/superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md` § Issue 2](../superpowers/plans/2026-04-15-openclaw-opportunity-delivery.md)
**Dependencies:** none (parallelizable with Issue 1)
**Blocks:** Issues 4, 5 (to the extent they want the enriched cards)
**Layer:** Protocol (`@indexnetwork/protocol` package)

## Goal

Lift the opportunity presenter so post-negotiation cards (`pending`, `stalled`, `accepted`, `rejected`) explain *why* an opportunity surfaced — using the full negotiation transcript as grounding. For in-flight `negotiating` opportunities, surface a templated chip (no transcript, no LLM call for the chip line).

## Context

Today the presenter renders opportunities without visibility into the negotiation that produced them. Post-negotiation cards feel bare ("here's a match") rather than explanatory ("the agents agreed on these roles because of this reasoning"). With negotiations capped at 12 turns, injecting the full transcript into the presenter prompt is feasible and gives the LLM maximum grounding.

## Scope

### In
- New loader `packages/protocol/src/opportunity/negotiation-context.loader.ts` exporting `loadNegotiationContext(db, opportunityId): Promise<NegotiationContext | null>`.
- New type `NegotiationContext` exported from a well-placed location (loader module or a shared types file — see plan).
- `HomeCardPresenterInput` in `packages/protocol/src/opportunity/opportunity.presenter.ts` gains optional `negotiationContext?: NegotiationContext`.
- `gatherPresenterContext()` in `packages/protocol/src/opportunity/feed/feed.graph.ts` invokes the loader when status ∈ `{pending, stalled, accepted, rejected, negotiating}`.
- Presenter prompt revisions: Branch A (negotiating → templated chip + non-transcript-grounded LLM render for the rest); Branch B (post-negotiation → full transcript injected with explicit framing and, for stalled, the `outcome.reason`).
- Snapshot tests for the prompt assembly across five branches: `negotiating`, `pending`, `stalled`, `accepted`, `rejected`.
- Unit tests for `loadNegotiationContext` returning `null` for `draft`/`latent` and populated data for the other statuses.

### Out
- Any changes to negotiation storage or lifecycle.
- The delivery/pickup infrastructure (Issues 0, 1, 4, 5).

## Acceptance Criteria

- [ ] `loadNegotiationContext` returns `null` for opportunities in `draft` or `latent` status.
- [ ] For other statuses, the loader returns a `NegotiationContext` with: `status`, `turnCount`, `turnCap`, `outcome` (when status ≠ `negotiating`), and the full `turns[]` array (when status ≠ `negotiating`).
- [ ] Presenter output for a `negotiating` opportunity contains a narrator line of the form "Currently negotiating · turn N of M" — produced without an LLM call.
- [ ] Presenter output for `pending|stalled|accepted|rejected` opportunities references the negotiation in `personalizedSummary` (verified by snapshot / rough text-match in integration).
- [ ] For `stalled` opportunities, the prompt includes `outcome.reason` (`turn_cap` or `timeout`) so the presenter can hedge appropriately.
- [ ] Existing home feed and chat UI continue to render the presenter output without additional changes.

## Implementation Notes

- Loader reads from `NegotiationGraphDatabase` (`packages/protocol/src/shared/interfaces/database.interface.ts`) — the full `tasks` + `messages` + `artifacts` chain for the opportunity.
- Presenter prompt changes live in `opportunity.presenter.ts` (or wherever the prompt template is assembled — confirmed during implementation).
- Snapshot tests use `bun test` with a snapshot of the prompt string, not the LLM output.
- Full task-level breakdown: megaplan Issue 2 section.
