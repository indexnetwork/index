---
title: "Radar"
type: domain
tags: [radar, composition, actionability]
created: 2026-03-26
updated: 2026-08-27
---

# Radar

The radar is the primary surface where users encounter opportunities. Rather than
showing a raw chronological list, the system curates it using composition targets
so users see a balanced set of actionable opportunities.

---

## Radar Categories

Each opportunity on the radar is classified into one of two categories:

### Connection

A pairing between the user and another person whose intents complement theirs.
This is what discovery produces, and since the introducer role was removed it is
the only kind of live card.

### Expired

Opportunities whose timing window has passed. Showing some expired opportunities
gives users a sense of activity and helps them understand what connections they
missed, which can motivate more timely action on future ones.

---

## Composition Targets

The radar uses soft targets for how many opportunities of each category to show:

| Category | Soft Target |
|---|---|
| Connection | 5 |
| Expired | 2 |

Total soft target: 7 opportunities per radar view. The connection target absorbed
the two slots that belonged to the removed connector-flow category, so the radar
holds the same number of cards it always did.

### Selection algorithm

The system fills the radar in two passes:

1. **First pass**: fill each category up to its soft target from available opportunities
2. **Second pass**: redistribute unused slots, connection before expired

This keeps the radar balanced when there are enough opportunities, without leaving
empty slots when one category has a surplus and the other a deficit.

---

## Actionability

An opportunity appears on the radar only if it is **actionable** for the viewing
user — meaning there is a pending action they can take.

An opportunity is actionable when its status is `pending` and the viewer has not
already acted on it. Acting is per-user rather than per-actor-row: re-detection
can append a second actor row for the same person without an `actedAt` stamp, and
a single stamped row still means that person has decided.

A `negotiating` pairing is not actionable. It is the agents' work, not the
principal's, until it resolves.

Nothing is actionable at a terminal status (`accepted`, `rejected`, `expired`,
`stalled`).

### Read access

Separate from actionability: the actors on a pairing may read it, at any status
and in any role. This used to be a four-way rule keyed on role, the `latent`
status, and whether an introducer had approved; none of those exist any more.

---

## Opportunity Card Presentation

Opportunities on the radar are presented as cards with the evaluator's reasoning,
the candidate's public profile information, and action buttons (accept, reject,
skip). Every card is system-discovered, so every card's narrator is Index.

- **Connection cards**: show the match reasoning and the candidate's profile summary
- **Expired cards**: show what the opportunity was, marked as expired, for historical context

---

## Relationship to Discovery

1. Intent confirm → HyDE → discovery records a *candidate* for each pair it finds
2. `matches_ready` wakes both seats' PersonalAgents
3. An agent that decides to reach out creates the opportunity and opens its negotiation
4. The pairing reaches the radar when a negotiation resolves to `pending`
5. Users act on it (accept, reject, or let it expire)

Discovery never creates opportunities, and nothing re-runs it on a health
schedule: the maintenance/rediscovery loop was removed along with the radar
health score that drove it.
