# Slice 1: Interface Refactor — Collapse NegotiationDatabase

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone `NegotiationDatabase` interface with `NegotiationGraphDatabase` — a composed type that adds `getOrCreateDM` (from `Database`) and drops `createConversation`. No behavior change.

**Architecture:** `NegotiationGraphDatabase` picks `getOrCreateDM` and `updateOpportunityStatus` from the main `Database` interface, declares conversation/task/artifact CRUD inline (these aren't on `Database`), and adds a `NegotiationQueries` extension for the 2 negotiation-specific methods. The old `NegotiationDatabase` interface is deleted. All consumers — graph factory, tools, queue workers, tests — update to use the new type name.

**Tech Stack:** TypeScript strict mode, Bun runtime, Drizzle ORM

**Linear issue:** IND-341

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Modify | Delete `NegotiationDatabase`, add `NegotiationQueries` + `NegotiationGraphDatabase` |
| `packages/protocol/src/negotiation/negotiation.graph.ts` | Modify | Update import and constructor type |
| `packages/protocol/src/opportunity/negotiation-context.loader.ts` | Modify | Update `NegotiationContextDatabase` to pick from new type |
| `packages/protocol/src/shared/agent/tool.helpers.ts` | Modify | Update `negotiationDatabase` field type in two interfaces |
| `packages/protocol/src/shared/agent/tests/tool.factory.spec.ts` | Modify | Update mock cast |
| `backend/src/adapters/database.adapter.ts` | Modify | Generalize `getOrCreateDM` to accept `participantType` |
| `backend/src/queues/negotiations/claim-timeout.queue.ts` | Modify | Update import |
| `backend/src/queues/negotiations/timeout.queue.ts` | Modify | Update import |
| `backend/tests/negotiation.graph.spec.ts` | Modify | Update mock type |
| `backend/tests/negotiation.e2e.spec.ts` | Modify | Update import and cast |

---

### Task 1: Define the new types in `database.interface.ts`

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts:1978-2127`

- [ ] **Step 1: Replace NegotiationDatabase with NegotiationQueries + NegotiationGraphDatabase**

Delete the entire `NegotiationDatabase` interface (lines 1978–2127) and replace with:

```typescript
/**
 * Negotiation-specific query operations not covered by generic
 * conversation/task primitives.
 */
export interface NegotiationQueries {
  /**
   * Persists the full negotiation turn context onto the task metadata so
   * polling agents can reconstruct the same context the system agent sees.
   * Merges into `metadata.turnContext`, leaving other keys intact.
   */
  setTaskTurnContext(taskId: string, turnContext: Record<string, unknown>): Promise<void>;

  /**
   * Returns the most-recently-created task whose metadata carries
   * `type: 'negotiation'` and `opportunityId: <id>`. Returns null if no
   * negotiation has been started for that opportunity yet.
   */
  getNegotiationTaskForOpportunity(opportunityId: string): Promise<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;
}

/**
 * Database dependency for the negotiation graph (A2A conversation/task/artifact
 * persistence). Composes generic conversation ops with negotiation-specific queries.
 *
 * Access layer: ConversationDatabaseAdapter
 */
export type NegotiationGraphDatabase = Pick<
  Database,
  | 'getOrCreateDM'
  | 'updateOpportunityStatus'
> & NegotiationQueries & {
  /** Persists a negotiation turn message within a conversation. */
  createMessage(data: {
    conversationId: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    taskId?: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ id: string; senderId: string; role: 'user' | 'agent'; parts: unknown; createdAt: Date }>;

  /** Creates a task to track the negotiation lifecycle within a conversation. */
  createTask(conversationId: string, metadata?: Record<string, unknown>): Promise<{ id: string; conversationId: string; state: string }>;

  /** Transitions a task to a new state (e.g. working, completed, failed). */
  updateTaskState(taskId: string, state: string, statusMessage?: unknown): Promise<{ id: string; conversationId: string; state: string }>;

  /** Persists a negotiation outcome artifact attached to a task. */
  createArtifact(data: { taskId: string; name?: string; parts: unknown[]; metadata?: Record<string, unknown> | null }): Promise<{ id: string }>;

  /** Lists negotiation tasks where the given user is source or candidate. */
  getTasksForUser(userId: string, options?: { state?: string }): Promise<Array<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }>>;

  /** Gets a specific task by ID. */
  getTask(taskId: string): Promise<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;

  /** Gets all messages for a conversation, ordered by creation time. */
  getMessagesForConversation(conversationId: string): Promise<Array<{
    id: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    createdAt: Date;
  }>>;

  /** Gets artifacts for a task (e.g. negotiation outcome). */
  getArtifactsForTask(taskId: string): Promise<Array<{
    id: string;
    name: string | null;
    parts: unknown[];
    metadata: Record<string, unknown> | null;
  }>>;
};
```

- [ ] **Step 2: Update HomeGraphDatabase to pick from the new type**

At line 2270, change:

```typescript
// Before
> & Pick<
  NegotiationDatabase,
  | 'getNegotiationTaskForOpportunity'
  | 'getMessagesForConversation'
  | 'getArtifactsForTask'
>;

// After
> & Pick<
  NegotiationGraphDatabase,
  | 'getNegotiationTaskForOpportunity'
  | 'getMessagesForConversation'
  | 'getArtifactsForTask'
>;
```

- [ ] **Step 3: Verify the protocol package builds**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds (there will be downstream consumer errors, but the protocol package itself should compile).

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts
git commit -m "refactor(protocol): replace NegotiationDatabase with NegotiationGraphDatabase

Delete the standalone NegotiationDatabase interface. New type composes
Pick<Database, 'getOrCreateDM' | 'updateOpportunityStatus'> with
NegotiationQueries and inline conversation/task/artifact CRUD.
Drops createConversation in favor of getOrCreateDM for slice 2."
```

---

### Task 2: Update the negotiation graph factory

**Files:**
- Modify: `packages/protocol/src/negotiation/negotiation.graph.ts:4,20,603`

- [ ] **Step 1: Update import**

At line 4, change:

```typescript
// Before
import type { NegotiationDatabase } from "../shared/interfaces/database.interface.js";

// After
import type { NegotiationGraphDatabase } from "../shared/interfaces/database.interface.js";
```

- [ ] **Step 2: Update constructor parameter**

At line 20, change:

```typescript
// Before
private database: NegotiationDatabase,

// After
private database: NegotiationGraphDatabase,
```

- [ ] **Step 3: Update createDefaultNegotiationGraph helper**

At line 603, change:

```typescript
// Before
export function createDefaultNegotiationGraph(deps: {
  database: NegotiationDatabase;

// After
export function createDefaultNegotiationGraph(deps: {
  database: NegotiationGraphDatabase;
```

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/negotiation/negotiation.graph.ts
git commit -m "refactor(protocol): update NegotiationGraphFactory to use NegotiationGraphDatabase"
```

---

### Task 3: Update negotiation-context.loader.ts

**Files:**
- Modify: `packages/protocol/src/opportunity/negotiation-context.loader.ts:17,24,27-30`

- [ ] **Step 1: Update import and NegotiationContextDatabase type**

```typescript
// Before (line 17)
import type { NegotiationDatabase, OpportunityStatus } from '../shared/interfaces/database.interface.js';

// After
import type { NegotiationGraphDatabase, OpportunityStatus } from '../shared/interfaces/database.interface.js';

// Before (lines 27-30)
export type NegotiationContextDatabase = Pick<
  NegotiationDatabase,
  'getNegotiationTaskForOpportunity' | 'getMessagesForConversation' | 'getArtifactsForTask'
>;

// After
export type NegotiationContextDatabase = Pick<
  NegotiationGraphDatabase,
  'getNegotiationTaskForOpportunity' | 'getMessagesForConversation' | 'getArtifactsForTask'
>;
```

- [ ] **Step 2: Update JSDoc comment**

At line 24, change `{@link NegotiationDatabase}` to `{@link NegotiationGraphDatabase}`.
At line 54, change `NegotiationDatabase` to `NegotiationGraphDatabase`.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/negotiation-context.loader.ts
git commit -m "refactor(protocol): update NegotiationContextDatabase to pick from NegotiationGraphDatabase"
```

---

### Task 4: Update tool.helpers.ts

**Files:**
- Modify: `packages/protocol/src/shared/agent/tool.helpers.ts:10,168,415`

- [ ] **Step 1: Update import**

At line 10, change:

```typescript
// Before
  NegotiationDatabase,

// After
  NegotiationGraphDatabase,
```

- [ ] **Step 2: Update both interface fields**

At line 168:

```typescript
// Before
  negotiationDatabase: NegotiationDatabase;

// After
  negotiationDatabase: NegotiationGraphDatabase;
```

At line 415:

```typescript
// Before
  negotiationDatabase: NegotiationDatabase;

// After
  negotiationDatabase: NegotiationGraphDatabase;
```

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/shared/agent/tool.helpers.ts
git commit -m "refactor(protocol): update tool helper interfaces to NegotiationGraphDatabase"
```

---

### Task 5: Update protocol test mock

**Files:**
- Modify: `packages/protocol/src/shared/agent/tests/tool.factory.spec.ts:305`

- [ ] **Step 1: Update mock cast**

At line 305:

```typescript
// Before
negotiationDatabase: {} as unknown as import("../../interfaces/database.interface").NegotiationDatabase,

// After
negotiationDatabase: {} as unknown as import("../../interfaces/database.interface").NegotiationGraphDatabase,
```

- [ ] **Step 2: Verify protocol tests pass**

Run: `cd packages/protocol && bun test src/shared/agent/tests/tool.factory.spec.ts`
Expected: PASS

- [ ] **Step 3: Verify full protocol build**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/agent/tests/tool.factory.spec.ts
git commit -m "test(protocol): update tool factory mock to NegotiationGraphDatabase"
```

---

### Task 6: Generalize getOrCreateDM for agent participants

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts:1371`
- Modify: `backend/src/adapters/database.adapter.ts:6891-6929`

- [ ] **Step 1: Update getOrCreateDM signature on Database interface**

At line 1371 in `database.interface.ts`:

```typescript
// Before
  getOrCreateDM(userA: string, userB: string): Promise<{ id: string }>;

// After
  getOrCreateDM(userA: string, userB: string, participantType?: 'user' | 'agent'): Promise<{ id: string }>;
```

- [ ] **Step 2: Update adapter implementation**

In `database.adapter.ts` at line 6891:

```typescript
// Before
  async getOrCreateDM(userA: string, userB: string): Promise<Conversation> {

// After
  async getOrCreateDM(userA: string, userB: string, participantType: 'user' | 'agent' = 'user'): Promise<Conversation> {
```

At line 6911, change the hardcoded `'user'` participant types:

```typescript
// Before
          { participantId: userA, participantType: 'user' as const },
          { participantId: userB, participantType: 'user' as const },

// After
          { participantId: userA, participantType },
          { participantId: userB, participantType },
```

- [ ] **Step 3: Verify existing DM tests still pass**

Run: `cd backend && bun test tests/ --grep "getOrCreateDM\|DM\|dm_pair" 2>/dev/null || echo "No matching tests found — verify via full suite"`
Expected: Any existing DM tests pass (default `'user'` preserves current behavior).

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts backend/src/adapters/database.adapter.ts
git commit -m "feat(adapter): generalize getOrCreateDM to accept participantType

Default 'user' preserves existing behavior. Agent conversations
will pass 'agent' in slice 2."
```

---

### Task 7: Update backend consumers — queue workers

**Files:**
- Modify: `backend/src/queues/negotiations/claim-timeout.queue.ts:10,24`
- Modify: `backend/src/queues/negotiations/timeout.queue.ts:6,19`

- [ ] **Step 1: Update claim-timeout.queue.ts**

At line 10:

```typescript
// Before
import type { NegotiationTurn, NegotiationOutcome, UserNegotiationContext, SeedAssessment, NegotiationDatabase } from '@indexnetwork/protocol';

// After
import type { NegotiationTurn, NegotiationOutcome, UserNegotiationContext, SeedAssessment, NegotiationGraphDatabase } from '@indexnetwork/protocol';
```

At line 24:

```typescript
// Before
  database?: NegotiationDatabase;

// After
  database?: NegotiationGraphDatabase;
```

- [ ] **Step 2: Update timeout.queue.ts**

At line 6:

```typescript
// Before
import type { NegotiationTurn, NegotiationOutcome, UserNegotiationContext, SeedAssessment, NegotiationDatabase } from '@indexnetwork/protocol';

// After
import type { NegotiationTurn, NegotiationOutcome, UserNegotiationContext, SeedAssessment, NegotiationGraphDatabase } from '@indexnetwork/protocol';
```

At line 19:

```typescript
// Before
  database?: NegotiationDatabase;

// After
  database?: NegotiationGraphDatabase;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/queues/negotiations/claim-timeout.queue.ts backend/src/queues/negotiations/timeout.queue.ts
git commit -m "refactor(backend): update negotiation queue workers to NegotiationGraphDatabase"
```

---

### Task 8: Update backend tests

**Files:**
- Modify: `backend/tests/negotiation.graph.spec.ts:7,43`
- Modify: `backend/tests/negotiation.e2e.spec.ts:6,20`

- [ ] **Step 1: Update negotiation.graph.spec.ts**

At line 7:

```typescript
// Before
import type { NegotiationDatabase, AgentDispatcher, UserNegotiationContext, SeedAssessment } from "@indexnetwork/protocol";

// After
import type { NegotiationGraphDatabase, AgentDispatcher, UserNegotiationContext, SeedAssessment } from "@indexnetwork/protocol";
```

At line 43:

```typescript
// Before
} satisfies Partial<NegotiationDatabase> as unknown as NegotiationDatabase;

// After
} satisfies Partial<NegotiationGraphDatabase> as unknown as NegotiationGraphDatabase;
```

- [ ] **Step 2: Update negotiation.e2e.spec.ts**

At line 6:

```typescript
// Before
import type { NegotiationDatabase } from "@indexnetwork/protocol";

// After
import type { NegotiationGraphDatabase } from "@indexnetwork/protocol";
```

At line 20:

```typescript
// Before
conversationDatabaseAdapter as unknown as NegotiationDatabase,

// After
conversationDatabaseAdapter as unknown as NegotiationGraphDatabase,
```

- [ ] **Step 3: Run backend tests**

Run: `cd backend && bun test tests/negotiation.graph.spec.ts tests/negotiation.e2e.spec.ts`
Expected: Both test files pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/negotiation.graph.spec.ts backend/tests/negotiation.e2e.spec.ts
git commit -m "test(backend): update negotiation test mocks to NegotiationGraphDatabase"
```

---

### Task 9: Update remaining backend composition roots

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts:7387` (comment only)

- [ ] **Step 1: Update comment reference**

At line 7387:

```typescript
// Before
  // NegotiationDatabase query methods (used by negotiation MCP tools)

// After
  // NegotiationGraphDatabase query methods (used by negotiation MCP tools)
```

At line 7506, update the JSDoc:

```typescript
// Before
   * Alias for getArtifacts with the interface name expected by NegotiationDatabase.

// After
   * Alias for getArtifacts with the interface name expected by NegotiationGraphDatabase.
```

- [ ] **Step 2: Full type check**

Run: `cd packages/protocol && bun run build && cd ../../backend && bunx tsc --noEmit`
Expected: Both pass with zero errors. The composition roots (`main.ts`, `mcp.controller.ts`, `negotiation.service.ts`, `tool.service.ts`) use `as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0]` casts, which automatically resolve to the new type.

- [ ] **Step 3: Run the full negotiation test suite**

Run: `cd backend && bun test tests/negotiation.graph.spec.ts tests/negotiation.e2e.spec.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/adapters/database.adapter.ts
git commit -m "chore(backend): update adapter comments to reference NegotiationGraphDatabase"
```

---

### Task 10: Final verification

- [ ] **Step 1: Verify NegotiationDatabase is fully removed**

Run: `grep -rn "NegotiationDatabase" --include="*.ts" packages/protocol/ backend/`
Expected: Zero matches. If any remain, fix them.

- [ ] **Step 2: Full build + type check**

Run: `cd packages/protocol && bun run build && cd ../../backend && bunx tsc --noEmit`
Expected: Both pass cleanly.

- [ ] **Step 3: Run all negotiation-related tests**

Run: `cd backend && bun test tests/negotiation.graph.spec.ts tests/negotiation.e2e.spec.ts && cd ../packages/protocol && bun test src/shared/agent/tests/tool.factory.spec.ts`
Expected: All pass.

- [ ] **Step 4: Final commit (if any stragglers)**

If the grep in step 1 found remaining references, commit the fixes:

```bash
git add -A
git commit -m "refactor: remove last NegotiationDatabase references"
```
