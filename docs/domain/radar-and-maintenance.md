---
title: "Radar and Maintenance"
type: domain
tags: [radar, maintenance, health-scoring, freshness, composition, rediscovery]
created: 2026-03-26
updated: 2026-04-06
---

# Radar and Maintenance

The radar is the primary surface where users encounter opportunities. Rather than showing a raw chronological list, the system curates the radar using composition targets, health scoring, and maintenance triggers that ensure users see a balanced, fresh set of actionable opportunities.

---

## Radar Categories

Each opportunity on the radar is classified into one of three categories:

### Connection

Direct opportunities where the user is matched with another person without an intermediary. These are the core discovery results -- two people whose intents or profiles complement each other.

### Connector Flow

Opportunities where an introducer is involved. A third party has explicitly decided these two people should meet. These are presented differently because they carry the social signal of a human endorsement.

### Expired

Opportunities whose timing window has passed. Showing some expired opportunities gives users a sense of activity and helps them understand what connections they missed, which can motivate more timely action on future opportunities.

---

## Composition Targets

The radar uses soft targets for how many opportunities of each category to show:

| Category | Soft Target |
|---|---|
| Connection | 3 |
| Connector Flow | 2 |
| Expired | 2 |

Total soft target: 7 opportunities per radar view.

### Selection algorithm

The system fills the radar in two passes:

1. **First pass**: Fill each category up to its soft target from available opportunities
2. **Second pass**: Redistribute unused slots to categories with remaining items, prioritizing connection over connector-flow over expired

This ensures the radar is balanced when there are enough opportunities, but does not leave empty slots when one category has surplus and another has deficit.

---

## Radar Health Scoring

The system continuously monitors the health of each user's radar using a composite score from 0 to 1. The health score determines whether maintenance (rediscovery) should be triggered.

### Components

The health score is a weighted sum of three sub-scores:

#### Composition (40% weight)

How close the current radar composition is to the soft targets. Computed per category as `1 - (|actual - target| / max(target, actual, 1))`, then averaged across categories.

When the radar has roughly the right mix of connections, connector-flow, and expired items, the composition score is high. A radar dominated by a single category or missing categories entirely scores low.

#### Freshness (30% weight)

How recently the radar was refreshed with new discovery results. This is a linear decay from 1.0 (just refreshed) to 0.0 over a configurable freshness window.

If the last rediscovery happened recently, freshness is high. If no rediscovery has happened within the window, freshness drops to zero. A null last-rediscovery timestamp (never refreshed) scores 0.

#### Expiration Ratio (30% weight)

The proportion of the radar that is still actionable versus expired. Computed as `1 - (expired / total)`.

A radar where most opportunities are expired scores low on this dimension, signaling that the user needs fresh connections.

### Maintenance threshold

When the composite health score drops below 0.5 (configurable), the system flags `shouldMaintain: true`, which triggers a rediscovery cycle.

An empty radar (no opportunities at all) always scores 0 and always triggers maintenance.

---

## Maintenance and Rediscovery

When the radar health check determines that maintenance is needed, the system triggers a rediscovery cycle:

1. **Health assessment**: Compute the current radar health score with breakdown
2. **Decision**: If `shouldMaintain` is true, proceed with rediscovery
3. **Rediscovery**: Run the opportunity discovery pipeline for the user, generating fresh HyDE documents, searching for new candidates, evaluating matches, and negotiating results
4. **Radar refresh**: New opportunities are added to the radar, improving composition and freshness scores

The maintenance graph runs this process automatically, typically triggered by scheduled jobs or user activity.

---

## Actionability

An opportunity appears on the radar only if it is **actionable** for the viewing user -- meaning there is a pending action they can take. The actionability rules depend on the user's role and the opportunity's status:

### With an introducer

| Role | Actionable when |
|---|---|
| Introducer | Status is latent (they need to confirm the introduction) |
| Patient / Party | Status is pending (they need to decide whether to reach out) |
| Agent | Status is accepted (the patient committed; now the agent decides) |
| Peer | Status is latent or pending |

### Without an introducer

| Role | Actionable when |
|---|---|
| Patient / Party | Status is latent (first to act) |
| Agent | Status is pending |
| Peer | Status is latent or pending |

Non-actionable opportunities (those the user has already acted on, or that are waiting for the other party) do not appear in the active radar.

---

## Opportunity Card Presentation

Opportunities on the radar are presented as cards with the evaluator's reasoning, the candidate's public profile information, and action buttons (accept, reject, skip). The specific presentation depends on the radar category:

- **Connection cards**: Show the match reasoning and the candidate's profile summary
- **Connector-flow cards**: Additionally show who made the introduction and any context they provided
- **Expired cards**: Show what the opportunity was, marked as expired, to provide historical context

---

## Relationship to Discovery

Radar and maintenance form a closed loop with the discovery pipeline:

1. Discovery creates opportunities
2. Opportunities appear on the radar
3. Users act on opportunities (accept, reject, or let them expire)
4. Radar health degrades as opportunities are consumed or expire
5. Maintenance triggers rediscovery
6. Fresh opportunities replenish the radar

This loop ensures that active users always have relevant connections to consider, while inactive radars naturally degrade and are refreshed when the user returns.
