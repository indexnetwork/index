---
date: 2026-06-09T13:10:22+0300
author: Yankı Ekin Yüksel
commit: cc4ceda7a
branch: dev
repository: index
topic: "Fix protocol package boundary violations"
tags: [plan, protocol, boundaries, interfaces, mcp, tools, schemas]
status: in-review
parent: .rpiv/artifacts/designs/2026-06-09_11-18-44_protocol-package-violations.md
last_updated: 2026-06-09T13:10:22+0300
last_updated_by: Yankı Ekin Yüksel
---

# Fix Protocol Package Boundary Violations — Implementation Plan

## Overview

Fix 8 protocol package boundary violations found by research: shared interface domain-type leaks, broad DB port erosion, unsafe premise casts, exposed internal API types, MCP auth Request coupling, and an unused adapter-specific dependency. Five phases, each leaving the codebase in a working state.

Design artifact: `.rpiv/artifacts/designs/2026-06-09_11-18-44_protocol-package-violations.md`

## Desired End State

Shared interfaces import from `shared/schemas/` instead of domain implementation modules. `DefineTool`, `ToolRegistry`, `ToolErrorReport` removed from root barrel. `PremiseGraphDatabase` casts are type-safe (no `as unknown as`). `@langchain/langgraph-checkpoint-postgres` removed from protocol dependencies. `McpAuthResolver.resolveIdentity` accepts a plain `McpAuthInput` DTO instead of platform `Request`. All builds pass.

## What We're NOT Doing

- Full `ToolDeps` deprecation or removal
- Raw `database` field removal from `ToolContext`
- Deep refactor of graph factory registration or tool registry architecture
- Migration of remaining raw-DB-using tools to scoped DBs
- Backend scoped DB factory restructuring
- Subpath export map addition
- Removing deprecated `QuestionGeneratorReader` interface entirely

## Phase 1: Profile + DiscoveryQuestion DTO Extraction

### Overview
Extract ProfileDocument and DiscoveryQuestionInput types from domain implementation modules to shared/schemas/ as pure Zod schemas. Update shared interfaces to import from schemas instead.

### Changes Required:

#### 1. New schema: profile.schema.ts
**File**: `packages/protocol/src/shared/schemas/profile.schema.ts`
**Changes**: NEW — ProfileDocument Zod schema and inferred type. Pure data shape matching the original LLM-output type. Zero domain imports.

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

#### 2. New schema: discovery-question.schema.ts
**File**: `packages/protocol/src/shared/schemas/discovery-question.schema.ts`
**Changes**: NEW — All discovery question leaf types (NegotiationRole, DiscoveryTurn, DiscoveryOutcome, DiscoveryNegotiation, DiscoverySummary, DiscoverySourceProfile) as Zod schemas + inferred types. Composite DiscoveryQuestionInput as pure interface.

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

#### 3. Update database.interface.ts import
**File**: `packages/protocol/src/shared/interfaces/database.interface.ts`
**Changes**: Change `import { ProfileDocument }` from `../../profile/profile.generator.js` to `../schemas/profile.schema.js`

```typescript
// BEFORE:
// import { ProfileDocument } from '../../profile/profile.generator.js';
// AFTER:
import { ProfileDocument } from '../schemas/profile.schema.js';
```

#### 4. Update tool.helpers.ts import
**File**: `packages/protocol/src/shared/agent/tool.helpers.ts`
**Changes**: Change `import type { ProfileDocument }` from `../../profile/profile.generator.js` to `../schemas/profile.schema.js`

```typescript
// BEFORE:
// import type { ProfileDocument } from "../../profile/profile.generator.js";
// AFTER:
import type { ProfileDocument } from "../schemas/profile.schema.js";
```

#### 5. Update question-generator.interface.ts import
**File**: `packages/protocol/src/shared/interfaces/question-generator.interface.ts`
**Changes**: Change `import type { DiscoveryQuestionInput }` from `../../opportunity/question.prompt.js` to `../schemas/discovery-question.schema.js`

```typescript
// BEFORE:
// import type { DiscoveryQuestionInput } from "../../opportunity/question.prompt.js";
// AFTER:
import type { DiscoveryQuestionInput } from "../schemas/discovery-question.schema.js";
```

#### 6. Update index.ts — add schema re-exports
**File**: `packages/protocol/src/index.ts`
**Changes**: Add profile.schema and discovery-question.schema re-exports. Remove old re-exports from `./opportunity/question.prompt.js`.

```typescript
// Add after the PendingQuestionSummary export:
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

// REMOVE old re-exports from "./opportunity/question.prompt.js":
// export type { DiscoveryQuestionInput, DiscoveryNegotiation, ... };
```

### Success Criteria:

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

---

## Phase 2: Negotiation State DTO Extraction

### Overview
Extract NegotiationTurn, UserNegotiationContext, SeedAssessment to shared/schemas/ as pure interfaces. Update agent-dispatcher.interface.ts and index.ts imports.

### Changes Required:

#### 1. New schema: negotiation-state.schema.ts
**File**: `packages/protocol/src/shared/schemas/negotiation-state.schema.ts`
**Changes**: NEW — Pure interface definitions for NegotiationTurn, UserNegotiationContext, SeedAssessment (used by agent-dispatcher.interface.ts). Also includes NegotiationTurnSchema + NegotiationOutcomeSchema as Zod schemas.

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

#### 2. Update agent-dispatcher.interface.ts import
**File**: `packages/protocol/src/shared/interfaces/agent-dispatcher.interface.ts`
**Changes**: Change import from `../../negotiation/negotiation.state.js` to `../schemas/negotiation-state.schema.js`

```typescript
// BEFORE:
// import type { NegotiationTurn, UserNegotiationContext, SeedAssessment } from '../../negotiation/negotiation.state.js';
// AFTER:
import type { NegotiationTurn, UserNegotiationContext, SeedAssessment } from '../schemas/negotiation-state.schema.js';
```

#### 3. Update index.ts — negotiation state re-exports
**File**: `packages/protocol/src/index.ts`
**Changes**: Re-export negotiation types from shared schema instead of domain state module.

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

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `cd packages/protocol && bun run build`
- [ ] Tests pass: `cd packages/protocol && bun test`
- [ ] No imports from `negotiation/negotiation.state.ts` remain in `shared/interfaces/agent-dispatcher.interface.ts`

#### Manual Verification:
- [ ] `negotiation-state.schema.ts` defines `NegotiationTurn` as a pure static interface (not `z.infer`)
- [ ] `negotiation.state.ts` defines `NegotiationTurn`, `NegotiationOutcome`, `UserNegotiationContext`, `SeedAssessment` structurally identical to the shared schema (dual definitions — schema is canonical for shared interfaces; domain file keeps local copies for graph internals)
- [ ] `agent-dispatcher.interface.ts` imports negotiation types from `../schemas/negotiation-state.schema.js`

---

## Phase 3: Public API Narrowing

### Overview
Remove `DefineTool`, `ToolRegistry`, `ToolErrorReport` from root barrel — zero external consumers. Keep `RawToolDefinition`, `CompiledGraph`, `ToolDeps` (used by backend queues and composition roots). `export type * from database.interface.js` kept as-is for now.

### Changes Required:

#### 1. Update index.ts — remove internal types
**File**: `packages/protocol/src/index.ts`
**Changes**: Remove `DefineTool`, `ToolRegistry`, `ToolErrorReport` from the tool.helpers.js re-export group.

```typescript
// BEFORE:
// export type {
//   ToolContext,
//   ToolErrorReport,
//   ResolvedToolContext,
//   ToolDeps,
//   ProtocolDeps,
//   DefineTool,
//   RawToolDefinition,
//   CompiledGraph,
//   ToolRegistry,
// } from "./shared/agent/tool.helpers.js";

// AFTER:
export type {
  ToolContext,
  ResolvedToolContext,
  ToolDeps,
  ProtocolDeps,
  RawToolDefinition,
  CompiledGraph,
} from "./shared/agent/tool.helpers.js";
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `cd packages/protocol && bun run build`
- [ ] No references to `DefineTool`, `RawToolDefinition`, or `ToolRegistry` remain in `index.ts` as root exports

#### Manual Verification:
- [ ] Backend code (`mcp.controller.ts`, `tool.service.ts`) still compiles without root imports of removed types
- [ ] Negotiation state types are re-exported from schemas, not from `negotiation/negotiation.state.js`

---

## Phase 4: Premise Cast Fix + Postgres Dep Removal

### Overview
Add 5 premise CRUD methods to ChatGraphCompositeDatabase. Remove `as unknown as PremiseGraphDatabase` casts from tool.factory.ts and premise.tools.ts. Remove unused Postgres checkpoint dependency from package.json.

### Changes Required:

#### 1. Add premise CRUD methods to ChatGraphCompositeDatabase
**File**: `packages/protocol/src/shared/interfaces/database.interface.ts`
**Changes**: Add `createPremise`, `getPremise`, `updatePremise`, `assignPremiseToNetwork`, `getPremiseNetworks` to the `ChatGraphCompositeDatabase` Pick<> union under the existing premise section.

```typescript
// In ChatGraphCompositeDatabase, under // ProfileGraph aggregate mode section:
  // ProfileGraph aggregate mode (premise-to-profile materialization)
  // Premise lifecycle (CRUD + network assignment)
  | 'getPremisesForUser'
  | 'getPremisesForUserInNetworks'
  | 'createPremise'
  | 'getPremise'
  | 'updatePremise'
  | 'assignPremiseToNetwork'
  | 'getPremiseNetworks'
```

#### 2. Remove cast in tool.factory.ts
**File**: `packages/protocol/src/shared/agent/tool.factory.ts`
**Changes**: Change `as unknown as PremiseGraphDatabase` to `as PremiseGraphDatabase`.

```typescript
// BEFORE:
// const premiseGraph = new PremiseGraphFactory(database as unknown as PremiseGraphDatabase, embedder).createGraph();
// AFTER:
const premiseGraph = new PremiseGraphFactory(database as PremiseGraphDatabase, embedder).createGraph();
```

#### 3. Remove cast in premise.tools.ts
**File**: `packages/protocol/src/premise/premise.tools.ts`
**Changes**: Change `as unknown as PremiseGraphDatabase` to `as PremiseGraphDatabase`.

```typescript
// BEFORE:
// const database = deps.database as unknown as PremiseGraphDatabase;
// AFTER:
const database = deps.database as PremiseGraphDatabase;
```

#### 4. Remove Postgres checkpoint dependency
**File**: `packages/protocol/package.json`
**Changes**: Remove `@langchain/langgraph-checkpoint-postgres` from dependencies.

```json
// BEFORE:
// "@langchain/core": "^1.1.17",
// "@langchain/langgraph": "^1.1.2",
// "@langchain/langgraph-checkpoint-postgres": "^1.0.0",
// "@langchain/openai": "^1.2.3",

// AFTER:
"@langchain/core": "^1.1.17",
"@langchain/langgraph": "^1.1.2",
"@langchain/openai": "^1.2.3",
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes: `cd packages/protocol && bun run build`
- [ ] Tests pass: `cd packages/protocol && bun test`
- [ ] No `as unknown as PremiseGraphDatabase` casts remain in `tool.factory.ts` or `premise.tools.ts` (production code; test stubs exempt)
- [ ] `@langchain/langgraph-checkpoint-postgres` is removed from `package.json`

#### Manual Verification:
- [ ] `ChatGraphCompositeDatabase` includes `createPremise`, `getPremise`, `updatePremise`, `assignPremiseToNetwork`, `getPremiseNetworks`
- [ ] `tool.factory.ts:130` uses `database as PremiseGraphDatabase` (no `as unknown as`)
- [ ] `premise.tools.ts:12` uses `deps.database` matching `PremiseGraphDatabase` (no `as unknown as`)

---

## Phase 5: MCP Auth DTO Refactor

### Overview
Create McpAuthInput DTO. Change McpAuthResolver.resolveIdentity signature from `Request` to `McpAuthInput`. Update MCP server to extract DTO from HTTP request at transport edge. Update backend resolver implementation.

### Changes Required:

#### 1. New schema: mcp-auth.schema.ts
**File**: `packages/protocol/src/shared/schemas/mcp-auth.schema.ts`
**Changes**: NEW — McpAuthInput interface with typed credential fields (transport-neutral).

```typescript
export interface McpAuthInput {
  bearerToken?: string;
  apiKey?: string;
  clientSurface?: 'telegram' | 'web';
  telegramHandle?: string;
  telegramUsername?: string;
}
```

#### 2. Update auth.interface.ts signature
**File**: `packages/protocol/src/shared/interfaces/auth.interface.ts`
**Changes**: Change `resolveIdentity` parameter from `Request` to `McpAuthInput`. Add McpAuthInput import. Update JSDoc.

```typescript
import type { McpAuthInput } from '../schemas/mcp-auth.schema.js';

export interface McpAuthResolver {
  resolveIdentity(input: McpAuthInput): Promise<{
    userId: string;
    agentId?: string;
    isSessionAuth?: boolean;
    networkScopeId?: string | null;
    clientSurface?: 'telegram' | 'web';
  }>;
  // deprecated resolveUserId remains unchanged
}
```

#### 3. Update mcp.server.ts — extract McpAuthInput
**File**: `packages/protocol/src/mcp/mcp.server.ts`
**Changes**: Import McpAuthInput type. Extract DTO from HTTP request headers before calling resolveIdentity. Add extractBearerToken() and parseClientSurface() helpers.

```typescript
import type { McpAuthResolver } from '../shared/interfaces/auth.interface.js';
import type { McpAuthInput } from '../shared/schemas/mcp-auth.schema.js';

// Inside the per-tool handler, after extracting httpReq:
const mcpAuthInput: McpAuthInput = {
  bearerToken: extractBearerToken(httpReq),
  apiKey: httpReq.headers.get('x-api-key') ?? undefined,
  clientSurface: parseClientSurface(httpReq.headers.get('x-index-surface')),
  telegramHandle: httpReq.headers.get('x-index-telegram-handle') ?? undefined,
  telegramUsername: httpReq.headers.get('x-index-telegram-username') ?? undefined,
};
const { userId, agentId, isSessionAuth, networkScopeId, clientSurface } = await authResolver.resolveIdentity(mcpAuthInput);

// Module-level helpers:
function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return undefined;
  const [scheme, token] = authHeader.split(/\s+/, 2);
  if (scheme?.toLowerCase() === 'bearer' && token) return token;
  return undefined;
}

const seenInvalidSurfaces = new Set<string>();
function parseClientSurface(raw: string | null): 'telegram' | 'web' {
  if (raw === null || raw === '') return 'web';
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'telegram') return 'telegram';
  if (trimmed === 'web') return 'web';
  if (!seenInvalidSurfaces.has(trimmed)) {
    seenInvalidSurfaces.add(trimmed);
    logger.warn(`Unknown x-index-surface value: "${trimmed}" (collapsing to web; seen once per process)`);
  }
  return 'web';
}
```

#### 4. Update backend mcp.controller.ts resolver
**File**: `backend/src/controllers/mcp.controller.ts`
**Changes**: Import `McpAuthInput` from `@indexnetwork/protocol`. Change resolver signature. Replace header reads with DTO field reads. Update finalizeMcpIdentity to accept telegram handle directly.

```typescript
import type { ..., McpAuthInput } from '@indexnetwork/protocol';

// In authResolver:
const authResolver: McpAuthResolver = {
  async resolveIdentity(input: McpAuthInput): Promise<ResolvedMcpIdentity> {
    const clientSurface = input.clientSurface ?? 'web';

    if (input.bearerToken) {
      // JWT or opaque token auth — same logic, reads input.bearerToken instead of headers
      // ...
    }

    if (input.apiKey) {
      // API key auth — reads input.apiKey instead of headers
      // ...
    }

    throw new Error('Authentication required');
  },
};

// finalizeMcpIdentity now accepts telegramHandle directly:
async function finalizeMcpIdentity(telegramHandle: string | undefined, identity: ResolvedMcpIdentity): Promise<ResolvedMcpIdentity> {
  if (identity.clientSurface !== 'telegram' || !telegramHandle) return identity;
  // ... (rest unchanged)
}
```

#### 5. Add McpAuthInput export to index.ts
**File**: `packages/protocol/src/index.ts`
**Changes**: Add `export type { McpAuthInput }` from the new schema.

```typescript
export type { McpAuthInput } from "./shared/schemas/mcp-auth.schema.js";
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking passes at both protocol and backend levels: `cd packages/protocol && bun run build` and `cd backend && bun run build`
- [ ] `McpAuthResolver.resolveIdentity` no longer accepts `Request` — accepts `McpAuthInput` instead
- [ ] `mcp.server.ts` extracts `McpAuthInput` from `ctx.http?.req` before calling `resolveIdentity`

#### Manual Verification:
- [ ] `mcp-auth.schema.ts` defines `McpAuthInput` with typed fields for authorization, API key, surface, and telegram headers
- [ ] Backend `mcp.controller.ts` extracts `McpAuthInput` from the HTTP Request before passing to the resolver
- [ ] `mcp.server.ts` no longer passes raw `Request` to `authResolver`

---

## Testing Strategy

### Automated:
- `cd packages/protocol && bun run build` — type checking after each phase
- `cd packages/protocol && bun test` — unit/integration tests after Phase 1, 2, 4
- `cd backend && bun run build` — full stack type check after Phase 5
- Verification grep commands from success criteria

### Manual Testing Steps:
1. Verify `database.interface.ts` no longer imports from `profile/profile.generator.ts`
2. Verify `agent-dispatcher.interface.ts` no longer imports from `negotiation/negotiation.state.ts`
3. Verify `index.ts` has no `DefineTool`, `RawToolDefinition`, `ToolRegistry` exports
4. Verify `grep -r "as unknown as PremiseGraphDatabase" packages/protocol/src/` (excluding tests) returns 0
5. Verify `grep -r "langgraph-checkpoint-postgres" packages/protocol/package.json` returns 0

## Performance Considerations

All changes are compile-time / import-level — no runtime performance impact. DTO extraction moves type definitions but does not change runtime behavior. Removal of Postgres dep marginally reduces `node_modules` size.

## Migration Notes

Not applicable — all changes are backward-compatible import refactors. No data schema or persisted format changes. Old domain imports remain viable if consumers haven't been updated (domain modules re-export from schemas where needed).

## Developer Context

(Reserved for Step 4 review findings triage.)

## References

- Design: `.rpiv/artifacts/designs/2026-06-09_11-18-44_protocol-package-violations.md`
- Research: `.rpiv/artifacts/research/2026-06-09_10-42-15_protocol-package-violations.md`