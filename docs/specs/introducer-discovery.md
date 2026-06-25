---
title: "Introducer Discovery"
type: spec
tags: [opportunities, discovery, introducer, maintenance, feed, contacts, connector-flow]
created: 2026-03-27
updated: 2026-03-27
---

## Behavior

Build a background pipeline that proactively discovers introducer opportunities -- identifying pairs of contacts in a user's network whose intents or profiles complement each other and surfacing them as connector-flow opportunities on the home feed. The user acts as introducer and quality gate: discovered opportunities start as latent so the user can review before parties see them.

### Contact-scoped discovery

For each of a user's top-N contacts (sorted by intent freshness), run a scoped HyDE discovery against other contacts within the user's personal network. Reuse the existing `OpportunityGraphFactory` with `onBehalfOfUserId` set to the contact being evaluated, scoped to the user's personal network.

- Cap at 5 contacts per maintenance cycle
- Cap at 3 candidate opportunities per contact
- Persist with `detection.source = 'introducer_discovery'`
- Created opportunities start in `latent` status (user acts as quality gate)

### Maintenance integration

Extend `MaintenanceGraphFactory` with an introducer discovery node that runs alongside existing intent rediscovery. The node activates when the connector-flow composition score is low (fewer connector-flow opportunities than the soft target). Wire into existing maintenance triggers (intent events, home view fire-and-forget).

### Home feed composition

Introducer opportunities naturally fill connector-flow slots via the existing `classifyOpportunity()` function, which detects the introducer actor role. Both intent-triggered opportunities and introducer-discovered opportunities flow through `selectByComposition()`.

### Observability

- New `detection.source` value: `introducer_discovery`
- Log pair evaluation count and opportunities created per cycle
- Include introducer discovery stats in maintenance graph logging

## Constraints

- Maintenance graph invocation remains fire-and-forget; introducer discovery must not block the home view response
- Must reuse existing `OpportunityGraphFactory` -- no parallel discovery implementation
- Discovery scoped to user's personal network contacts only (Phase 1)
- Opportunities created with introducer as the `userId` (state.userId) and contact as `onBehalfOfUserId`
- Services do not import other services; cross-service communication via events/queues
- Graph factories receive dependencies via constructor injection
- Agents are pure: no direct DB access

## Acceptance Criteria

1. `MaintenanceGraphFactory` has an `introducerDiscovery` node that discovers introducer opportunities
2. The introducer discovery node activates when connector-flow count is below soft target
3. Contacts are selected from the user's personal network (up to 5 per cycle)
4. Each contact's intents are used to discover opportunities against other contacts (up to 3 per contact)
5. Created opportunities have `detection.source = 'introducer_discovery'` and status `latent`
6. Created opportunities have the user as introducer actor and both contacts as parties
7. Introducer opportunities appear as connector-flow items in the home feed via `classifyOpportunity()`
8. Existing maintenance tests continue to pass
9. New unit tests cover: introducer discovery node logic, contact selection, opportunity creation with correct detection source
10. No architecture rule violations
