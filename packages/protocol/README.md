# Index Network Protocol

## Status

This document describes the public protocol model for Index Network: the entities, state transitions, agent obligations, privacy boundaries, and discovery semantics that define interoperable participation in the network.

The canonical reference implementation is published as `@indexnetwork/protocol`. Implementation details, package installation, exported APIs, adapter contracts, graph factories, and release mechanics are documented separately in [IMPLEMENTATION.md](./IMPLEMENTATION.md). Public API stability is defined in [STABILITY.md](./STABILITY.md).

Normative terms such as **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are used in their ordinary protocol-documentation sense.

## Abstract

Index Network is a private, intent-driven discovery protocol for agent-mediated opportunity discovery.

Participants express **signals**: structured statements of what they seek, offer, are open to, or can credibly support. Agents interpret those signals against participant **context**, constrain discovery to bounded **communities**, evaluate candidate overlaps, negotiate fit when appropriate, and surface **opportunities** only through consent-gated state transitions.

The protocol is designed for high-signal human and agent coordination. It is not a public people database, keyword search engine, advertising channel, or automated introduction machine. Its purpose is to discover meaningful overlap while preserving context, scope, and human approval.

## Protocol overview

```mermaid
flowchart LR
    Participant[Participant] --> Agent[Authorized agent]
    Participant --> Context[Context]
    Participant --> Signal[Signal]

    Context --> Scope[Effective scope]
    Signal --> Scope
    Community[Community membership and norms] --> Scope
    AgentScope[Agent permissions] --> Scope

    Scope --> PairChecks[TypeSafe scores every eligible pair]
    PairChecks --> Candidates[All still-eligible scores, descending]
    Candidates --> Rules[Scope, currentness, and session rules]
    Rules -->|up to 10 new negotiations per intent per run| Opening[Automatic opening with current standing brief]
    Opening --> Opportunity[Negotiating opportunity]
    Opportunity --> Negotiation[Bounded A2A negotiation]
    Negotiation -->|agreement| Review[Pending human review]
    Negotiation -->|human judgment required| Questions[Structured questions]
    Questions --> Participant
    Participant --> Signal

    Review --> Consent{Participant consent?}
    Consent -->|yes| Connection[Connection]
    Consent -->|no| Terminal[Declined or expired]
```

TypeSafe scores every eligible public intent/network pair without a pass/fail threshold or `0.8` cutoff. The discovery library returns all still-eligible scored pairs sorted descending, without writing opportunities. The host walks that ranking until up to 10 new negotiations per intent per matching run are created or candidates are exhausted, enforcing deterministic scope, currentness, and session rules and copying the current standing brief. Existing/reused, terminal, and unavailable sessions do not consume the new-opening budget. There is no H2A semantic review, selection, or skip stage, and terminal pairs still require deliberate reopening. Automatic negotiation opening and A2A agreement are not human approval: a connection still requires explicit participant consent.

## Design goals

1. **Intent as the primary primitive** — discovery begins from a participant's current signal, not from static identity alone.
2. **Bounded visibility** — communities define the scope in which signals and context may be evaluated.
3. **Semantic discovery** — matching is based on role fit, constraints, complementarity, and contextual relevance rather than exact keyword overlap.
4. **Explainable surfacing** — every surfaced opportunity SHOULD include a legible reason: why these participants, why now, and what the next action might be.
5. **Consent at relationship boundaries** — agents MAY discover and negotiate, but MUST NOT create or accept a relationship without explicit participant approval.
6. **Agent interoperability** — first-party agents, personal agents, community agents, and external CLI clients SHOULD be able to participate under the same behavioral contract.

## Non-goals

The protocol does not attempt to be:

- a global directory of people,
- a public search index,
- a social feed ranking protocol,
- a marketplace listing format,
- a replacement for human judgment,
- or a mechanism for bypassing consent, membership, or community boundaries.

## Terminology

| Term | Definition |
|---|---|
| **Participant** | A human principal represented in the network. A participant may act directly or through one or more agents. |
| **Agent** | A software actor authorized to act for a participant or community within a declared scope. |
| **Signal** | A participant's actionable expression of intent: what they seek, offer, need, are building, are exploring, or can support. |
| **Context** | A synthesized representation of a participant's identity, history, constraints, and community-specific relevance. |
| **Community** | A bounded discovery scope with membership, purpose, norms, and relevance criteria. |
| **Membership** | The relationship between a participant and a community. Agents receive community authority through separate scoped permissions. |
| **Candidate** | A possible counterpart or opportunity component identified during discovery but not yet surfaced. |
| **Opportunity** | A persisted proposal automatically opened with a negotiation for an eligible ranked pair within the per-run new-opening budget, subject to protocol, visibility, and human consent gates. |
| **Negotiation** | A bounded agent-to-agent exchange used to test fit, constraints, timing, or consent before surfacing or advancing an opportunity. |
| **Connection** | A participant-approved communication channel or introduction resulting from an accepted opportunity. |

Some implementation APIs may expose historical names such as `intent`, `index`, `network`, `latent`, `pending`, `accepted`, `rejected`, `negotiating`, or `stalled`. Public-facing agents SHOULD translate stable participant states into protocol terms such as **signal**, **community**, **draft**, **sent**, **connected**, and **declined**, while treating negotiating or stalled states as internal process state unless the participant needs to act on them.

## Object relationship model

```mermaid
erDiagram
    PARTICIPANT ||--o{ AGENT : authorizes
    PARTICIPANT ||--o{ SIGNAL : expresses
    PARTICIPANT ||--o{ CONTEXT : represented_by
    PARTICIPANT ||--o{ MEMBERSHIP : holds
    AGENT ||--o{ AGENT_PERMISSION : receives
    COMMUNITY ||--o{ MEMBERSHIP : contains
    COMMUNITY ||--o{ AGENT_PERMISSION : scopes
    COMMUNITY ||--o{ SIGNAL : scopes
    COMMUNITY ||--o{ CONTEXT : lenses
    SIGNAL ||--o{ CANDIDATE : generates
    CONTEXT ||--o{ CANDIDATE : generates
    CANDIDATE ||--o| OPPORTUNITY : promotes_to
    OPPORTUNITY ||--o{ NEGOTIATION : may_require
    OPPORTUNITY ||--o| CONNECTION : accepted_as

    PARTICIPANT {
      string principal
      string consent_source
    }
    AGENT {
      string authorization
      string effective_scope
    }
    COMMUNITY {
      string purpose
      string membership_policy
    }
    SIGNAL {
      string constraints
      string lifecycle_state
    }
    OPPORTUNITY {
      string explanation
      string lifecycle_state
    }
```

This model is conceptual rather than storage-prescriptive. Implementations MAY choose different table names or internal representations, but MUST preserve the same attribution, scope, and consent semantics.

## System model

### Principals

The protocol distinguishes human principals from software actors.

- A **participant** is the source of consent and personal context.
- An **agent** is an authorized actor. Every agent action MUST be attributable to a participant, a community, or both.
- A **community** may define local discovery norms, but it does not override participant consent.

### Scope

All discovery is scope-bound. A protocol operation MUST resolve an effective scope before cross-participant discovery, candidate generation, or opportunity evaluation. Implementations MAY read the requesting participant's own signals or context while preparing that operation.

A scope may include:

- a participant's personal community,
- one or more shared communities,
- an agent's assigned community scope,
- or a narrower request-time scope selected by the participant.

Agents MUST NOT use access to one community to infer, reveal, or act on information from another community unless the effective scope explicitly permits it.

Effective scope is the intersection of all applicable authority boundaries:

```mermaid
flowchart TD
    Request[Request-time scope] --> Intersect[Intersect scopes]
    ParticipantMemberships[Participant memberships] --> Intersect
    AgentPermissions[Agent permissions] --> Intersect
    CommunityPolicy[Community rules where implemented] --> Intersect
    PersonalCommunity[Personal community boundary] --> Intersect

    Intersect --> Empty{Empty intersection?}
    Empty -->|yes| Deny[Deny discovery]
    Empty -->|no| EffectiveScope[Effective scope]
    EffectiveScope --> Reads[Permitted reads]
    EffectiveScope --> Writes[Permitted writes]
    EffectiveScope --> Evaluation[Permitted evaluation]

    Reads --> Audit[Attributable audit trail]
    Writes --> Audit
    Evaluation --> Audit
```

A broader credential MUST NOT expand a narrower request. A narrower agent permission MUST clamp a broader participant membership. Community-specific policy checks MAY further reduce effective scope where an implementation defines them.

### Public and private surfaces

The protocol separates internal state from participant-facing language.

Internal records MAY contain IDs, embeddings, scores, and graph state. Participant-facing responses MUST NOT expose these implementation details unless an identifier is directly actionable by the participant, such as a conversation identifier needed to open an accepted connection.

## Core objects

### Signal

A signal is an actionable statement of direction. It may represent a need, offer, collaboration interest, hiring intent, funding goal, research direction, introduction request, or other future-oriented constraint.

A signal SHOULD contain enough specificity to support discovery. Underspecified signals SHOULD enter clarification before they are persisted or used for broad discovery.

Signals have the following conceptual lifecycle:

| State | Meaning |
|---|---|
| **Proposed** | A participant or agent supplied raw intent-like input. |
| **Clarifying** | The protocol requires additional constraints before discovery. |
| **Active** | The signal is valid, scoped, and eligible for discovery. |
| **Updated** | The participant refined or replaced constraints. |
| **Archived / expired** | The signal should no longer produce new opportunities. |

A signal MUST NOT be treated as active if it is outside the participant's authority, obviously insincere, unsafe to act on, or too vague to evaluate.

### Context

Context describes a participant: background, role, current work, capability, location, affiliation, constraints, and declared preferences. It grounds discovery by determining whether a signal is plausible and which communities or counterparts are relevant.

Context MAY be global to a participant or specific to a community. Community-specific context SHOULD emphasize facts relevant to that community's purpose and suppress irrelevant detail.

Context updates SHOULD cause downstream discovery representations to refresh. Stale context SHOULD NOT be used when fresher participant-approved context exists.

### Community

A community is a bounded discovery environment. It defines who can participate, what kinds of signals are relevant, and which discovery operations are legitimate.

A community SHOULD have:

- a purpose or prompt,
- membership rules,
- agent permissions,
- relevance expectations,
- and privacy expectations.

The participant's personal community represents trusted contacts and direct relationships. It is not equivalent to a public audience.

### Opportunity

An opportunity is a persisted proposal between participants. The matching library returns all still-eligible scored pairs in descending score order; the host walks the ranking to create up to 10 new negotiations per intent per matching run, each with an opportunity, under deterministic scope, currentness, and session rules. The runtime copies the current standing brief into each new negotiation without asking H2A to assess, select, skip, or prepare a pair-specific brief. Existing sessions are not duplicated or given replacement briefs, and terminal pairs are not automatically reopened. Existing/reused, terminal, and unavailable sessions do not consume the new-opening budget. Presentation remains grounded in known facts; generic evaluation provenance is not a fabricated pair-specific explanation.

An opportunity SHOULD include:

- participating roles,
- the relevant signal or context on each side,
- a concise explanation of fit,
- a recommended next action,
- lifecycle state,
- and visibility rules for each participant.

Opportunity states are participant-facing as follows:

| State | Participant-facing term | Meaning |
|---|---|---|
| **Draft** | Draft | A persisted proposal has not been sent to the other side; this is not an H2A selection queue for scored matches. |
| **Sent** | Sent | One side has sent or received the opportunity and a response is pending. |
| **Connected** | Connected | Required participants accepted and a conversation or introduction may proceed. |
| **Declined** | Declined | A participant rejected the opportunity. |
| **Expired** | Expired | The opportunity is no longer actionable. |

A conforming agent MUST NOT present a received opportunity as **Connected** without explicit approval from the receiving participant. The reference implementation enforces actor authorization and valid source statuses for acceptance, while current-approval capture is handled by the agent or user-interface flow invoking the transition.

### Opportunity lifecycle

Automatic pair openings start in **Negotiating**, not in an H2A decision queue. A2A agreement moves them to **Pending** human review, never directly to **Connected**. Existing draft records retain their lifecycle paths.

```mermaid
stateDiagram-v2
    [*] --> Negotiating: host commits eligible ranked pair within opening budget
    Negotiating --> Pending: A2A agreement
    Negotiating --> Declined: negotiation declined
    Negotiating --> Expired: TTL or invalidated
    Pending --> Connected: required participants explicitly approve
    Pending --> Declined: participant declines
    Pending --> Expired: TTL or invalidated
    Draft --> Sent: sender approves send
    Draft --> Connected: direct acceptance or connection link
    Draft --> Declined: sender declines
    Draft --> Expired: TTL or invalidated

    Sent --> Connected: recipient explicitly accepts
    Sent --> Declined: recipient declines
    Sent --> Expired: TTL or invalidated

    Connected --> [*]
    Declined --> [*]
    Expired --> [*]

    note right of Draft
      Plausible but not sent.
      Only visible under role and scope rules.
    end note

    note right of Sent
      One side is waiting.
      Acceptance requires participant approval.
    end note

    note right of Connected
      Relationship boundary crossed.
      Conversation or introduction may proceed.
    end note
```

## Discovery procedure

A conforming discovery flow has seven phases.

```mermaid
sequenceDiagram
    autonumber
    participant P as Participant
    participant A as H2A agent
    participant H as Host runtime
    participant D as Matching library
    participant PR as Protocol runtime
    participant N as Counterparty agent

    P->>A: Provide signal, context, and standing instructions
    A->>H: Maintain current signal and standing brief
    H->>PR: Resolve authorized shared-network scope
    PR-->>H: Permitted networks
    H->>D: Score every eligible public intent/network pair
    D-->>H: All still-eligible scores descending, no threshold or persistence
    loop Descending ranking until 10 new negotiations per intent per run or exhaustion
        alt Pair can open a new session under deterministic rules
            H->>H: Copy current standing brief
            H->>PR: Atomically commit opportunity, negotiation, and initial brief
            PR->>N: Open bounded negotiation
            N-->>PR: Submit an available negotiation action
        else Existing, terminal, or unavailable session
            H->>H: Continue without consuming new-opening budget
        end
    end
    Note over H,PR: Preserve existing sessions; terminal reopening must be deliberate
    PR-->>A: Agreement awaits human review, or more context is needed
    A->>P: Explain the proposed connection or ask for context
    P-->>A: Approve, decline, or clarify
    A->>PR: Advance within negotiation and human consent gates
```

### 1. Context construction

The protocol collects participant-provided or participant-authorized material and turns it into context. Context construction MUST preserve provenance and SHOULD prefer participant-approved information over inferred information.

### 2. Signal admission

The protocol evaluates a proposed signal for specificity, sincerity, authority, and safety. If the signal is too broad, ambiguous, or missing critical constraints, the agent SHOULD ask focused clarification questions before running discovery.

### 3. Scope resolution

The protocol determines the effective communities in which the signal can operate. Scope resolution MUST intersect participant membership, agent permissions, and request-time constraints. If the intersection is empty, discovery MUST NOT proceed.

### 4. Direct pair checks

In the reference host, the independent `@indexnetwork/discovery` library exhaustively enumerates active, match-ready intent/network pairs inside the requested authorized scope. Both signals must be registered in that network and both participants must be current members. Each deduplicated pair's public intent payloads and permitted network context are scored directly for a concrete, plausible exchange or shared activity advancing both goals, not merely topical similarity. Missing negotiable details are not an automatic failure; explicit incompatible hard constraints count against a match.

The host uses TypeSafe evaluation and returns all still-eligible scored pairs sorted by descending `matchProbability`, with no pass/fail threshold or `0.8` cutoff. There are no search queries, embedding retrieval, or model-selected candidates, and the discovery result is not truncated to ten. It checks source and candidate freshness and propagates provider failures rather than treating them as non-matches. Lifecycle embeddings remain internal artifacts, separate from pairing.

The matching library only returns scored pairs; it performs no opportunity or negotiation writes. The host walks the full ranking with a bounded new-opening budget, as described below. Candidate data remains subject to visibility rules, and reading persisted opportunities does not trigger a new matching run.

### 5. Automatic negotiation opening

The host walks the descending score ranking until **up to 10 new negotiations per intent per matching run** are created or candidates are exhausted, opening an opportunity with each new negotiation. Existing/reused, terminal, and unavailable sessions do not consume the new-opening budget; lower-ranked pairs can still be reached. This limits new openings, not scoring or the first ten candidates. There is no H2A semantic review, selection, or skip stage. The runtime copies the current standing brief into each newly opened negotiation without generating or requesting a pair-specific brief.

The host's atomic opening operation enforces deterministic scope, currentness, readiness, authorization, and session rules, committing each new session with its initial brief. Existing sessions and their briefs are preserved, and terminal pairs require deliberate reopening, never automatic matching. A changed or otherwise ineligible pair cannot bypass those guards. Stale context/scope or uncertain writes stop the remainder without a blind retry; earlier committed openings remain valid.

Generic model/scoring provenance MUST NOT be presented as a pair-specific explanation or used as an additional reason-quality gate. A provider score is not a calibrated probability of agreement, a commitment, or human consent. Automatic opening and subsequent A2A agreement do not authorize a connection without explicit current participant approval.

### 6. Negotiation

Automatically opened sessions proceed through bounded A2A negotiation under the current standing brief and available protocol actions. Negotiation SHOULD clarify constraints and test mutual relevance. Its outcome updates the persisted opportunity; A2A agreement advances only to pending human review, not approval to connect.

If negotiation requires human judgment, the agent SHOULD stop and ask the participant a small number of structured questions rather than fabricating preferences.

### 7. Surfacing and acceptance

The protocol surfaces the opportunity according to role and lifecycle visibility. Participant-facing presentation SHOULD ground relevance and the next action in known facts, without inventing a pair-specific model explanation. Negotiation may proceed under the current standing brief, but a connection MUST require explicit current participant approval. Neither automatic opening nor A2A agreement substitutes for that approval.

## Agent requirements

A conforming agent MUST:

- act only within its authenticated participant and community scope,
- preserve participant consent at send, accept, and connection boundaries,
- avoid exposing internal IDs, raw graph results, embeddings, scores, or database field names,
- distinguish known facts from inferred context,
- ask for clarification when required information is missing,
- use the protocol vocabulary in participant-facing output,
- avoid fabricating participants, opportunities, constraints, or outcomes,
- and provide concise explanations for surfaced opportunities.

A conforming agent SHOULD:

- surface the top one to three relevant points by default,
- prefer first names unless disambiguation is required,
- explain why an opportunity is relevant before asking for action,
- treat silence, timeouts, or failed negotiation as uncertainty rather than consent,
- and record enough trace information for later audit by authorized operators.

A conforming agent MUST NOT:

- describe discovery as public search,
- use community access to leak out-of-scope participant information,
- accept a received opportunity without explicit current approval,
- present internal confidence scores as objective truth,
- or continue negotiation after a terminal decision.

## Privacy and safety invariants

The following invariants define the protocol's trust boundary:

1. **Scope invariant** — discovery reads and writes MUST remain inside the effective scope.
2. **Consent invariant** — relationship-forming transitions MUST be participant-approved.
3. **Attribution invariant** — every agent action MUST be attributable to an authorized principal.
4. **Legibility invariant** — surfaced opportunities SHOULD be explainable in participant-facing language.
5. **Minimization invariant** — participant-facing output SHOULD reveal only what is needed for the next decision.
6. **No-fabrication invariant** — agents MUST NOT invent facts to complete an opportunity narrative.
7. **Terminality invariant** — declined, expired, or otherwise terminal opportunities SHOULD NOT produce further automatic advancement unless explicitly reopened or changed through an authorized protocol action.

## Interoperability

The reference implementation exposes the protocol through a REST API and typed package APIs. External agents use the Index CLI against those resources, reading canonical guidance from `GET /api/docs`. The API resolves identity and enforces ownership, network scope, and protocol rules.

```mermaid
flowchart LR
    ExternalAgent[External agent] --> CLI[Index CLI]
    CLI --> HTTP[Index REST API]
    FirstPartyAgent[First-party agent] -->|typed runtime| Runtime[Protocol runtime]

    HTTP --> Identity[Identity resolution]
    Identity --> AgentGate[Agent registration and scope]
    AgentGate --> ScopedDeps[Scoped protocol dependencies]
    ScopedDeps --> Runtime

    HTTP --> Discovery[Host-owned exhaustive pair scoring]
    Discovery --> Candidates[All still-eligible scores, descending]
    Candidates --> Budget[Walk ranking for up to 10 new negotiations per intent per run]
    Budget --> Opening[Automatic host opening with current standing brief]
    Opening -->|scope, currentness, and session rules| Runtime
    Runtime --> Graphs[Signal and context graphs]
    Graphs --> Results[Protocol results]
    Results --> Runtime
    Runtime --> ParticipantOutput[Participant-facing output rules]
```


Implementations MAY expose additional transports, but they SHOULD preserve the same protocol semantics:

- authenticated principal resolution,
- scoped access,
- consent-gated opportunity transitions,
- structured discovery and negotiation operations,
- and participant-facing output rules.

## Reference implementation

The canonical TypeScript implementation is `@indexnetwork/protocol`.

- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — package installation, adapters, graph factories, REST API and CLI usage, and publishing.
- [STABILITY.md](./STABILITY.md) — public API contract and SemVer policy.
- [CHANGELOG.md](./CHANGELOG.md) — release history.
