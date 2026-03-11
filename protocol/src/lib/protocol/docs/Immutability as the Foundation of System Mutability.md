# Immutability as the Foundation of System Mutability

**Thesis**: *"The mutability of a system is enhanced by the immutability of its components."*

This document evaluates the Index Protocol's design and architecture through the lens of this thesis.
The central claim is that rigid, immutable boundaries — interfaces, schemas, annotations, event
signatures, and migration journals — are the mechanism by which the system achieves flexibility,
extensibility, and safe evolution. Each immutable component creates a stable attachment point where
the system can freely mutate behind that boundary.

---

## 1. The Adapter Pattern: Immutable Contracts, Mutable Implementations

The protocol layer defines its dependencies as **TypeScript interfaces** in
`lib/protocol/interfaces/`. These interfaces are immutable contracts: they specify *what* operations
exist, not *how* they are performed.

```typescript
// lib/protocol/interfaces/database.interface.ts
export type IntentGraphDatabase = Pick<
  Database,
  | 'getActiveIntents'
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  | 'isIndexMember'
  | 'getUser'
  | 'getProfile'
>;
```

```typescript
// lib/protocol/interfaces/queue.interface.ts
export interface IntentGraphQueue {
  addGenerateHydeJob(data: { intentId: string; userId: string }): Promise<unknown>;
  addDeleteHydeJob(data: { intentId: string }): Promise<unknown>;
}
```

The `IntentGraphDatabase` type is a narrowed pick of the full `Database` interface — it exposes only
the methods the intent graph requires. The `IntentGraphQueue` exposes only two job-enqueue methods.
Neither interface knows about PostgreSQL, Drizzle, Redis, or BullMQ. This immutability of the
contract surface is what enables the system to swap adapters without touching the protocol layer.
A migration from PostgreSQL to another store, or from BullMQ to a different queue backend, requires
only a new adapter that satisfies the same immutable interface.

**Principle**: The narrower and more immutable the interface, the greater the freedom of the
implementation behind it.

---

## 2. LangGraph State Annotations: Immutable Schemas, Mutable Flows

Each LangGraph workflow defines its state through `Annotation.Root` — a typed, reducer-governed
schema that nodes read from and write to. The schema itself is immutable: fields, types, and
reducers are declared once and never change at runtime.

```typescript
// states/intent.state.ts
export const IntentGraphState = Annotation.Root({
  userId:           Annotation<string>,
  operationMode:    Annotation<'create' | 'update' | 'delete' | 'read' | 'propose'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'create' as const,
  }),
  inferredIntents:  Annotation<InferredIntent[]>({
    reducer: (curr, next) => next,     // Overwrite
    default: () => [],
  }),
  trace:            Annotation<Array<{ node: string; detail?: string }>>({
    reducer: (curr, next) => [...curr, ...(next || [])],  // Accumulate
    default: () => [],
  }),
});
```

Three reducer patterns govern how state mutates:

| Pattern | Reducer | Semantics |
|---------|---------|-----------|
| **Overwrite** | `(curr, next) => next` | Replaces the full value |
| **Keep-newer** | `(curr, next) => next ?? curr` | Null-coalescing for optional updates |
| **Accumulate** | `(curr, next) => [...curr, ...next]` | Appends to an array |

The graph state annotation is the *constitution* of the workflow. Nodes are free to produce any
partial state update they wish, but the annotation's reducers deterministically control how updates
merge. A node cannot invent new fields or change the merge strategy. This immutability of the state
schema is exactly what allows the system to safely introduce new nodes, reorder edges, and add
conditional routing without risking state corruption.

**Principle**: Immutable state schemas allow workflows to evolve freely because every mutation
follows a predefined, type-safe contract.

---

## 3. Graph Factory Pattern: Immutable Topology, Mutable Dependencies

Each graph is produced by a factory class. The factory's constructor accepts dependencies as
immutable interfaces; the `createGraph()` method assembles a fixed topology of nodes and edges.

```typescript
// graphs/intent.graph.ts
export class IntentGraphFactory {
  constructor(
    private database: IntentGraphDatabase,
    private embedder?: EmbeddingGenerator,
    private intentQueue?: IntentGraphQueue,
  ) {}

  public createGraph() {
    const inferrer   = new ExplicitIntentInferrer();
    const verifier   = new SemanticVerifier();
    const reconciler = new IntentReconciler();
    // ... assemble StateGraph with nodes and edges
  }
}
```

The graph's *structure* — the sequence of inference, verification, reconciliation, and execution —
is immutable. What varies are the implementations injected through the constructor: a production
database adapter, a test mock, or a different embedding provider. The factory pattern enforces a
strict boundary: the protocol defines *what happens*, while the adapter layer defines *how it
happens*.

This is the thesis in microcosm: the immutability of the graph topology is what makes the system
mutable. If nodes could rewire themselves at runtime, testing and reasoning about the system would
collapse. Because the topology is fixed, developers can safely swap, mock, or upgrade any dependency
without worrying about emergent graph behaviors.

**Principle**: A fixed topology with injectable dependencies maximizes testability and
composability.

---

## 4. Zod Schemas: Immutable Output Contracts for LLM Agents

Every agent defines its output as a Zod schema and binds it to the LLM via `.withStructuredOutput()`.
The schema is the immutable contract between the agent and all downstream consumers.

```typescript
// agents/intent.inferrer.ts
const InferredIntentSchema = z.object({
  type:        z.enum(['goal', 'tombstone']),
  description: z.string(),
  reasoning:   z.string(),
  confidence:  z.enum(['high', 'medium', 'low']),
});

const responseFormat = z.object({
  intents: z.array(InferredIntentSchema),
});

// Constructor binds schema to model
this.model = model.withStructuredOutput(responseFormat, { name: "intent_inferrer" });
```

The agent's *internal behavior* — its system prompt, chain-of-thought reasoning, temperature
setting — can change freely. But the output shape is governed by an immutable Zod schema. This
means:

- Downstream nodes can depend on the shape without runtime type checks.
- Prompts can be iterated without breaking consumers.
- Model versions can be upgraded without structural regressions.

The Zod schema acts as a **semantic firewall**: it prevents LLM hallucinations from leaking invalid
structures into the system. The immutability of the output contract is what allows the agent's
internals to mutate rapidly (prompt engineering, model swaps) without destabilizing the graph.

**Principle**: Immutable output schemas decouple agent evolution from system stability.

---

## 5. Centralized Model Configuration: Immutable Registry, Mutable Models

All agent model settings are centralized in a single `MODEL_CONFIG` object declared `as const`:

```typescript
// agents/model.config.ts
export const MODEL_CONFIG = {
  intentInferrer:       { model: "google/gemini-2.5-flash" },
  intentVerifier:       { model: "google/gemini-2.5-flash" },
  opportunityEvaluator: { model: "google/gemini-2.5-flash" },
  chat:                 { model: process.env.CHAT_MODEL ?? "google/gemini-3-pro-preview",
                          maxTokens: 8192,
                          reasoning: { effort: "low", exclude: true } },
  // ... 15 agents total
} as const satisfies Record<string, ModelSettings>;
```

The `as const` assertion makes the object deeply readonly — the registry's *structure* is immutable.
But the *values* within it (model names, temperatures, token limits) serve as the single source of
truth for the entire system. Upgrading from `gemini-2.5-flash` to a newer model requires changing
one line; every agent that uses `createModel("intentInferrer")` picks up the change automatically.

The immutability of the registry's shape (agent names, configuration schema) is what enables safe
model mutations. Without it, model strings would be scattered across agent files, and a version
upgrade would require a multi-file search-and-replace with no guarantee of consistency.

**Principle**: A read-only registry centralizes mutation to a single point of change.

---

## 6. Event Hooks: Immutable Signatures, Mutable Handlers

The event system uses a minimal, immutable hook pattern:

```typescript
// events/intent.event.ts
export const IntentEvents = {
  onArchived: (_intentId: string, _userId: string): void => {},
};
```

The *signature* of `onArchived` — two string parameters, void return — is immutable. The protocol
layer calls `IntentEvents.onArchived(intentId, userId)` without knowing or caring what the handler
does. At application startup, `main.ts` binds a concrete implementation:

```typescript
// main.ts
IntentEvents.onArchived = (intentId: string, userId: string) => {
  log.job.from('IntentEvents').verbose('Intent archived', { intentId, userId });
};
```

This pattern enables the protocol to remain a pure, self-contained library while the application
layer wires in side effects — queue jobs, logging, notifications — without modifying protocol code.
The immutability of the event signature is what allows the handler to mutate freely across
environments (production, test, development).

**Principle**: Immutable event signatures decouple the protocol from its side effects.

---

## 7. Database Schema: Immutable Migrations, Mutable Structure

The Drizzle migration system maintains an **append-only journal** — each migration is timestamped,
indexed, and permanent:

```json
{
  "entries": [
    { "idx": 0, "tag": "0000_initial_schema",                "when": 1739962800000 },
    { "idx": 1, "tag": "0001_add_chat_session_share_token",  "when": 1740050000000 },
    { "idx": 2, "tag": "0002_add_user_wallet_xmtp_columns",  "when": 1771741718439 },
    { "idx": 3, "tag": "0003_drop_agent_wallet_columns",      "when": 1771789220268 }
  ]
}
```

Once a migration is applied, it becomes part of the permanent, immutable record. New migrations
append; previous ones never change. This allows the database schema to evolve (mutate) through
additive changes while maintaining a deterministic, replayable history. Any environment —
development, staging, production — can replay the full migration chain and arrive at an identical
schema state.

The soft-delete pattern reinforces this principle at the data level:

```typescript
// schemas/database.schema.ts
export const users = pgTable('users', {
  // ... fields ...
  deletedAt: timestamp('deleted_at'),  // Soft delete — data is never destroyed
});
```

Records are never physically removed; they are marked with `deletedAt`. The data itself is
immutable — what changes is the application's *view* of which records are active. This enables
recovery, auditing, and compliance without sacrificing the system's ability to "delete" records
from the user's perspective.

**Principle**: Append-only migration journals and soft deletes allow schema and data to evolve
while preserving full history.

---

## 8. Layering Rules: Immutable Boundaries, Mutable Internals

The architecture enforces strict layering rules that function as immutable boundaries:

```
Controllers → Services → Adapters
     ↓            ↓          ↓
  (HTTP)    (Business)  (Infrastructure)
```

These rules are codified conventions:

1. **Controllers** import **services**, never adapters.
2. **Services** import **adapters**, never other services.
3. **Lib/protocol** receives adapters via **constructor injection**, never imports them.
4. Cross-service orchestration uses **events** or **queues**, not direct imports.

The boundaries are immutable — they are architectural invariants that do not change regardless of
what features are added. Within each layer, the internals can mutate freely: controllers can add
new endpoints, services can rewrite business logic, adapters can swap infrastructure. The layering
rules prevent mutations in one layer from cascading into others.

**Principle**: Immutable architectural boundaries contain the blast radius of change.

---

## Summary

| Immutable Component | What Cannot Change | What Can Freely Mutate |
|---|---|---|
| Protocol Interfaces | Method signatures, type contracts | Adapter implementations (DB, cache, queue) |
| State Annotations | Field schemas, reducer functions | Node outputs, graph routing, operation modes |
| Graph Topology | Node sequence, edge structure | Injected dependencies (database, embedder, queue) |
| Zod Output Schemas | Output shape, field types | Agent prompts, reasoning, model versions |
| Model Registry | Agent keys, config schema | Model names, temperatures, token limits |
| Event Signatures | Parameter types, return type | Runtime handler implementations |
| Migration Journal | Applied entries, timestamps | New migrations, schema additions |
| Soft Delete Fields | `deletedAt` column existence | Logical deletion state of records |
| Layering Rules | Controller→Service→Adapter flow | Internal logic within each layer |

The thesis holds throughout the architecture: **every point of system flexibility is enabled by an
adjacent point of rigidity**. The protocol layer's graphs can accommodate new workflows because
their state schemas are immutable. Agents can iterate on prompts and models because their output
contracts are fixed. Infrastructure can be swapped because the interfaces never change. The database
can evolve because each migration is permanent.

The deeper insight is that immutability is not a constraint on the system — it is the *mechanism*
by which the system achieves mutability. Without immutable interfaces, adapter swaps would require
protocol changes. Without immutable state annotations, node additions could corrupt workflows.
Without immutable Zod schemas, model upgrades could break downstream consumers. Each immutable
component is a load-bearing wall that allows the rooms around it to be freely reconfigured.

*The mutability of the system is not merely enhanced by the immutability of its components — it is
made possible by it.*
