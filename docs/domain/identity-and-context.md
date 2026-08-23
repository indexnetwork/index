---
title: "Identity and Context"
type: domain
tags: [identity, context, enrichment, premises, discovery]
created: 2026-03-26
updated: 2026-08-23
---

# Identity and Context

A user is represented by **identity** — name, bio (`users.intro`), and location on the `users` row — and **premises**: composable first-person assertions that carry embeddings and drive discovery. There is no `user_profiles` table and no `user_contexts` table (dropped in migration `0142`).

Identity grounds felicity scoring for intents. Premises are the semantic discovery corpus.

---

## Identity

Identity is persisted on `users`:

- **name**: full name
- **bio**: professional summary from `users.intro` (no contact identifiers)
- **location**: city/country or "Remote"

Reads build a thin `UserIdentity` DTO from `users` via `buildProfileFromUser`. Historical `skills[]` / `interests[]` arrays are gone; that content lives in premises.

---

## Premises Are the Source of Truth

Premises are atomic self-descriptions ("I am a climate-tech founder") with embeddings, provenance, and lifecycle (ACTIVE / RETRACTED / EXPIRED). Free text — chat, bio edits, imports — is turned into premises through `PremiseGraphFactory` `decompose` mode.

Discovery searches premise embeddings (and intent embeddings), not a monolithic profile vector.

---

## Public research prefill (not persistence)

`research_profile` (MCP/REST tool) and `POST /api/enrichment/enrich` run Parallel public lookup and return a **suggested** profile for review. They do not persist. Onboarding and settings persist identity through profile-save REST endpoints; approved text decomposes into premises.

The enrichment graph (`EnrichmentGraphFactory`) is **query-only**: it reports whether ACTIVE premises exist so intent tools can gate inference.

---

## Context reads in graphs

`getUserContext(userId, networkId)` still exists on database ports for negotiation and intent graphs. After `user_contexts` removal it synthesizes a short paragraph from `users` name/bio/location — a compatibility shim, not a stored embedding corpus.

`searchIntentsByContextEmbedding` remains on adapters but is unused by production graphs while context embeddings are empty.

---

## Relationship to other concepts

- **Intents** use identity for felicity scoring.
- **Opportunities** use identity and premises for evaluation.
- **HyDE** searches premises as the person-level corpus.
- **Opportunity enricher** (`opportunity.enricher.ts`) uses `detection.source: 'enrichment'` for a different meaning: merging duplicate opportunity rows, not profile research.
