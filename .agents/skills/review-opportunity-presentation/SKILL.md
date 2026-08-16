---
name: review-opportunity-presentation
description: Review or change persisted opportunity card/list/home/digest presentation safely. Use when code touches OpportunityPresenter, safe-presentation fallbacks, persisted-list formatting, home feed cards, delivery cards, raw interpretation.reasoning/matchReason, or user-facing opportunity text. Prevents unsanitized evaluator reasoning from leaking while preserving each surface's fallback-versus-skip policy.
---

# Opportunity Presentation Safety

Use this when editing opportunity presentation paths or reviewing PRs that affect persisted opportunity cards and lists, home feed sections, accepted-chat context, Telegram/digest copy, or delivery cards.

## Core rule

Prefer genuine `OpportunityPresenter` output (`presentHomeCard` for cards, `present` for
accepted chat context). When presenter output is unavailable, a surface may either skip
or use reasoning-derived fallback copy, but only through
`opportunity.safe-presentation.ts` (`getSafePresentationOrSkip` /
`safeFallbackSummary`). Never render `interpretation.reasoning`, `matchReason`, or
`opportunityReasoning` directly on a user-facing surface.

## Surfaces to inspect

- `packages/protocol/src/opportunities/domain/opportunity.safe-presentation.ts`
  - the single sanitization primitive and each surface's `allowFallback` policy
- `packages/protocol/src/opportunities/application/opportunity.tools.ts`
  - persisted `list_opportunities` card building
  - MCP prose via `buildOpportunityPresentation`
- `packages/protocol/src/opportunities/application/opportunity.enricher.ts`
  - background-enrichment fallback paths where `homeCardPresentation` can be missing
- `packages/protocol/src/opportunities/feed/feed.graph.ts`
  - persisted home-feed fallback cards and cache writes
- `packages/protocol/src/opportunities/application/delivery-card.cache.ts`
  - cached persisted delivery cards
- `services/api/src/services/opportunity.service.ts`
  - `getOpportunityWithPresentation()` and `getChatContext()` for persisted records
- `services/api/src/services/opportunity-delivery.service.ts`
  - background delivery notification rendering fallback

## Audit checklist

1. Grep for fallback chains:

   ```bash
   rg -n "homeCardPresentation\?\.personalizedSummary|matchReason|interpretation\?\.reasoning|interpretation\.reasoning|reasoningSnippet|fallbackCard|buildMinimalOpportunityCard" packages/protocol/src/opportunity services/api/src
   ```

2. For every user-facing `mainText`, `personalizedSummary`, `description`, `digestSummary`, `narratorRemark`, or MCP prose field, verify it is presenter-produced or returned by the shared safe-presentation helper.
3. Make the per-surface policy explicit: use `allowFallback:false` when degraded copy should be skipped (for example, some scheduled delivery paths); otherwise allow the helper's sanitized grammatical fallback.
4. Never cache unsanitized raw reasoning. Cached fallback cards must come from the shared helper and use the surface's versioned cache contract.
5. Keep internal/debug responses separate from UI/chat/MCP surfaces; raw reasoning is acceptable only when clearly non-user-facing.
6. Add a regression test proving presenter output wins when present and fallback output strips unsafe/raw details when used.

## Common pitfall

`OpportunityPresenter.presentHomeCard()` catches LLM failures and may return fallback-shaped copy. Callers that must require LLM-quality copy (for example scheduled digests) need an explicit way to detect/skip fallback results; a `try/catch` around `presentHomeCard()` alone is not enough if the presenter swallows the error.

## Related skills

- `review-connect-routing` — for opportunity deep-link (`appUrl` / universal link) routing and delivery URL safety.
