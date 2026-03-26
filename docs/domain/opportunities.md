---
title: "Opportunities"
type: domain
tags: [opportunities, discovery, valency, scoring, lifecycle, deduplication, negotiation]
created: 2026-03-26
updated: 2026-03-26
---

# Opportunities

An opportunity is a coordination point where aligned intents, profiles, and context make a connection between two people rational and valuable. Opportunities are not mere "matches" -- they are first-class entities that capture the conditions under which collaboration becomes possible.

The system does not create opportunities; it detects them. Opportunities exist latently in the intent graph whenever complementary goals overlap. Agents make them legible by evaluating alignment, scoring fit, and producing human-readable reasoning about why two people should connect.

---

## Discovery Triggers

Opportunities are discovered through several triggers:

### Intent-based discovery

When a user creates or updates an intent, the system searches for people whose profiles or intents complement it. This is the primary discovery path. The trigger intent's HyDE documents are used to find semantically similar candidates across the network.

### User query (chat-driven)

When a user asks the chat agent to find connections ("Find me ML collaborators in SF"), the system runs a targeted discovery using the query as the search context. Query-driven discovery applies stricter scoring: the query is the primary evaluation criterion, and stored intents serve only as background context.

### Direct connection (introduction)

A user can explicitly introduce two people. In introduction mode, the introducer is not an actor in the opportunity -- they are added separately by the system. The evaluator is more generous with scoring (70+ for any introduction with a plausible basis) because a human has already made the judgment that these people should connect.

### Member-added discovery

When a new member joins an index, the system evaluates potential matches between the new member and existing members within that index's scope.

---

## Valency Roles

Every actor in an opportunity is assigned a semantic role that determines their relationship to the connection and, critically, controls when they see the opportunity.

### Agent (helper/provider)

The candidate CAN DO something for the other party. Example: the source needs a developer, and the candidate IS a developer. Agents are the last to see the opportunity -- they only learn about it after the patient has committed to reaching out. This protects agents from noise; they only see high-intent connections.

### Patient (seeker/requester)

The candidate NEEDS something from the other party. Example: the source is a mentor, and the candidate needs mentoring. Patients see the opportunity early and decide whether to reach out.

### Peer (symmetric collaboration)

Neither party is primarily helping or seeking -- both contribute and benefit equally. Both parties see the opportunity immediately, and either can initiate contact.

### Role derivation

Roles can be derived from how a candidate was found:
- Found via the **profiles** corpus (who they are) -- the candidate is likely an agent (they can help)
- Found via the **intents** corpus (what they need) -- the candidate is likely a patient (they need something)

The evaluator may override these defaults based on deeper analysis of the actual intents and profiles involved.

---

## Scoring

The opportunity evaluator assigns a confidence score from 0-100 that determines whether the opportunity is surfaced.

### Scoring bands

| Range | Label | Meaning |
|---|---|---|
| 90-100 | Must Meet | Perfect alignment. The candidate's primary role directly matches what the discoverer seeks. |
| 70-89 | Should Meet | Strong overlap with clear potential. Meaningful overlap on role type and complementary intent. |
| 50-69 | Worth Considering | Tangential overlap only. Used in batch mode to let downstream filtering decide. |
| <70 (pairwise) / <30 (batch) | No opportunity | The match is too weak to surface. Returns empty. |

Pairwise mode (one candidate at a time) uses a strict 70 threshold. Batch mode (entity-bundle with multiple candidates) uses a permissive 30 threshold so the calling pipeline can apply its own filters.

### Role-satisfiability check

Before scoring, the evaluator checks whether the candidate can fill the **substitutive role** in the discoverer's intent -- the actual type of person the discoverer is seeking. A candidate in a **complementary role** (someone who funds, advises, or otherwise enables the sought relationship from outside it) does not satisfy the intent.

Example: If a discoverer seeks a "co-founder", a VC investor occupies a complementary role (they fund the company but do not co-found it). Score capped at 30, which means no opportunity is surfaced.

A contextual override applies: if the candidate's profile shows they currently function in the substitutive role (e.g., a former investor now building full-time as a technical co-founder), they are re-evaluated as substitutive.

### Same-side matching rejection

If both the discoverer and candidate are SEEKING the same resource (both looking for investors, both seeking co-founders), this is not an opportunity. An opportunity requires one side to OFFER what the other SEEKS. Same-side matches score below 30 regardless of keyword overlap.

### Location matching

When the discovery request mentions a specific location:
- Known mismatch (request says "SF" but candidate is "New York"): Score capped at 40
- Unknown or empty location: No penalty; noted as unverified
- Compatible match ("Bay Area" matches "SF", "Remote" matches any): Score normally

---

## Status Lifecycle

Opportunities follow a seven-state lifecycle:

| Status | Meaning |
|---|---|
| **latent** | Detected but not yet surfaced to any user. The system knows this coordination point exists. |
| **draft** | Under construction (used during negotiation). Not yet visible. |
| **pending** | Surfaced to the appropriate party based on role visibility rules. Awaiting user action. |
| **viewed** | The user has seen the opportunity but not yet acted on it. |
| **accepted** | The user has accepted the connection. Triggers contact creation and notification to the other party. |
| **rejected** | The user has declined the connection. |
| **expired** | The timing window has passed or the underlying intents are no longer active. |

---

## Visibility Rules

Who sees an opportunity and when is governed by the actor roles and the opportunity's current status. This is the role-visibility matrix:

### With an introducer present

| Role | Sees when |
|---|---|
| Introducer | Always (they created the introduction) |
| Patient / Party | Status is pending or viewed |
| Agent | Status is accepted, rejected, or expired |
| Peer | Always |

### Without an introducer

| Role | Sees when |
|---|---|
| Patient / Party | Status is not latent |
| Agent | Status is not latent |
| Peer | Always |

The key design principle: agents (helpers/providers) are shielded from noise. They only learn about opportunities after the seeking party has committed, ensuring that connections are high-intent by the time the agent sees them.

---

## Dual-Interpretation Model

Each opportunity carries interpretations written from a third-party analytical perspective. The reasoning explains why the opportunity exists, mentioning both users by their roles ("the source user", "the candidate") rather than by name or with direct address.

Key properties of interpretations:
- **Non-leaking**: Neither description reveals the other party's raw intent text. If an intent is incognito, the interpretation describes relevant attributes instead.
- **Contextually grounded**: Uses publicly shareable signals (profile data, shared index membership)
- **Specific**: Explains what each side brings to the connection and why it is mutually valuable

The interpretation `reasoning` field is sanitized to strip UUIDs, preventing internal identifiers from leaking into user-facing text.

---

## Deduplication

The evaluator checks existing opportunities before creating new ones. If an opportunity between the same two parties already exists (same actors, similar reasoning), a new duplicate is not created. The evaluator receives a formatted string of existing opportunities as deduplication context.

Additionally, the system will not suggest opportunities between people who clearly already know each other (co-founders of the same company, same team, same employer) based on profile analysis.

---

## Opportunity Structure

Each opportunity record contains four JSONB fields that capture the full context:

### Detection

Provenance information: what triggered the discovery, who or what caused it, and when.

- `source`: How the opportunity was detected (opportunity_graph, chat, manual, cron, member_added, enrichment)
- `triggeredBy`: The intent ID that caused detection (if intent-driven)
- `createdBy` / `createdByName`: The user who triggered it (for attribution)
- `timestamp`: When detection occurred

### Actors

The parties involved and their roles. Each actor has:
- `userId`: Who they are
- `indexId`: The index through which they were found
- `intent`: The specific intent that drove the match (optional)
- `role`: Their valency role (agent, patient, peer)

### Interpretation

The evaluator's analysis:
- `category`: Type of opportunity
- `reasoning`: Third-party analytical explanation
- `confidence`: Composite score (0-100)
- `signals`: Optional array of signal types with weights and details

### Context

Additional metadata:
- `indexId`: The index scope (if index-scoped discovery)
- `conversationId`: The conversation where this opportunity was discussed (if chat-driven)

---

## Negotiation Gate

Before an opportunity is persisted, it may pass through bilateral agent-to-agent negotiation (see [Negotiation](negotiation.md)). Negotiation acts as a quality gate: only matches where both agents agree are persisted as opportunities. If negotiation rejects the match, the opportunity is not created.

This prevents low-quality matches from reaching users even when the initial evaluator score is above threshold.
