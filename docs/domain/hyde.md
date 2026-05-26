---
title: "HyDE (Hypothetical Document Embeddings)"
type: domain
tags: [hyde, semantic-search, lenses, embeddings, discovery, caching]
created: 2026-03-26
updated: 2026-03-26
---

# HyDE (Hypothetical Document Embeddings)

HyDE is the semantic search strategy that powers discovery in Index Network. Instead of directly matching a user's intent or profile against the database, the system generates a **hypothetical document** describing the ideal match, embeds that document, and searches for real entries that are similar to the hypothesis.

This bridging technique solves a fundamental problem in discovery: what a user says they want ("Looking for a co-founder") is written in the seeker's voice, but the ideal match ("Senior engineer with 10 years experience building distributed systems, interested in co-founding") is written in the match's voice. HyDE bridges this gap by generating the match-side document before searching.

---

## Why HyDE Exists

Direct embedding comparison between a search query and candidate documents often fails because:

1. **Voice mismatch**: A seeker describes what they want; a candidate describes what they are or offer. These are fundamentally different linguistic registers.
2. **Implicit context**: "Looking for investors" implies a startup founder seeking VC funding, but the query text alone does not contain investor-side vocabulary.
3. **Specificity gap**: A short intent ("Need ML collaborators") must match against rich profile descriptions with many dimensions.

HyDE closes these gaps by generating a document in the target's voice that captures the implied context, making the embedding comparison meaningful.

---

## Dynamic Lens Inference

The system uses **lenses** to determine what kinds of hypothetical documents to generate. A lens is a search perspective -- a specific angle from which to look for matches.

Previously, the system used a fixed set of hardcoded strategies (mirror, reciprocal, mentor, investor, collaborator, hiree). These have been replaced by dynamic lens inference: an LLM agent (the Lens Inferrer) analyzes the source text and optional profile context to produce 1-N specific, contextually appropriate lenses.

### How lenses work

Given a source text like "Looking for investors for my DePIN startup", the Lens Inferrer might produce:

1. **"Early-stage crypto infrastructure VC"** (corpus: profiles) -- Search user profiles for people who match this description
2. **"Angel investor interested in DePIN/blockchain infrastructure"** (corpus: profiles) -- A different investor profile angle
3. **"Seeking startups to invest in, focused on decentralized infrastructure"** (corpus: intents) -- Search user intents for complementary goals

Each lens specifies:
- **label**: A specific, domain-aware description (not generic like "investor" but specific like "early-stage crypto infrastructure VC")
- **corpus**: Whether to search user profiles or user intents
- **reasoning**: Why this perspective is relevant (for logging and tracing)

### Guidelines for lens inference

- Be specific and domain-aware. "Early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need.
- When the source mentions a specific location, incorporate it into lens descriptions to improve retrieval quality.
- Generate only perspectives that add distinct search value -- no repeated similar angles.

---

## Target Corpus

Each lens targets one of two corpora:

### Profiles corpus

Search user profiles (bios, expertise, backgrounds). Used when looking for a **type of person** who could help. The HyDE generator writes a hypothetical professional biography for someone matching the lens description.

Prompt pattern: "Write a professional biography for someone who could fulfill this need: [source text]. Focus on the specific expertise described by: [lens]."

### Intents corpus

Search user intents (stated goals, needs, aspirations). Used when looking for someone with a **complementary goal**. The HyDE generator writes a hypothetical goal statement for someone matching the lens.

Prompt pattern: "Write a goal or aspiration statement for someone who is: [lens]. This person's needs would complement: [source text]."

---

## The Full Pipeline

HyDE generation follows this pipeline for each source (intent, profile, or query):

### 1. Lens inference

The Lens Inferrer analyzes the source text (and optional profile context) and produces up to 3 lenses, each tagged with a target corpus.

### 2. Cache check

For each lens, the system checks whether a valid HyDE document already exists:
- **Redis cache** (fast, ephemeral): Checked first for recently generated documents
- **PostgreSQL** (`hyde_documents` table): Checked second for persisted documents with their embeddings

Cache keys are built from (sourceType, sourceId, strategy/lens, targetCorpus). A unique index on these columns prevents duplicate entries.

### 3. Generation

For cache misses, the HyDE Generator agent produces a hypothetical document in the target corpus voice. The document is written in first person as the hypothetical match, is concrete and specific for good vector similarity, and is kept to a few sentences or one short paragraph.

### 4. Embedding

The generated text is embedded using the same 2000-dimensional text-embedding-3-large model used for intents and premises, producing a vector that lives in the same embedding space.

### 5. Caching

The generated document and its embedding are stored:
- In Redis with a default TTL of 1 hour (3600 seconds) for fast retrieval during the current discovery session
- In PostgreSQL's `hyde_documents` table with an optional `expiresAt` timestamp for longer-term persistence

### 6. Search

The HyDE embedding is used to perform cosine similarity search against the target corpus (intent embeddings or premise embeddings) using pgvector's HNSW index. Results are candidate users ranked by similarity.

---

## HyDE Source Types

HyDE documents can be generated from three source types:

| Source | When | Purpose |
|---|---|---|
| **intent** | When an intent is created or updated | Find people whose intents or premises complement this intent |
| **query** | When a user asks the chat agent to find someone | Find people matching the search query |

---

## Cache-Aware Architecture

The caching strategy is designed to minimize redundant LLM calls while keeping results fresh:

- **Within a session**: Multiple searches against the same intent reuse cached HyDE documents from Redis, avoiding regeneration.
- **Across sessions**: PostgreSQL stores embeddings that persist beyond Redis TTL. If a user's intent has not changed, the stored HyDE embedding can be reused without regeneration.
- **Staleness management**: HyDE documents have expiration timestamps. When an intent is updated, associated HyDE documents are invalidated and regenerated on next use.
- **Deduplication**: The unique index on (sourceType, sourceId, strategy, targetCorpus) prevents multiple identical HyDE documents from accumulating.

---

## Relationship to Discovery

HyDE is the bridge between intent expression and candidate retrieval in the opportunity discovery pipeline:

1. User creates an intent
2. Lens Inferrer determines search perspectives
3. HyDE Generator produces hypothetical documents for each lens
4. Vector search finds candidates similar to the hypotheticals
5. Opportunity Evaluator scores the candidates
6. Negotiation validates high-scoring matches
7. Opportunities are persisted and surfaced to users

Without HyDE, the system would rely on direct intent-to-intent or intent-to-premise embedding comparison, which suffers from the voice mismatch problem described above.
