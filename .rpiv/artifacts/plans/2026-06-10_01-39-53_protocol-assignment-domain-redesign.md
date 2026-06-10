---
date: 2026-06-10T01:39:53+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Protocol assignment domain redesign"
tags: [plan, protocol, premises, intents, opportunities, networks]
status: ready
parent: ".worktrees/docs-protocol-assignment-domain-redesign/.rpiv/artifacts/designs/2026-06-09_23-11-22_protocol-assignment-domain-redesign.md"
phase_count: 6
phases:
  - { n: 1, title: "Shared assignment contract" }
  - { n: 2, title: "Persist assignment metadata" }
  - { n: 3, title: "Apply shared assignment policy" }
  - { n: 4, title: "One premise lifecycle for profile answers" }
  - { n: 5, title: "Typed opportunity evidence" }
  - { n: 6, title: "End-to-end verification surface" }
last_updated: 2026-06-10T01:39:53+0300
last_updated_by: Yankı Ekin Yüksel
---

# Protocol assignment domain redesign Implementation Plan

## Overview

This design introduces a shared protocol-level assignment contract for premises and intents, backed by persisted assignment metadata and typed opportunity evidence. The chosen approach keeps protocol/backend boundaries intact: protocol owns DTOs, pure policy helpers, graph state, and evaluator evidence; backend owns Drizzle schema, SQL migrations, adapter persistence, queues, and event wiring.


The phase boundaries below are inherited 1:1 from the design artifact's `## Slices` section. Success Criteria are copied verbatim from the matching design slices.

## Desired End State

```ts
// Global creation evaluates all memberships, regardless of network_members.autoAssign.
await premiseGraph.invoke({
  userId,
  assertionText: "I build AI developer tools",
  tier: "assertive",
  operationMode: "create",
});

// Network-scoped creation evaluates only that network.
await intentQueue.addGenerateHydeJob({ intentId, userId, networkScopeId });

// Assignment rows retain explainability metadata.
await db.assignIntentToNetwork(intentId, networkId, score, {
  resourceType: "intent",
  mode: "automatic",
  scope: "network",
  policy: "unified-threshold-v1",
  threshold: 0.7,
  rawScores: { indexScore: 0.82, memberScore: 0.76 },
  promptPresence: "both",
  reason: "Intent matched both network prompt and member prompt.",
});

// Opportunity evaluation receives typed evidence instead of only matchedVia/ragScore.
const entity: EvaluatorEntity = {
  userId,
  profile,
  networkId,
  evidence: [{ kind: "premise_similarity", candidatePremiseId, sourcePremiseId, assertionText, score }],
};
```


## What We're NOT Doing

- Frontend/operator UI for visualizing assignment/evidence metadata.
- A separate network policy UI or prompt editor.
- A complete storage unification of `premise_networks` and `intent_networks` into one assignment table.
- Prompt-only tuning without domain-contract changes.
- Source implementation in this design step; implementation is for `/skill:implement` after `/skill:plan`.


---

## Phase 1: Shared assignment contract

### Overview

Implements Slice 1 from the approved design. Files: `packages/protocol/src/shared/schemas/network-assignment.schema.ts`, `packages/protocol/src/shared/assignment/network-assignment.policy.ts`, `packages/protocol/src/shared/assignment/tests/network-assignment.policy.spec.ts`, `packages/protocol/src/index.ts`.

### Changes Required:

#### 1. packages/protocol/src/shared/schemas/network-assignment.schema.ts

**File**: `packages/protocol/src/shared/schemas/network-assignment.schema.ts`  

**Changes**: shared DTOs for network assignment decisions, metadata, and opportunity evidence.

Purpose: shared DTOs for network assignment decisions, metadata, and opportunity evidence.
```ts
/**
 * Shared assignment and opportunity-evidence DTOs.
 *
 * These schemas are graph-agnostic protocol contracts. Protocol graphs and
 * backend workers may use the inferred TypeScript types, while backend storage
 * remains responsible for schema/SQL details.
 */
import { z } from "zod";

export const NetworkAssignmentResourceTypeSchema = z.enum(["premise", "intent"]);
export type NetworkAssignmentResourceType = z.infer<typeof NetworkAssignmentResourceTypeSchema>;

export const NetworkAssignmentModeSchema = z.enum(["automatic", "manual_override"]);
export type NetworkAssignmentMode = z.infer<typeof NetworkAssignmentModeSchema>;

export const NetworkAssignmentScopeSchema = z.enum(["global", "network"]);
export type NetworkAssignmentScope = z.infer<typeof NetworkAssignmentScopeSchema>;

export const NetworkAssignmentPromptPresenceSchema = z.enum(["none", "index", "member", "both"]);
export type NetworkAssignmentPromptPresence = z.infer<typeof NetworkAssignmentPromptPresenceSchema>;

export const NetworkAssignmentPolicySchema = z.enum(["unified-threshold-v1"]);
export type NetworkAssignmentPolicy = z.infer<typeof NetworkAssignmentPolicySchema>;

export const NetworkAssignmentRawScoresSchema = z.object({
  indexScore: z.number().min(0).max(1).optional(),
  memberScore: z.number().min(0).max(1).optional(),
});
export type NetworkAssignmentRawScores = z.infer<typeof NetworkAssignmentRawScoresSchema>;

export const NetworkAssignmentMetadataSchema = z.object({
  resourceType: NetworkAssignmentResourceTypeSchema,
  mode: NetworkAssignmentModeSchema,
  scope: NetworkAssignmentScopeSchema,
  policy: NetworkAssignmentPolicySchema,
  threshold: z.number().min(0).max(1),
  promptPresence: NetworkAssignmentPromptPresenceSchema,
  rawScores: NetworkAssignmentRawScoresSchema.optional(),
  finalScore: z.number().min(0).max(1),
  assigned: z.boolean(),
  reason: z.string().optional(),
  evaluator: z.string().optional(),
  source: z.string().optional(),
  createdAt: z.string().optional(),
});
export type NetworkAssignmentMetadata = z.infer<typeof NetworkAssignmentMetadataSchema>;

export const OpportunityEvidenceKindSchema = z.enum([
  "query_intent",
  "query_premise",
  "premise_similarity",
  "context_to_intent",
  "profile",
]);
export type OpportunityEvidenceKind = z.infer<typeof OpportunityEvidenceKindSchema>;

export const OpportunityEvidenceSchema = z.object({
  kind: OpportunityEvidenceKindSchema,
  networkId: z.string(),
  score: z.number().min(0).max(1).optional(),
  lens: z.string().optional(),
  discoverySource: z.enum(["query", "premise-similarity", "context-to-intent"]).optional(),
  matchedStrategies: z.array(z.string()).optional(),
  sourcePremiseId: z.string().optional(),
  candidatePremiseId: z.string().optional(),
  candidateIntentId: z.string().optional(),
  sourceContextId: z.string().optional(),
  payload: z.string().optional(),
  summary: z.string().optional(),
  assertionText: z.string().optional(),
});
export type OpportunityEvidence = z.infer<typeof OpportunityEvidenceSchema>;
```


#### 2. packages/protocol/src/shared/assignment/network-assignment.policy.ts

**File**: `packages/protocol/src/shared/assignment/network-assignment.policy.ts`  

**Changes**: pure assignment policy helper for prompt classification, score combination, scope, and metadata construction.

Purpose: pure assignment policy helper for prompt classification, score combination, scope, and metadata construction.
```ts
import type {
  NetworkAssignmentMetadata,
  NetworkAssignmentMode,
  NetworkAssignmentPromptPresence,
  NetworkAssignmentRawScores,
  NetworkAssignmentResourceType,
  NetworkAssignmentScope,
} from "../schemas/network-assignment.schema.js";

/** Centralized default for unified premise/intent network assignment. */
export const DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD = 0.7;

export interface PromptPresenceInput {
  indexPrompt?: string | null;
  memberPrompt?: string | null;
}

export interface ResolveAssignmentNetworkScopeArgs {
  memberships: string[];
  networkScopeId?: string;
}

export interface BuildNetworkAssignmentDecisionArgs extends PromptPresenceInput {
  resourceType: NetworkAssignmentResourceType;
  mode: NetworkAssignmentMode;
  scope: NetworkAssignmentScope;
  rawScores?: NetworkAssignmentRawScores | null;
  threshold?: number;
  evaluator?: string;
  source?: string;
  reason?: string;
  createdAt?: string;
}

export interface NetworkAssignmentDecision {
  assigned: boolean;
  finalScore: number;
  metadata: NetworkAssignmentMetadata;
}

/**
 * Classifies whether a network/member prompt pair can filter a resource.
 */
export function classifyPromptPresence(input: PromptPresenceInput): NetworkAssignmentPromptPresence {
  const hasIndex = !!input.indexPrompt?.trim();
  const hasMember = !!input.memberPrompt?.trim();
  if (hasIndex && hasMember) return "both";
  if (hasIndex) return "index";
  if (hasMember) return "member";
  return "none";
}

/**
 * Resolves the networks to evaluate: all memberships in global scope, only the
 * requested network in network scope. The requested network must also be a
 * membership to avoid broadening scope accidentally.
 */
export function resolveAssignmentNetworkScope(args: ResolveAssignmentNetworkScopeArgs): string[] {
  if (!args.networkScopeId) return [...args.memberships];
  return args.memberships.includes(args.networkScopeId) ? [args.networkScopeId] : [];
}

/**
 * Builds a unified assignment decision and metadata envelope.
 */
export function buildNetworkAssignmentDecision(args: BuildNetworkAssignmentDecisionArgs): NetworkAssignmentDecision {
  const threshold = clampScore(args.threshold ?? DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD);
  const promptPresence = classifyPromptPresence(args);

  if (args.mode === "manual_override") {
    const finalScore = 1.0;
    return buildDecision(args, promptPresence, threshold, finalScore, true, args.reason ?? "Explicit manual override.");
  }

  if (promptPresence === "none") {
    const finalScore = 1.0;
    return buildDecision(args, promptPresence, threshold, finalScore, true, args.reason ?? "No prompts configured; network has no dynamic filtration.");
  }

  const finalScore = combineAssignmentScores(args.rawScores ?? {}, promptPresence);
  const assigned = finalScore >= threshold;
  return buildDecision(args, promptPresence, threshold, finalScore, assigned, args.reason);
}

export function combineAssignmentScores(
  rawScores: NetworkAssignmentRawScores,
  promptPresence: NetworkAssignmentPromptPresence,
): number {
  const indexScore = clampScore(rawScores.indexScore ?? 0);
  const memberScore = clampScore(rawScores.memberScore ?? 0);

  switch (promptPresence) {
    case "both":
      return clampScore(indexScore * 0.6 + memberScore * 0.4);
    case "index":
      return indexScore;
    case "member":
      return memberScore;
    case "none":
      return 1.0;
  }
}

function buildDecision(
  args: BuildNetworkAssignmentDecisionArgs,
  promptPresence: NetworkAssignmentPromptPresence,
  threshold: number,
  finalScore: number,
  assigned: boolean,
  reason?: string,
): NetworkAssignmentDecision {
  return {
    assigned,
    finalScore,
    metadata: {
      resourceType: args.resourceType,
      mode: args.mode,
      scope: args.scope,
      policy: "unified-threshold-v1",
      threshold,
      promptPresence,
      ...(args.rawScores ? { rawScores: args.rawScores } : {}),
      finalScore,
      assigned,
      ...(reason ? { reason } : {}),
      ...(args.evaluator ? { evaluator: args.evaluator } : {}),
      ...(args.source ? { source: args.source } : {}),
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    },
  };
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}
```


#### 3. packages/protocol/src/shared/assignment/tests/network-assignment.policy.spec.ts

**File**: `packages/protocol/src/shared/assignment/tests/network-assignment.policy.spec.ts`  

**Changes**: deterministic tests for assignment policy behavior.

Purpose: deterministic tests for assignment policy behavior.
```ts
import { describe, expect, it } from "bun:test";

import {
  buildNetworkAssignmentDecision,
  classifyPromptPresence,
  DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD,
  resolveAssignmentNetworkScope,
} from "../network-assignment.policy.js";

describe("network-assignment.policy", () => {
  it("classifies prompt presence", () => {
    expect(classifyPromptPresence({ indexPrompt: "Index", memberPrompt: "Member" })).toBe("both");
    expect(classifyPromptPresence({ indexPrompt: "Index", memberPrompt: "  " })).toBe("index");
    expect(classifyPromptPresence({ indexPrompt: null, memberPrompt: "Member" })).toBe("member");
    expect(classifyPromptPresence({ indexPrompt: undefined, memberPrompt: "" })).toBe("none");
  });

  it("evaluates all memberships in global scope", () => {
    expect(resolveAssignmentNetworkScope({ memberships: ["n1", "n2"] })).toEqual(["n1", "n2"]);
  });

  it("evaluates only the active network in network scope", () => {
    expect(resolveAssignmentNetworkScope({ memberships: ["n1", "n2"], networkScopeId: "n2" })).toEqual(["n2"]);
    expect(resolveAssignmentNetworkScope({ memberships: ["n1"], networkScopeId: "n2" })).toEqual([]);
  });

  it("assigns when weighted score meets the unified threshold", () => {
    const decision = buildNetworkAssignmentDecision({
      resourceType: "intent",
      mode: "automatic",
      scope: "global",
      indexPrompt: "founders",
      memberPrompt: "AI",
      rawScores: { indexScore: 0.8, memberScore: 0.7 },
      createdAt: "2026-06-09T00:00:00.000Z",
    });

    expect(decision.assigned).toBe(true);
    expect(decision.finalScore).toBeCloseTo(0.76);
    expect(decision.metadata.threshold).toBe(DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD);
    expect(decision.metadata.promptPresence).toBe("both");
    expect(decision.metadata.createdAt).toBe("2026-06-09T00:00:00.000Z");
  });

  it("does not assign when score is below threshold", () => {
    const decision = buildNetworkAssignmentDecision({
      resourceType: "premise",
      mode: "automatic",
      scope: "global",
      indexPrompt: "founders",
      rawScores: { indexScore: 0.4 },
    });

    expect(decision.assigned).toBe(false);
    expect(decision.finalScore).toBe(0.4);
  });

  it("assigns no-prompt networks because they have no dynamic filtration", () => {
    const decision = buildNetworkAssignmentDecision({
      resourceType: "intent",
      mode: "automatic",
      scope: "network",
      rawScores: { indexScore: 0.1, memberScore: 0.1 },
    });

    expect(decision.assigned).toBe(true);
    expect(decision.finalScore).toBe(1);
    expect(decision.metadata.reason).toContain("No prompts");
  });

  it("marks explicit manual override assignments", () => {
    const decision = buildNetworkAssignmentDecision({
      resourceType: "intent",
      mode: "manual_override",
      scope: "network",
      indexPrompt: "strict prompt",
      rawScores: { indexScore: 0.1 },
    });

    expect(decision.assigned).toBe(true);
    expect(decision.finalScore).toBe(1);
    expect(decision.metadata.mode).toBe("manual_override");
    expect(decision.metadata.reason).toContain("manual override");
  });
});
```


#### 4. packages/protocol/src/index.ts

**File**: `packages/protocol/src/index.ts`  

**Changes**: export shared assignment schemas/helpers from the protocol public API.

Purpose: export shared assignment schemas/helpers from the protocol public API.
```ts
export {
  NetworkAssignmentResourceTypeSchema,
  NetworkAssignmentModeSchema,
  NetworkAssignmentScopeSchema,
  NetworkAssignmentPromptPresenceSchema,
  NetworkAssignmentPolicySchema,
  NetworkAssignmentRawScoresSchema,
  NetworkAssignmentMetadataSchema,
  OpportunityEvidenceKindSchema,
  OpportunityEvidenceSchema,
} from "./shared/schemas/network-assignment.schema.js";
export type {
  NetworkAssignmentResourceType,
  NetworkAssignmentMode,
  NetworkAssignmentScope,
  NetworkAssignmentPromptPresence,
  NetworkAssignmentPolicy,
  NetworkAssignmentRawScores,
  NetworkAssignmentMetadata,
  OpportunityEvidenceKind,
  OpportunityEvidence,
} from "./shared/schemas/network-assignment.schema.js";
export {
  DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD,
  classifyPromptPresence,
  resolveAssignmentNetworkScope,
  buildNetworkAssignmentDecision,
  combineAssignmentScores,
} from "./shared/assignment/network-assignment.policy.js";
export type {
  PromptPresenceInput,
  ResolveAssignmentNetworkScopeArgs,
  BuildNetworkAssignmentDecisionArgs,
  NetworkAssignmentDecision,
} from "./shared/assignment/network-assignment.policy.js";
export type { IntentIndexerOutput } from "./intent/intent.indexer.js";
```


### Success Criteria:

#### Automated Verification:
- [x] Shared helper tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/packages/protocol && bun test src/shared/assignment/tests/network-assignment.policy.spec.ts`
- [x] Protocol exports include assignment contracts: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "NetworkAssignmentMetadata|buildNetworkAssignmentDecision|OpportunityEvidenceSchema" packages/protocol/src/index.ts`

#### Manual Verification:
- [x] `packages/protocol/src/shared/schemas/network-assignment.schema.ts` contains only DTO/schema definitions and no graph/backend imports.
- [x] `packages/protocol/src/shared/assignment/network-assignment.policy.ts` is pure and contains no database, queue, model, logger, or time-source imports.


---

## Phase 2: Persist assignment metadata

### Overview

Implements Slice 2 from the approved design. Files: `backend/src/schemas/database.schema.ts`, `backend/drizzle/0082_add_assignment_metadata.sql`, `backend/drizzle/meta/_journal.json`, `packages/protocol/src/shared/interfaces/database.interface.ts`, `backend/src/adapters/database.adapter.ts`, `backend/src/adapters/tests/database.adapter.spec.ts`.

### Changes Required:

#### 1. backend/src/schemas/database.schema.ts

**File**: `backend/src/schemas/database.schema.ts`  

**Changes**: add metadata JSONB columns to premise and intent assignment joins.

Purpose: add metadata JSONB columns to premise and intent assignment joins.
```ts
export const premiseNetworks = pgTable('premise_networks', {
  premiseId: text('premise_id').notNull().references(() => premises.id, { onDelete: 'cascade' }),
  networkId: text('network_id').notNull().references(() => networks.id),
  relevancyScore: numeric('relevancy_score'),
  assignmentMetadata: jsonb('assignment_metadata').$type<import('@indexnetwork/protocol').NetworkAssignmentMetadata>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.premiseId, t.networkId] }),
  networkIdIdx: index('premise_networks_network_id_idx').on(t.networkId),
}));

export const intentNetworks = pgTable('intent_networks', {
  intentId: text('intent_id').notNull().references(() => intents.id),
  networkId: text('network_id').notNull().references(() => networks.id),
  relevancyScore: numeric('relevancy_score'),
  assignmentMetadata: jsonb('assignment_metadata').$type<import('@indexnetwork/protocol').NetworkAssignmentMetadata>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.intentId, t.networkId] }),
  networkIdIdx: index('intent_networks_network_id_idx').on(t.networkId),
}));
```


#### 2. backend/drizzle/0082_add_assignment_metadata.sql

**File**: `backend/drizzle/0082_add_assignment_metadata.sql`  

**Changes**: migration for assignment metadata columns.

Purpose: migration for assignment metadata columns.
```sql
ALTER TABLE "premise_networks" ADD COLUMN "assignment_metadata" jsonb;
ALTER TABLE "intent_networks" ADD COLUMN "assignment_metadata" jsonb;
```


#### 3. backend/drizzle/meta/_journal.json

**File**: `backend/drizzle/meta/_journal.json`  

**Changes**: add migration journal entry for 0082.

Purpose: add migration journal entry for 0082.
```json
{
  "idx": 82,
  "version": "7",
  "when": 1781035882000,
  "tag": "0082_add_assignment_metadata",
  "breakpoints": true
}
```
Append this object to the existing top-level `entries` array, preserving the current `{ "version", "dialect", "entries" }` shape. The Drizzle snapshot is generated by `bun run db:generate` during implementation and committed as `backend/drizzle/meta/0082_snapshot.json`; it is intentionally not hand-authored in the design.


#### 4. packages/protocol/src/shared/interfaces/database.interface.ts

**File**: `packages/protocol/src/shared/interfaces/database.interface.ts`  

**Changes**: extend assignment write/read signatures and add non-autoAssign assignment context reads.

Purpose: extend assignment write/read signatures and add non-autoAssign assignment context reads.
```ts
import type { ProfileDocument } from '../schemas/profile.schema.js';
import type { NetworkAssignmentMetadata } from '../schemas/network-assignment.schema.js';
```

```ts
export interface NetworkAssignmentContext {
  networkId: string;
  indexPrompt: string | null;
  memberPrompt: string | null;
}
```

```ts
/**
 * Network IDs that should be considered for assignment policy. Unlike
 * getUserIndexIds, this is not gated by network_members.autoAssign.
 */
getAssignmentNetworkIdsForUser(userId: string): Promise<string[]>;

/**
 * Prompt context for assignment policy. Unlike getNetworkMemberContext, this is
 * not gated by network_members.autoAssign.
 */
getNetworkAssignmentContext(networkId: string, userId: string): Promise<NetworkAssignmentContext | null>;
```

```ts
assignIntentToNetwork(
  intentId: string,
  networkId: string,
  relevancyScore?: number,
  assignmentMetadata?: NetworkAssignmentMetadata,
): Promise<void>;

getIntentIndexScores(intentId: string): Promise<Array<{
  networkId: string;
  relevancyScore: number | null;
  assignmentMetadata?: NetworkAssignmentMetadata | null;
}>>;
```

```ts
assignPremiseToNetwork(
  premiseId: string,
  networkId: string,
  relevancyScore: number,
  assignmentMetadata?: NetworkAssignmentMetadata,
): Promise<void>;

getPremiseNetworks(premiseId: string): Promise<Array<{
  networkId: string;
  relevancyScore: number | null;
  assignmentMetadata?: NetworkAssignmentMetadata | null;
}>>;
```

```ts
export type PremiseGraphDatabase = Pick<
  Database,
  'createPremise'
  | 'getPremise'
  | 'getPremisesForUser'
  | 'updatePremise'
  | 'assignPremiseToNetwork'
  | 'getPremiseNetworks'
  | 'getAssignmentNetworkIdsForUser'
  | 'getNetworkAssignmentContext'
>;
```

```ts
getNetworkAssignmentContext?(networkId: string): Promise<NetworkAssignmentContext | null>;
```

```ts
export type IntentNetworkGraphDatabase = Pick<
  Database,
  | 'getIntentForIndexing'
  | 'getNetworkAssignmentContext'
  | 'getNetwork'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToNetwork'
  | 'unassignIntentFromIndex'
  | 'getIntent'
  | 'isNetworkMember'
  | 'isIndexOwner'
  | 'getNetworkIdsForIntent'
  | 'getNetworkIntentsForMember'
  | 'getIntentsInIndexForMember'
>;
```

```ts
assignIntentToNetwork(
  intentId: string,
  networkId: string,
  relevancyScore?: number,
  assignmentMetadata?: NetworkAssignmentMetadata,
): Promise<void>;
```


#### 5. backend/src/adapters/database.adapter.ts

**File**: `backend/src/adapters/database.adapter.ts`  

**Changes**: persist/read assignment metadata and expose non-autoAssign assignment context.

Purpose: persist/read assignment metadata and expose non-autoAssign assignment context.
```ts
async assignIntentToNetwork(
  intentId: string,
  networkId: string,
  relevancyScore?: number,
  assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
): Promise<void> {
  await db.insert(schema.intentNetworks)
    .values({
      intentId,
      networkId,
      relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
      assignmentMetadata: assignmentMetadata ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.intentNetworks.intentId, schema.intentNetworks.networkId],
      set: {
        relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
        assignmentMetadata: assignmentMetadata ?? null,
      },
    });
}
```

```ts
async assignIntentToNetwork(
  intentId: string,
  networkId: string,
  relevancyScore?: number,
  assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
): Promise<void> {
  await db.insert(intentNetworks)
    .values({
      intentId,
      networkId,
      relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
      assignmentMetadata: assignmentMetadata ?? null,
    })
    .onConflictDoUpdate({
      target: [intentNetworks.intentId, intentNetworks.networkId],
      set: {
        relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
        assignmentMetadata: assignmentMetadata ?? null,
      },
    });
}

async getIntentIndexScores(intentId: string): Promise<Array<{
  networkId: string;
  relevancyScore: number | null;
  assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata | null;
}>> {
  const rows = await db
    .select({
      networkId: intentNetworks.networkId,
      relevancyScore: intentNetworks.relevancyScore,
      assignmentMetadata: intentNetworks.assignmentMetadata,
    })
    .from(intentNetworks)
    .where(eq(intentNetworks.intentId, intentId));
  return rows.map(r => ({
    networkId: r.networkId,
    relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
    assignmentMetadata: r.assignmentMetadata ?? null,
  }));
}
```

```ts
async assignPremiseToNetwork(
  premiseId: string,
  networkId: string,
  relevancyScore: number,
  assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
): Promise<void> {
  await db
    .insert(schema.premiseNetworks)
    .values({
      premiseId,
      networkId,
      relevancyScore: String(relevancyScore),
      assignmentMetadata: assignmentMetadata ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.premiseNetworks.premiseId, schema.premiseNetworks.networkId],
      set: {
        relevancyScore: String(relevancyScore),
        assignmentMetadata: assignmentMetadata ?? null,
      },
    });
}

async getPremiseNetworks(premiseId: string): Promise<Array<{
  networkId: string;
  relevancyScore: number | null;
  assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata | null;
}>> {
  const rows = await db
    .select({
      networkId: schema.premiseNetworks.networkId,
      relevancyScore: schema.premiseNetworks.relevancyScore,
      assignmentMetadata: schema.premiseNetworks.assignmentMetadata,
    })
    .from(schema.premiseNetworks)
    .where(eq(schema.premiseNetworks.premiseId, premiseId));
  return rows.map((r) => ({
    networkId: r.networkId,
    relevancyScore: r.relevancyScore !== null ? Number(r.relevancyScore) : null,
    assignmentMetadata: r.assignmentMetadata ?? null,
  }));
}
```

```ts
async assignIntentToNetwork(
  intentId: string,
  networkId: string,
  relevancyScore?: number,
  assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
): Promise<void> {
  await db.insert(intentNetworks)
    .values({
      intentId,
      networkId,
      relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
      assignmentMetadata: assignmentMetadata ?? null,
    })
    .onConflictDoUpdate({
      target: [intentNetworks.intentId, intentNetworks.networkId],
      set: {
        relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
        assignmentMetadata: assignmentMetadata ?? null,
      },
    });
}
```

```ts
async getAssignmentNetworkIdsForUser(userId: string): Promise<string[]> {
  try {
    const result = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
      .leftJoin(schema.personalNetworks, eq(schema.networks.id, schema.personalNetworks.networkId))
      .where(
        and(
          eq(schema.networkMembers.userId, userId),
          isNull(schema.networkMembers.deletedAt),
          isNull(schema.networks.deletedAt),
          or(
            eq(schema.networks.isPersonal, false),
            and(
              eq(schema.networks.isPersonal, true),
              eq(schema.personalNetworks.userId, userId),
            ),
          ),
        )
      );
    return result.map((r) => r.networkId);
  } catch (error: unknown) {
    logger.error('ChatDatabaseAdapter.getAssignmentNetworkIdsForUser error', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

async getNetworkAssignmentContext(networkId: string, userId: string) {
  const rows = await db
    .select({
      networkId: networks.id,
      indexPrompt: networks.prompt,
      memberPrompt: networkMembers.prompt,
    })
    .from(networks)
    .innerJoin(networkMembers, eq(networks.id, networkMembers.networkId))
    .where(
      and(
        eq(networks.id, networkId),
        eq(networkMembers.userId, userId),
        isNull(networkMembers.deletedAt),
        isNull(networks.deletedAt)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
```

```ts
async getNetworkAssignmentContext(networkId: string, userId: string) {
  const rows = await db
    .select({
      networkId: networks.id,
      indexPrompt: networks.prompt,
      memberPrompt: networkMembers.prompt,
    })
    .from(networks)
    .innerJoin(networkMembers, eq(networks.id, networkMembers.networkId))
    .where(
      and(
        eq(networks.id, networkId),
        eq(networkMembers.userId, userId),
        isNull(networkMembers.deletedAt),
        isNull(networks.deletedAt)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
```

```ts
associateIntentWithNetworks: async (intentId: string, indexIds: string[]) => {
  const intent = await db.getIntent(intentId);
  if (!intent) throw new Error('Intent not found');
  if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
  for (const networkId of indexIds) {
    await db.assignIntentToNetwork(intentId, networkId);
  }
},
assignIntentToNetwork: async (
  intentId: string,
  networkId: string,
  relevancyScore?: number,
  assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
) => {
  const intent = await db.getIntent(intentId);
  if (!intent) throw new Error('Intent not found');
  if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
  return db.assignIntentToNetwork(intentId, networkId, relevancyScore, assignmentMetadata);
},
getNetworkAssignmentContext: (networkId: string) => db.getNetworkAssignmentContext(networkId, authUserId),
```


#### 6. backend/src/adapters/tests/database.adapter.spec.ts

**File**: `backend/src/adapters/tests/database.adapter.spec.ts`  

**Changes**: verify assignment metadata persistence/readback.

Purpose: verify assignment metadata persistence/readback.
```ts
import {
  users,
  userProfiles,
  userSocials,
  networks,
  networkMembers,
  intents,
  intentNetworks,
  premises,
  opportunities,
} from '../../schemas/database.schema';
```

```ts
it('should persist assignment metadata for intent-network assignment', async () => {
  const newIntentId = uuidv4();
  const metadata = {
    resourceType: 'intent' as const,
    mode: 'automatic' as const,
    scope: 'global' as const,
    policy: 'unified-threshold-v1' as const,
    threshold: 0.7,
    promptPresence: 'both' as const,
    rawScores: { indexScore: 0.8, memberScore: 0.7 },
    finalScore: 0.76,
    assigned: true,
    reason: 'Matched network and member prompts.',
    evaluator: 'intent-indexer',
    source: 'test',
    createdAt: '2026-06-09T00:00:00.000Z',
  };

  await db.insert(intents).values({
    id: newIntentId,
    userId: fixture.userBId,
    payload: TEST_PREFIX + 'Assignment metadata test',
    sourceType: 'discovery_form',
    sourceId: fixture.userBId,
  });

  await adapter.assignIntentToNetwork(newIntentId, fixture.networkId, 0.76, metadata);
  const scores = await adapter.getIntentIndexScores(newIntentId);
  const row = scores.find((score) => score.networkId === fixture.networkId);

  expect(row?.relevancyScore).toBe(0.76);
  expect(row?.assignmentMetadata).toEqual(metadata);

  await adapter.unassignIntentFromIndex(newIntentId, fixture.networkId);
  await db.delete(intents).where(eq(intents.id, newIntentId));
});

it('should persist assignment metadata for premise-network assignment', async () => {
  const premise = await adapter.createPremise({
    userId: fixture.userBId,
    assertion: { text: TEST_PREFIX + 'Premise metadata test', tier: 'assertive' },
    provenance: { source: 'explicit', confidence: 1, timestamp: '2026-06-09T00:00:00.000Z' },
    validity: { volatile: false },
  });
  const metadata = {
    resourceType: 'premise' as const,
    mode: 'automatic' as const,
    scope: 'global' as const,
    policy: 'unified-threshold-v1' as const,
    threshold: 0.7,
    promptPresence: 'index' as const,
    rawScores: { indexScore: 0.9 },
    finalScore: 0.9,
    assigned: true,
    reason: 'Matched network prompt.',
    evaluator: 'premise-indexer',
    source: 'test',
    createdAt: '2026-06-09T00:00:00.000Z',
  };

  await adapter.assignPremiseToNetwork(premise.id, fixture.networkId, 0.9, metadata);
  const rows = await adapter.getPremiseNetworks(premise.id);
  const row = rows.find((score) => score.networkId === fixture.networkId);

  expect(row?.relevancyScore).toBe(0.9);
  expect(row?.assignmentMetadata).toEqual(metadata);

  await db.delete(premises).where(eq(premises.id, premise.id));
});
```


### Success Criteria:

#### Automated Verification:
- [x] Migration file exists: `cd .worktrees/docs-protocol-assignment-domain-redesign && test -f backend/drizzle/0082_add_assignment_metadata.sql`
- [x] Schema includes assignment metadata columns: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "assignmentMetadata" backend/src/schemas/database.schema.ts`
- [x] All assignment adapter methods accept metadata: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "assignmentMetadata\?: import\('@indexnetwork/protocol'\)\.NetworkAssignmentMetadata" backend/src/adapters/database.adapter.ts | wc -l` returns at least 4
- [x] Adapter tests pass after migration is applied: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun test src/adapters/tests/database.adapter.spec.ts`
- [x] Drizzle generates and commits the snapshot: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun run db:generate && test -f drizzle/meta/0082_snapshot.json`
- [x] Migration round-trip is clean after implementation: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun run db:migrate && bun run db:generate` reports no schema changes

#### Manual Verification:
- [x] `premise_networks` and `intent_networks` retain `relevancy_score` and add nullable `assignment_metadata` JSONB.
- [x] `backend/drizzle/meta/_journal.json` appends `0082_add_assignment_metadata` inside the existing `entries` array; it is not replaced by a bare object.
- [x] `backend/drizzle/meta/0082_snapshot.json` is generated by Drizzle and committed with the SQL migration, not hand-authored.
- [x] Protocol interface changes import `NetworkAssignmentMetadata` at top-level and use optional metadata parameters.
- [x] Existing `assignIntentToNetwork(intentId, networkId)` and `assignPremiseToNetwork(premiseId, networkId, score)` call sites remain source-compatible because metadata is optional.


---

## Phase 3: Apply shared assignment policy

### Overview

Implements Slice 3 from the approved design. Files: `packages/protocol/src/index.ts`, `packages/protocol/src/premise/premise.state.ts`, `packages/protocol/src/shared/interfaces/database.interface.ts`, `backend/src/adapters/database.adapter.ts`, `packages/protocol/src/premise/premise.graph.ts`, `backend/src/queues/intent.queue.ts`, `packages/protocol/src/network/indexer/indexer.graph.ts`, `backend/src/queues/tests/intent.queue.spec.ts`, `packages/protocol/src/premise/tests/premise.graph.spec.ts`, `packages/protocol/src/network/indexer/tests/indexer.graph.spec.ts`.

### Changes Required:

#### 1. packages/protocol/src/premise/premise.state.ts

**File**: `packages/protocol/src/premise/premise.state.ts`  

**Changes**: carry optional active network scope and provenance source id into premise assignment.

Purpose: carry optional active network scope and provenance source id into premise assignment.
```ts
networkScopeId: Annotation<string | undefined>({
  reducer: (curr, next) => next ?? curr,
  default: () => undefined,
}),

provenanceSourceId: Annotation<string | undefined>({
  reducer: (curr, next) => next ?? curr,
  default: () => undefined,
}),
```


#### 2. packages/protocol/src/premise/premise.graph.ts

**File**: `packages/protocol/src/premise/premise.graph.ts`  

**Changes**: use shared assignment policy and metadata for premise assignment.

Purpose: use shared assignment policy and metadata for premise assignment.
```ts
import {
  buildNetworkAssignmentDecision,
  resolveAssignmentNetworkScope,
} from "../shared/assignment/network-assignment.policy.js";
```

```ts
export class PremiseGraphFactory {
  constructor(
    private database: PremiseGraphDatabase,
    private embedder: Embedder,
    private premiseIndexer: PremiseIndexer = new PremiseIndexer(),
  ) {}
```

```ts
provenance: {
  source: state.provenanceSource ?? 'explicit',
  sourceId: state.provenanceSourceId,
  confidence: state.provenanceConfidence ?? 1.0,
  timestamp: new Date().toISOString(),
},
```

```ts
const indexNode = async (state: typeof PremiseGraphState.State) => {
  return timed("PremiseGraph.index", async () => {
    if (!state.premise) return {};

    logger.verbose(`[PremiseGraph.index] Scoring premise against user networks`);

    const membershipNetworkIds = await this.database.getAssignmentNetworkIdsForUser(state.userId);
    const indexIds = resolveAssignmentNetworkScope({
      memberships: membershipNetworkIds,
      networkScopeId: state.networkScopeId,
    });
    const scope = state.networkScopeId ? "network" : "global";
    const assignments: Array<{ networkId: string; relevancyScore: number }> = [];
    const agentTimings: DebugMetaAgent[] = [];

    for (const networkId of indexIds) {
      try {
        const assignmentContext = await this.database.getNetworkAssignmentContext(networkId, state.userId);
        if (!assignmentContext) continue;
        const indexPrompt = assignmentContext.indexPrompt;
        const memberPrompt = assignmentContext.memberPrompt;
        const hasPrompts = !!indexPrompt?.trim() || !!memberPrompt?.trim();
        let rawScores: { indexScore?: number; memberScore?: number } | undefined;
        let reason: string | undefined;

        if (hasPrompts) {
          const start = Date.now();
          const result = await this.premiseIndexer.invoke({
            premiseText: state.assertionText!,
            indexPrompt: indexPrompt ?? "",
            memberPrompt: memberPrompt ?? undefined,
          });
          const timing: DebugMetaAgent = {
            name: "premise-indexer",
            durationMs: Date.now() - start,
          };
          rawScores = { indexScore: result.indexScore, memberScore: result.memberScore };
          reason = result.reasoning;
          agentTimings.push(timing);
        }

        const decision = buildNetworkAssignmentDecision({
          resourceType: "premise",
          mode: "automatic",
          scope,
          indexPrompt,
          memberPrompt,
          rawScores,
          evaluator: "premise-indexer",
          source: "premise-graph",
          reason,
          createdAt: new Date().toISOString(),
        });

        if (decision.assigned) {
          await this.database.assignPremiseToNetwork(
            state.premise.id,
            networkId,
            decision.finalScore,
            decision.metadata,
          );
          assignments.push({ networkId, relevancyScore: decision.finalScore });
        }
      } catch (err) {
        logger.verbose(`[PremiseGraph.index] Failed to score network ${networkId}, skipping: ${err}`);
      }
    }

    logger.verbose(`[PremiseGraph.index] Assigned to ${assignments.length} networks`);

    return { networkAssignments: assignments, agentTimings };
  });
};
```


#### 3. backend/src/queues/intent.queue.ts

**File**: `backend/src/queues/intent.queue.ts`  

**Changes**: use shared assignment policy and metadata for intent queue auto-assignment.

Purpose: use shared assignment policy and metadata for intent queue auto-assignment.
```ts
import {
  HydeGraphFactory,
  HydeGenerator,
  LensInferrer,
  IntentIndexer,
  buildNetworkAssignmentDecision,
  resolveAssignmentNetworkScope,
} from '@indexnetwork/protocol';
import type { HydeGraphDatabase, IntentGraphQueue, IntentIndexerOutput } from '@indexnetwork/protocol';
```

```ts
export type IntentQueueDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getAssignmentNetworkIdsForUser' | 'assignIntentToNetwork' | 'deleteHydeDocumentsForSource' | 'getNetworkAssignmentContext' | 'getProfile' | 'getActiveIntents'
>;
```

```ts
evaluateIntentAssignment?: (opts: {
  intent: string;
  indexPrompt: string | null;
  memberPrompt: string | null;
  sourceName?: string | null;
}) => Promise<IntentIndexerOutput | null>;
```

```ts
overrides?: { addOpportunityJob?: (d: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown> }
```

```ts
let assignedIndexCount = 0;
try {
  const membershipNetworkIds = await db.getAssignmentNetworkIdsForUser(userId);
  const userIndexIds = resolveAssignmentNetworkScope({ memberships: membershipNetworkIds, networkScopeId });
  this.logger.info('[IntentHyde] User assignment networks found', { intentId, userId, indexCount: userIndexIds.length, indexIds: userIndexIds });

  const evaluateIntentAssignment = this.deps?.evaluateIntentAssignment ?? (async (opts: {
    intent: string;
    indexPrompt: string | null;
    memberPrompt: string | null;
    sourceName?: string | null;
  }) => {
    const indexer = new IntentIndexer();
    return indexer.invoke(opts.intent, opts.indexPrompt, opts.memberPrompt, opts.sourceName ?? null);
  });

  const sourceName = intent.sourceType
    ? `${intent.sourceType}:${intent.sourceId ?? ''}`
    : undefined;

  const scoringResults = await Promise.all(
    userIndexIds.map(async (networkId) => {
      const ctx = await db.getNetworkAssignmentContext(networkId, userId);
      const indexPrompt = ctx?.indexPrompt ?? null;
      const memberPrompt = ctx?.memberPrompt ?? null;
      const hasPrompts = !!indexPrompt?.trim() || !!memberPrompt?.trim();
      let result: IntentIndexerOutput | null = null;
      if (hasPrompts) {
        try {
          result = await evaluateIntentAssignment({ intent: intent.payload, indexPrompt, memberPrompt, sourceName });
        } catch (err) {
          this.logger.warn('[IntentHyde] IntentIndexer failed for index', { intentId, networkId, error: err });
        }
      }

      const decision = buildNetworkAssignmentDecision({
        resourceType: 'intent',
        mode: 'automatic',
        scope: networkScopeId ? 'network' : 'global',
        indexPrompt,
        memberPrompt,
        rawScores: result ? { indexScore: result.indexScore, memberScore: result.memberScore } : undefined,
        evaluator: 'intent-indexer',
        source: 'intent-hyde-queue',
        reason: result?.reasoning,
        createdAt: new Date().toISOString(),
      });
      return { networkId, decision };
    })
  );

  for (const { networkId, decision } of scoringResults) {
    if (!decision.assigned) continue;
    try {
      await db.assignIntentToNetwork(intentId, networkId, decision.finalScore, decision.metadata);
      assignedIndexCount++;
    } catch (assignErr) {
      this.logger.debug('[IntentHyde] Assign intent to index skipped', { intentId, networkId, error: assignErr });
    }
  }
} catch (err) {
  this.logger.warn('[IntentHyde] Failed to assign intent to user indexes', {
    intentId,
    userId,
    error: err,
  });
}
```


#### 4. packages/protocol/src/network/indexer/indexer.graph.ts

**File**: `packages/protocol/src/network/indexer/indexer.graph.ts`  

**Changes**: use shared assignment policy/metadata for manual and evaluated intent assignment.

Purpose: use shared assignment policy/metadata for manual and evaluated intent assignment.
```ts
import {
  buildNetworkAssignmentDecision,
} from "../../shared/assignment/network-assignment.policy.js";
```

```ts
if (state.skipEvaluation) {
  const decision = buildNetworkAssignmentDecision({
    resourceType: "intent",
    mode: "manual_override",
    scope: "network",
    evaluator: "intent-network-graph",
    source: "manual-index-assignment",
    createdAt: new Date().toISOString(),
  });
  await this.database.assignIntentToNetwork(intentId, networkId, decision.finalScore, decision.metadata);
  return {
    agentTimings: agentTimingsAccum,
    assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
    mutationResult: { success: true, message: "Intent saved to the network." },
  };
}
```

```ts
const indexContext = await this.database.getNetworkAssignmentContext(networkId, intentForIndexing.userId);
const indexPrompt = indexContext?.indexPrompt ?? null;
const memberPrompt = indexContext?.memberPrompt ?? null;
const hasNoPrompts = !indexPrompt?.trim() && !memberPrompt?.trim();
if (hasNoPrompts) {
  const decision = buildNetworkAssignmentDecision({
    resourceType: "intent",
    mode: "automatic",
    scope: "network",
    indexPrompt,
    memberPrompt,
    evaluator: "intent-indexer",
    source: "intent-network-graph",
    createdAt: new Date().toISOString(),
  });
  await this.database.assignIntentToNetwork(intentId, networkId, decision.finalScore, decision.metadata);
  return {
    agentTimings: agentTimingsAccum,
    assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
    mutationResult: { success: true, message: "Intent assigned to network (no prompts)." },
  };
}
```

```ts
const decision = buildNetworkAssignmentDecision({
  resourceType: "intent",
  mode: "automatic",
  scope: "network",
  indexPrompt,
  memberPrompt,
  rawScores: { indexScore: result.indexScore, memberScore: result.memberScore },
  evaluator: "intent-indexer",
  source: "intent-network-graph",
  reason: result.reasoning,
  createdAt: new Date().toISOString(),
});

if (decision.assigned) {
  await this.database.assignIntentToNetwork(intentId, networkId, decision.finalScore, decision.metadata);
  return {
    agentTimings: agentTimingsAccum,
    evaluation: result,
    shouldAssign: true,
    finalScore: decision.finalScore,
    assignmentResult: { networkId, assigned: true, success: true } as AssignmentResult,
    mutationResult: { success: true, message: `Intent assigned to network (score: ${decision.finalScore.toFixed(2)}).` },
  };
}

return {
  agentTimings: agentTimingsAccum,
  evaluation: result,
  shouldAssign: false,
  finalScore: decision.finalScore,
  assignmentResult: { networkId, assigned: false, success: true } as AssignmentResult,
  mutationResult: { success: false, error: `Intent did not qualify for this network (score: ${decision.finalScore.toFixed(2)}).` },
};
```


#### 5. backend/src/queues/tests/intent.queue.spec.ts

**File**: `backend/src/queues/tests/intent.queue.spec.ts`  

**Changes**: verify scoped/all-membership intent assignment and metadata behavior.

Purpose: verify scoped/all-membership intent assignment and metadata behavior.
```ts
/** Cast a plain object to IntentQueueDatabase for tests and provide new assignment-policy defaults. */
const asIntentDb = (db: Partial<IntentQueueDatabase> & { getUserIndexIds?: (userId: string) => Promise<string[]> }): IntentQueueDatabase => ({
  getIntentForIndexing: async () => null,
  getAssignmentNetworkIdsForUser: async (userId: string) => db.getUserIndexIds?.(userId) ?? [],
  getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
  assignIntentToNetwork: async () => {},
  deleteHydeDocumentsForSource: async () => 0,
  getProfile: async () => null,
  getActiveIntents: async () => [],
  ...db,
} as IntentQueueDatabase);
```

```ts
it('generate_hyde: networkScopeId restricts assignment to active network only', async () => {
  const invokeHyde = mock(async () => {});
  const addOpportunityJob = mock(async () => ({}));
  const assignIntentToNetwork = mock(async () => {});
  const getAssignmentNetworkIdsForUser = mock(async () => ['scope-net', 'personal-net', 'other-net']);
  const db = {
    getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
    getAssignmentNetworkIdsForUser,
    getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
    assignIntentToNetwork,
    deleteHydeDocumentsForSource: async () => 0,
  };
  const queue = new IntentQueue({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
  await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1', networkScopeId: 'scope-net' });

  expect(getAssignmentNetworkIdsForUser).toHaveBeenCalledWith('u1');
  expect(assignIntentToNetwork.mock.calls.map((c) => c[1])).toEqual(['scope-net']);
  expect(addOpportunityJob).toHaveBeenCalledWith({ intentId: 'i1', userId: 'u1', networkIds: ['scope-net'] });
});

it('generate_hyde: global assignment uses all membership networks and persists metadata', async () => {
  const invokeHyde = mock(async () => {});
  const addOpportunityJob = mock(async () => ({}));
  const assignIntentToNetwork = mock(async () => {});
  const db = {
    getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build AI tools', userId: 'u1', sourceType: 'discovery_form', sourceId: 'u1' }),
    getAssignmentNetworkIdsForUser: async () => ['n1', 'n2'],
    getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
    assignIntentToNetwork,
    deleteHydeDocumentsForSource: async () => 0,
  };
  const queue = new IntentQueue({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
  await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });

  expect(assignIntentToNetwork.mock.calls.map((c) => c[1]).sort()).toEqual(['n1', 'n2']);
  const metadata = assignIntentToNetwork.mock.calls[0][3];
  expect(metadata).toMatchObject({ resourceType: 'intent', mode: 'automatic', scope: 'global', assigned: true, finalScore: 1 });
});

it('generate_hyde: prompted networks use injected evaluator and unified threshold', async () => {
  const assignIntentToNetwork = mock(async () => {});
  const evaluateIntentAssignment = mock(async () => ({ indexScore: 0.8, memberScore: 0.6, reasoning: 'Weighted match' }));
  const db = {
    getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build AI tools', userId: 'u1', sourceType: null, sourceId: null }),
    getAssignmentNetworkIdsForUser: async () => ['n1'],
    getNetworkAssignmentContext: async () => ({ networkId: 'n1', indexPrompt: 'AI founders', memberPrompt: 'developer tools' }),
    assignIntentToNetwork,
    deleteHydeDocumentsForSource: async () => 0,
  };
  const queue = new IntentQueue({
    database: asIntentDb(db),
    invokeHyde: mock(async () => {}),
    addOpportunityJob: mock(async () => ({})),
    evaluateIntentAssignment,
  });

  await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });

  expect(evaluateIntentAssignment).toHaveBeenCalled();
  expect(assignIntentToNetwork).toHaveBeenCalledWith('i1', 'n1', 0.72, expect.objectContaining({ finalScore: 0.72, promptPresence: 'both' }));
});
```


#### 6. packages/protocol/src/premise/tests/premise.graph.spec.ts

**File**: `packages/protocol/src/premise/tests/premise.graph.spec.ts`  

**Changes**: verify premise assignment policy and metadata behavior.

Purpose: verify premise assignment policy and metadata behavior.
```ts
function createMockDatabase(): PremiseGraphDatabase {
  const premises: PremiseRecord[] = [];

  return {
    createPremise: async (input) => { /* existing body unchanged */ },
    getPremise: async (id) => premises.find(p => p.id === id) ?? null,
    getPremisesForUser: async (userId, status) =>
      premises.filter(p => p.userId === userId && (!status || p.status === status)),
    updatePremise: async (id, updates) => { /* existing body unchanged */ },
    assignPremiseToNetwork: async () => {},
    getPremiseNetworks: async () => [],
    getAssignmentNetworkIdsForUser: async () => [],
    getNetworkAssignmentContext: async () => null,
  };
}
```

```ts
it("assigns created premises to all membership networks with metadata", async () => {
  const assignments: Array<{ networkId: string; score: number; metadata: unknown }> = [];
  const db = {
    ...createMockDatabase(),
    getAssignmentNetworkIdsForUser: async () => ["n1", "n2"],
    getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
    assignPremiseToNetwork: async (_premiseId: string, networkId: string, score: number, metadata: unknown) => {
      assignments.push({ networkId, score, metadata });
    },
  };
  const embedder = createMockEmbedder();
  const premiseIndexer = { invoke: async () => ({ indexScore: 0, memberScore: 0, reasoning: "unused" }) };
  const factory = new PremiseGraphFactory(db, embedder, premiseIndexer as never);
  const graph = factory.createGraph();

  await graph.invoke({
    userId: "user-1",
    assertionText: "I build AI developer tools",
    tier: "assertive" as const,
    volatile: false,
  });

  expect(assignments.map((a) => a.networkId).sort()).toEqual(["n1", "n2"]);
  expect(assignments[0].metadata).toMatchObject({ resourceType: "premise", scope: "global", assigned: true, finalScore: 1 });
}, 60_000);

it("restricts premise assignment to active network scope", async () => {
  const assignments: string[] = [];
  const db = {
    ...createMockDatabase(),
    getAssignmentNetworkIdsForUser: async () => ["active-network", "other-network"],
    getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
    assignPremiseToNetwork: async (_premiseId: string, networkId: string) => {
      assignments.push(networkId);
    },
  };
  const factory = new PremiseGraphFactory(db, createMockEmbedder(), { invoke: async () => ({ indexScore: 0, memberScore: 0, reasoning: "unused" }) } as never);
  const graph = factory.createGraph();

  await graph.invoke({
    userId: "user-1",
    assertionText: "I am attending the active network event",
    tier: "assertive" as const,
    volatile: false,
    networkScopeId: "active-network",
  });

  expect(assignments).toEqual(["active-network"]);
}, 60_000);
```


#### 7. packages/protocol/src/network/indexer/tests/indexer.graph.spec.ts

**File**: `packages/protocol/src/network/indexer/tests/indexer.graph.spec.ts`  

**Changes**: verify explicit manual bypass and evaluated assignment policy.

Purpose: verify explicit manual bypass and evaluated assignment policy.
```ts
import { describe, expect, it } from "bun:test";

import { IntentNetworkGraphFactory } from "../indexer.graph.js";
import type { IntentIndexerOutput } from "../../../intent/intent.indexer.js";

function createDb(overrides: Record<string, unknown> = {}) {
  const assignments: Array<{ intentId: string; networkId: string; score?: number; metadata?: unknown }> = [];
  return {
    assignments,
    getIntent: async () => ({ id: "intent-1", userId: "user-1", payload: "Build AI tools" }),
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    isIntentAssignedToIndex: async () => false,
    getIntentForIndexing: async () => ({ id: "intent-1", userId: "user-1", payload: "Build AI tools", sourceType: null, sourceId: null }),
    getNetworkAssignmentContext: async () => ({ networkId: "network-1", indexPrompt: "AI founders", memberPrompt: "developer tools" }),
    getNetwork: async () => ({ id: "network-1", title: "AI", prompt: "AI founders", type: "community", metadata: {} }),
    assignIntentToNetwork: async (intentId: string, networkId: string, score?: number, metadata?: unknown) => {
      assignments.push({ intentId, networkId, score, metadata });
    },
    unassignIntentFromIndex: async () => {},
    getNetworkIdsForIntent: async () => [],
    getNetworkIntentsForMember: async () => [],
    getIntentsInIndexForMember: async () => [],
    ...overrides,
  };
}

function createIndexer(result: IntentIndexerOutput | null) {
  return {
    evaluate: async () => result,
  };
}

describe("IntentNetworkGraphFactory", () => {
  it("records manual override metadata for skipEvaluation assignment", async () => {
    const db = createDb();
    const graph = new IntentNetworkGraphFactory(db as never, createIndexer(null) as never).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: true,
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(db.assignments[0]).toMatchObject({ intentId: "intent-1", networkId: "network-1", score: 1 });
    expect(db.assignments[0].metadata).toMatchObject({ resourceType: "intent", mode: "manual_override", assigned: true });
  });

  it("uses unified weighted threshold for evaluated assignment", async () => {
    const db = createDb();
    const graph = new IntentNetworkGraphFactory(
      db as never,
      createIndexer({ indexScore: 0.8, memberScore: 0.6, reasoning: "Weighted match" }) as never,
    ).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: false,
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.finalScore).toBeCloseTo(0.72);
    expect(db.assignments[0].metadata).toMatchObject({ mode: "automatic", finalScore: 0.72, promptPresence: "both" });
  });
});
```


### Success Criteria:

#### Automated Verification:
- [x] Assignment policy consumers import shared helper: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "buildNetworkAssignmentDecision|resolveAssignmentNetworkScope" packages/protocol/src/premise/premise.graph.ts backend/src/queues/intent.queue.ts packages/protocol/src/network/indexer/indexer.graph.ts`
- [x] Production assignment code no longer references autoAssign-gated context methods: `cd .worktrees/docs-protocol-assignment-domain-redesign && ! rg "getUserIndexIds|getNetworkMemberContext" packages/protocol/src/premise/premise.graph.ts backend/src/queues/intent.queue.ts packages/protocol/src/network/indexer/indexer.graph.ts`
- [x] Non-autoAssign assignment context methods are implemented and wired: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "getAssignmentNetworkIdsForUser|getNetworkAssignmentContext" backend/src/adapters/database.adapter.ts packages/protocol/src/shared/interfaces/database.interface.ts backend/src/queues/intent.queue.ts packages/protocol/src/premise/premise.graph.ts packages/protocol/src/network/indexer/indexer.graph.ts`
- [x] Intent queue tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun test src/queues/tests/intent.queue.spec.ts`
- [x] Premise graph tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/packages/protocol && bun test src/premise/tests/premise.graph.spec.ts`
- [x] Intent network graph tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/packages/protocol && bun test src/network/indexer/tests/indexer.graph.spec.ts`

#### Manual Verification:
- [x] Global assignment reads all membership networks through `getAssignmentNetworkIdsForUser`, not `getUserIndexIds`.
- [x] Network-scoped assignment evaluates only `networkScopeId` when it is part of the user's memberships.
- [x] Manual intent-network assignment records `mode: "manual_override"` metadata.
- [x] No production branch uses `network_members.autoAssign` to decide premise/intent assignment.


---

## Phase 4: One premise lifecycle for profile answers

### Overview

Implements Slice 4 from the approved design. Files: `packages/protocol/src/premise/premise.state.ts`, `packages/protocol/src/premise/premise.graph.ts`, `backend/src/events/handlers/question.answer.profile.ts`, `backend/src/main.ts`, `backend/src/events/handlers/tests/question.answer.profile.test.ts`, `backend/src/events/handlers/tests/question.answer.handler.test.ts`.

### Changes Required:

#### 1. backend/src/events/handlers/question.answer.profile.ts

**File**: `backend/src/events/handlers/question.answer.profile.ts`  

**Changes**: route profile answer premise creation through a lifecycle dependency.

Purpose: route profile answer premise creation through a lifecycle dependency.
```ts
/**
 * Profile-mode answer handler: creates a premise from the user's answer through
 * the shared PremiseGraph lifecycle.
 *
 * The graph performs analysis, embedding, network assignment, and persistence.
 * This handler emits PremiseEvents.onCreated after the graph returns so the
 * existing profile-regeneration cascade remains unchanged.
 */

import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerProfile');

export interface PremiseLifecycleResult {
  premise?: { id: string };
  error?: string;
}

export interface PremiseCreatorDeps {
  runPremiseLifecycle: (input: {
    userId: string;
    assertionText: string;
    tier: 'assertive' | 'contextual';
    volatile: boolean;
    provenanceSource: 'explicit' | 'enrichment' | 'integration' | 'onboarding';
    provenanceSourceId?: string;
    provenanceConfidence: number;
    networkScopeId?: string;
  }) => Promise<PremiseLifecycleResult>;
  emitPremiseCreated: (premiseId: string, userId: string) => void;
}

/**
 * Build the assertion text from the answer components.
 * Joins selected options with "; " and appends freeText if present.
 */
function buildAssertionText(selectedOptions: string[], freeText?: string): string {
  const base = selectedOptions.join('; ');
  const trimmed = freeText?.trim();
  if (base && trimmed) return `${base}. ${trimmed}`;
  return trimmed || base;
}

export function createPremiseFromAnswerFactory(deps: PremiseCreatorDeps) {
  return async (input: {
    userId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
    sourceId: string;
    networkScopeId?: string;
  }): Promise<void> => {
    const assertionText = buildAssertionText(input.selectedOptions, input.freeText);

    if (!assertionText) {
      logger.warn('Empty answer content — skipping premise creation', {
        questionId: input.questionId,
        userId: input.userId,
      });
      return;
    }

    logger.verbose('Creating premise from profile answer through premise lifecycle', {
      userId: input.userId,
      questionId: input.questionId,
      assertionLength: assertionText.length,
    });

    const result = await deps.runPremiseLifecycle({
      userId: input.userId,
      assertionText,
      tier: 'contextual',
      volatile: false,
      provenanceSource: 'explicit',
      provenanceSourceId: input.questionId,
      provenanceConfidence: 0.9,
      ...(input.networkScopeId ? { networkScopeId: input.networkScopeId } : {}),
    });

    if (!result.premise) {
      logger.warn('Premise lifecycle did not create a premise from profile answer', {
        questionId: input.questionId,
        userId: input.userId,
        error: result.error,
      });
      return;
    }

    deps.emitPremiseCreated(result.premise.id, input.userId);

    logger.info('Premise created from profile answer', {
      premiseId: result.premise.id,
      userId: input.userId,
      questionId: input.questionId,
    });
  };
}
```


#### 2. backend/src/main.ts

**File**: `backend/src/main.ts`  

**Changes**: wire profile answer lifecycle to compiled PremiseGraph and premise events.

Purpose: wire profile answer lifecycle to compiled PremiseGraph and premise events.
```ts
import { NegotiationGraphFactory, PremiseGraphFactory, setTimingWrapper } from '@indexnetwork/protocol';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';
```

```ts
const profileAnswerPremiseGraph = new PremiseGraphFactory(
  chatDatabaseAdapter as unknown as PremiseGraphDatabase,
  embedderAdapter,
).createGraph();
```

```ts
const questionAnswerDeps = {
  createPremiseFromAnswer: createPremiseFromAnswerFactory({
    runPremiseLifecycle: async (input) => profileAnswerPremiseGraph.invoke(input),
    emitPremiseCreated: (premiseId, userId) => PremiseEvents.onCreated(premiseId, userId),
  }),
  enqueueIntentRefinement: enqueueIntentRefinementFactory({
```


#### 3. backend/src/events/handlers/tests/question.answer.profile.test.ts

**File**: `backend/src/events/handlers/tests/question.answer.profile.test.ts`  

**Changes**: verify profile answers delegate to lifecycle and emit premise-created behavior through dependency.

Purpose: verify profile answers delegate to lifecycle and emit premise-created behavior through dependency.
```ts
import { describe, it, expect, mock } from "bun:test";
import { createPremiseFromAnswerFactory, type PremiseCreatorDeps } from "../question.answer.profile";

function makeDeps(overrides?: Partial<PremiseCreatorDeps>): PremiseCreatorDeps {
  return {
    runPremiseLifecycle: mock(async () => ({ premise: { id: "prem-1" } })),
    emitPremiseCreated: mock(() => {}),
    ...overrides,
  };
}
```

```ts
it("routes the answer through PremiseGraph lifecycle", async () => {
  const deps = makeDeps();
  const fn = createPremiseFromAnswerFactory(deps);

  await fn({
    userId: "u-1",
    questionId: "q-1",
    selectedOptions: ["Technical mentorship", "Career guidance"],
    freeText: "Specifically in AI/ML",
    sourceId: "prof-1",
  });

  expect(deps.runPremiseLifecycle).toHaveBeenCalledTimes(1);
  expect((deps.runPremiseLifecycle as ReturnType<typeof mock>).mock.calls[0][0]).toMatchObject({
    userId: "u-1",
    assertionText: expect.stringContaining("Technical mentorship"),
    tier: "contextual",
    volatile: false,
    provenanceSource: "explicit",
    provenanceSourceId: "q-1",
    provenanceConfidence: 0.9,
  });
});

it("emits PremiseEvents.onCreated after successful lifecycle creation", async () => {
  const deps = makeDeps();
  const fn = createPremiseFromAnswerFactory(deps);

  await fn({
    userId: "u-1",
    questionId: "q-1",
    selectedOptions: ["Option A"],
    sourceId: "prof-1",
  });

  expect(deps.emitPremiseCreated).toHaveBeenCalledTimes(1);
  expect((deps.emitPremiseCreated as ReturnType<typeof mock>).mock.calls[0]).toEqual(["prem-1", "u-1"]);
});

it("does not emit when lifecycle returns no premise", async () => {
  const deps = makeDeps({ runPremiseLifecycle: mock(async () => ({ error: "failed" })) });
  const fn = createPremiseFromAnswerFactory(deps);

  await fn({
    userId: "u-1",
    questionId: "q-1",
    selectedOptions: ["Option A"],
    sourceId: "prof-1",
  });

  expect(deps.emitPremiseCreated).not.toHaveBeenCalled();
});
```

Keep/adapt the existing selected-options/free-text/no-content assertions so they now inspect `runPremiseLifecycle` rather than `createPremise`/`embedText`.


#### 4. backend/src/events/handlers/tests/question.answer.handler.test.ts

**File**: `backend/src/events/handlers/tests/question.answer.handler.test.ts`  

**Changes**: verify profile-mode answer dispatch still routes to the profile answer dependency.

Purpose: verify profile-mode answer dispatch still routes to the profile answer dependency.
```ts
it("calls createPremiseFromAnswer for profile mode", async () => {
  await handleQuestionAnswered(
    { ...basePayload, mode: "profile", sourceType: "profile", sourceId: "prof-1" },
    deps,
  );
  expect(deps.createPremiseFromAnswer).toHaveBeenCalledTimes(1);
  const call = (deps.createPremiseFromAnswer as ReturnType<typeof mock>).mock.calls[0];
  expect(call[0]).toEqual({
    userId: "u-1",
    questionId: "q-1",
    selectedOptions: ["Option A"],
    freeText: undefined,
    sourceId: "prof-1",
  });
});
```


### Success Criteria:

#### Automated Verification:
- [x] Profile answer handler no longer embeds or directly creates premises: `cd .worktrees/docs-protocol-assignment-domain-redesign && ! rg "embedText|createPremise:" backend/src/events/handlers/question.answer.profile.ts`
- [x] Profile answer handler routes through lifecycle: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "runPremiseLifecycle|provenanceSourceId" backend/src/events/handlers/question.answer.profile.ts packages/protocol/src/premise/premise.state.ts packages/protocol/src/premise/premise.graph.ts`
- [x] Main wiring compiles lifecycle dependency: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "profileAnswerPremiseGraph|PremiseGraphFactory" backend/src/main.ts`
- [x] Profile handler tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun test src/events/handlers/tests/question.answer.profile.test.ts`
- [x] Question answer dispatcher tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun test src/events/handlers/tests/question.answer.handler.test.ts`

#### Manual Verification:
- [x] Profile answers enter the same PremiseGraph analyze/embed/persist/index lifecycle as other premise creation paths.
- [x] `PremiseEvents.onCreated` is still emitted exactly once after successful graph persistence.
- [x] Empty profile answers still skip premise creation.
- [x] Question provenance is preserved via `provenance.sourceId = questionId`.


---

## Phase 5: Typed opportunity evidence

### Overview

Implements Slice 5 from the approved design. Files: `packages/protocol/src/shared/interfaces/database.interface.ts`, `backend/src/adapters/database.adapter.ts`, `packages/protocol/src/opportunity/opportunity.state.ts`, `packages/protocol/src/opportunity/opportunity.evaluator.ts`, `packages/protocol/src/opportunity/opportunity.evidence.ts`, `packages/protocol/src/opportunity/opportunity.graph.ts`, `packages/protocol/src/opportunity/tests/opportunity.evidence.spec.ts`, `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`.

### Changes Required:

#### 1. packages/protocol/src/shared/interfaces/database.interface.ts

**File**: `packages/protocol/src/shared/interfaces/database.interface.ts`  

**Changes**: allow discovery-created opportunities to persist selected typed evidence without a new opportunity-evidence table.

Purpose: allow discovery-created opportunities to persist selected typed evidence without a new opportunity-evidence table.
```ts
export interface Opportunity {
  id: string;
  detection: OpportunityDetection;
  actors: OpportunityActor[];
  interpretation: OpportunityInterpretation;
  context: OpportunityContext;
  confidence: string;
  status: OpportunityStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateOpportunityData {
  detection: OpportunityDetection;
  actors: OpportunityActor[];
  interpretation: OpportunityInterpretation;
  context: OpportunityContext;
  confidence: string;
  status?: OpportunityStatus;
  expiresAt?: Date;
  metadata?: Record<string, unknown> | null;
}
```


#### 2. backend/src/adapters/database.adapter.ts

**File**: `backend/src/adapters/database.adapter.ts`  

**Changes**: carry optional opportunity metadata through both backend create paths; do not add a schema migration because `opportunities.metadata` already exists.

Purpose: carry optional opportunity metadata through both backend create paths; do not add a schema migration because `opportunities.metadata` already exists.
```ts
interface CreateOpportunityInput {
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  confidence: string;
  status?: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
  expiresAt?: Date;
  metadata?: Record<string, unknown> | null;
}
```

```ts
async createOpportunity(data: CreateOpportunityInput): Promise<OpportunityRow> {
  const [row] = await db
    .insert(opportunities)
    .values({
      detection: data.detection,
      actors: data.actors,
      interpretation: data.interpretation,
      context: data.context,
      confidence: data.confidence,
      status: data.status ?? 'pending',
      expiresAt: data.expiresAt ?? null,
      metadata: data.metadata ?? {},
    })
    .returning();
  if (!row) throw new Error('OpportunityDatabaseAdapter.createOpportunity: no row returned');
  return toOpportunityRow(row);
}
```

```ts
async createOpportunityAndExpireIds(
  data: CreateOpportunityInput,
  expireIds: string[]
): Promise<{ created: OpportunityRow; expired: OpportunityRow[] }> {
  return traceAppOperation(
    {
      name: 'db create opportunity and expire ids',
      op: 'db.transaction',
      attributes: {
        subsystem: 'database',
        'db.system': 'postgresql',
        'db.operation': 'transaction',
        'opportunity.expire_count': expireIds.length,
      },
    },
    () => db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(opportunities)
        .values({
          detection: data.detection,
          actors: data.actors,
          interpretation: data.interpretation,
          context: data.context,
          confidence: data.confidence,
          status: data.status ?? 'pending',
          expiresAt: data.expiresAt ?? null,
          metadata: data.metadata ?? {},
        })
        .returning();
      if (!inserted) throw new Error('OpportunityDatabaseAdapter.createOpportunityAndExpireIds: no row returned');
      const created = toOpportunityRow(inserted);
      const expired: OpportunityRow[] = [];
      const now = new Date();
      for (const id of expireIds) {
        const [row] = await tx
          .update(opportunities)
          .set({ status: 'expired', updatedAt: now })
          .where(eq(opportunities.id, id))
          .returning();
        if (row) expired.push(toOpportunityRow(row));
      }
      return { created, expired };
    }),
  );
}
```


#### 3. packages/protocol/src/opportunity/opportunity.state.ts

**File**: `packages/protocol/src/opportunity/opportunity.state.ts`  

**Changes**: add typed evidence bundle to CandidateMatch and evaluator output state.

Purpose: add typed evidence bundle to CandidateMatch and evaluator output state.
```ts
import type { OpportunityEvidence } from '../shared/schemas/network-assignment.schema.js';

export interface CandidateMatch {
  candidateUserId: Id<'users'>;
  candidateIntentId?: Id<'intents'>;
  candidatePremiseId?: Id<'premises'>;
  sourcePremiseId?: Id<'premises'>;
  sourceContextId?: string;
  networkId: Id<'networks'>;
  similarity: number;
  lens: string;
  candidatePayload: string;
  candidateSummary?: string;
  discoverySource?: 'query' | 'premise-similarity' | 'context-to-intent';
  matchedStrategies?: string[];
  evidence?: OpportunityEvidence[];
}

export interface EvaluatedOpportunity {
  actors: EvaluatedOpportunityActor[];
  score: number;
  reasoning: string;
  evidence?: OpportunityEvidence[];
}
```


#### 4. packages/protocol/src/opportunity/opportunity.evaluator.ts

**File**: `packages/protocol/src/opportunity/opportunity.evaluator.ts`  

**Changes**: include typed evidence on EvaluatorEntity and prompt rendering without replacing existing `ragScore` / `matchedVia` signals.

Purpose: include typed evidence on EvaluatorEntity and prompt rendering without replacing existing `ragScore` / `matchedVia` signals.
```ts
import type { OpportunityEvidence } from '../shared/schemas/network-assignment.schema.js';
import { renderOpportunityEvidenceForPrompt } from './opportunity.evidence.js';

export interface EvaluatorEntity {
  userId: string;
  profile: {
    name?: string;
    bio?: string;
    location?: string;
    interests?: string[];
    skills?: string[];
    context?: string;
  };
  intents?: Array<{
    intentId: string;
    payload: string;
    summary?: string;
  }>;
  networkId: string;
  evidenceKey: string;
  ragScore?: number;
  matchedVia?: string;
  evidence?: OpportunityEvidence[];
}
```

```ts
  RAG SCORE: ${e.ragScore ?? '—'}
  MATCHED VIA: ${e.matchedVia ?? '—'}
  EVIDENCE:
${renderOpportunityEvidenceForPrompt(e.evidence ?? [])}`;
```


#### 5. packages/protocol/src/opportunity/opportunity.evidence.ts

**File**: `packages/protocol/src/opportunity/opportunity.evidence.ts`  

**Changes**: pure evidence helpers for CandidateMatch and EvaluatorEntity conversion.

Purpose: pure evidence helpers for CandidateMatch and EvaluatorEntity conversion.
```ts
import type { OpportunityEvidence } from '../shared/schemas/network-assignment.schema.js';

export interface EvidenceCandidateInput {
  networkId: string;
  similarity: number;
  lens: string;
  discoverySource?: 'query' | 'premise-similarity' | 'context-to-intent';
  matchedStrategies?: string[];
  sourcePremiseId?: string;
  candidatePremiseId?: string;
  candidateIntentId?: string;
  sourceContextId?: string;
  candidatePayload?: string;
  candidateSummary?: string;
}

export function buildCandidateEvidence(candidate: EvidenceCandidateInput): OpportunityEvidence {
  const kind = resolveEvidenceKind(candidate);
  return {
    kind,
    networkId: candidate.networkId,
    score: candidate.similarity,
    lens: candidate.lens,
    discoverySource: candidate.discoverySource,
    matchedStrategies: candidate.matchedStrategies,
    sourcePremiseId: candidate.sourcePremiseId,
    candidatePremiseId: candidate.candidatePremiseId,
    candidateIntentId: candidate.candidateIntentId,
    sourceContextId: candidate.sourceContextId,
    payload: candidate.candidatePayload,
    summary: candidate.candidateSummary,
    assertionText: candidate.candidatePremiseId ? candidate.candidatePayload : undefined,
  };
}

export function withCandidateEvidence<T extends EvidenceCandidateInput>(candidate: T): T & { evidence: OpportunityEvidence[] } {
  return { ...candidate, evidence: [buildCandidateEvidence(candidate)] };
}

export function mergeOpportunityEvidence(...groups: Array<OpportunityEvidence[] | undefined>): OpportunityEvidence[] {
  const byKey = new Map<string, OpportunityEvidence>();
  for (const evidence of groups.flatMap((group) => group ?? [])) {
    const key = [
      evidence.kind,
      evidence.networkId,
      evidence.sourcePremiseId ?? '',
      evidence.candidatePremiseId ?? '',
      evidence.candidateIntentId ?? '',
      evidence.sourceContextId ?? '',
      evidence.lens ?? '',
    ].join('|');
    const existing = byKey.get(key);
    if (!existing || (evidence.score ?? 0) > (existing.score ?? 0)) byKey.set(key, evidence);
  }
  return Array.from(byKey.values());
}

export function withMatchedStrategies(evidence: OpportunityEvidence[], strategies: string[]): OpportunityEvidence[] {
  return evidence.map((item) => ({
    ...item,
    matchedStrategies: Array.from(new Set([...(item.matchedStrategies ?? []), ...strategies])),
  }));
}

export function renderOpportunityEvidenceForPrompt(evidence: OpportunityEvidence[]): string {
  if (evidence.length === 0) return '    —';
  return evidence.map((item) => {
    const refs = [
      item.sourcePremiseId ? `sourcePremise=${item.sourcePremiseId}` : undefined,
      item.candidatePremiseId ? `candidatePremise=${item.candidatePremiseId}` : undefined,
      item.candidateIntentId ? `candidateIntent=${item.candidateIntentId}` : undefined,
      item.sourceContextId ? `sourceContext=${item.sourceContextId}` : undefined,
      item.matchedStrategies?.length ? `strategies=${item.matchedStrategies.join(',')}` : undefined,
    ].filter(Boolean).join(', ');
    const text = item.summary ?? item.payload ?? item.assertionText ?? '';
    return `    - ${item.kind} on ${item.networkId} via ${item.lens ?? 'unknown'} score=${item.score?.toFixed(3) ?? '—'}${refs ? ` (${refs})` : ''}${text ? `: ${text}` : ''}`;
  }).join('\n');
}

function resolveEvidenceKind(candidate: EvidenceCandidateInput): OpportunityEvidence['kind'] {
  if (candidate.discoverySource === 'premise-similarity') return 'premise_similarity';
  if (candidate.discoverySource === 'context-to-intent') return 'context_to_intent';
  if (candidate.candidatePremiseId) return 'query_premise';
  if (candidate.candidateIntentId) return 'query_intent';
  return 'profile';
}
```


#### 6. packages/protocol/src/opportunity/opportunity.graph.ts

**File**: `packages/protocol/src/opportunity/opportunity.graph.ts`  

**Changes**: preserve source/candidate evidence through every discovery candidate path, merge strategy, evaluation conversion, and persistence metadata.

Purpose: preserve source/candidate evidence through every discovery candidate path, merge strategy, evaluation conversion, and persistence metadata.
```ts
import type { OpportunityEvidence } from '../shared/schemas/network-assignment.schema.js';
import {
  mergeOpportunityEvidence,
  withCandidateEvidence,
  withMatchedStrategies,
} from './opportunity.evidence.js';
```

Direct target candidate construction:
```ts
directCandidates.push(withCandidateEvidence({
  candidateUserId: state.targetUserId,
  candidateIntentId: intent.id as Id<'intents'>,
  networkId,
  similarity: 1.0,
  lens: 'explicit_mention',
  candidatePayload: intent.payload,
  candidateSummary: intent.summary ?? undefined,
  discoverySource: 'query',
}));
```

Profile-only fallback direct target candidate:
```ts
directCandidates.push(withCandidateEvidence({
  candidateUserId: state.targetUserId,
  networkId: sharedIndexIds[0] as Id<'networks'>,
  similarity: 1.0,
  lens: 'explicit_mention',
  candidatePayload: '',
  candidateSummary: undefined,
  discoverySource: 'query',
}));
```

Query/direct search candidates:
```ts
all.push(withCandidateEvidence({
  candidateUserId: r.userId as Id<'users'>,
  candidateIntentId: r.id as Id<'intents'>,
  networkId: targetIndex.networkId,
  similarity: r.score,
  lens: r.matchedVia,
  candidatePayload: '',
  candidateSummary: undefined,
  discoverySource: 'query' as const,
}));

all.push(withCandidateEvidence({
  candidateUserId: r.userId as Id<'users'>,
  candidatePremiseId: r.id as Id<'premises'>,
  networkId: targetIndex.networkId,
  similarity: r.score,
  lens: r.matchedVia,
  candidatePayload: '',
  candidateSummary: undefined,
  discoverySource: 'query' as const,
}));
```

HyDE result candidates:
```ts
allCandidates.push(withCandidateEvidence({
  candidateUserId: result.userId as Id<'users'>,
  candidateIntentId: result.id as Id<'intents'>,
  networkId: targetIndex.networkId,
  similarity: result.score,
  lens: result.matchedVia,
  candidatePayload: '',
  candidateSummary: undefined,
  discoverySource: 'query' as const,
}));

allCandidates.push(withCandidateEvidence({
  candidateUserId: result.userId as Id<'users'>,
  candidatePremiseId: result.id as Id<'premises'>,
  networkId: targetIndex.networkId,
  similarity: result.score,
  lens: result.matchedVia,
  candidatePayload: '',
  candidateSummary: undefined,
  discoverySource: 'query' as const,
}));
```

Premise-similarity candidates, including batched and single-source fallback paths:
```ts
const rawResults = self.database.searchPremisesBySimilarityBatch
  ? await self.database.searchPremisesBySimilarityBatch({
      sources: sourcePremises,
      networkIds: targetNetworkIds,
      excludeUserId: discoveryUserId,
      limitPerSource: PREMISE_MATCH_LIMIT_PER_SOURCE,
    })
  : (await Promise.all(
      sourcePremises.map(async (sp) => {
        const results = await self.database.searchPremisesBySimilarity({
          embedding: sp.embedding,
          networkIds: targetNetworkIds,
          excludeUserId: discoveryUserId,
          limit: PREMISE_MATCH_LIMIT_PER_SOURCE,
        });
        return results.map((r) => ({ ...r, sourcePremiseId: sp.premiseId }));
      })
    )).flat();
```

```ts
premiseCandidates.push(withCandidateEvidence({
  candidateUserId: r.userId as Id<'users'>,
  sourcePremiseId: r.sourcePremiseId as Id<'premises'> | undefined,
  candidatePremiseId: r.premiseId as Id<'premises'>,
  networkId: r.networkId as Id<'networks'>,
  similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(String(r.similarity)),
  lens: 'premise_match',
  candidatePayload: r.assertionText ?? '',
  discoverySource: 'premise-similarity',
}));
```

HyDE-enhanced context-to-intent candidates:
```ts
contextCandidates.push(withCandidateEvidence({
  candidateUserId: r.userId as Id<'users'>,
  candidateIntentId: r.id as Id<'intents'>,
  sourceContextId: ctx.contextId,
  networkId: ctx.networkId as Id<'networks'>,
  similarity: r.score,
  lens: r.matchedVia,
  candidatePayload: '',
  candidateSummary: undefined,
  discoverySource: 'context-to-intent',
}));
```

Raw-embedding context-to-intent fallback candidates:
```ts
contextCandidates.push(withCandidateEvidence({
  candidateUserId: r.userId as Id<'users'>,
  candidateIntentId: r.intentId as Id<'intents'>,
  sourceContextId: ctx.contextId,
  networkId: r.networkId as Id<'networks'>,
  similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(String(r.similarity)),
  lens: 'context_match',
  candidatePayload: r.payload ?? '',
  candidateSummary: r.summary ?? undefined,
  discoverySource: 'context-to-intent',
}));
```

Merge strategy evidence preservation:
```ts
existing._strategies.add(c.discoverySource ?? 'unknown');
const mergedEvidence = mergeOpportunityEvidence(existing.evidence, c.evidence);
if (c.similarity > existing.similarity) {
  Object.assign(existing, { ...c, evidence: mergedEvidence });
} else {
  existing.evidence = mergedEvidence;
}
```

```ts
return Array.from(merged.values()).map(({ _strategies, ...c }) => {
  const matchedStrategies = Array.from(_strategies);
  const boost = Math.min((_strategies.size - 1) * 0.05, 0.15);
  return {
    ...c,
    similarity: Math.min(c.similarity + boost, 1.0),
    matchedStrategies,
    evidence: withMatchedStrategies(mergeOpportunityEvidence(c.evidence), matchedStrategies),
  };
});
```

Evaluator entity conversion:
```ts
const evidenceKey = buildEvaluatorEvidenceKey(c);
return {
  userId: c.candidateUserId,
  profile: {
    name: profile?.identity?.name,
    bio: profile?.identity?.bio,
    location: profile?.identity?.location,
    interests: profile?.attributes?.interests,
    skills: profile?.attributes?.skills,
    context: profile?.narrative?.context,
  },
  intents:
    c.candidateIntentId != null
      ? [{ intentId: c.candidateIntentId, payload: intentPayload ?? '', summary: intentSummary }]
      : undefined,
  networkId: c.networkId,
  evidenceKey,
  ragScore: c.similarity * 100,
  matchedVia: c.lens,
  evidence: c.evidence,
};

function buildEvaluatorEvidenceKey(candidate: CandidateMatch): string {
  return [
    candidate.candidateUserId,
    candidate.networkId,
    candidate.candidateIntentId ?? candidate.candidatePremiseId ?? candidate.sourceContextId ?? 'profile',
  ].join(':');
}
```

Evaluator output evidence mapping:
```ts
const evidenceByEntityKey = new Map<string, OpportunityEvidence[]>();
const entityKeysByUserId = new Map<string, string[]>();
for (const entity of candidateEntities) {
  evidenceByEntityKey.set(
    entity.evidenceKey,
    mergeOpportunityEvidence(evidenceByEntityKey.get(entity.evidenceKey), entity.evidence),
  );
  entityKeysByUserId.set(entity.userId, [...(entityKeysByUserId.get(entity.userId) ?? []), entity.evidenceKey]);
}

function evidenceForActor(actor: { userId: string; intentId?: string | null; evidenceKey?: string | null }): OpportunityEvidence[] | undefined {
  if (actor.evidenceKey) return evidenceByEntityKey.get(actor.evidenceKey);
  const keys = entityKeysByUserId.get(actor.userId) ?? [];
  const intentKey = actor.intentId ? keys.find((key) => key.endsWith(`:${actor.intentId}`)) : undefined;
  if (intentKey) return evidenceByEntityKey.get(intentKey);
  // Avoid leaking unrelated resource evidence when the evaluator collapsed multiple
  // candidates for the same user into a profile-only actor.
  if (keys.length === 1) return evidenceByEntityKey.get(keys[0]);
  return undefined;
}

const evaluatedOpportunities: EvaluatedOpportunity[] = pairwiseOpportunities.map((op) => ({
  reasoning: op.reasoning,
  score: op.score,
  evidence: mergeOpportunityEvidence(...op.actors.map(evidenceForActor)),
  actors: op.actors.map((a) => {
    // existing actor mapping body unchanged
  }),
}));
```

Discovery-path persistence:
```ts
metadata: {
  evidence: evaluated.evidence ?? [],
},
```


#### 7. packages/protocol/src/opportunity/tests/opportunity.evidence.spec.ts

**File**: `packages/protocol/src/opportunity/tests/opportunity.evidence.spec.ts`  

**Changes**: verify evidence helper behavior.

Purpose: verify evidence helper behavior.
```ts
import { describe, expect, it } from 'bun:test';

import {
  buildCandidateEvidence,
  mergeOpportunityEvidence,
  renderOpportunityEvidenceForPrompt,
  withMatchedStrategies,
} from '../opportunity.evidence.js';

describe('opportunity.evidence', () => {
  it('builds premise-similarity evidence', () => {
    const evidence = buildCandidateEvidence({
      networkId: 'net-1',
      similarity: 0.82,
      lens: 'premise_match',
      discoverySource: 'premise-similarity',
      sourcePremiseId: 'source-premise',
      candidatePremiseId: 'candidate-premise',
      candidatePayload: 'I build AI tools',
    });

    expect(evidence).toMatchObject({
      kind: 'premise_similarity',
      networkId: 'net-1',
      score: 0.82,
      sourcePremiseId: 'source-premise',
      candidatePremiseId: 'candidate-premise',
      assertionText: 'I build AI tools',
    });
  });

  it('uses profile evidence kind for profile-only candidates', () => {
    const evidence = buildCandidateEvidence({
      networkId: 'net-1',
      similarity: 1,
      lens: 'explicit_mention',
      discoverySource: 'query',
    });

    expect(evidence.kind).toBe('profile');
  });

  it('merges duplicate evidence by stable key and keeps highest score', () => {
    const merged = mergeOpportunityEvidence(
      [{ kind: 'query_intent', networkId: 'net-1', candidateIntentId: 'intent-1', lens: 'mirror', score: 0.7 }],
      [{ kind: 'query_intent', networkId: 'net-1', candidateIntentId: 'intent-1', lens: 'mirror', score: 0.9 }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.9);
  });

  it('copies matched strategies onto merged evidence', () => {
    const evidence = withMatchedStrategies([
      { kind: 'query_intent', networkId: 'net-1', candidateIntentId: 'intent-1', lens: 'mirror', score: 0.9 },
    ], ['query', 'context-to-intent']);

    expect(evidence[0].matchedStrategies).toEqual(['query', 'context-to-intent']);
  });

  it('renders evidence for evaluator prompt', () => {
    const rendered = renderOpportunityEvidenceForPrompt([
      { kind: 'context_to_intent', networkId: 'net-1', sourceContextId: 'ctx-1', candidateIntentId: 'intent-1', lens: 'context_match', score: 0.8, matchedStrategies: ['context-to-intent'] },
    ]);

    expect(rendered).toContain('context_to_intent');
    expect(rendered).toContain('sourceContext=ctx-1');
    expect(rendered).toContain('candidateIntent=intent-1');
    expect(rendered).toContain('strategies=context-to-intent');
  });
});
```


#### 8. packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts

**File**: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`  

**Changes**: verify evidence survives discovery/evaluation and opportunity metadata persistence.

Purpose: verify evidence survives discovery/evaluation and opportunity metadata persistence.
```ts
test('persists typed opportunity evidence in metadata', async () => {
  const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
  const createSpy = spyOn(mockDb, 'createOpportunity');
  spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
    {
      type: 'intent' as const,
      id: 'intent-bob',
      userId: 'b0000000-0000-4000-8000-000000000002',
      score: 0.9,
      matchedVia: 'mirror' as const,
      networkId: 'idx-1',
    },
  ]);

  await compiledGraph.invoke({
    userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
    searchQuery: 'co-founder',
    options: { minScore: 70 },
  } as OpportunityGraphInvokeInput);

  expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
    metadata: expect.objectContaining({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          kind: 'query_intent',
          candidateIntentId: 'intent-bob',
          networkId: 'idx-1',
          score: 0.9,
          matchedStrategies: expect.arrayContaining(['query']),
        }),
      ]),
    }),
  }));
});
```


### Success Criteria:

#### Automated Verification:
- [x] Evidence helper tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/packages/protocol && bun test src/opportunity/tests/opportunity.evidence.spec.ts`
- [x] Opportunity graph tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/packages/protocol && bun test src/opportunity/tests/opportunity.graph.spec.ts`
- [x] Evaluator receives typed evidence: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "renderOpportunityEvidenceForPrompt|evidence" packages/protocol/src/opportunity/opportunity.evaluator.ts packages/protocol/src/opportunity/opportunity.graph.ts`
- [x] Opportunity persistence includes metadata evidence: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "evidence: evaluated\.evidence" packages/protocol/src/opportunity/opportunity.graph.ts`
- [x] Backend create opportunity saves metadata in both create paths: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "metadata: data\.metadata" backend/src/adapters/database.adapter.ts | wc -l` returns at least 2

#### Manual Verification:
- [x] Candidate evidence preserves discovery kind, network, score, lens, matched strategies, and source/candidate ids where available.
- [x] Entity-bundle evaluator prompt includes evidence without replacing existing `ragScore`/`matchedVia` fields.
- [x] Persisted opportunities include `metadata.evidence` for discovery-path opportunities.
- [x] Introduction/manual opportunities are not forced to invent evidence when none exists.


---

## Phase 6: End-to-end verification surface

### Overview

Implements Slice 6 from the approved design. Files: `backend/src/queues/tests/intent.queue.spec.ts`, `backend/src/events/handlers/tests/question.answer.profile.test.ts`, `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`.

### Changes Required:

#### 1. backend/src/queues/tests/intent.queue.spec.ts

**File**: `backend/src/queues/tests/intent.queue.spec.ts`  

**Changes**: add regression coverage that intent assignment uses the shared policy semantics from Slices 1–3, not `autoAssign` gating.

Purpose: add regression coverage that intent assignment uses the shared policy semantics from Slices 1–3, not `autoAssign` gating.
```ts
import { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD } from '@indexnetwork/protocol';

describe('network assignment domain invariants', () => {
  it('evaluates all user memberships in global scope and stores assignment metadata', async () => {
    const assignIntentToNetwork = mock(async () => {});
    const evaluateIntentAssignment = mock(async () => ({
      indexScore: 0.86,
      memberScore: 0.82,
      reasoning: 'Intent matches network and member prompts.',
    }));
    const db = {
      getIntentForIndexing: async () => ({ id: 'intent-1', payload: 'Build protocol tools', userId: 'user-1', sourceType: null, sourceId: null }),
      getAssignmentNetworkIdsForUser: mock(async () => ['net-a', 'net-b']),
      getNetworkAssignmentContext: mock(async (networkId: string) => ({
        networkId,
        indexPrompt: `Index prompt for ${networkId}`,
        memberPrompt: `Member prompt for ${networkId}`,
      })),
      assignIntentToNetwork,
      deleteHydeDocumentsForSource: async () => 0,
    };
    const queue = new IntentQueue({
      database: asIntentDb(db),
      invokeHyde: mock(async () => {}),
      addOpportunityJob: mock(async () => ({})),
      evaluateIntentAssignment,
    });

    await queue.processJob('generate_hyde', { intentId: 'intent-1', userId: 'user-1' });

    expect(db.getAssignmentNetworkIdsForUser).toHaveBeenCalledWith('user-1');
    expect(assignIntentToNetwork.mock.calls.map((call) => call[1]).sort()).toEqual(['net-a', 'net-b']);
    for (const call of assignIntentToNetwork.mock.calls) {
      expect(call[3]).toEqual(expect.objectContaining({
        resourceType: 'intent',
        mode: 'automatic',
        scope: 'global',
        policy: 'unified-threshold-v1',
        threshold: DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD,
        assigned: true,
      }));
    }
  });

  it('limits network-scoped assignment to the requested network', async () => {
    const getNetworkAssignmentContext = mock(async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }));
    const assignIntentToNetwork = mock(async () => {});
    const db = {
      getIntentForIndexing: async () => ({ id: 'intent-1', payload: 'Build protocol tools', userId: 'user-1', sourceType: null, sourceId: null }),
      getAssignmentNetworkIdsForUser: mock(async () => ['net-a', 'net-b']),
      getNetworkAssignmentContext,
      assignIntentToNetwork,
      deleteHydeDocumentsForSource: async () => 0,
    };
    const queue = new IntentQueue({ database: asIntentDb(db), invokeHyde: mock(async () => {}), addOpportunityJob: mock(async () => ({})) });

    await queue.processJob('generate_hyde', { intentId: 'intent-1', userId: 'user-1', networkScopeId: 'net-b' });

    expect(getNetworkAssignmentContext).toHaveBeenCalledTimes(1);
    expect(getNetworkAssignmentContext).toHaveBeenCalledWith('net-b', 'user-1');
    expect(assignIntentToNetwork.mock.calls.map((call) => call[1])).toEqual(['net-b']);
  });
});
```


#### 2. backend/src/events/handlers/tests/question.answer.profile.test.ts

**File**: `backend/src/events/handlers/tests/question.answer.profile.test.ts`  

**Changes**: assert profile-answer premises remain on the graph-backed lifecycle and never reintroduce direct embed/create shortcuts.

Purpose: assert profile-answer premises remain on the graph-backed lifecycle and never reintroduce direct embed/create shortcuts.
```ts
it('routes profile-answer premises through lifecycle with assignment-capable graph input', async () => {
  const deps = makeDeps();
  const fn = createPremiseFromAnswerFactory(deps);

  await fn({
    userId: 'user-1',
    questionId: 'question-1',
    selectedOptions: ['AI developer tools'],
    freeText: 'especially protocol design',
    sourceId: 'profile-1',
  });

  expect(deps.runPremiseLifecycle).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-1',
    assertionText: expect.stringContaining('AI developer tools'),
    tier: 'contextual',
    volatile: false,
    provenanceSource: 'explicit',
    provenanceSourceId: 'question-1',
  }));
  expect(deps.createPremise).toBeUndefined();
  expect(deps.embedText).toBeUndefined();
});
```


#### 3. packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts

**File**: `packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts`  

**Changes**: assert surfaced opportunities retain typed evidence after strategy merge and persistence.

Purpose: assert surfaced opportunities retain typed evidence after strategy merge and persistence.
```ts
// Add `mock` to this file's bun:test import:
// import { describe, test, it, expect, spyOn, mock } from 'bun:test';

test('merges strategy evidence before persisting surfaced opportunities', async () => {
  const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
  const createSpy = spyOn(mockDb, 'createOpportunity');

  spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
    { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'net-1' },
  ]);
  mockDb.getUserContexts = mock(async () => [
    {
      id: 'ctx-1',
      networkId: 'net-1',
      text: 'Alice is looking for protocol collaborators',
      embedding: dummyEmbedding,
      premiseHash: 'hash-1',
      generatedAt: new Date('2026-06-09T00:00:00.000Z'),
    },
  ]) as typeof mockDb.getUserContexts;
  mockDb.getHydeDocumentsForSource = mock(async () => []) as typeof mockDb.getHydeDocumentsForSource;
  mockDb.searchIntentsByContextEmbedding = mock(async () => [
    { intentId: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', networkId: 'net-1', similarity: 0.86, payload: 'Looking for protocol collaborators' },
  ]) as typeof mockDb.searchIntentsByContextEmbedding;

  await compiledGraph.invoke({
    userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
    searchQuery: 'protocol collaborator',
    options: { minScore: 70 },
  } as OpportunityGraphInvokeInput);

  expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
    metadata: expect.objectContaining({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          candidateIntentId: 'intent-bob',
          networkId: 'net-1',
          matchedStrategies: expect.arrayContaining(['query', 'context-to-intent']),
        }),
      ]),
    }),
  }));
});
```


### Success Criteria:

#### Automated Verification:
- [x] Shared assignment helper tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/packages/protocol && bun test src/shared/assignment/tests/network-assignment.policy.spec.ts`
- [x] Intent queue assignment regression tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun test src/queues/tests/intent.queue.spec.ts`
- [x] Profile answer lifecycle regression tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun test src/events/handlers/tests/question.answer.profile.test.ts src/events/handlers/tests/question.answer.handler.test.ts`
- [x] Opportunity evidence helper and integration tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/packages/protocol && bun test src/opportunity/tests/opportunity.evidence.spec.ts src/opportunity/tests/opportunity.graph.spec.ts`
- [x] Premise graph assignment tests pass: `cd .worktrees/docs-protocol-assignment-domain-redesign/packages/protocol && bun test src/premise/tests/premise.graph.spec.ts`
- [x] Migration flow is clean after implementation: `cd .worktrees/docs-protocol-assignment-domain-redesign/backend && bun run db:generate && bun run db:migrate && bun run db:generate`
- [x] Assignment metadata is visible across schema, interfaces, adapters, and graph/queue call sites: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "assignmentMetadata|NetworkAssignmentMetadata" backend packages/protocol`
- [x] Production assignment code does not use `autoAssign` as assignment gate: `cd .worktrees/docs-protocol-assignment-domain-redesign && ! rg "autoAssign" packages/protocol/src/premise/premise.graph.ts backend/src/queues/intent.queue.ts packages/protocol/src/network/indexer/indexer.graph.ts`
- [x] Profile answer handler has no direct premise/embed shortcut: `cd .worktrees/docs-protocol-assignment-domain-redesign && ! rg "embedText|createPremise:" backend/src/events/handlers/question.answer.profile.ts`
- [x] Opportunity evidence is visible across state/evaluator/graph/tests: `cd .worktrees/docs-protocol-assignment-domain-redesign && rg "OpportunityEvidence|evidence" packages/protocol/src/opportunity`

#### Manual Verification:
- [x] Slice 6 only adds/updates tests and verification checks; it introduces no runtime behavior.
- [x] The regression surface covers the three redesign pillars: assignment policy/metadata, one premise lifecycle, and typed opportunity evidence persistence.
- [x] Verification commands mirror the artifact-level Verification Notes so `/skill:implement` and `/skill:validate` can execute them phase-by-phase.


---

## Testing Strategy

### Automated:

- Run protocol helper tests: `cd packages/protocol && bun test src/shared/assignment/tests/network-assignment.policy.spec.ts`.
- Run backend queue tests: `cd backend && bun test src/queues/tests/intent.queue.spec.ts`.
- Run backend handler tests: `cd backend && bun test src/events/handlers/tests/question.answer.profile.test.ts src/events/handlers/tests/question.answer.handler.test.ts`.
- Run opportunity tests: `cd packages/protocol && bun test src/opportunity/tests/opportunity.evidence.spec.ts src/opportunity/tests/opportunity.graph.spec.ts`.
- Run premise tests: `cd packages/protocol && bun test src/premise/tests/premise.graph.spec.ts`.
- Run database migration flow after implementation: `cd backend && bun run db:generate && bun run db:migrate` and verify a second `bun run db:generate` reports no changes.
- Inspect assignment metadata with grep: `rg "assignmentMetadata|NetworkAssignmentMetadata" backend packages/protocol` should show schema, interface, adapter, and graph/queue call sites.
- Inspect opportunity evidence with grep: `rg "OpportunityEvidence|evidence" packages/protocol/src/opportunity` should show state, evaluator, graph, and tests.

### Manual Testing Steps:

1. `packages/protocol/src/shared/schemas/network-assignment.schema.ts` contains only DTO/schema definitions and no graph/backend imports.
2. `packages/protocol/src/shared/assignment/network-assignment.policy.ts` is pure and contains no database, queue, model, logger, or time-source imports.
3. `premise_networks` and `intent_networks` retain `relevancy_score` and add nullable `assignment_metadata` JSONB.
4. `backend/drizzle/meta/_journal.json` appends `0082_add_assignment_metadata` inside the existing `entries` array; it is not replaced by a bare object.
5. `backend/drizzle/meta/0082_snapshot.json` is generated by Drizzle and committed with the SQL migration, not hand-authored.
6. Protocol interface changes import `NetworkAssignmentMetadata` at top-level and use optional metadata parameters.
7. Existing `assignIntentToNetwork(intentId, networkId)` and `assignPremiseToNetwork(premiseId, networkId, score)` call sites remain source-compatible because metadata is optional.
8. Global assignment reads all membership networks through `getAssignmentNetworkIdsForUser`, not `getUserIndexIds`.
9. Network-scoped assignment evaluates only `networkScopeId` when it is part of the user's memberships.
10. Manual intent-network assignment records `mode: "manual_override"` metadata.
11. No production branch uses `network_members.autoAssign` to decide premise/intent assignment.
12. Profile answers enter the same PremiseGraph analyze/embed/persist/index lifecycle as other premise creation paths.
13. `PremiseEvents.onCreated` is still emitted exactly once after successful graph persistence.
14. Empty profile answers still skip premise creation.
15. Question provenance is preserved via `provenance.sourceId = questionId`.
16. Candidate evidence preserves discovery kind, network, score, lens, matched strategies, and source/candidate ids where available.
17. Entity-bundle evaluator prompt includes evidence without replacing existing `ragScore`/`matchedVia` fields.
18. Persisted opportunities include `metadata.evidence` for discovery-path opportunities.
19. Introduction/manual opportunities are not forced to invent evidence when none exists.
20. Slice 6 only adds/updates tests and verification checks; it introduces no runtime behavior.
21. The regression surface covers the three redesign pillars: assignment policy/metadata, one premise lifecycle, and typed opportunity evidence persistence.
22. Verification commands mirror the artifact-level Verification Notes so `/skill:implement` and `/skill:validate` can execute them phase-by-phase.


## Performance Considerations

- Global assignment now evaluates all memberships instead of only `autoAssign=true`; keep membership fetch bounded to existing user memberships and preserve network-scoped filtering for agent/network scope.
- Premise-rich opportunity discovery already caps source premises with `DISCOVERY_SOURCE_PREMISE_LIMIT`; do not remove this fan-out guard.
- Persisted metadata adds JSONB writes on assignment upsert; avoid extra read-before-write where policy helpers can build metadata from already-loaded prompts/scores.
- Evidence bundles can grow; persist selected evidence for surfaced opportunities, not every discarded candidate.


## Migration Notes

- Add nullable JSONB `assignment_metadata` columns to `premise_networks` and `intent_networks`.
- Existing assignment rows remain valid with `assignment_metadata = NULL` and can be interpreted as legacy assignments.
- No rollback data loss beyond dropping assignment metadata columns if migration is reversed.
- Opportunity evidence persistence uses existing `opportunities.metadata`; no schema change needed for opportunity evidence.


## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

_Coverage reviewer emitted no findings — all verification intents were covered by phase Success Criteria or visible code mirrors._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 6 §3 (opportunity.graph.spec.ts) | packages/protocol/src/opportunity/tests/opportunity.graph.spec.ts:109 | blocker | actionability | The planned merge-strategy evidence test only assigns `mockDb.searchIntentsByContextEmbedding`, but the live mock returns `getUserContexts: async () => []`, so the context-to-intent path never runs and `matchedStrategies` cannot include `"context-to-intent"`. | Add a source-context fixture to the Phase 6 test and provide `getHydeDocumentsForSource: async () => []` so the raw context-to-intent fallback is exercised. | applied: Phase 6 test now supplies a source context fixture, empty HyDE-doc fallback, and raw context-to-intent mock before invocation. |
| code | Phase 2 §5 (database.adapter.ts) | backend/src/adapters/database.adapter.ts:1555 | concern | codebase-fit | `getAssignmentNetworkIdsForUser` selects all `network_members` rows, but the codebase explicitly distinguishes a user's own personal network from contact memberships on other users' personal indexes to avoid cross-personal-index leakage. | Exclude contact-only memberships on other users' personal networks, or constrain assignment eligibility to non-contact memberships plus the user's own personal network. | applied: Phase 2 query now mirrors membership visibility by left-joining `personalNetworks` and allowing non-personal networks plus the user's own personal network only. |
| code | Phase 5 §6 (opportunity.graph.ts) | packages/protocol/src/opportunity/opportunity.graph.ts:1687 | concern | code-quality | The planned `evidenceByUserId` map keys evidence only by `userId`, so multiple candidates for the same user across different intents, premises, or networks can leak evidence into the wrong evaluated opportunity. | Key evidence by the matched entity identity, such as `userId + intentId/premiseId + networkId`, and map each actor back to that entity-specific key. | applied: Phase 5 now adds `evidenceKey`, stores evidence by entity key, maps actors by explicit key or intent key, and fails closed for ambiguous profile-only actor evidence. |

## Developer Context

Step 5 triage: applied all plan-reviewer findings (1 blocker, 2 concerns).


## References

- Design: `.worktrees/docs-protocol-assignment-domain-redesign/.rpiv/artifacts/designs/2026-06-09_23-11-22_protocol-assignment-domain-redesign.md`
- `.rpiv/artifacts/research/2026-06-09_22-56-27_protocol-assignment-domain-redesign.md`
- `.rpiv/artifacts/discover/2026-06-09_22-29-03_protocol-assignment-domain-redesign.md`
