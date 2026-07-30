---
title: "Opportunities"
type: domain
tags: [opportunities, discovery, valency, scoring, lifecycle, deduplication, negotiation]
created: 2026-03-26
updated: 2026-04-06
---

# Opportunities

An opportunity is a coordination point where aligned intents, profiles, and context make a connection between two people rational and valuable. Opportunities are not mere "matches" -- they are first-class entities that capture the conditions under which collaboration becomes possible.

The system does not create opportunities; it detects them. Opportunities exist latently in the intent graph whenever complementary goals overlap. Agents make them legible by evaluating alignment, scoring fit, and producing human-readable reasoning about why two people should connect.

---

## Discovery Triggers

Opportunity creation is background-only. Queues evaluate persisted context and save eligible opportunities for later review; a chat turn can help create or refine a signal and can review persisted cards, but it does not run matching.

### Intent queue

Creating, refining, or resuming an active assigned intent enqueues discovery. The queue uses the trigger intent's HyDE documents and current network assignments to find eligible candidates.

### Enrichment queue

Enrichment and premise changes regenerate user contexts and can enqueue discovery from that persisted context. Context-to-intent and premise representations provide the candidate evidence.

### Introducer queue

An explicit introduction is validated and processed asynchronously within the participants' shared-network scope. The introducer remains an actor on the resulting opportunity; the evaluator receives the explicit introduction context.

### Maintenance queue

Feed-health maintenance can enqueue rediscovery for active intents when persisted opportunity coverage is stale or unhealthy.

---

## Valency Roles

Every actor in an opportunity is assigned a semantic role that determines their relationship to the connection and, critically, controls when they see the opportunity.

### Agent (helper/provider)

The candidate CAN DO something for the other party. Example: the source needs a developer, and the candidate IS a developer. Agents are the last to see the opportunity -- they only learn about it after the patient has committed to reaching out. This protects agents from noise; they only see high-intent connections.

### Patient (seeker/requester)

The candidate NEEDS something from the other party. Example: the source is a mentor, and the candidate needs mentoring. Patients see the opportunity early and decide whether to reach out.

### Peer (symmetric collaboration)

Neither party is primarily helping or seeking -- both contribute and benefit equally. Both parties see the opportunity immediately, and either can initiate contact.

### Introducer

A third party who created the opportunity on behalf of two other users (e.g. "I think these two should meet"). Introducers are always actors on the opportunity but they are not participating in the connection itself — they sit outside the visibility matrix as perpetual observers of the introduction they triggered.

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

When the source intent or introduction context mentions a specific location:
- Known mismatch (request says "SF" but candidate is "New York"): Score capped at 40
- Unknown or empty location: No penalty; noted as unverified
- Compatible match ("Bay Area" matches "SF", "Remote" matches any): Score normally

---

## Status Lifecycle

Opportunities follow an eight-state lifecycle:

| Status | Meaning |
|---|---|
| **latent** | Detected but not yet surfaced to any user. The system knows this coordination point exists. |
| **draft** | Retained lifecycle state for persisted compatibility and introducer reactivation. Not newly produced as a live chat card. |
| **negotiating** | Bilateral agent-to-agent negotiation is in flight. The opportunity is persisted but not yet visible to either party. |
| **pending** | Negotiation accepted (or negotiation was skipped); opportunity is surfaced to the appropriate party based on role visibility rules. Awaiting user action. |
| **stalled** | Negotiation reached its turn cap or timed out without resolution. Surfaced as an inconclusive match (not confidently accepted or rejected). |
| **accepted** | The user has accepted the connection. Triggers contact creation and notification to the other party. |
| **rejected** | The user has declined the connection (or negotiation finished with a rejection). |
| **expired** | The timing window has passed or the underlying intents are no longer active. |

---

## Visibility Rules

Who sees an opportunity and when is governed by the actor roles and the opportunity's current status. This is the role-visibility matrix:

In-flight statuses (`latent`, `draft`, `negotiating`) are never visible to any actor. The matrix below governs the surfaced statuses (`pending`, `stalled`, `accepted`, `rejected`, `expired`).

### With an introducer present

| Role | Sees when |
|---|---|
| Introducer | Always (they created the introduction) |
| Patient / Party | Status is pending or stalled |
| Agent | Status is accepted, rejected, or expired |
| Peer | Always |

### Without an introducer

| Role | Sees when |
|---|---|
| Patient / Party | Surfaced statuses only |
| Agent | Surfaced statuses only |
| Peer | Always |

The key design principle: agents (helpers/providers) are shielded from noise. They only learn about opportunities after the seeking party has committed, ensuring that connections are high-intent by the time the agent sees them.

---

## Bilateral Acceptance

A connection requires acceptance from two distinct actors. The system enforces this by stamping `actedAt` on the acting actor each time a user advances an opportunity's state, and refusing accept if the caller has already acted.

- **Patient + agent:** the patient sends an eligible latent or retained draft opportunity (`actedAt` set on the patient); the agent then accepts (`actedAt` set on the agent). The patient cannot subsequently accept their own send — the API returns HTTP 409.
- **Peer + peer:** the first peer sends an eligible latent or retained draft opportunity (`actedAt` set on them). The second peer then accepts on the resulting `pending` opportunity. Neither can self-accept.
- **Introducer + others:** the introducer sends after approving the intro (`actedAt` set on the introducer). The downstream patient/agent acceptance follows the same rules as above.

The `actedAt` stamp is written atomically with the status change inside a row-locked transaction, so concurrent attempts serialize through Postgres' row lock. The guard runs at both layers:

- **Graph** (`updateNode` and `sendNode` in `opportunity.graph.ts`): used by `update_opportunity` and `send_opportunity` MCP tools.
- **Service** (`OpportunityService.updateOpportunityStatus` and `OpportunityService.startChat`): used by REST `PATCH /api/opportunities/:id/status` and `POST /api/opportunities/:id/start-chat`.

Reject and expire transitions are exempt from the guard — they are terminal flips, not commit signals, and may be invoked by either actor regardless of prior `actedAt`. Background system flips (negotiation finalize, timeout cleanup) also use the legacy `updateOpportunityStatus` path and do not stamp `actedAt` — only explicit user commits do.

### Uptake clarification before commitment

When the uptake feature is enabled, every committed transition to `pending` is evaluated asynchronously. If the exact counterparty intent is active in the shared non-personal network and its preparatory-condition (`felicityAuthority`) score is below the configured threshold, the receiving actor gets one neutral negotiation-mode question about practical capability, resources, availability, or authority. The numeric score and verifier reasoning are never shown or persisted in the public question.

The question carries server-only `detection.purpose = "uptake"`; purpose, QUD type, and conversational strategy remain independent metadata. Uptake answers stay private on the question row and are not copied into shared opportunity metadata.

Acceptance uses a **soft interlock**, not a new status. The first accept attempt returns the current unresolved questions and leaves the opportunity `pending` without opening a DM or mutating contacts. The user can answer/dismiss and retry, cancel, or explicitly continue anyway by acknowledging every ID in the latest advisory. Question lookup/generation failures fail open, so infrastructure trouble cannot permanently block a connection. The rollout is independently gated by `QUESTIONER_UPTAKE_ENABLED` under the `QUESTIONER_ENABLED` master switch.

---

## Dual-Interpretation Model

Each opportunity carries interpretations written from a third-party analytical perspective. The reasoning explains why the opportunity exists, mentioning both users by their roles ("the source user", "the candidate") rather than by name or with direct address.

Key properties of interpretations:
- **Non-leaking**: Neither description reveals the other party's raw intent text. If an intent is incognito, the interpretation describes relevant attributes instead.
- **Contextually grounded**: Uses publicly shareable signals (profile data, shared network membership)
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

- `source`: How the opportunity was detected (`opportunity_graph`, `manual`, `member_added`, `enrichment`, `introducer_discovery`)
- `triggeredBy`: The intent ID that caused detection (if intent-driven)
- `createdBy` / `createdByName`: The user who triggered it (for attribution)
- `timestamp`: When detection occurred

### Actors

The parties involved and their roles. Each actor has:
- `userId`: Who they are
- `indexId`: The index through which they were found
- `intent`: The specific intent that drove the match (optional)
- `role`: Their valency role (agent, patient, peer)
- `approved`: Set only on `role === 'introducer'`. `false` until the introducer approves the intro; `true` after approval.
- `actedAt`: ISO-8601 timestamp of this actor's first state-advancing mutation — set when the actor sends (`pending`) or accepts (`accepted`). Used to enforce the bilateral-acceptance guard described below. Absent until the actor has acted.

### Interpretation

The evaluator's analysis:
- `category`: Type of opportunity
- `reasoning`: Third-party analytical explanation
- `confidence`: Composite score (0-100)
- `signals`: Optional array of signal types with weights and details

### Context

Additional metadata:
- `indexId`: The network scope (if network-scoped discovery)
- `conversationId`: Optional historical conversation association retained on persisted records

---

## Negotiation Gate

Once the evaluator clears a background candidate, the graph persists it and then runs ambient bilateral agent-to-agent negotiation (see [Negotiation](negotiation.md)) as a quality gate before surfacing. The opportunity remains invisible to either party while negotiation is in flight. Negotiation then drives the status to one of:

- **pending** — both agents agreed; the opportunity becomes visible per the visibility matrix.
- **rejected** — at least one agent rejected; the opportunity stays persisted but hidden from both parties.
- **stalled** — negotiation reached its turn cap without a decision; surfaced inconclusively so the user can decide.

Persisting before negotiation (rather than gating persistence on negotiation) keeps an audit trail of discovered-but-not-surfaced opportunities. Completed, persisted cards are available through the feed and home surfaces and can be reviewed from later chat turns or chat history.
