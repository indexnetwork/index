# AGENTS.md — opportunity presentation

Adds to the root `AGENTS.md` for `packages/protocol/src/opportunities/`. It also governs
the consuming services (`services/api/src/services/opportunity.service.ts`,
`opportunity-delivery.service.ts`).

## Core rule

Prefer genuine `OpportunityPresenter` output — `presentHomeCard` for cards, `present` for
accepted chat context. When presenter output is unavailable, a surface may either skip or
use reasoning-derived fallback copy, but **only** through
`application/opportunity.presentation.ts` (`getSafePresentationOrSkip` /
`safeFallbackSummary`).

Never render `interpretation.reasoning`, `matchReason`, or `opportunityReasoning`
directly on a user-facing surface.

## Surfaces to inspect

- `application/opportunity.presentation.ts` — the whole presentation cluster in one file:
  the pure transforms, cache keys, the sanitization primitive with each surface's
  `allowFallback` policy, the `OpportunityPresenter`, and the MCP prose renderer
- `application/opportunity.tools.list.ts` — persisted `list_opportunities` card building
  (MCP prose comes from `buildOpportunityPresentation` in the presentation cluster)
- `application/opportunity.enricher.ts` — background-enrichment fallback paths where
  `homeCardPresentation` can be missing
- `feed/feed.graph.ts` — persisted home-feed fallback cards and cache writes
- `application/delivery-card.cache.ts` — cached persisted delivery cards
- `services/api/src/services/opportunity.service.ts` —
  `getOpportunityWithPresentation()` and `getChatContext()` for persisted records
- `services/api/src/services/opportunity-delivery.service.ts` — background delivery
  notification rendering fallback

## Audit checklist

1. Grep the fallback chains:

   ```bash
   rg -n "homeCardPresentation\?\.personalizedSummary|matchReason|interpretation\?\.reasoning|interpretation\.reasoning|reasoningSnippet|fallbackCard|buildMinimalOpportunityCard" packages/protocol/src/opportunities services/api/src
   ```

2. For every user-facing `mainText`, `personalizedSummary`, `description`,
   `digestSummary`, `narratorRemark`, or MCP prose field, verify it is presenter-produced
   or returned by the shared safe-presentation helper.
3. Make the per-surface policy explicit: `allowFallback: false` where degraded copy
   should be skipped (some scheduled delivery paths); otherwise allow the helper's
   sanitized grammatical fallback.
4. Never cache unsanitized raw reasoning. Cached fallback cards must come from the shared
   helper and use the surface's versioned cache contract.
5. Keep internal and debug responses separate from UI/chat/MCP surfaces. Raw reasoning is
   acceptable only when clearly non-user-facing.
6. Add a regression test proving presenter output wins when present, and that fallback
   output strips unsafe or raw details when used.

## Common pitfall

`OpportunityPresenter.presentHomeCard()` catches LLM failures and may return
fallback-shaped copy. Callers that require LLM-quality copy — scheduled digests, for
example — need an explicit way to detect and skip fallback results. A `try`/`catch`
around `presentHomeCard()` alone is not enough if the presenter swallows the error.

## See also

- [Routing and surfaces](../../../../docs/guides/routing-and-surfaces.md) — opportunity
  deep-link (`appUrl` / universal link) routing and delivery URL safety.
