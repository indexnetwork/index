---
date: 2026-06-09T11:18:44+0300
author: Yankı Ekin Yüksel
commit: cc4ceda7a
branch: dev
repository: index
topic: "Fix protocol package boundary violations"
tags: [design, protocol, boundaries, interfaces, mcp, tools, schemas]
status: ready
parent: .rpiv/artifacts/research/2026-06-09_10-42-15_protocol-package-violations.md
last_updated: 2026-06-09T11:18:44+0300
last_updated_by: Yankı Ekin Yüksel
---

# Design: Fix protocol package boundary violations

## Summary
Extract shared domain DTOs to `shared/schemas/` to eliminate reverse imports from shared interfaces into domain implementation modules. Narrow the public API surface by replacing `export type *` with explicit exports and removing internal orchestration types. Fix the `PremiseGraphDatabase` type-contract violation by adding missing methods to `ChatGraphCompositeDatabase`. Remove the unused Postgres checkpoint adapter dependency. Replace `Request` in `McpAuthResolver` with a plain `McpAuthInput` DTO.

## Requirements
- Remove domain implementation imports from `shared/interfaces/` files
- Extract `ProfileDocument`, `DiscoveryQuestionInput`, `NegotiationTurn`, `UserNegotiationContext`, `SeedAssessment` to `shared/schemas/`
- Replace `export type * from "./shared/interfaces/database.interface.js"` with narrow explicit exports in `index.ts`
- Remove `DefineTool`, `RawToolDefinition`, `ToolRegistry` from root barrel
- Add premise CRUD methods to `ChatGraphCompositeDatabase` and remove `as unknown as` casts
- Remove `@langchain/langgraph-checkpoint-postgres` from `package.json`
- Replace `Request` parameter in `McpAuthResolver.resolveIdentity()` with plain `McpAuthInput` DTO
- All changes must be compile-safe and backward-compatible with existing downstream consumers

## Current State Analysis

### Key Discoveries
- `packages/protocol/src/shared/interfaces/database.interface.ts:1` imports `ProfileDocument` from `profile/profile.generator.ts:37`, but generator imports LangChain/Zod runtime and constructs LLM models — the type should live in shared schemas
- `packages/protocol/src/shared/interfaces/question-generator.interface.ts:10` imports `DiscoveryQuestionInput` from `opportunity/question.prompt.ts`; this interface is already `@deprecated` but still imported
- `packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts:9` imports `NegotiationTurn`, `UserNegotiationContext`, `SeedAssessment` from `negotiation/negotiation.state.ts`; two are pure interfaces, one is `z.infer`-derived
- `packages/protocol/src/shared/agent/tool.helpers.ts:3` imports `ProfileDocument` from `profile/profile.generator.ts`
- `PremiseGraphDatabase` at `database.interface.ts:1968-1970` requires 5 methods NOT in `ChatGraphCompositeDatabase`: `createPremise`, `getPremise`, `updatePremise`, `assignPremiseToNetwork`, `getPremiseNetworks`
- `packages/protocol/src/shared/agent/tool.factory.ts:130` and `packages/protocol/src/premise/premise.tools.ts:12` use `as unknown as PremiseGraphDatabase` casts
- `packages/protocol/package.json:25` lists `@langchain/langgraph-checkpoint-postgres` but source only imports `BaseCheckpointSaver` from `@langchain/langgraph`
- `packages/protocol/src/shared/interfaces/auth.interface.ts:29` accepts `Request` in `resolveIdentity`; backend implements it in `mcp.controller.ts:426-560` reading headers directly

### Patterns to follow
- `packages/protocol/src/shared/schemas/question.schema.ts:1-60` — clean DTO pattern: Zod schema + `z.infer` type, zero domain imports
- `packages/protocol/src/shared/interfaces/cache.interface.ts:1-41` — narrow port: no domain imports, clean Pick-based subtypes
- `packages/protocol/src/shared/schemas/chat-context.schema.ts:1-21` — minimal schema: `z` from zod only, clear clamping
- `packages/protocol/src/chat/chat.graph.ts:81-86` — positive injection pattern: accepts `BaseCheckpointSaver` interface, never imports `PostgresSaver`

### Constraints
- Backend code at `backend/src/services/tool.service.ts:17` and `backend/src/controllers/mcp.controller.ts:54-55` imports internal types like `ToolDeps` and `CompiledGraph` from the protocol root — removal must not break these consumers
- The `package.json` export map exposes only `"."` at line 7 — no subpath exports exist
- Graph factory exports from `index.ts:103-119` are per developer checkpoint tolerated host seams, NOT to be removed

## Scope

### Building
- Extract `ProfileDocument` shape to `shared/schemas/profile.schema.ts`
- Extract `DiscoveryQuestionInput` and all nested types (DiscoverySourceProfile, DiscoverySummary, DiscoveryNegotiation, DiscoveryTurn, DiscoveryOutcome) to `shared/schemas/discovery-question.schema.ts`
- Extract `NegotiationTurn`, `UserNegotiationContext`, `SeedAssessment` to `shared/schemas/negotiation-state.schema.ts`
- Update all shared interfaces to import from schemas instead of domain modules
- Replace `export type * from database.interface.js` with explicit named exports in `index.ts`
- Remove `DefineTool`, `RawToolDefinition`, `ToolRegistry` from root barrel
- Add premise CRUD methods (`createPremise`, `getPremise`, `updatePremise`, `assignPremiseToNetwork`, `getPremiseNetworks`) to `ChatGraphCompositeDatabase`
- Remove `as unknown as PremiseGraphDatabase` casts from `tool.factory.ts` and `premise.tools.ts`
- Remove `@langchain/langgraph-checkpoint-postgres` from `package.json`
- Create `McpAuthInput` DTO, change `McpAuthResolver.resolveIdentity` signature, update backend implementation

### Not Building
- Full `ToolDeps` deprecation or removal — still needed by backend composition roots
- Raw `database` field removal from `ToolContext` — marked deprecated but host code still uses it
- Deep refactor of graph factory registration or tool registry architecture
- Migration of remaining raw-DB-using tools (profile.tools.ts, opportunity.tools.ts) to scoped DBs
- Backend scoped DB factory restructuring
- Subpath export map addition (`package.json exports` field)
- Removing deprecated `QuestionGeneratorReader` interface entirely

## Decisions

### Extract shared domain DTOs to shared/schemas/
**Ambiguity**: Domain types (ProfileDocument, negotiation state, discovery question input) are defined in domain implementation modules but imported by shared interfaces.
**Explored**: (A) Extract to shared/schemas/ following `question.schema.ts` pattern. (B) Leave in place. (C) Inline in each interface.
**Decision**: Extract all three to shared/schemas/ using the established Zod-schema + inferred-type pattern. These become the canonical DTO definitions; domain modules that currently define them re-export or derive from the shared schema. Follows the `question.schema.ts:1-60` pattern.

### Narrow public API exports
**Ambiguity**: Root barrel at `index.ts:47` uses `export type *` from `database.interface.ts`, leaking ~50+ internal types. Internal orchestration types (`DefineTool`, `RawToolDefinition`, `ToolRegistry`) are root-exported.
**Explored**: (A) Replace `export type *` with explicit narrow exports of stable host contract types only; remove internal orchestration types. (B) Leave as-is. (C) Remove all non-interface types.
**Decision**: Replace `export type * from database.interface.js` with explicit named exports for stable contracts only (like `cache.interface.ts` does with narrow Pick exports). Remove `DefineTool`, `RawToolDefinition`, `ToolRegistry` from root barrel. Keep `ToolDeps` and `CompiledGraph` (backend needs them). Graph factory exports remain tolerated host seams.

### Fix PremiseGraphDatabase type-contract violation
**Ambiguity**: PremiseGraphDatabase has 5 methods not in ChatGraphCompositeDatabase, requiring `as unknown as` casts.
**Explored**: (A) Add the 5 missing premise CRUD methods to ChatGraphCompositeDatabase. (B) Push toward scoped DB usage instead.
**Decision**: Add `createPremise`, `getPremise`, `updatePremise`, `assignPremiseToNetwork`, `getPremiseNetworks` to `ChatGraphCompositeDatabase` and remove the unsafe casts. This is the minimal fix that restores type safety without requiring a deep tool rewrite.

### Remove unused Postgres checkpoint dependency
**Ambiguity**: `@langchain/langgraph-checkpoint-postgres` in `package.json:25` is not imported by protocol source.
**Explored**: (A) Remove it. (B) Keep it for future use. (C) Move to devDependencies.
**Decision**: Remove from `dependencies`. Protocol source only uses `BaseCheckpointSaver` from `@langchain/langgraph`. Backend owns the actual `PostgresSaver` import at `backend/src/adapters/checkpointer.adapter.ts:18` and has its own dependency.

### MCP auth DTO extraction
**Ambiguity**: `McpAuthResolver.resolveIdentity(request: Request)` at `auth.interface.ts:29` couples the shared interface to a platform HTTP Request object.
**Explored**: (A) Create `McpAuthInput` DTO with header fields. (B) Leave Request for now. (C) Abstract the MCP SDK context instead.
**Decision**: Create `McpAuthInput` type containing the fields the resolver actually needs (authorization token, api key, client surface, telegram headers). Change `resolveIdentity(McpAuthInput)` signature. Extract `McpAuthInput` from `Request` at the backend MCP controller edge before calling protocol.

## Architecture

### packages/protocol/src/shared/schemas/profile.schema.ts — NEW

```typescript
import { z } from "zod";

export const ProfileIdentitySchema = z.object({
  name: z.string(),
  bio: z.string(),
  location: z.string(),
});

export const ProfileNarrativeSchema = z.object({
  context: z.string(),
});

export const ProfileAttributesSchema = z.object({
  interests: z.array(z.string()),
  skills: z.array(z.string()),
});

export const ProfileDocumentSchema = z.object({
  userId: z.string(),
  identity: ProfileIdentitySchema,
  narrative: ProfileNarrativeSchema,
  attributes: ProfileAttributesSchema,
});

export type ProfileDocument = z.infer<typeof ProfileDocumentSchema>;
```

### packages/protocol/src/shared/schemas/discovery-question.schema.ts — NEW

```typescript
import { z } from "zod";
import type { DiscoveryNegotiationDigest } from "./negotiation-digest.schema.js";
import type { ChatContextDigest } from "./chat-context.schema.js";

export const NegotiationRoleSchema = z.enum(["agent", "patient", "peer"]);
export type NegotiationRole = z.infer<typeof NegotiationRoleSchema>;

export const DiscoveryTurnSchema = z.object({
  action: z.enum(["propose", "accept", "reject", "counter", "question"]),
  reasoning: z.string(),
  suggestedRoles: z.object({
    ownUser: NegotiationRoleSchema,
    otherUser: NegotiationRoleSchema,
  }),
});
export type DiscoveryTurn = z.infer<typeof DiscoveryTurnSchema>;

export const DiscoveryOutcomeSchema = z.object({
  hasOpportunity: z.boolean(),
  reasoning: z.string(),
  agreedRoles: z.array(z.object({
    userId: z.string(),
    role: NegotiationRoleSchema,
  })).optional(),
  reason: z.enum(["turn_cap", "timeout"]).optional(),
});
export type DiscoveryOutcome = z.infer<typeof DiscoveryOutcomeSchema>;

export const DiscoveryNegotiationSchema = z.object({
  counterpartyId: z.string(),
  counterpartyHint: z.string(),
  indexContext: z.string(),
  turns: z.array(DiscoveryTurnSchema),
  outcome: DiscoveryOutcomeSchema,
  seedAssessmentScore: z.number().optional(),
});
export type DiscoveryNegotiation = z.infer<typeof DiscoveryNegotiationSchema>;

export const DiscoverySummarySchema = z.object({
  totalCandidates: z.number(),
  opportunitiesFound: z.number(),
  noOpportunityCount: z.number(),
  timeoutCount: z.number(),
  roleDistribution: z.record(z.string(), z.number()).optional(),
});
export type DiscoverySummary = {
  totalCandidates: number;
  opportunitiesFound: number;
  noOpportunityCount: number;
  timeoutCount: number;
  roleDistribution?: Partial<Record<NegotiationRole, number>>;
};

export const DiscoverySourceProfileSchema = z.object({
  name: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
});
export type DiscoverySourceProfile = z.infer<typeof DiscoverySourceProfileSchema>;

export interface DiscoveryQuestionInput {
  query: string;
  sourceProfile: DiscoverySourceProfile;
  negotiationDigests: DiscoveryNegotiationDigest[];
  summary: DiscoverySummary;
  chatContext?: ChatContextDigest;
  now: string;
}
```

### packages/protocol/src/shared/interfaces/database.interface.ts — MODIFY (line 1)

```typescript
// BEFORE:
// import { ProfileDocument } from '../../profile/profile.generator.js';
// AFTER:
import { ProfileDocument } from '../schemas/profile.schema.js';
```

### packages/protocol/src/shared/agent/tool.helpers.ts — MODIFY (line 3)

```typescript
// BEFORE:
// import type { ProfileDocument } from "../../profile/profile.generator.js";
// AFTER:
import type { ProfileDocument } from "../schemas/profile.schema.js";
```

### packages/protocol/src/shared/interfaces/question-generator.interface.ts — MODIFY (line 10)

```typescript
// BEFORE:
// import type { DiscoveryQuestionInput } from "../../opportunity/question.prompt.js";
// AFTER:
import type { DiscoveryQuestionInput } from "../schemas/discovery-question.schema.js";
```

### packages/protocol/src/index.ts — MODIFY

```typescript
// Added after the PendingQuestionSummary export:
export {
  ProfileIdentitySchema,
  ProfileNarrativeSchema,
  ProfileAttributesSchema,
  ProfileDocumentSchema,
  type ProfileDocument,
} from "./shared/schemas/profile.schema.js";
export type {
  DiscoverySourceProfile,
  DiscoverySummary,
  DiscoveryNegotiation,
  DiscoveryTurn,
  DiscoveryOutcome,
  DiscoveryQuestionInput,
  NegotiationRole,
} from "./shared/schemas/discovery-question.schema.js";

// Removed old re-exports from "./opportunity/question.prompt.js":
// export type { DiscoveryQuestionInput, DiscoveryNegotiation, ... };
```

### packages/protocol/src/shared/schemas/negotiation-state.schema.ts — NEW

```typescript
import { z } from "zod";

export const NegotiationTurnSchema = z.object({
  action: z.enum(["propose", "accept", "reject", "counter", "question"]),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
  message: z.string().nullable().optional(),
});
export type NegotiationTurn = z.infer<typeof NegotiationTurnSchema>;

export const NegotiationOutcomeSchema = z.object({
  hasOpportunity: z.boolean(),
  agreedRoles: z.array(z.object({
    userId: z.string(),
    role: z.enum(["agent", "patient", "peer"]),
  })),
  reasoning: z.string(),
  turnCount: z.number(),
  reason: z.enum(["turn_cap", "timeout"]).optional(),
});
export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

export interface UserNegotiationContext {
  id: string;
  intents: Array<{ id: string; title: string; description: string; confidence: number }>;
  profile: { name?: string; bio?: string; location?: string; interests?: string[]; skills?: string[] };
}

export interface SeedAssessment {
  reasoning: string;
  valencyRole: string;
  actors?: Array<{ userId: string; role: string }>;
}
```

### packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts — MODIFY

```typescript
// BEFORE:
// import type { NegotiationTurn, UserNegotiationContext, SeedAssessment } from '../../negotiation/negotiation.state.js';
// AFTER:
import type { NegotiationTurn, UserNegotiationContext, SeedAssessment } from '../schemas/negotiation-state.schema.js';
```

### packages/protocol/src/negotiation/negotiation.state.ts — no change needed (local copies retained for graph-internal consumers)

### packages/protocol/src/index.ts — MODIFY (Slice 2 re-exports)

```typescript
// BEFORE:
// export type { NegotiationTurn, UserNegotiationContext, SeedAssessment, NegotiationGraphLike } from "./negotiation/negotiation.state.js";
// AFTER:
export type {
  UserNegotiationContext,
  NegotiationTurn,
  NegotiationOutcome,
  SeedAssessment,
} from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationGraphLike } from "./negotiation/negotiation.state.js";
```

### packages/protocol/src/shared/interfaces/database.interface.ts — MODIFY (Slice 4)

```typescript
// Added to the ChatGraphCompositeDatabase Pick<> union under // Premise lifecycle:
//   | 'createPremise'
//   | 'getPremise'
//   | 'updatePremise'
//   | 'assignPremiseToNetwork'
//   | 'getPremiseNetworks'
// These 5 methods were missing from ChatGraphCompositeDatabase but required
// by PremiseGraphDatabase, forcing `as unknown as` casts.
```

### packages/protocol/src/shared/agent/tool.factory.ts — MODIFY

```typescript
// BEFORE:
// const premiseGraph = new PremiseGraphFactory(database as unknown as PremiseGraphDatabase, embedder).createGraph();
// AFTER:
const premiseGraph = new PremiseGraphFactory(database as PremiseGraphDatabase, embedder).createGraph();
```

### packages/protocol/src/premise/premise.tools.ts — MODIFY

```typescript
// BEFORE:
// const database = deps.database as unknown as PremiseGraphDatabase;
// AFTER:
const database = deps.database as PremiseGraphDatabase;
```

### packages/protocol/package.json — MODIFY

```json
{
  "dependencies": {
    "@langchain/core": "^1.1.17",
    "@langchain/langgraph": "^1.1.2",
    "@langchain/openai": "^1.2.3",
    // @langchain/langgraph-checkpoint-postgres removed — not imported by source
  }
}
```

### packages/protocol/src/shared/schemas/mcp-auth.schema.ts — NEW

```typescript
export interface McpAuthInput {
  bearerToken?: string;
  apiKey?: string;
  clientSurface?: 'telegram' | 'web';
  telegramHandle?: string;
  telegramUsername?: string;
}
```

### packages/protocol/src/shared/interfaces/auth.interface.ts — MODIFY

```typescript
// BEFORE:
// resolveIdentity(request: Request): Promise<{...}>;
// AFTER:
import type { McpAuthInput } from '../schemas/mcp-auth.schema.js';
// ...
resolveIdentity(input: McpAuthInput): Promise<{userId: string; agentId?: string; isSessionAuth?: boolean; networkScopeId?: string | null; clientSurface?: 'telegram' | 'web'}>;
```

### packages/protocol/src/mcp/mcp.server.ts — MODIFY

```typescript
// Extracts McpAuthInput from ctx.http?.req headers before calling resolveIdentity:
const mcpAuthInput: McpAuthInput = {
  bearerToken: extractBearerToken(httpReq),
  apiKey: httpReq.headers.get('x-api-key') ?? undefined,
  clientSurface: parseClientSurface(httpReq.headers.get('x-index-surface')),
  telegramHandle: httpReq.headers.get('x-index-telegram-handle') ?? undefined,
  telegramUsername: httpReq.headers.get('x-index-telegram-username') ?? undefined,
};
const { userId, agentId, isSessionAuth, networkScopeId, clientSurface } = await authResolver.resolveIdentity(mcpAuthInput);

// Added helpers:
function extractBearerToken(req: Request): string | undefined { ... }
function parseClientSurface(raw: string | null): 'telegram' | 'web' { ... }
```

### backend/src/controllers/mcp.controller.ts — MODIFY (Slices 3+5)

```typescript
// Import added: McpAuthInput
// resolver signature: resolveIdentity(input: McpAuthInput) instead of resolveIdentity(request: Request)
// Header reads changed from request.headers.get('X') to input.x
// finalizeMcpIdentity signature: (telegramHandle, identity) instead of (request, identity)
// resolveUserId bridges: extracts McpAuthInput from Request inline
```

### backend/src/services/tool.service.ts — MODIFY (Slice 3)

```typescript
// No code changes needed — ToolDeps and compiled graph imports remain intact
// (DefineTool, ToolRegistry, ToolErrorReport removals from barrel did not affect this file)
```

## Slices

### Slice 1: Profile + DiscoveryQuestion DTO extraction

**Files**: `packages/protocol/src/shared/schemas/profile.schema.ts` (NEW), `packages/protocol/src/shared/schemas/discovery-question.schema.ts` (NEW), `packages/protocol/src/shared/interfaces/database.interface.ts` (MODIFY), `packages/protocol/src/shared/agent/tool.helpers.ts` (MODIFY), `packages/protocol/src/shared/interfaces/question-generator.interface.ts` (MODIFY), `packages/protocol/src/index.ts` (MODIFY)

#### Automated Verification:
- [ ] Type checking passes: `cd packages/protocol && bun run build`
- [ ] Tests pass: `cd packages/protocol && bun test`
- [ ] No imports from `profile/profile.generator.ts` or `opportunity/question.prompt.ts` remain in `shared/interfaces/database.interface.ts`
- [ ] No imports from `profile/profile.generator.ts` remain in `shared/agent/tool.helpers.ts`

#### Manual Verification:
- [ ] `profile.schema.ts` defines `ProfileDocument` as a pure Zod-inferred type without LangChain or model imports
- [ ] `discovery-question.schema.ts` defines all discovery question types without domain implementation imports
- [ ] `database.interface.ts` imports `ProfileDocument` from `../schemas/profile.schema.js` not from `../../profile/profile.generator.js`
- [ ] `tool.helpers.ts` imports `ProfileDocument` from `../schemas/profile.schema.js` not from `../../profile/profile.generator.js`

### Slice 2: Negotiation state DTO extraction

**Files**: `packages/protocol/src/shared/schemas/negotiation-state.schema.ts` (NEW), `packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts` (MODIFY), `packages/protocol/src/negotiation/negotiation.state.ts` (MODIFY), `packages/protocol/src/index.ts` (MODIFY)

#### Automated Verification:
- [ ] Type checking passes: `cd packages/protocol && bun run build`
- [ ] Tests pass: `cd packages/protocol && bun test`
- [ ] No imports from `negotiation/negotiation.state.ts` remain in `shared/interfaces/agent-dispatcher.interface.ts`

#### Manual Verification:
- [ ] `negotiation-state.schema.ts` defines `NegotiationTurn` as a pure static interface (not `z.infer`)
- [ ] `negotiation.state.ts` defines `NegotiationTurn`, `NegotiationOutcome`, `UserNegotiationContext`, `SeedAssessment` structurally identical to the shared schema (dual definitions — schema is canonical for shared interfaces; domain file keeps local copies for graph internals)
- [ ] `agent-dispatcher.interface.ts` imports negotiation types from `../schemas/negotiation-state.schema.js`

### Slice 3: Public API narrowing

**Files**: `packages/protocol/src/index.ts` (MODIFY), `backend/src/controllers/mcp.controller.ts` (MODIFY), `backend/src/services/tool.service.ts` (MODIFY)

#### Automated Verification:
- [ ] Type checking passes: `bun run build` at root
- [ ] `export type * from "./shared/interfaces/database.interface.js"` is replaced with explicit named exports
- [ ] No references to `DefineTool`, `RawToolDefinition`, or `ToolRegistry` remain in `index.ts` as root exports

#### Manual Verification:
- [ ] Backend code (`mcp.controller.ts`, `tool.service.ts`) still compiles without root imports of removed types
- [ ] Negotiation state types are re-exported from schemas, not from `negotiation/negotiation.state.js`

### Slice 4: Premise cast fix + Postgres dep removal

**Files**: `packages/protocol/src/shared/interfaces/database.interface.ts` (MODIFY), `packages/protocol/src/shared/agent/tool.factory.ts` (MODIFY), `packages/protocol/src/premise/premise.tools.ts` (MODIFY), `packages/protocol/package.json` (MODIFY)

#### Automated Verification:
- [ ] Type checking passes: `cd packages/protocol && bun run build`
- [ ] Tests pass: `cd packages/protocol && bun test`
- [ ] No `as unknown as PremiseGraphDatabase` casts remain in `tool.factory.ts` or `premise.tools.ts`
- [ ] `@langchain/langgraph-checkpoint-postgres` is removed from `package.json`

#### Manual Verification:
- [ ] `ChatGraphCompositeDatabase` includes `createPremise`, `getPremise`, `updatePremise`, `assignPremiseToNetwork`, `getPremiseNetworks`
- [ ] `tool.factory.ts:130` uses `database as PremiseGraphDatabase` (no `as unknown as`)
- [ ] `premise.tools.ts:12` uses `deps.database` matching `PremiseGraphDatabase` (no `as unknown as`)

### Slice 5: MCP auth DTO refactor

**Files**: `packages/protocol/src/shared/schemas/mcp-auth.schema.ts` (NEW), `packages/protocol/src/shared/interfaces/auth.interface.ts` (MODIFY), `packages/protocol/src/mcp/mcp.server.ts` (MODIFY), `backend/src/controllers/mcp.controller.ts` (MODIFY), `packages/protocol/src/index.ts` (MODIFY)

#### Automated Verification:
- [ ] Type checking passes at both protocol and backend levels: `cd packages/protocol && bun run build` and `cd backend && bun run build`
- [ ] `McpAuthResolver.resolveIdentity` no longer accepts `Request` — accepts `McpAuthInput` instead
- [ ] `mcp.server.ts` extracts `McpAuthInput` from `ctx.http?.req` before calling `resolveIdentity`

#### Manual Verification:
- [ ] `mcp-auth.schema.ts` defines `McpAuthInput` with typed fields for authorization, API key, surface, and telegram headers
- [ ] Backend `mcp.controller.ts` extracts `McpAuthInput` from the HTTP Request before passing to the resolver
- [ ] `mcp.server.ts` no longer passes raw `Request` to `authResolver`

## Desired End State

```typescript
// Shared interface imports from shared schemas — clean, no domain implementation coupling
// packages/protocol/src/shared/interfaces/database.interface.ts
import { ProfileDocument } from '../schemas/profile.schema.js';

export interface Database {
  getProfile(userId: string): Promise<ProfileDocument | null>;
  saveProfile(userId: string, profile: ProfileDocument): Promise<void>;
  // ...
}

// packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts
import type { NegotiationTurn, UserNegotiationContext, SeedAssessment } from '../schemas/negotiation-state.schema.js';

export interface AgentDispatcher {
  dispatch(userId: string, scope: ...,
    payload: NegotiationTurnPayload, options: ...): Promise<AgentDispatchResult>;
}

// packages/protocol/src/index.ts — explicit exports, no export type *
export type { Database, UserDatabase, SystemDatabase } from './shared/interfaces/database.interface.js';
// No: DefineTool, RawToolDefinition, ToolRegistry

// packages/protocol/src/shared/interfaces/auth.interface.ts
export interface McpAuthResolver {
  resolveIdentity(input: McpAuthInput): Promise<{ userId: string; agentId?: string; /* ... */ }>;
}

// packages/protocol/src/shared/agent/tool.factory.ts — no as unknown as
new PremiseGraphFactory(database as PremiseGraphDatabase, embedder)
```

## File Map
```
packages/protocol/src/shared/schemas/profile.schema.ts                              # NEW — ProfileDocument DTO
packages/protocol/src/shared/schemas/discovery-question.schema.ts                   # NEW — DiscoveryQuestionInput DTO
packages/protocol/src/shared/schemas/negotiation-state.schema.ts                    # NEW — NegotiationTurn, UserNegotiationContext, SeedAssessment DTO
packages/protocol/src/shared/schemas/mcp-auth.schema.ts                             # NEW — McpAuthInput DTO
packages/protocol/src/shared/interfaces/database.interface.ts                       # MODIFY — import ProfileDocument from schema, add premise CRUD to composite
packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts               # MODIFY — import from schema
packages/protocol/src/shared/interfaces/question-generator.interface.ts             # MODIFY — import from schema
packages/protocol/src/shared/interfaces/auth.interface.ts                           # MODIFY — McpAuthInput signature
packages/protocol/src/shared/agent/tool.helpers.ts                                  # MODIFY — import ProfileDocument from schema
packages/protocol/src/shared/agent/tool.factory.ts                                  # MODIFY — remove as unknown as PremiseGraphDatabase cast
packages/protocol/src/premise/premise.tools.ts                                      # MODIFY — remove as unknown as PremiseGraphDatabase cast
packages/protocol/src/mcp/mcp.server.ts                                             # MODIFY — extract McpAuthInput before auth
packages/protocol/package.json                                                      # MODIFY — remove Postgres checkpoint dep
packages/protocol/src/index.ts                                                      # MODIFY — narrow exports (×3: schema re-exports, API narrowing, auth)
backend/src/controllers/mcp.controller.ts                                           # MODIFY — import adjusted types, extract McpAuthInput
backend/src/services/tool.service.ts                                                # MODIFY — handle removed internal exports
```

## Ordering Constraints
- Slice 1 must precede Slices 2 and 3 (types need to be in schemas first)
- Slice 2 can run independently of Slice 1 (different types, same pattern)
- Slices 4 and 5 are independent of Slices 1-3
- Slice 5 modifies `mcp.controller.ts` — Slice 3 also modifies it; Slice 5 should come after Slice 3 to avoid merge conflicts in that file

## Verification Notes
- Run `bun run build` in packages/protocol and backend after each slice
- Run `cd packages/protocol && bun test` after each slice
- Check `grep -r "as unknown as PremiseGraphDatabase" packages/protocol/` after Slice 4 — must return 0
- Check `grep -r "DefineTool" packages/protocol/src/index.ts` after Slice 3 — must return 0
- Check `grep -r "RawToolDefinition" packages/protocol/src/index.ts` after Slice 3 — must return 0
- Check `grep -r "langgraph-checkpoint-postgres" packages/protocol/package.json` after Slice 4 — must return 0
- Dual-definition pattern: `negotiation.state.ts` and `negotiation-state.schema.ts` define structurally identical types. The schema is canonical for shared interfaces; domain file keeps local copies for backward compatibility with graph internals. A lint rule or build check should enforce structural parity between the two files.

## Performance Considerations
- All changes are compile-time / import-level — no runtime performance impact
- DTO extraction moves type definitions but does not change runtime behavior
- Removal of Postgres dep may marginally reduce `node_modules` size but has no runtime effect

## Migration Notes
- Not applicable — all changes are backward-compatible import refactors
- No data schema or persisted format changes
- Old domain imports remain viable if consumers haven't been updated (domain modules re-export from schemas where needed)

## Pattern References
- `packages/protocol/src/shared/schemas/question.schema.ts:1-60` — pattern for clean DTO: Zod schema + `z.infer` type, zero domain imports
- `packages/protocol/src/shared/schemas/chat-context.schema.ts:1-21` — minimal schema example
- `packages/protocol/src/shared/interfaces/cache.interface.ts:1-41` — pattern for narrow port: no domain imports, clean Pick-based subtypes
- `packages/protocol/src/shared/schemas/negotiation-digest.schema.ts:14-18` — existing negotiation-adjacent schema in shared/
- `packages/protocol/src/chat/chat.graph.ts:81-86` — positive injection pattern for adapter-specific infra

## Developer Context
**Q (research, Q1+Q2): Should shared interface domain-type imports be extracted to schemas or left as-is?**
A: Extract to schemas. Follow `question.schema.ts` pattern.

**Q (research, API surface): Should graph factory root exports be treated as violations?**
A: Split severity — graph factories stay as tolerated host seams. Raw runtime/registry and broad DB exports are violations.

**Q (research, MCP auth): How to fix `Request` in McpAuthResolver?**
A: Create `McpAuthInput` DTO, change `resolveIdentity` signature, extract from `Request` at MCP controller edge before calling protocol.

**Q (design, directional): Should this design extract orthogonal DTO groups into separate slices?**
A: Yes — 5 slices.

**Q (design, scope): Include MCP auth refactor?**
A: Yes — full refactor with DTO type, changed signature, backend update.

## Design History
- Slice 1: Profile + DiscoveryQuestion DTO extraction — approved as generated
- Slice 2: Negotiation state DTO extraction — approved as generated
- Slice 3: Public API narrowing — approved as generated
- Slice 4: Premise cast fix + Postgres dep removal — approved as generated
- Slice 5: MCP auth DTO refactor — approved as generated

## References
- `.rpiv/artifacts/research/2026-06-09_10-42-15_protocol-package-violations.md` — Violation detection research