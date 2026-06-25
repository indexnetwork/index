---
date: 2026-06-25T10:10:04+0300
author: Yanek Yuk
commit: 8304e875a0
branch: dev
repository: index
topic: split-chat-scope-semantics
tags: [protocol, chat, scope, opportunities, questions]
status: in-progress
parent: null
phase_count: 6
phases:
  - { n: 1, title: Scope envelope foundation }
  - { n: 2, title: Context and DB clamp wiring }
  - { n: 3, title: Assignment writes and tests }
  - { n: 4, title: Opportunity visibility and tests }
  - { n: 5, title: Question visibility and tests }
  - { n: 6, title: Legacy cleanup and final validation }
unresolved_phase_count: 4
last_updated: 2026-06-25T10:10:04+0300
last_updated_by: Yanek Yuk
---

# Split Chat Scope Semantics Implementation Plan

## Overview

This plan separates scoped chat write reach from opportunity/question visibility without retaining the overloaded `indexScope` terminology. Chat and MCP contexts will carry a scope envelope (`scopeType`, `scopeId`); helper functions derive allowed self-owned read/write network IDs and focused discovery network IDs from the envelope plus memberships.

Scoped chats will still write/assign self-owned entities to the focused network plus the user's personal network(s), while opportunity discovery/listing/negotiation/question visibility remains bounded to the focused network only.

## Requirements

- Replace legacy `indexScope` and `networkScopeId` terminology with a scope envelope: `scopeType?: 'network'`, `scopeId?: string`.
- Preserve scoped write/assignment reach: focused network + personal network(s).
- Preserve unscoped write/read reach: all networks the user belongs to.
- Restrict scoped opportunity/discovery visibility to the focused network only.
- Persist scoped generated questions with actor `networkId`, and filter scoped pending-question reads by that network.
- Update prompt/tool descriptions so agents do not describe scoped discovery as focused + personal.
- Add regression coverage for both under-clamp and over-clamp failures.

## Current State Analysis

The current code conflates scope meanings under `indexScope`. In scoped chat, `resolveChatContext` computes `indexScope` as focused network plus personal network, and `discover_opportunities` reuses that array for discovery. That makes personal-index opportunities surface in a network-scoped chat.

### Key Discoveries

- `packages/protocol/src/shared/agent/tool.helpers.ts:58` defines `ResolvedToolContext`; `tool.helpers.ts:79` currently documents `indexScope` as both tool reach and DB clamp.
- `packages/protocol/src/shared/agent/tool.helpers.ts:369` derives scoped `indexScope` as focused network plus personal network.
- `packages/protocol/src/shared/agent/tool.factory.ts:171` passes `resolvedContext.indexScope` into `createSystemDatabase`, making it the DB clamp.
- `packages/protocol/src/mcp/mcp.server.ts:281` / `mcp.server.ts:307` mirror scoped-agent reach through `computeAgentIndexScope` and `applyNetworkScopeToContext`.
- `packages/protocol/src/opportunity/opportunity.tools.ts:1084` is the direct leak point: scoped discovery uses `context.indexScope`.
- `packages/protocol/src/opportunity/opportunity.tools.ts:1557` already models list visibility correctly by defaulting to `context.networkId`.
- `packages/protocol/src/negotiation/negotiation.tools.ts:117` and nearby checks already treat scoped visibility as focused network only.
- `packages/protocol/src/shared/assignment/network-assignment.policy.ts:57` filters scoped assignment to singleton `networkScopeId`, losing the personal leg.
- `services/api/src/queues/intent.queue.ts:20` / `intent.queue.ts:84` carry singleton `networkScopeId` through async intent assignment.
- `packages/protocol/src/premise/premise.state.ts:43` and `premise.graph.ts:212` also use singleton `networkScopeId` for premise assignment.
- `packages/protocol/src/shared/schemas/question.schema.ts:87` already supports `QuestionActor.networkId`.
- `services/api/src/queues/questioner.queue.ts:159` currently persists actors without network context.
- `services/api/src/adapters/questioner.adapter.ts:143` currently filters pending questions only by actor `userId`.

## Desired End State

```ts
const scope = { scopeType: 'network' as const, scopeId: focusedNetworkId };

const allowedNetworkIds = deriveAllowedNetworkIds({
  memberships: context.userNetworks,
  scopeType: context.scopeType,
  scopeId: context.scopeId,
});
// scoped => [focusedNetworkId, personalNetworkId]
// unscoped => all membership network IDs

const discoveryNetworkIds = deriveDiscoveryNetworkIds({
  memberships: context.userNetworks,
  scopeType: context.scopeType,
  scopeId: context.scopeId,
});
// scoped => [focusedNetworkId]
// unscoped => all membership network IDs
```

```ts
await intentQueue.addGenerateHydeJob({
  intentId,
  userId,
  ...(context.scopeType && context.scopeId
    ? { scopeType: context.scopeType, scopeId: context.scopeId }
    : {}),
});
```

```ts
await questionerEnqueue({
  mode: 'discovery',
  userId,
  sourceType: 'discovery',
  sourceId,
  context: enqueueInput,
  conversationId: chatSessionId,
  ...(context.scopeType && context.scopeId
    ? { scopeType: context.scopeType, scopeId: context.scopeId }
    : {}),
});
```

## What We're NOT Doing

- No database schema migration: `questions.actors` already stores JSON actors and `QuestionActor.networkId` already exists.
- No UI changes: filtering and persistence happen server/protocol side.
- No new discovery scope arrays on chat context.
- No retention of `indexScope` as a context API after this refactor, except in compatibility shims when absolutely necessary during code transition.
- No broad rewrite of access-control or opportunity visibility predicates beyond the scoped-chat leak and question filtering.

## Decisions

### Decision 1: Replace overloaded scope names with a scope envelope

**Ambiguity:** Whether to add `assignmentNetworkIds` and `discoveryNetworkIds`, keep `indexScope`, or introduce a clearer scope primitive.

**Explored:**
- Keep `indexScope`: easy because `tool.factory.ts:171` and scoped reads already use it, but it preserves the name that caused the conflation.
- Add two context arrays: explicit but duplicates derivable state and increases drift risk.
- Replace with `{ scopeType, scopeId }`: represents the user-visible focus and derives allowed/discovery networks from memberships.

**Decision:** Final state drops `indexScope` terminology and replaces it with `scopeType?: 'network'` and `scopeId?: string`. Derive network ID sets through pure helpers. Phase 1 is intentionally additive and temporarily keeps deprecated legacy fields so each phase remains buildable; later wiring phases remove active `indexScope`/`networkScopeId` use after call sites migrate.

### Decision 2: Scoped assignment includes personal networks

Scoped chats write/assign self-owned entities to focused network plus personal network(s). This follows the developer correction: “Intents/premises gets written to personal networks regardless of network scope. But while network scoped, only show opportunities that surface from that network.”

### Decision 3: Scoped opportunity visibility uses focused network only

`discover_opportunities`, `list_opportunities`, negotiation visibility, discovery questions, and pending question reads should use the focused network. The precedent is `list_opportunities` at `packages/protocol/src/opportunity/opportunity.tools.ts:1557`, which already defaults to the scoped network rather than personal-inclusive reach.

### Decision 4: Questions persist and filter network context

Scoped generated questions should carry the same `{ scopeType, scopeId }` envelope through the enqueue payload, map network scopes into `QuestionActor.networkId` at persistence time, and filter pending-question reads by that network. The actor schema already supports `networkId` at `packages/protocol/src/shared/schemas/question.schema.ts:87`; the missing pieces are enqueue payload scope, persistence mapping, and DB/tool filters.

### Decision 5: Scope envelope is `{ scopeType, scopeId }`

The prior singleton `networkScopeId` should not remain as the final internal payload name. Replace it with `scopeType` (currently only `'network'`) and `scopeId`, so future scope kinds do not overload a network-specific name. Phase 1 may retain a deprecated compatibility field only until Phase 3 migrates queue/graph producers and consumers.

## Phase 1: Scope envelope foundation

### Overview

Defines the new scope envelope and pure derivation helpers. Foundation phase; no dependency on later phases. This phase is additive for atomicity: deprecated legacy fields remain until later phases migrate all call sites.

### Changes Required:

#### 1. packages/protocol/src/shared/agent/tool.scope.ts

**File**: packages/protocol/src/shared/agent/tool.scope.ts
**Changes**: NEW — central scope envelope and network-derivation helpers.

```ts
/**
 * Request scope primitives for protocol tools.
 *
 * `scopeType`/`scopeId` describe the user's focused scope, not the full set of
 * networks a caller may read or write. Helper functions derive concrete network
 * id sets from the focused scope plus the caller's memberships.
 */
export type ToolScopeType = 'network';

export interface ToolScopeEnvelope {
  scopeType?: ToolScopeType;
  scopeId?: string;
}

export interface ScopeMembership {
  networkId: string;
  isPersonal?: boolean | null;
}

export interface DeriveNetworkScopeInput extends ToolScopeEnvelope {
  memberships: ScopeMembership[];
}

function uniqueNetworkIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function scopeFromNetworkId(networkId: string | null | undefined): ToolScopeEnvelope {
  const scopeId = networkId?.trim();
  return scopeId ? { scopeType: 'network', scopeId } : {};
}

export function hasNetworkScope(scope: ToolScopeEnvelope): scope is { scopeType: 'network'; scopeId: string } {
  return scope.scopeType === 'network' && typeof scope.scopeId === 'string' && scope.scopeId.trim().length > 0;
}

export function deriveAllowedNetworkIds(input: DeriveNetworkScopeInput): string[] {
  if (!hasNetworkScope(input)) {
    return uniqueNetworkIds(input.memberships.map((membership) => membership.networkId));
  }

  return uniqueNetworkIds(
    input.memberships
      .filter((membership) => membership.networkId === input.scopeId || membership.isPersonal === true)
      .map((membership) => membership.networkId),
  );
}

export function deriveDiscoveryNetworkIds(input: DeriveNetworkScopeInput): string[] {
  if (!hasNetworkScope(input)) {
    return uniqueNetworkIds(input.memberships.map((membership) => membership.networkId));
  }

  return input.memberships.some((membership) => membership.networkId === input.scopeId)
    ? [input.scopeId]
    : [];
}
```

#### 2. packages/protocol/src/shared/agent/tool.helpers.ts

**File**: packages/protocol/src/shared/agent/tool.helpers.ts
**Changes**: MODIFY — add scope envelope fields while retaining legacy fields until wiring phases remove them.

```ts
import type { ToolScopeType } from "./tool.scope.js";
```

```ts
export interface ResolvedToolContext {
  // Legacy flat fields (kept for backwards compatibility in tools/prompts).
  userId: string;
  userName: string;
  userEmail: string;
  /** Focused network for scoped chats/agents. Prefer `scopeType`/`scopeId` in new code. */
  networkId?: string;
  /** Focused request scope type. Currently only network scopes exist. */
  scopeType?: ToolScopeType;
  /** Focused request scope id. When `scopeType === 'network'`, this is the focused network id. */
  scopeId?: string;
  indexName?: string;
  /** True when chat is index-scoped and the user owns the index. */
  isOwner?: boolean;
  // Rich identity context for prompt/tool orchestration.
  user: UserRecord;
  userProfile: IdentityContext;
  userNetworks: NetworkMembership[];
  /**
   * @deprecated Legacy concrete network reach. New code should derive reach
   * from `scopeType`/`scopeId` plus `userNetworks` via `tool.scope.ts`.
   * Removed after call sites are migrated in this plan.
   */
  indexScope: string[];
  scopedIndex?: {
    id: string;
    title: string;
    prompt: string | null;
    type?: string;
    metadata?: Record<string, unknown>;
    permissions?: Record<string, unknown>;
  };
```

```ts
export interface ToolContext {
  userId: string;
  /** @deprecated Use userDb or systemDb instead. Kept for backwards compatibility. */
  database: ChatGraphCompositeDatabase;
  /** Context-bound database for accessing the authenticated user's own resources. Created internally if not provided. */
  userDb?: UserDatabase;
  /** Context-bound database for LLM/system operations on cross-user resources within shared indexes. Created internally if not provided. */
  systemDb?: SystemDatabase;
  embedder: Embedder;
  scraper: Scraper;
  /** When set, chat is scoped to this index; tools use it as the default focused network. */
  networkId?: string;
  /** Focused request scope type. Currently only `network` is supported. */
  scopeType?: ToolScopeType;
  /** Focused request scope id. When omitted, `networkId` is converted to a network scope. */
  scopeId?: string;
  /** @deprecated Use `scopeType`/`scopeId`; retained until wiring phases migrate call sites. */
  indexScope?: string[];
  /** Chat session ID when creating tools for a chat; enables draft opportunities with context.conversationId. */
  sessionId?: string;
```

#### 3. packages/protocol/src/shared/interfaces/discovery-run.interface.ts

**File**: packages/protocol/src/shared/interfaces/discovery-run.interface.ts
**Changes**: MODIFY — add scope envelope to async discovery run context while retaining legacy `indexScope` until Phase 4 migrates writers/readers.

```ts
export interface DiscoveryRunRecord {
  id: string;
  userId: string;
  agentId?: string | null;
  status: DiscoveryRunStatus;
  input: DiscoveryRunInput;
  context: Pick<ResolvedToolContext,
    "userId" |
    "userName" |
    "userEmail" |
    "networkId" |
    "scopeType" |
    "scopeId" |
    "indexName" |
    "indexScope" |
    "sessionId" |
    "agentId" |
    "clientSurface"
  >;
  progress?: Record<string, unknown> | null;
  result?: unknown;
  error?: string | null;
  cancelRequestedAt?: Date | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
}
```

#### 4. packages/protocol/src/shared/interfaces/queue.interface.ts

**File**: packages/protocol/src/shared/interfaces/queue.interface.ts
**Changes**: MODIFY — add scope envelope to intent queue contract while retaining legacy `networkScopeId` until Phase 3 migrates callers.

```ts
import type { ToolScopeType } from "../agent/tool.scope.js";

export interface IntentGraphQueueScope {
  scopeType?: ToolScopeType;
  scopeId?: string;
  /** @deprecated Use `scopeType: 'network'` + `scopeId`. */
  networkScopeId?: string;
}

/**
 * Operations the Intent Graph needs to enqueue follow-up work (e.g. HyDE generation/deletion).
 * Implemented by the intent queue; protocol layer depends only on this interface.
 */
export interface IntentGraphQueue {
  addGenerateHydeJob(data: { intentId: string; userId: string } & IntentGraphQueueScope): Promise<unknown>;
  addDeleteHydeJob(data: { intentId: string }): Promise<unknown>;
}
```

#### 5. packages/protocol/src/questioner/questioner.types.ts

**File**: packages/protocol/src/questioner/questioner.types.ts
**Changes**: MODIFY — add optional scope envelope for scoped question actor persistence.

```ts
import type { ToolScopeType } from "../shared/agent/tool.scope.js";
```

```ts
export interface QuestionerInput {
  /** Selects the preset (system prompt + builder). */
  mode: QuestionMode;
  /** User the questions are generated for. */
  userId: string;
  /** Entity type that triggered this (e.g. "opportunity", "intent", "profile"). */
  sourceType: string;
  /** ID of the triggering entity. */
  sourceId: string;
  /** Mode-specific context. Must align with the selected mode. */
  context: QuestionerContext;
  /** Scoped question context. Network scopes persist as QuestionActor.networkId. */
  scopeType?: ToolScopeType;
  /** Scoped question id. When scopeType is `network`, this is the actor networkId. */
  scopeId?: string;
  /** Conversation ID — set when the question originates from a chat session. Persisted on the question row for frontend filtering. */
  conversationId?: string;
  /** Assistant message ID — set when we know which message triggered this question. Stored in detection.messageId for inline anchoring. */
  messageId?: string;
}
```

#### 6. packages/protocol/src/index.ts

**File**: packages/protocol/src/index.ts
**Changes**: MODIFY — export the stable scope helper types/functions from the package root.

```ts
export {
  deriveAllowedNetworkIds,
  deriveDiscoveryNetworkIds,
  hasNetworkScope,
  scopeFromNetworkId,
} from "./shared/agent/tool.scope.js";
export type { ToolScopeEnvelope, ToolScopeType, ScopeMembership, DeriveNetworkScopeInput } from "./shared/agent/tool.scope.js";
```

### Success Criteria:

#### Automated Verification:
- [ ] Type check reaches the new scope helper without deep imports: `cd packages/protocol && bun run build`
- [ ] Legacy scope names are explicitly deprecated in foundational contracts: `rg "@deprecated.*(indexScope|networkScopeId)|indexScope|networkScopeId" packages/protocol/src/shared/agent/tool.helpers.ts packages/protocol/src/shared/interfaces/queue.interface.ts`

#### Manual Verification:
- [ ] Confirm `deriveAllowedNetworkIds()` returns focused + personal for scoped input and all memberships for unscoped input.
- [ ] Confirm `deriveDiscoveryNetworkIds()` returns focused only for scoped input and all memberships for unscoped input.
- [ ] Confirm Phase 1 is additive only; final deletion of legacy `indexScope`/`networkScopeId` remains assigned to later wiring phases.

## Phase 2: Context and DB clamp wiring

### Overview

Routes chat/MCP/tool factory contexts through the scope envelope and derives DB clamp network IDs at the boundary. Depends on Phase 1. Deprecated `indexScope` population remains only as a compatibility bridge until later phases migrate remaining call sites.

### Changes Required:

#### 1. packages/protocol/src/shared/agent/tool.helpers.ts

**File**: packages/protocol/src/shared/agent/tool.helpers.ts
**Changes**: MODIFY — resolve scoped chat as `{ scopeType:'network', scopeId: networkId }` and derive allowed IDs from the scope envelope.

```ts
import { deriveAllowedNetworkIds, scopeFromNetworkId } from "./tool.scope.js";
```

```ts
  const userName = user.name ?? "Unknown";
  const userEmail = user.email ?? "";
  const hasName = !!user.name?.trim();
  const scope = scopeFromNetworkId(networkId);

  // Deprecated compatibility reach. New call sites should call
  // deriveAllowedNetworkIds({ memberships: userNetworks, ...scope }) directly.
  const allowedNetworkIds = deriveAllowedNetworkIds({
    memberships: userNetworks,
    ...scope,
  });

  return {
    userId,
    userName,
    userEmail,
    networkId,
    ...scope,
    indexName,
    isOwner,
    user,
    userProfile,
    userNetworks,
    indexScope: allowedNetworkIds,
    scopedIndex,
    scopedMembershipRole,
    isOnboarding: !(user.onboarding?.completedAt),
    hasName,
    contactsEnabled,
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
```

#### 2. packages/protocol/src/shared/agent/tool.factory.ts

**File**: packages/protocol/src/shared/agent/tool.factory.ts
**Changes**: MODIFY — use derived allowed network IDs for `createSystemDatabase` and session-aware question enqueue.

```ts
import { deriveAllowedNetworkIds, scopeFromNetworkId } from "./tool.scope.js";
```

```ts
  const explicitScope = deps.scopeType && deps.scopeId
    ? { scopeType: deps.scopeType, scopeId: deps.scopeId }
    : scopeFromNetworkId(deps.networkId);

  if (!preResolvedContext && explicitScope.scopeType && explicitScope.scopeId) {
    resolvedContext.scopeType = explicitScope.scopeType;
    resolvedContext.scopeId = explicitScope.scopeId;
    resolvedContext.networkId = explicitScope.scopeId;
  }

  const allowedNetworkIds = deriveAllowedNetworkIds({
    memberships: resolvedContext.userNetworks,
    scopeType: resolvedContext.scopeType,
    scopeId: resolvedContext.scopeId,
  });
```

```ts
  const sessionAwareEnqueue: QuestionerEnqueueFn | undefined = deps.questionerEnqueue
    ? (input) => deps.questionerEnqueue!({
        ...input,
        ...(resolvedContext.scopeType && resolvedContext.scopeId && !input.scopeId
          ? { scopeType: resolvedContext.scopeType, scopeId: resolvedContext.scopeId }
          : {}),
        ...(resolvedContext.sessionId && !input.conversationId ? { conversationId: resolvedContext.sessionId } : {}),
      })
    : undefined;
```

```ts
  const systemDb = deps.systemDb ?? deps.createSystemDatabase(database, resolvedContext.userId, allowedNetworkIds, embedder);
```

#### 3. packages/protocol/src/mcp/mcp.server.ts

**File**: packages/protocol/src/mcp/mcp.server.ts
**Changes**: MODIFY — apply network-scoped agents through the scope envelope and derived DB clamp IDs.

```ts
import { deriveAllowedNetworkIds, scopeFromNetworkId } from '../shared/agent/tool.scope.js';
```

```ts
export const computeAgentAllowedNetworkIds = (
  userNetworks: { networkId: string; isPersonal?: boolean | null }[],
  scopeType: 'network' | undefined,
  scopeId: string | null | undefined,
): string[] => deriveAllowedNetworkIds({
  memberships: userNetworks,
  ...(scopeType && scopeId ? { scopeType, scopeId } : {}),
});
```

```ts
export const applyNetworkScopeToContext = (
  context: ResolvedToolContext,
  networkScopeId: string | null | undefined,
): void => {
  if (!networkScopeId) return;
  if (context.scopeType && context.scopeId) return;

  const scope = scopeFromNetworkId(networkScopeId);
  context.scopeType = scope.scopeType;
  context.scopeId = scope.scopeId;
  context.networkId = networkScopeId;
  // Deprecated compatibility reach until remaining tool call sites migrate.
  context.indexScope = computeAgentAllowedNetworkIds(context.userNetworks, context.scopeType, context.scopeId);

  const bound = context.userNetworks.find((m) => m.networkId === networkScopeId);
  if (!bound) return;

  context.indexName = bound.networkTitle;
  context.scopedIndex = {
    id: bound.networkId,
    title: bound.networkTitle,
    prompt: bound.indexPrompt ?? null,
  };
  const isOwner = bound.permissions?.includes('owner') ?? false;
  context.scopedMembershipRole = isOwner ? 'owner' : 'member';
  context.isOwner = isOwner;
};
```

```ts
          const allowedNetworkIds = deriveAllowedNetworkIds({
            memberships: context.userNetworks,
            scopeType: context.scopeType,
            scopeId: context.scopeId,
          });
          // Deprecated compatibility reach until remaining tool call sites migrate.
          context.indexScope = allowedNetworkIds;
          const scopedDbs = scopedDepsFactory.create(userId, allowedNetworkIds);
```

#### 4. services/api/src/queues/opportunity/discovery-run.queue.ts

**File**: services/api/src/queues/opportunity/discovery-run.queue.ts
**Changes**: MODIFY — restore scope envelope and derive scoped DB clamp IDs for async discovery workers.

```ts
import { deriveAllowedNetworkIds, HydeGenerator, HydeGraphFactory, LensInferrer, OpportunityGraphFactory, createOpportunityTools, getToolTimeoutPolicy, requestContext, resolveChatContext } from '@indexnetwork/protocol';
```

```ts
    const context: ResolvedToolContext = {
      ...resolved,
      ...(run.context.scopeType && run.context.scopeId
        ? { scopeType: run.context.scopeType, scopeId: run.context.scopeId, networkId: run.context.scopeId }
        : {}),
      isMcp: true,
      ...(run.agentId ? { agentId: run.agentId } : {}),
      ...(run.context.clientSurface ? { clientSurface: run.context.clientSurface } : {}),
    };
    const allowedNetworkIds = deriveAllowedNetworkIds({
      memberships: context.userNetworks,
      scopeType: context.scopeType,
      scopeId: context.scopeId,
    });
    // Deprecated compatibility reach until remaining tool call sites migrate.
    context.indexScope = allowedNetworkIds;

    const userDb = createUserDatabase(chatDatabaseAdapter, run.userId);
    const systemDb = createSystemDatabase(chatDatabaseAdapter, run.userId, allowedNetworkIds, embedderAdapter);
```

#### 5. services/api/src/services/tool.service.ts

**File**: services/api/src/services/tool.service.ts
**Changes**: MODIFY — derive DB clamp IDs from resolved context rather than legacy scope arrays.

```ts
import { deriveAllowedNetworkIds, IntentGraphFactory, EnrichmentGraphFactory, OpportunityGraphFactory, HydeGraphFactory, NetworkGraphFactory, NetworkMembershipGraphFactory, IntentNetworkGraphFactory, NegotiationGraphFactory, PremiseGraphFactory, HydeGenerator, LensInferrer, IntentIndexer, resolveChatContext, createToolRegistry, invokeToolRuntime, toolRuntimeErrorToResult, ONBOARDING_ALLOWED, buildMcpOnboardingMessage } from '@indexnetwork/protocol';
```

```ts
    const allowedNetworkIds = deriveAllowedNetworkIds({
      memberships: context.userNetworks,
      scopeType: context.scopeType,
      scopeId: context.scopeId,
    });
    // Deprecated compatibility reach until remaining tool call sites migrate.
    context.indexScope = allowedNetworkIds;
    const userDb = createUserDatabase(database, userId);
    const systemDb = createSystemDatabase(database, userId, allowedNetworkIds, this.embedder);
```

#### 6. services/api/src/controllers/mcp.controller.ts

**File**: services/api/src/controllers/mcp.controller.ts
**Changes**: MODIFY — rename scoped dependency factory parameters to allowed network IDs for clarity.

```ts
  const scopedDepsFactory: ScopedDepsFactory = {
    create(userId: string, allowedNetworkIds: string[]) {
      return {
        userDb: protocolDeps.createUserDatabase(protocolDeps.database, userId),
        systemDb: protocolDeps.createSystemDatabase(protocolDeps.database, userId, allowedNetworkIds, protocolDeps.embedder),
      };
    },
  };
```

### Success Criteria:

#### Automated Verification:
- [ ] Context/tool factory type checks: `cd packages/protocol && bun run build`
- [ ] API TypeScript references compile for renamed factory parameter and derived scope imports: `cd services/api && bun test src/queues/tests/intent.queue.spec.ts`

#### Manual Verification:
- [ ] Scoped chat contexts have `scopeType: 'network'` and `scopeId` equal to the focused network.
- [ ] `createSystemDatabase` receives focused + personal network IDs for scoped contexts and all membership IDs for unscoped contexts.
- [ ] Question enqueue wrappers attach `scopeType`/`scopeId` when the active context has a scope.

## Phase 3: Assignment writes

### Overview

Updates intent and premise assignment flows to use the scope envelope and include focused plus personal networks for scoped writes. Depends on Phase 2.

### Changes Required:

#### 1. packages/protocol/src/shared/assignment/network-assignment.policy.ts

**File**: packages/protocol/src/shared/assignment/network-assignment.policy.ts
**Changes**: MODIFY — replace singleton `networkScopeId` filtering with scope-envelope filtering over memberships including `isPersonal`.

```ts
```

#### 2. packages/protocol/src/shared/interfaces/database.interface.ts

**File**: packages/protocol/src/shared/interfaces/database.interface.ts
**Changes**: MODIFY — add or extend assignment membership contract so assignment policy can identify personal networks.

```ts
```

#### 3. services/api/src/queues/intent.queue.ts

**File**: services/api/src/queues/intent.queue.ts
**Changes**: MODIFY — carry `scopeType`/`scopeId`, derive scoped assignment network IDs including personal, and enqueue from-intent discovery only for focused network.

```ts
```

#### 4. packages/protocol/src/intent/intent.graph.ts

**File**: packages/protocol/src/intent/intent.graph.ts
**Changes**: MODIFY — enqueue HyDE jobs with scope envelope rather than `networkScopeId`.

```ts
```

#### 5. packages/protocol/src/intent/intent.state.ts

**File**: packages/protocol/src/intent/intent.state.ts
**Changes**: MODIFY — replace `indexScope`/`networkScopeId` state usage with scope envelope where relevant.

```ts
```

#### 6. packages/protocol/src/intent/intent.tools.ts

**File**: packages/protocol/src/intent/intent.tools.ts
**Changes**: MODIFY — pass scope envelope for scoped create/update/delete/link flows.

```ts
```

#### 7. packages/protocol/src/premise/premise.state.ts

**File**: packages/protocol/src/premise/premise.state.ts
**Changes**: MODIFY — replace `networkScopeId` with scope envelope.

```ts
```

#### 8. packages/protocol/src/premise/premise.graph.ts

**File**: packages/protocol/src/premise/premise.graph.ts
**Changes**: MODIFY — derive assignment networks from scope envelope, including personal networks.

```ts
```

#### 9. packages/protocol/src/premise/premise.tools.ts

**File**: packages/protocol/src/premise/premise.tools.ts
**Changes**: MODIFY — pass scoped chat envelope into premise create/update graph invocations.

```ts
```

### Success Criteria:

#### Automated Verification:

#### Manual Verification:

## Phase 4: Opportunity visibility

### Overview

Fixes opportunity discovery to use focused scope only for scoped chat and updates run coalescing/context and agent-facing docs. Depends on Phase 2.

### Changes Required:

#### 1. packages/protocol/src/opportunity/opportunity.tools.ts

**File**: packages/protocol/src/opportunity/opportunity.tools.ts
**Changes**: MODIFY — derive discovery scope from `scopeType`/`scopeId`, not personal-inclusive allowed reach; update coalescing and async run context.

```ts
```

#### 2. packages/protocol/src/opportunity/opportunity.discover.ts

**File**: packages/protocol/src/opportunity/opportunity.discover.ts
**Changes**: MODIFY — rename `indexScope` inputs/cache fields to discovery network IDs and preserve focused scope through pagination.

```ts
```

#### 3. packages/protocol/src/chat/chat.prompt.ts

**File**: packages/protocol/src/chat/chat.prompt.ts
**Changes**: MODIFY — update scoped-chat prompt language so discovery is focused-network only.

```ts
```

### Success Criteria:

#### Automated Verification:

#### Manual Verification:

## Phase 5: Question visibility

### Overview

Persists scoped question network context and filters scoped pending-question reads by network. Depends on Phases 1 and 2.

### Changes Required:

#### 1. packages/protocol/src/shared/agent/tool.helpers.ts

**File**: packages/protocol/src/shared/agent/tool.helpers.ts
**Changes**: MODIFY — extend `ToolDeps.findPendingQuestions` filters with `networkId`.

```ts
```

#### 2. packages/protocol/src/opportunity/opportunity.pending-questions.ts

**File**: packages/protocol/src/opportunity/opportunity.pending-questions.ts
**Changes**: MODIFY — pass network filters into pending discovery question merge.

```ts
```

#### 3. packages/protocol/src/opportunity/opportunity.discover.ts

**File**: packages/protocol/src/opportunity/opportunity.discover.ts
**Changes**: MODIFY — enqueue discovery questions with scoped `networkId` when present.

```ts
```

#### 4. packages/protocol/src/questioner/questioner.tools.ts

**File**: packages/protocol/src/questioner/questioner.tools.ts
**Changes**: MODIFY — scoped `read_pending_questions` filters by network in addition to mode clamp.

```ts
```

#### 5. services/api/src/queues/questioner.queue.ts

**File**: services/api/src/queues/questioner.queue.ts
**Changes**: MODIFY — persist `QuestionActor.networkId` from enqueue payload.

```ts
```

#### 6. services/api/src/adapters/questioner.adapter.ts

**File**: services/api/src/adapters/questioner.adapter.ts
**Changes**: MODIFY — add network filter to pending-question SQL JSON containment.

```ts
```

#### 7. services/api/src/services/tool.service.ts

**File**: services/api/src/services/tool.service.ts
**Changes**: MODIFY — thread `networkId` filters from protocol deps into `QuestionerAdapter.findPending`.

```ts
```

#### 8. services/api/src/controllers/mcp.controller.ts

**File**: services/api/src/controllers/mcp.controller.ts
**Changes**: MODIFY — thread `networkId` filters from MCP tool deps into `QuestionerAdapter.findPending`.

```ts
```

### Success Criteria:

#### Automated Verification:

#### Manual Verification:

## Phase 6: Regression tests

### Overview

Pins the new semantics with targeted protocol/API tests. Depends on Phases 1–5.

### Changes Required:

#### 1. packages/protocol/src/shared/agent/tests/tool.helpers.spec.ts

**File**: packages/protocol/src/shared/agent/tests/tool.helpers.spec.ts
**Changes**: MODIFY — assert scope envelope and derived allowed/discovery network IDs.

```ts
```

#### 2. packages/protocol/src/mcp/tests/apply-network-scope-to-context.spec.ts

**File**: packages/protocol/src/mcp/tests/apply-network-scope-to-context.spec.ts
**Changes**: MODIFY — update MCP scoped context tests for scope envelope and derived IDs.

```ts
```

#### 3. services/api/src/queues/tests/intent.queue.spec.ts

**File**: services/api/src/queues/tests/intent.queue.spec.ts
**Changes**: MODIFY — assert scoped assignment includes personal but from-intent discovery remains focused-network only.

```ts
```

#### 4. packages/protocol/src/premise/tests/premise.graph.spec.ts

**File**: packages/protocol/src/premise/tests/premise.graph.spec.ts
**Changes**: MODIFY — assert scoped premise assignment includes focused and personal networks.

```ts
```

#### 5. packages/protocol/src/questioner/tests/questioner.tools.spec.ts

**File**: packages/protocol/src/questioner/tests/questioner.tools.spec.ts
**Changes**: MODIFY — assert scoped pending question reads pass and enforce network filter.

```ts
```

#### 6. packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts

**File**: packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts
**Changes**: MODIFY — add regression for scoped discovery using focused network only, excluding personal network reach.

```ts
```

### Success Criteria:

#### Automated Verification:

#### Manual Verification:

## Ordering Constraints

- Phase 1 must land first because later phases use the scope envelope helpers and types.
- Phase 2 must land before Phase 3–5 because it updates context creation and DB clamp derivation.
- Phases 3, 4, and 5 are conceptually independent after Phase 2, but this plan keeps them sequential to avoid simultaneous edits to shared tool/context files.
- Phase 6 must run last so tests target final semantics rather than compatibility shims.

## Verification Notes

- Run protocol scoped context tests: `cd packages/protocol && bun test src/shared/agent/tests/tool.helpers.spec.ts src/mcp/tests/apply-network-scope-to-context.spec.ts`.
- Run protocol opportunity/question/premise tests: `cd packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts src/questioner/tests/questioner.tools.spec.ts src/premise/tests/premise.graph.spec.ts`.
- Run API queue tests: `cd services/api && bun test src/queues/tests/intent.queue.spec.ts`.
- Grep for removed terminology: `rg "indexScope|networkScopeId|computeAgentIndexScope" packages/protocol services/api` should only show intentional compatibility comments or deleted-code absence.
- Verify scoped discovery no longer passes personal network IDs into opportunity graph from `discover_opportunities`.
- Verify scoped assignment still writes to personal network(s) by inspecting intent and premise assignment tests.
- Verify pending questions for scoped chat require actor `{ userId, networkId: scopeId }`.

## Performance Considerations

Scope derivation should be pure array filtering over already-loaded memberships in request contexts. Queue workers may need one additional membership lookup with `isPersonal` metadata for assignment, but assignment already performs DB work per network; this does not materially alter hot-path performance. Pending-question network filtering should be pushed into SQL JSON containment to avoid over-fetching and tool-side filtering as the primary control.

## Migration Notes

No database migration is required. Existing pending question rows without actor `networkId` will not match scoped network reads after this change; they remain visible in unscoped reads. This is acceptable because scoped filtering is a privacy hardening behavior.

## Pattern References

- `packages/protocol/src/opportunity/opportunity.tools.ts:1557-1561` — focused-network default for `list_opportunities`.
- `packages/protocol/src/negotiation/negotiation.tools.ts:117-123` — scoped negotiation listing filters by focused `context.networkId`.
- `packages/protocol/src/shared/schemas/question.schema.ts:87-95` — existing `QuestionActor.networkId` schema support.
- `services/api/src/adapters/questioner.adapter.ts:143` — JSON actor containment query to extend for network filtering.
- `packages/protocol/src/shared/assignment/network-assignment.policy.ts:57-59` — current singleton scope policy to replace.

## Developer Context

- ❓ Question: Scoped chat should create self-owned entities in the focused community plus personal index per the requested rule, but current assignment paths accept only a singleton `networkScopeId` (`packages/protocol/src/shared/assignment/network-assignment.policy.ts:13`, `services/api/src/queues/intent.queue.ts:84`, `packages/protocol/src/premise/premise.state.ts:43`). Which implementation direction should the plan use?
  - Answer: “It is clear. Intents/premises gets written to personal networks regardless of network scope. But while network scoped, only show opportunities that surface from that network.”
- ❓ Question: Pending-question reads currently filter actors only by `userId` (`services/api/src/adapters/questioner.adapter.ts:143`) while scoped callers only exclude negotiation mode (`packages/protocol/src/questioner/questioner.tools.ts:63`). For scoped chat, should the plan filter pending questions strictly to the focused network?
  - Answer: “Filter by network”.
- ❓ Question: Which decision should we adjust before decomposition?
  - Answer: “Do you need to add `assignmentNetworkIds` and `discoveryNetworkIds`?”
- Follow-up correction: “We can drop `indexScope`. If chat is scoped, it is scoped network + personal network. If not, it is all networks the user is part of.”
- Follow-up decision: “Let's not call it `networkScopeId`. Instead, we will have `scopeType` (currently only `network`), and `scopeId`.”
- Follow-up correction: “Why are you still mentioning `indexScope`? That is to be dropped.”
- Decomposition approved after revising to drop `indexScope` and use the scope envelope.

## Plan History

- Phase 1: Scope envelope foundation — revised after approval: question enqueue payload uses `scopeType`/`scopeId` instead of adding top-level `networkId`; deprecated `indexScope`/`networkScopeId` retained only as additive compatibility bridge
- Phase 2: Context and DB clamp wiring — approved as revised (question enqueue carries scope envelope; pending-question filtering deferred to Phase 5; legacy context reach populated only as compatibility bridge)
- Phase 3: Assignment writes and tests — pending (remaining decomposition revised: tests merge into behavior phases)
- Phase 4: Opportunity visibility and tests — pending
- Phase 5: Question visibility and tests — pending
- Phase 6: Legacy cleanup and final validation — pending

## References

- User-provided architecture input in blueprint invocation: split assignment/write scope from opportunity/discovery visibility scope.
- Precedent commits from research: `486a840a14`, `58145358e1`, `98ae0fe533`, `a838a53e0d` — prior scope leak hardening.
- Related research artifact: `.rpiv/artifacts/research/2026-06-19_19-16-39_intent-count-consistency.md`.
