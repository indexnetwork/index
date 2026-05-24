# Premises: Composable Profiles for Index Network

**Date:** 2026-05-24
**Status:** Draft

## Ontological Position

Premises are the third first-class entity in the Index Network protocol's discovery triad:

| Entity | Philosophical role | Speech act class | Question answered |
|--------|-------------------|-----------------|-------------------|
| **Premise** | Condition of possibility | Declaration / Assertive | "What is true about this person?" |
| **Intent** | Act of desire | Directive / Commissive | "What does this person want?" |
| **Opportunity** | Emergent conclusion | (derived, not uttered) | "What becomes possible between people?" |

The relationship is logical implication: premises + intents, when composed across agents within shared indexes, yield opportunity conclusions. When a premise is retracted or expires, any opportunity that depended on it must be re-evaluated. The conclusion may no longer follow from the remaining premises.

### Two Tiers

- **Assertive premises**: Relatively stable identity claims. "I am a climate-tech founder." "I hold a PhD in computational biology." High authority, low volatility.
- **Contextual premises**: Temporal, situational. "I'm raising Series A." "I'm relocating to Berlin in Q3." These carry validity windows and their expiry propagates through the opportunity graph.

Both tiers are propositions. Both carry embeddings, speech-act analysis, and index membership. The tier distinction is metadata (`volatile: boolean`), not a structural fork.

### Relationship to Implicit Intents

What was previously called "implicit intents" (the `implicitIntents` JSON column on `user_profiles`) is better modeled as premises. "This person works in climate-tech" is not an intent (a desire); it is a premise (a condition). Premises absorb and replace the implicit intents concept. The `implicitIntents` column is deprecated.

## Data Model

### Typed Interfaces

Following the opportunity pattern of JSONB composable sub-objects:

```typescript
interface PremiseAssertion {
  text: string;
  tier: 'assertive' | 'contextual';
  summary?: string;
}

interface PremiseProvenance {
  source: 'explicit' | 'enrichment' | 'integration' | 'onboarding';
  sourceId?: string;
  confidence: number;  // 0-1
  timestamp: string;
}

interface PremiseAnalysis {
  speechActType: 'DECLARATIVE' | 'ASSERTIVE';
  felicityAuthority: number;  // 0-100
  felicitySincerity: number;  // 0-100
  felicityClarity: number;    // 0-100
  semanticEntropy: number;    // 0 (specific) to 1 (vague)
}

interface PremiseValidity {
  validFrom?: string;   // ISO-8601, null = always
  validUntil?: string;  // ISO-8601, null = indefinite
  volatile: boolean;
}
```

### `premises` Table

```sql
CREATE TYPE premise_status AS ENUM ('ACTIVE', 'RETRACTED', 'EXPIRED');

CREATE TABLE premises (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES users(id),
  assertion   JSONB NOT NULL,   -- PremiseAssertion
  provenance  JSONB NOT NULL,   -- PremiseProvenance
  analysis    JSONB,            -- PremiseAnalysis (populated by premise graph)
  validity    JSONB NOT NULL,   -- PremiseValidity
  embedding   VECTOR(2000),
  status      premise_status NOT NULL DEFAULT 'ACTIVE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  retracted_at TIMESTAMPTZ
);

CREATE INDEX premises_user_id_idx ON premises(user_id);
CREATE INDEX premises_status_idx ON premises(status);
CREATE INDEX premises_embedding_idx ON premises
  USING hnsw (embedding vector_cosine_ops);
```

### `premise_networks` Junction Table

Relational (not JSONB) because index membership is a first-class query path.

```sql
CREATE TABLE premise_networks (
  premise_id     TEXT NOT NULL REFERENCES premises(id),
  network_id     TEXT NOT NULL REFERENCES networks(id),
  relevancy_score NUMERIC,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (premise_id, network_id)
);

CREATE INDEX premise_networks_network_id_idx ON premise_networks(network_id);
```

### Profile as Materialized View

The existing `user_profiles` table remains but becomes a computed projection. When premises change, the profile graph re-aggregates:

1. Collect all ACTIVE premises for the user
2. Synthesize identity (name, bio, location) from assertive premises
3. Synthesize narrative (context) from contextual premises
4. Extract attributes (skills, interests) from all premises
5. Generate a composite embedding
6. Write to `user_profiles`

Existing profile consumers (UI, MCP tools, opportunity evaluator) are unaffected.

## Event System and Cascade Re-evaluation

### Premise Events

```
PremiseEvents
  onCreated(premiseId, userId, payload)
  onUpdated(premiseId, userId, payload)
  onRetracted(premiseId, userId, payload)
  onExpired(premiseId, userId, payload)
```

### Cascade Flow

When `onRetracted` or `onExpired` fires:

1. **Find affected opportunities**: Query all opportunities where the user is an actor.
2. **Re-evaluate each**: Run the opportunity evaluator with the user's current premise set (minus the dissolved premise). The evaluator produces a new score.
3. **Update or dissolve**:
   - `draft` opportunities: remove (no one has acted on them yet)
   - `pending` opportunities: transition to `stalled` with reasoning
   - `accepted` opportunities: transition to `stalled` (parties already connected, but the system signals the basis shifted)

Uses the existing BullMQ pattern: premise events enqueue a `premise-cascade` job with retries and exponential backoff.

### Profile Regeneration

Any premise event for a user also enqueues a `profile-regen` job. This re-runs the profile graph in an aggregate mode that builds `user_profiles` from active premises.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `create_premise` | Establish a new premise. Accepts assertion text, tier, validity window. Runs through the premise graph for analysis, embedding, and auto-assignment to indexes. |
| `read_premises` | Query premises. Modes: no args = own; `userId` = specific user; `networkId` = all in index; `query` = semantic search. |
| `update_premise` | Modify assertion text, validity, or volatile flag. Triggers re-embedding, re-analysis, profile regeneration, and cascade re-evaluation. |
| `retract_premise` | Retract (soft-delete) a premise. Sets status to RETRACTED, fires `onRetracted`, triggers cascade. Distinct from delete: the premise existed, it just no longer holds. |

## Discovery Integration

### New Search Path

The opportunity discovery graph gains a fourth path:

- **Path A**: Intent-to-intent matching (existing)
- **Path B/C**: Profile-similarity matching (existing, now uses premise-derived profile embedding)
- **Path D**: Premise-to-premise matching. Searches the premise corpus for complementary premises across shared indexes.

### Opportunity Actor Enhancement

`OpportunityActor` gains an optional `premise` field:

```typescript
interface OpportunityActor {
  networkId: Id<'networks'>;
  userId: Id<'users'>;
  intent?: Id<'intents'>;
  premise?: Id<'premises'>;  // Which premise grounded this match
  role: string;
  approved?: boolean;
  actedAt?: string;
}
```

This makes cascade dissolution traceable: "which premise did this opportunity depend on?"

## Migration Phases

### Phase 1: Schema and Infrastructure

Add `premises` table, `premise_networks` junction, `premise_status` enum. Additive only, no existing data changes.

### Phase 2: Premise Graph and MCP Tools

Build in `packages/protocol/src/premise/`: state, graph, generator (analysis + embedding), tools. Add `aggregate` mode to the profile graph.

### Phase 3: Events and Cascade

Add `PremiseEvents`, the `premise-cascade` queue job, profile regeneration pipeline integration. Update the opportunity evaluator to track premise references in actors.

### Phase 4: Discovery Integration

Add premise-to-premise search path (Path D) to the opportunity discovery graph. Update the opportunity presenter to reference premises in explanations.

### Phase 5: Deprecation

Mark `user_profiles.implicitIntents` as deprecated. Profile becomes read-only for direct writes; all mutations go through premises.

## Linguistic Analysis Framework

Premises use the same Searle-derived framework as intents, adapted for self-descriptions:

- **Speech act type**: DECLARATIVE ("I am X" -- constitutive) or ASSERTIVE ("I have done Y" -- descriptive)
- **Felicity authority**: Does this person have standing to assert this? High for verifiable claims.
- **Felicity sincerity**: Is this self-description genuine vs. aspirational?
- **Felicity clarity**: How specific and matchable is this premise? Low entropy = high clarity.
- **Semantic entropy**: Embedding uncertainty. Vague premises match too broadly.

These are computed by the premise graph's analysis step, using the same verifier pattern as intents.
