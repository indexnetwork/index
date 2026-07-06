---
name: opportunity-presentation-safety
description: Review or change opportunity card/list/discovery/home/digest presentation safely. Use when code touches OpportunityPresenter, list_opportunities/discover_opportunities card formatting, home feed cards, delivery cards, raw interpretation.reasoning/matchReason fallbacks, or any user-facing opportunity description text. Prevents leaking non-LLM evaluator reasoning or heuristic/minimal descriptions into UI, chat, MCP, or digest surfaces.
---

# Opportunity Presentation Safety

Use this when editing opportunity presentation paths or reviewing PRs that affect opportunity cards, lists, discovery results, home feed sections, accepted-chat context, Telegram/digest copy, or delivery cards.

## Core rule

User-facing opportunity copy must come from `OpportunityPresenter` (usually `presentHomeCard` for cards, `present` for accepted chat context). Do **not** render raw evaluator fields such as `interpretation.reasoning`, `matchReason`, or `opportunityReasoning` as the main card description except in explicitly internal/debug output.

## Surfaces to inspect

- `packages/protocol/src/opportunity/opportunity.tools.ts`
  - `discover_opportunities` card building
  - `list_opportunities` card building
  - introduction-mode immediate cards
  - MCP prose via `buildOpportunityPresentation`
- `packages/protocol/src/opportunity/opportunity.discover.ts`
  - enrichment fallback paths where `homeCardPresentation` can be missing
- `packages/protocol/src/opportunity/feed/feed.graph.ts`
  - home feed `fallbackCard()` and card cache writes
- `packages/protocol/src/opportunity/delivery-card.cache.ts`
  - cached delivery cards
- `services/api/src/services/opportunity.service.ts`
  - `getOpportunityWithPresentation()` and `getChatContext()`
- `services/api/src/services/opportunity-delivery.service.ts`
  - notification / delivery rendering fallback

## Audit checklist

1. Grep for fallback chains:

   ```bash
   rg -n "homeCardPresentation\?\.personalizedSummary|matchReason|interpretation\?\.reasoning|interpretation\.reasoning|reasoningSnippet|fallbackCard|buildMinimalOpportunityCard" packages/protocol/src/opportunity services/api/src
   ```

2. For every user-facing `mainText`, `personalizedSummary`, `description`, `digestSummary`, `narratorRemark`, or MCP prose field, verify it is presenter-produced.
3. If a presenter call fails, prefer skipping the card or using a generic grammatical placeholder over raw reasoning.
4. Do not cache fallback/raw-reasoning cards under long-lived keys (`home:card:*`, `delivery:card:*`, `chat:card:*`).
5. Keep internal/debug responses separate from UI/chat/MCP surfaces; raw reasoning is acceptable only when clearly non-user-facing.
6. Add a regression test proving the rendered card text includes presenter output and excludes raw reasoning.

## Common pitfall

`OpportunityPresenter.presentHomeCard()` catches LLM failures and may return fallback-shaped copy. Callers that must require LLM-quality copy (for example scheduled digests) need an explicit way to detect/skip fallback results; a `try/catch` around `presentHomeCard()` alone is not enough if the presenter swallows the error.

## Related skills

- `audit-digests` — for auditing AgentVillage digest cards after deployment.
- `connect-link-routing-safety` — for opportunity connect-link routing and delivery URL safety.
