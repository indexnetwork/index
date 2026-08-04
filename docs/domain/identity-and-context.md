---
title: "Identity and Context"
type: domain
tags: [identity, context, enrichment, premises, discovery]
created: 2026-03-26
updated: 2026-06-19
---

# Identity and Context

A user is represented by two things: their **identity** -- the core facts about who they are (name, bio, location) stored directly on the `users` row -- and their **context** -- a synthesized prose-plus-embedding projection of their premises, stored in `user_contexts`. In Index Network's theoretical framework, these represent **constitutive facts**: they describe what is true about a person, as opposed to intents (commissive acts) which describe what a person wants.

Identity and context serve two purposes: they provide grounding for evaluating intents (authority and sincerity scoring depend on who the user is), and they participate directly in discovery (people can be found by who they are, not just what they want).

---

## Identity

Identity is the durable, structured information about a user, persisted on the `users` table:

- **name**: The user's full name
- **bio**: A professional summary (2-3 sentences), sourced from `users.intro`. This is public-facing and must not contain contact identifiers (email, phone, physical address, government ID).
- **location**: Inferred location (City, Country) or "Remote"

There is no longer a dedicated `user_profiles` table -- it was dropped in the profile-removal epic (WS8, IND-365, migration `0084_drop_user_profiles`). Identity reads return only `name`/`bio`/`location` plus the synthesized context paragraph. The historical discrete `skills[]`/`interests[]` arrays are **no longer persisted or returned** by any read path; their content now lives in the user's premises and their synthesized `user_contexts` representation.

---

## Context

Context is the synthesized representation of a user, derived from their premises and stored in `user_contexts`:

- A **global** context row (`networkId = null`) -- the network-agnostic identity paragraph that replaces the old profile document. It is enforced unique per user by the partial `user_contexts_user_global_uniq` index and is always (re)built from active premises, even when the user belongs to no non-personal networks.
- Zero or more **per-network** context rows -- network-lensed paragraphs generated for each network the user belongs to.

Each context row carries its own vector embedding (and, for per-network rows, HyDE documents). Contexts are generated during enrichment and regenerated whenever the user's premises change.

---

## Premises Are the Source of Truth

A user's identity and context are both **projections** of their premises -- composable identity assertions ("I am a climate-tech founder", "I'm raising Series A") that each carry their own vector embedding. Rather than one monolithic document, a user has many premises that can be individually created, retracted, and expired. Premise lifecycle events (create, update, retract, expire) trigger automatic context regeneration via the `UserContextQueue`.

Discovery searches the premise embedding space rather than a single monolithic vector, enabling more precise and granular matching. Premises also participate directly in opportunity discovery through premise-to-premise similarity search.

---

## Enrichment

The synthesis pipeline that produces identity and context from raw data is called **enrichment**. The enrichment graph (`enrichment/enrichment.graph.ts`, nodes `check_state` → `scrape` → `decompose_premises` / `auto_generate`) manages the full lifecycle. Raw data can come from several sources.

### Web scraping

When a user connects social accounts or provides URLs (LinkedIn, GitHub, personal website), the system can scrape publicly available information and feed it to enrichment. Networks may opt into `profileEnrichment: 'consent_required'`, in which case automatic member-enrichment jobs run public lookup only after `privacy.publicProfileLookup.granted === true`; `profileEnrichment: 'disabled'` blocks network-triggered public enrichment entirely. Missing policy means `auto` for backward compatibility.

> The `profileEnrichment` network policy and the `publicProfileLookup` consent key are persisted/serialized identifiers and are retained as-is.

### Event/import seeds and onboarding drafts

Master-key `/signup` and CSV import provision the user, scoped agent, and membership immediately, but rich payloads (`name`, `bio`, `location`, socials) are staged under `users.onboarding.profileSeeds` instead of being written to active identity fields. Privacy-first clients first record two independent consent decisions under `users.onboarding.privacy`: whether event/EdgeOS-provided data may be used, and whether public lookup may run. The onboarding-safe `preview_user_profile` tool can use staged seeds only after EdgeOS/import consent, synthesizes a draft without persisting it, and `confirm_user_profile` saves only the approved draft or approved correction text.

### User-directed updates

Users can request changes to their identity through the chat interface. The enrichment generator receives the existing identity plus the user's request and applies the requested changes while preserving everything else.

### Privacy safeguards

Enrichment is explicitly instructed to never include email addresses, phone numbers, physical addresses, government IDs, or other contact identifiers in the bio or context paragraph, even if they appear in the raw data. Identity describes the person professionally without including ways to contact them.

---

## Context-Based Discovery

Identity and context participate in discovery through premises. When raw data is enriched, it is decomposed into premises -- composable assertions that each carry their own vector embedding. Discovery searches the premise embedding space rather than a single monolithic vector.

When a user's intent triggers discovery, the HyDE system generates hypothetical documents that describe the kind of person who would match that intent, then searches the premise embedding space for similar assertions. Candidates found this way are "found by who they are" and are typically assigned the agent (helper) role.

The opportunity graph also uses contexts for **context-to-intent discovery**: it loads a user's contexts, then searches for matching intents via `searchIntentsByContextEmbedding()` (or HyDE-enhanced context embeddings). Discovery runs on **context-to-intent + premise similarity**; results are merged via `mergeStrategyCandidates()`. (The legacy profile-HyDE discovery strategy was retired in WS10, IND-367.)

---

## Enrichment Lifecycle

The enrichment graph manages the full lifecycle:

1. **Check** (`check_state`): Determine whether the user needs enrichment, keyed on the presence of ACTIVE premises
2. **Consent/draft (onboarding clients)**: Record EdgeOS import and public lookup decisions, then build a non-persisted draft for approval
3. **Scrape/enrich** (`scrape`): Gather public data only when the network policy allows it and the user has consented where required
4. **Decompose** (`decompose_premises`): Break the enrichment input into premises with individual vector embeddings
5. **Context/HyDE refresh**: Premise changes enqueue `UserContextQueue`, which regenerates the user's `user_contexts` representation (global + per-network) plus their embeddings and HyDE documents

Premise creation is the terminal effect, and the user's representation is the regenerated `user_contexts`, not a persisted profile document.

---

## Relationship to Other Concepts

- **Intents** depend on identity: felicity conditions (authority, sincerity) are scored against the user's identity and context. An identity claiming "Senior ML Engineer" gives authority to an intent about seeking ML collaborators.
- **Opportunities** reference identity: the evaluator receives identity/context data for both the source and candidate to assess fit.
- **HyDE** searches premises as the person-level corpus: when searching for people (as opposed to searching for intents), the HyDE system generates hypothetical documents and searches the premise embedding space.
- **Premises** decompose a user's identity into composable self-descriptions. The user's synthesized representation lives in `user_contexts` (a global `networkId = null` row plus per-network rows) and is regenerated from active premises by the `UserContextQueue`. Premise lifecycle events trigger automatic context regeneration, and premises participate directly in opportunity discovery through premise-to-premise similarity search.
