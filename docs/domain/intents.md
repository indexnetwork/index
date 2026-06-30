---
title: "Intents"
type: domain
tags: [intents, speech-acts, felicity-conditions, semantic-entropy, reconciliation, lifecycle]
created: 2026-03-26
updated: 2026-04-06
---

# Intents

An intent is a first-class expression of what a user wants. Rather than relying on static profile attributes to drive discovery, Index Network treats intents as the primary unit of coordination: a user declares what they are seeking or committing to, and the system matches those declarations against the declarations and profiles of others.

Intents are grounded in **speech act theory** (John Searle). Every natural-language statement a user makes is classified as a specific type of illocutionary act, scored for quality, and then managed through a formal lifecycle.

---

## Speech Act Classification

When a user submits content (text, uploaded documents, links), the system classifies each extracted statement using Searle's taxonomy. The classification determines whether the statement is actionable as an intent.

### Actionable types

- **DIRECTIVE** -- The user expresses a search, need, or request directed at others. This is the most common intent type. Examples: "Looking for a technical co-founder", "Seeking ML researchers", "Need a Rails contractor starting next week". Verbless gerundive forms ("Looking for artists for collaboration") are classified as directives because the elided subject ("I am") is routine in natural intent language.

- **COMMISSIVE** -- The user commits to a future action. Examples: "I will deploy the contract by Friday", "I commit to mentoring two junior devs". The commitment must be genuine -- hedged language ("I could maybe try") scores low on sincerity rather than receiving a different classification.

### Non-actionable types

- **ASSERTIVE** -- States a fact, belief, or opinion with no implied request or commitment. "Rust is faster than C++" is assertive. These are flagged as NOISE and not converted into intents.

- **EXPRESSIVE** -- Psychological states or social rituals ("I'm so excited!", "Congrats to the team"). Also flagged as NOISE.

- **DECLARATION** -- Cancels, terminates, or declares a state change ("I quit", "This position is closed"). Declarations may trigger intent expiration rather than creation.

- **UNKNOWN** -- Does not fit any category cleanly.

Only DIRECTIVE and COMMISSIVE statements become intents. The others are filtered out during verification.

---

## Felicity Conditions

Every intent is scored against three felicity conditions, each rated 0-100. These scores determine whether an intent is well-formed enough to participate in discovery.

### Clarity (Essential Condition)

How unambiguous and actionable is the statement?

- 100: "Deploy the Solidity contract to Mainnet by March 15"
- 60: "Looking for a developer" (clear direction, vague spec)
- 20: "We should do something cool"

When clarity falls below 50, the intent is flagged as VAGUE_INTENT.

### Authority (Preparatory Condition)

Does the speaker's profile support this act? The system compares the user's stated skills, role, and background against the domain of the intent.

- 100: A Senior ML Engineer saying "Seeking a research collaborator on transformers"
- 20: A Junior Marketer saying "I will rewrite the Rust compiler"

For directives, authority measures the plausibility that this person would make this search. When authority falls below 70, the intent is flagged as SKILL_MISMATCH.

### Sincerity (Sincerity Condition)

Does the linguistic form imply genuine commitment or genuine need?

- For commissives: checked via modality strength (will > going to > might > could)
- For directives: checked via specificity of the search (specific need > vague wish)
- 100: "I need a Rails contractor starting next week, $150/hr, remote"
- 40: "I could maybe try to find someone"

When sincerity falls below 70, the intent is flagged as WEAK_COMMITMENT.

---

## Semantic Entropy and Referential Anchors

Beyond felicity conditions, each intent carries two semantic governance metrics.

### Semantic Entropy

A constraint density score ranging from 0.0 (maximally constrained) to 1.0 (completely unconstrained). This measures how specific the intent is based on the presence of constraints like time, location, technology stack, and quantifiers.

- 0.0: "Meet 50 senior React devs in SF by Friday" -- every constraint slot is filled
- 1.0: "Network" -- no constraints at all

Lower entropy intents produce better matches because they carry more information for the discovery system to work with.

### Referential Anchor

Based on Donnellan's distinction between referential and attributive uses of definite descriptions:

- **Referential**: The intent names a specific unique entity. "I want to join Google" has referential anchor "Google". The user refers to a particular thing.
- **Attributive**: The intent describes a class. "I want to join a startup" has no referential anchor (null). The user refers to any member of a class that satisfies the description.

This distinction matters for reconciliation: two referential intents match only if they share the same anchor, while two attributive intents match if their descriptions are semantically similar.

---

## Intent Modes

Each intent is classified into one of two modes, derived from the referential anchor analysis:

- **REFERENTIAL** -- Points to a specific entity (anchor is not null). "Looking for John Smith at OpenAI."
- **ATTRIBUTIVE** -- Describes desired characteristics of any entity that fits (anchor is null). "Looking for an ML researcher with 5+ years experience."

The mode is stored in the `intentMode` field and influences how the reconciler matches new intents against existing ones.

---

## Lifecycle

Intents follow a four-state lifecycle:

| Status | Meaning |
|---|---|
| **ACTIVE** | The intent is live and participates in discovery. New intents start here. |
| **PAUSED** | The user has temporarily suspended the intent. It does not participate in discovery but is not expired. |
| **FULFILLED** | The intent has been satisfied (the user found what they were looking for or completed what they committed to). |
| **EXPIRED** | The intent is no longer relevant. This can happen through explicit user action, through reconciliation (a tombstone matched it), or through system expiration rules. |

An archived intent (with an `archivedAt` timestamp) is effectively removed from active consideration.

---

## Confidence Scoring

Each inferred intent carries a `semanticEntropy` score (0.0–1.0, stored as a double) reflecting how certain the inference is. Lower values mean higher certainty (less semantic entropy across candidate extractions); values near 1.0 mean the inference is ambiguous. This is distinct from the felicity scores, which measure the quality of the intent itself rather than the certainty of extraction.

During reconciliation, this score influences whether an action is taken: a highly entropic (low-confidence) inference is less likely to trigger creation of a new intent if an existing intent already covers similar ground.

---

## Incognito Intents

An intent can be marked as incognito (`isIncognito: true`). Incognito intents participate in the discovery pipeline but their content is never exposed to other users. When the opportunity evaluator encounters an incognito intent, it describes the user's relevant attributes instead of revealing the intent text.

This allows users to seek connections around sensitive goals (job searching while employed, exploring a pivot) without broadcasting those goals.

---

## Source Tracking

Every intent tracks its origin through a polymorphic source system:

| Source Type | Meaning |
|---|---|
| **file** | Extracted from an uploaded document (PDF, text file, etc.) |
| **integration** | Imported from a connected service (Slack, Notion, Gmail via Composio) |
| **link** | Extracted from a crawled URL |
| **discovery_form** | Created through the onboarding or discovery form flow |
| **enrichment** | Added through intent enrichment (system-generated elaboration) |

The `sourceId` field references the originating record in the corresponding table (files, network_integrations, links). This enables filtering intents by source and bulk re-processing when a source is updated or removed.

---

## Intent-Network Assignment and Relevancy Scoring

Intents do not exist in isolation -- they are assigned to one or more indexes (communities). The many-to-many relationship between intents and indexes is tracked in the `intent_networks` junction table, which carries an optional `relevancyScore` (0.0-1.0).

### How assignment works

When an intent is created or updated, the Intent Indexer agent evaluates how well it fits each candidate index. The agent considers:

1. **Network prompt** -- the purpose/scope of the community
2. **Member prompt** -- the user's specific sharing preferences in that community
3. **Intent content** -- what the intent actually says
4. **Source context** -- where the intent came from

The agent produces two scores:
- `indexScore` (0.0-1.0): How well the intent fits the index's stated purpose
- `memberScore` (0.0-1.0): How well the intent fits the member's sharing preferences

### Qualification threshold

An intent qualifies for an index when its `indexScore` reaches 0.7 or above. Below that threshold, the intent is not assigned. The scoring rubric:

- 0.9-1.0: Highly appropriate, perfect match
- 0.7-0.8: Good match, relevant
- 0.5-0.6: Moderate, borderline (does not qualify)
- 0.0-0.4: Not appropriate

### Relevancy in discovery

The `relevancyScore` stored on the junction table is used during opportunity discovery to break ties. When a candidate appears across multiple shared networks, the index with the highest relevancy to the trigger intent wins. Networks without prompts default to a score of 1.0.

---

## Reconciliation

When new content arrives (user input, uploaded document, integration sync), the system does not blindly create new intents. Instead, a three-stage pipeline runs:

### 1. Inference

The Intent Inferrer extracts candidate intents from the content. Each inferred intent has a type:

- **goal**: The user wants to start, continue, or achieve something
- **tombstone**: The user explicitly states they have completed, stopped, or abandoned a goal

The inferrer is grounded to the content: every inferred intent must be directly related to the new content, not fabricated from the profile alone. The user profile serves as enrichment context to add specificity, not as a source of new intents.

### 2. Verification

The Semantic Verifier classifies each inferred intent (speech act type), scores its felicity conditions, computes semantic entropy, and identifies referential anchors. Intents classified as ASSERTIVE or EXPRESSIVE are flagged as NOISE and filtered out.

### 3. Reconciliation

The Intent Reconciler compares inferred intents against the user's existing active intents and decides on actions:

- **Create**: The inferred intent is genuinely new -- no existing intent covers this ground. A new intent is created.
- **Update**: The inferred intent matches an existing active intent but offers a better or modified description. The existing intent is updated. Critically, updates are treated as refinements: existing details are preserved and only the specified aspects are modified. Even exact duplicates produce an update action, allowing the system to link the intent to an additional index.
- **Expire**: An inferred tombstone matches an existing active intent semantically. The existing intent is expired.
- **Conflict resolution**: A new goal contradicts an existing active intent. The old intent is expired and the new one is created.

Matching uses Donnellan's distinction: referential intents match only if they share the same anchor, while attributive intents match if their descriptions are semantically similar.

---

## Domain Events

Intent state changes emit events that other parts of the system react to asynchronously:

- **onCreated**: Fired when a new intent is created. Triggers HyDE document generation and opportunity discovery.
- **onUpdated**: Fired when an intent is modified. Triggers re-evaluation of index assignments and opportunity re-discovery.
- **onArchived**: Fired when an intent is archived/expired. Triggers cleanup of associated HyDE documents and opportunity expiration.
