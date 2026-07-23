---
title: "Intents"
type: domain
tags: [intents, speech-acts, felicity-conditions, semantic-entropy, reconciliation, lifecycle, pool-questions]
created: 2026-03-26
updated: 2026-07-23
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
| **ACTIVE** | The intent is live and can admit new discovery and matching work. New intents start here. |
| **PAUSED** | The user has temporarily suspended new intent-driven discovery and matching without removing the existing intent workspace. |
| **FULFILLED** | The intent has been satisfied (the user found what they were looking for or completed what they committed to). |
| **EXPIRED** | The intent is no longer relevant. This can happen through explicit user action, through reconciliation (a tombstone matched it), or through system expiration rules. |

Legacy rows whose `status` is null are treated as **ACTIVE**.

Pausing is non-destructive. Existing opportunities (including Radar cards), pending questions, conversations, intent-network assignments, and HyDE documents remain in place. A paused intent cannot admit not-yet-started intent-driven discovery, be returned as a candidate match, start new pool mining or question generation, or schedule an answer-triggered Tier-1 discovery rerun. Work that already passed its lifecycle admission check may still finish.

Existing pending questions remain answerable while paused. Their deterministic Tier-0 preference adjustment can still re-rank the existing pool, but the answer does not start Tier-1 discovery or chain a new question. Resuming changes the intent to **ACTIVE** and immediately enqueues one lifecycle-version-deduplicated from-intent discovery run; ordinary pool mining and question generation then follow the normal discovery flow. If that enqueue is not acknowledged, a changed resume is compare-and-set back to **PAUSED** when no concurrent lifecycle write intervened, and the client receives a retryable failure rather than false success.

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

## Pool-Aware Refinement Questions

An active intent can receive `pool_discovery` questions derived from meaningful differences across its current opportunity pool. The discriminator miner verifies evidence against candidate context, scores each axis for expected value of information, and asks only sufficiently supported questions. These questions are scoped to the intent's Personal Agent thread rather than the global question inbox. Before a queued or chained result is persisted, the final gate re-reads the exact recipient+intent pool and normalized payload+summary fingerprint. It creates no row, push, or dismissal when the fingerprint changed or pool Jaccard similarity is below the shared inclusive `0.7` freshness threshold.

Discovery completion also reconciles pending snapshots against that same current pool and fingerprint. Drifted rows are system-voided with `detection.voidedReason='pool_drift'`; voided rows never render, push, count, contribute to dismissal decay, or suppress a novel axis. Repeated MODE-on mining skips when the latest durable non-voided snapshot has the same fingerprint and pool Jaccard is at least `0.7`. Shadow-only mining remains independently gated and has no durable snapshot cadence anchor.

Immediate rank application is deterministic and auditable. Candidates on the chosen side retain a `1.0` factor, the other side receives `0.6`, and live candidates that were not assigned by the mined snapshot receive `0.9`. Every adjustment records the exact answering `recipientUserId` and selected `intentId`; legacy entries without both fields are ignored for ranking but preserved. Multiple answers multiply, with a cumulative floor of `0.3`, but only in that recipient's Radar for that exact selected intent, so a preference cannot change another participant's or another intent's ordering. “Both matter” records no preference and changes no ranking. The same inclusive `0.7` Jaccard threshold used for drift governs P3 retained-assignment admission; below it, the system skips the local reshuffle rather than applying stale evidence.

Pool mining and Tier-0 admission are narrower than ordinary selected-intent display scoping: mining, the initial adjustment read, and the row-locked write recheck all require `opportunities.detection.triggeredBy` to equal the answered intent, an eligible recipient actor, and a live pool status. The actor-level `actors[].intent` fallback remains available for historical Radar reads but cannot admit answer-driven metadata writes. Canonical intent refinement intentionally continues to target only `questions.detection.sourceId`, and newborn opportunities stamp the same recipient+intent provenance only when their exact `detection.triggeredBy` matches.

For an active intent, a substantive answer also runs through the same canonical intent-update graph used by chat refinements; it never mechanically appends answer text or creates a premise. Refinement completes before the debounced discovery rerun is scheduled, and a refinement failure is isolated so Tier-1 discovery and interview chaining can continue. “Both matter” alone does not refine the intent, while accompanying free text can. While the intent is paused, the pending question remains answerable and the immediate deterministic re-ranking can still apply, but refinement, rerun, and any next question are withheld.

Resolved axes are durable semantic novelty references when `POOL_QUESTIONS_MODE=on`. Each generated question discriminator retains its internal embedding and embedding-model id, and answered or dismissed axes—including “Both matter”—suppress semantically equivalent future questions while their full normalized intent payload+summary fingerprint is current. Reuse requires both the current embedding model and vector dimensions; mismatches and legacy rows fall back to canonical axis text. Shadow-only mining neither looks up resolved axes nor retains vectors, though ordinary text-reference novelty scoring still embeds as needed. A pool answer whose canonical refinement actually applies is stamped directly from the returned updated payload plus the pre-update summary, so a concurrent external edit cannot be stamped accidentally. A later material payload/summary edit voids pending stale questions, invalidates resolved-axis dedup so an answered axis may be asked once under the new fingerprint, and marks exact recipient+intent `poolAdjustments` as `stale: true`; stale adjustments remain auditable but cannot rank or demote. Legacy unscoped or malformed entries are preserved. Pause/resume does not invalidate the fingerprint. For legacy snapshots without a fingerprint, normalized snippets shorter than the 160-character cap require exact equality; only snippets exactly 160 characters long may prefix-match a longer current intent. Pending exact labels always deduplicate. The Personal Agent narrates the immediate adjustment and later refresh using count-only templates; cards expose only the user's selected side in a muted deprioritization chip, never embeddings, evaluator reasoning, or internal pool snapshots.

When both `POOL_QUESTIONS_MODE=on` and `POOL_QUESTIONS_STAMP_NEWBORN=on`, genuinely new opportunities from owned, active, exact-trigger intent discovery inherit still-current answered preferences immediately before insertion. One fixed-axis classifier call batches the call-local candidates using the same bounded public context as mining; it never receives the user's chosen sides. Only answers with an exact current full payload+summary fingerprint are eligible. Verified chosen, other, and unknown assignments receive the same `1.0`, `0.6`, and `0.9` factors (cumulative floor `0.3`), deterministic template details, and `questionId` provenance. Raw classifier evidence and evaluator reasoning are not added to persisted adjustment metadata or signals. Callback failure, lifecycle/fingerprint drift, or unsafe output length/order fails open to the original insert payload. Dedup reactivations/upgrades, context-only/ad-hoc discovery, introductions, on-behalf-of, enrichment, and manual paths are excluded.

When `POOL_QUESTIONS_PUSH=on`, a pending owner question may proactively reach the Personal Agent only if pool-question mode and negotiator chat are also available. Admission is transactional and self-throttling: internal asked VoI must be strictly above `0.6 × 1.15^dismissalStreak`, pool size must be at least 8, the active/nonarchived intent must not have been visited after the question was created, only one claim is allowed per recipient+intent+pool-refresh cycle, and each recipient may claim at most two per UTC day. Dismissed legacy/pull pool questions participate in the streak; the latest later answer resets it. Claims—not successful deliveries—consume the daily budget so concurrency and terminal delivery failures cannot overrun it.

A successful push has exactly two surfaces: the delivered row joins the Personal Agent sidebar count, and one deterministic assistant line is inserted into the stable unscoped negotiator DM with a link to `/i/:intentId`. It never creates an intent-pinned session, global Questions row, injected unscoped card, toast, modal, or separate notification. The DM remains historical after resolution; the badge clears naturally because counts require pending status and the authoritative internal `pushedAt` delivery stamp. Internal pool snapshots and push claim/delivery metadata are stripped from REST and MCP payloads.

Pool answers do **not** create premises. The canonical intent-refinement graph already incorporates substantive answers into the owned intent, so creating a premise would duplicate authority and trigger unrelated premise cascades.

This behavior is independently gated: `POOL_QUESTIONS_MINING` controls shadow-only scoring, `POOL_QUESTIONS_MODE` controls durable question generation/application, `POOL_QUESTIONS_PUSH` controls proactive delivery, `POOL_QUESTIONS_STAMP_NEWBORN` controls pre-insert preference stamping, and `POOL_QUESTIONS_RANKING` controls whether fresh stored adjustments affect read-time ordering. With ranking off, feed ordering remains unchanged. The question TTL remains seven days.

---

## Post-Discovery Recovery Refinement

After an authoritative from-intent or exact-intent asynchronous discovery run succeeds, an active owned intent may receive one additional ordinary intent-refinement question when the owner has no currently actionable exact-trigger opportunity. Actionability uses the same canonical read and role rules as the home feed: only role-eligible `latent` and `pending` rows suppress recovery; `draft`, `negotiating`, `stalled`, `accepted`, `rejected`, and `expired` history does not.

Recovery remains private implementation metadata rather than a new user-facing question type. Rows persist and render as `mode='intent'`, `sourceType='intent'`, and `sourceId=intentId`, then answers follow the existing canonical intent-update, embedding/HyDE, and rediscovery lifecycle. Pool-discovery questions are independent and may coexist with recovery refinement.

Generation is source-grounded. With no safely validated prior negotiation evidence, the model receives only the signal payload/summary and the owner's global context. Rejected negotiation history may influence the missing axis only as a bounded aggregate count after exact-trigger, bilateral-participant, capture-time fingerprint, completed-task, network-provenance, and single no-opportunity-artifact validation. IDs, identities, profiles, networks, transcripts/turns, outcome reasoning, evaluator reasoning, match reasons, candidate snapshots, and event/community context never enter generation or question persistence. Unsafe or unhelpful output produces no row.

Cadence is one recovery question per exact recipient, intent, and normalized payload+summary fingerprint across every status and expiry state. Advisory and row locks recheck ownership, active lifecycle, fingerprint, and canonical exact-trigger actionability immediately before insertion; an expression unique index is the final concurrent-worker guard. A material edit permits one new question and system-voids stale pending recovery rows. Answer admission repeats the owner/lifecycle/fingerprint check atomically and the intent answer handler checks the expected fingerprint again before canonical mutation, so delayed answers cannot update a drifted or paused signal.

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

- **onCreated**: Fired when a new intent is created; its handler enqueues from-intent discovery and triggers opportunity maintenance.
- **onPaused**: Fired only when an intent actually changes to **PAUSED**. It records the lifecycle transition without deleting existing workspace state.
- **onResumed**: Invoked for **ACTIVE** requests, including idempotent retries. Its async handler enqueues the lifecycle-version-deduplicated from-intent discovery job, and the status request waits for that enqueue acknowledgement. A failed enqueue returns `enqueue_failed`; a changed resume is narrowly compensated back to **PAUSED** when still at the same lifecycle version.
- **onArchived**: Fired after archive handling removes intent-network assignments, expires opportunities that reference the intent, and enqueues HyDE deletion; its handler triggers opportunity maintenance.
