# QuestionerAgent Slice 2: DB Table + Adapter + Queue

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `questions` database table, the `QuestionerAdapter` (implementing `QuestionerDatabase`), the `QuestionerQueue` BullMQ job + worker, and the `QUESTIONER_ENABLED` env gate. After this slice, the QuestionerAgent can be triggered as a background job and its output persisted.

**Architecture:** The `questions` table uses opportunity-style composable jsonb columns (`detection`, `actors`, `payload`, `answer`). The `QuestionerAdapter` implements the `QuestionerDatabase` interface from `@indexnetwork/protocol` using Drizzle. The `QuestionerQueue` accepts jobs from any caller, instantiates the `QuestionerAgent`, invokes it, and persists results via the adapter. The `QUESTIONER_ENABLED` env var gates whether callers enqueue jobs.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, BullMQ, `bun:test`

**Depends on:** Slice 1 (core agent, schemas, interface must be built and published/linked first)

---

### Task 1: Add the `questions` table to database schema

**Files:**
- Modify: `backend/src/schemas/database.schema.ts`

- [ ] **Step 1: Add the question status enum and table definition**

Add the following after the existing table definitions (near the other enums at the top and tables in the body):

At the top with other enums:
```typescript
export const questionStatusEnum = pgEnum('question_status', ['pending', 'answered', 'dismissed']);
```

After the `opportunities` table definition:
```typescript
export const questions = pgTable('questions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  detection: jsonb('detection').$type<import('@indexnetwork/protocol').QuestionDetection>().notNull(),
  actors: jsonb('actors').$type<import('@indexnetwork/protocol').QuestionActor[]>().notNull(),
  payload: jsonb('payload').$type<import('@indexnetwork/protocol').Question>().notNull(),
  status: questionStatusEnum('status').notNull().default('pending'),
  answer: jsonb('answer').$type<import('@indexnetwork/protocol').QuestionAnswer>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusIdx: index('questions_status_idx').on(table.status),
}));

export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestionRow = typeof questions.$inferInsert;
```

- [ ] **Step 2: Generate the migration**

Run: `cd backend && bun run db:generate`

- [ ] **Step 3: Rename the migration file**

Find the generated migration file in `backend/drizzle/` and rename it to follow the convention: `NNNN_add_questions_table.sql`. Update the `tag` in `drizzle/meta/_journal.json` to match (without `.sql`).

- [ ] **Step 4: Apply the migration**

Run: `cd backend && bun run db:migrate`

- [ ] **Step 5: Verify no pending changes**

Run: `cd backend && bun run db:generate`
Expected: "No schema changes" — confirms the migration matches the schema.

- [ ] **Step 6: Commit**

```bash
git add backend/src/schemas/database.schema.ts backend/drizzle/
git commit -m "feat(backend): add questions table with opportunity-style composable schema"
```

---

### Task 2: Create the QuestionerAdapter

**Files:**
- Create: `backend/src/adapters/questioner.adapter.ts`
- Test: `backend/tests/questioner.adapter.test.ts`

- [ ] **Step 1: Write the adapter tests**

Create `backend/tests/questioner.adapter.test.ts`:

```typescript
import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { questions } from "../src/schemas/database.schema.js";
import { QuestionerAdapter } from "../src/adapters/questioner.adapter.js";
import type { PersistableQuestion } from "@indexnetwork/protocol";

let pool: Pool;
let db: ReturnType<typeof drizzle>;
let adapter: QuestionerAdapter;

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool);
  adapter = new QuestionerAdapter(db);
});

afterAll(async () => {
  // Clean up test data
  const { eq } = await import("drizzle-orm");
  await db.delete(questions).where(eq(questions.status, "pending"));
  await pool.end();
});

function makePersistable(overrides: Partial<PersistableQuestion> = {}): PersistableQuestion {
  return {
    detection: {
      mode: "discovery",
      sourceType: "opportunity",
      sourceId: "test-opp-1",
      timestamp: new Date().toISOString(),
    },
    actors: [{ userId: "test-user-1", role: "subject" as const }],
    payload: {
      title: "Stage",
      prompt: "What stage?",
      options: [
        { label: "Early", description: "Pre-seed" },
        { label: "Growth", description: "Series A+" },
      ],
      multiSelect: false,
    },
    strategy: "refine_intent",
    ...overrides,
  };
}

describe("QuestionerAdapter", () => {
  it("persists a batch of questions", async () => {
    const batch = [makePersistable(), makePersistable({ strategy: "surface_missing_detail" })];
    await adapter.persist(batch);
    const pending = await adapter.findPending("test-user-1");
    expect(pending.length).toBeGreaterThanOrEqual(2);
  });

  it("findPending returns only pending questions for the given user", async () => {
    const pending = await adapter.findPending("test-user-1");
    for (const q of pending) {
      expect(q.status).toBe("pending");
      expect(q.actors.some((a) => a.userId === "test-user-1")).toBe(true);
    }
  });

  it("findPending filters by mode", async () => {
    const pending = await adapter.findPending("test-user-1", { mode: "discovery" });
    for (const q of pending) {
      expect(q.detection.mode).toBe("discovery");
    }
  });

  it("answers a question", async () => {
    const pending = await adapter.findPending("test-user-1");
    expect(pending.length).toBeGreaterThan(0);
    const questionId = pending[0].id;
    await adapter.answer(questionId, {
      selectedOptions: ["Early"],
      answeredBy: "test-user-1",
      answeredAt: new Date().toISOString(),
    });
    const after = await adapter.findPending("test-user-1");
    const answered = after.find((q) => q.id === questionId);
    // It should no longer appear in pending
    expect(answered).toBeUndefined();
  });

  it("dismisses a question", async () => {
    const pending = await adapter.findPending("test-user-1");
    expect(pending.length).toBeGreaterThan(0);
    const questionId = pending[0].id;
    await adapter.dismiss(questionId);
    const after = await adapter.findPending("test-user-1");
    const dismissed = after.find((q) => q.id === questionId);
    expect(dismissed).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && bun test tests/questioner.adapter.test.ts`
Expected: FAIL — `QuestionerAdapter` not found.

- [ ] **Step 3: Implement the adapter**

Create `backend/src/adapters/questioner.adapter.ts`:

```typescript
/**
 * QuestionerAdapter — Drizzle implementation of the QuestionerDatabase
 * interface from @indexnetwork/protocol.
 */
import { eq, and, sql } from "drizzle-orm";
import { questions } from "../schemas/database.schema.js";
import type {
  QuestionerDatabase,
  PersistableQuestion,
  PersistedQuestion,
  QuestionFilters,
  QuestionAnswer,
} from "@indexnetwork/protocol";

type DrizzleDb = Parameters<typeof eq> extends never[] ? never : any;

export class QuestionerAdapter implements QuestionerDatabase {
  constructor(private readonly db: DrizzleDb) {}

  async persist(batch: PersistableQuestion[]): Promise<void> {
    if (batch.length === 0) return;
    await this.db.insert(questions).values(
      batch.map((q) => ({
        detection: q.detection,
        actors: q.actors,
        payload: q.payload,
        status: "pending" as const,
      })),
    );
  }

  async findPending(userId: string, filters?: QuestionFilters): Promise<PersistedQuestion[]> {
    const conditions = [
      eq(questions.status, "pending"),
      sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`,
    ];
    if (filters?.mode) {
      conditions.push(sql`${questions.detection}->>'mode' = ${filters.mode}`);
    }
    if (filters?.sourceType) {
      conditions.push(sql`${questions.detection}->>'sourceType' = ${filters.sourceType}`);
    }
    if (filters?.sourceId) {
      conditions.push(sql`${questions.detection}->>'sourceId' = ${filters.sourceId}`);
    }
    const rows = await this.db
      .select()
      .from(questions)
      .where(and(...conditions))
      .orderBy(questions.createdAt);
    return rows.map(toPersistedQuestion);
  }

  async answer(questionId: string, answer: QuestionAnswer): Promise<void> {
    await this.db
      .update(questions)
      .set({ status: "answered", answer })
      .where(eq(questions.id, questionId));
  }

  async dismiss(questionId: string): Promise<void> {
    await this.db
      .update(questions)
      .set({ status: "dismissed" })
      .where(eq(questions.id, questionId));
  }
}

function toPersistedQuestion(row: typeof questions.$inferSelect): PersistedQuestion {
  return {
    id: row.id,
    detection: row.detection,
    actors: row.actors,
    payload: row.payload,
    status: row.status,
    answer: row.answer ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && bun test tests/questioner.adapter.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/adapters/questioner.adapter.ts backend/tests/questioner.adapter.test.ts
git commit -m "feat(backend): add QuestionerAdapter implementing QuestionerDatabase"
```

---

### Task 3: Create the QuestionerQueue

**Files:**
- Create: `backend/src/queues/questioner.queue.ts`

Consult `backend/src/queues/queue.template.md` before implementing. Follow the existing queue patterns in `backend/src/queues/`.

- [ ] **Step 1: Identify the existing queue pattern**

Read `backend/src/queues/queue.template.md` and one existing queue file (e.g. the intent or negotiation-timeout queue) to understand the BullMQ setup pattern used in this codebase: job name constants, worker setup, retry config, etc.

- [ ] **Step 2: Implement the queue**

Create `backend/src/queues/questioner.queue.ts` following the codebase queue pattern. The queue should:

- Define a `QuestionerJobData` type matching `QuestionerInput` from `@indexnetwork/protocol`.
- Define a `QUESTIONER_QUEUE_NAME` constant.
- Export a function to create the queue and add jobs.
- Export a worker function that:
  1. Instantiates `QuestionerAgent` from `@indexnetwork/protocol`.
  2. Calls `agent.invoke(jobData)`.
  3. If result is non-null, maps the result to `PersistableQuestion[]` (building `QuestionDetection` and `QuestionActor` from the job data) and calls `questionerAdapter.persist()`.
- Config: 3 retries, exponential backoff, completed jobs removed after 24h.

- [ ] **Step 3: Verify the file compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/queues/questioner.queue.ts
git commit -m "feat(backend): add QuestionerQueue BullMQ job and worker"
```

---

### Task 4: Add QUESTIONER_ENABLED env gate and inject into ProtocolDeps

**Files:**
- Modify: `backend/.env.example` — add `QUESTIONER_ENABLED=false`
- Modify: `backend/src/protocol-init.ts` (or equivalent composition root) — add `questionerDatabase` to `ProtocolDeps`

- [ ] **Step 1: Add env var to .env.example**

Add the following line to `backend/.env.example`:

```
# QuestionerAgent: set to "true" to enable background question generation
QUESTIONER_ENABLED=false
```

- [ ] **Step 2: Inject QuestionerAdapter into ProtocolDeps**

In the composition root (likely `backend/src/protocol-init.ts` or `backend/src/controllers/mcp.controller.ts`), instantiate `QuestionerAdapter` and add it to the `ProtocolDeps` object as `questionerDatabase`.

- [ ] **Step 3: Add `questionerDatabase` to the ProtocolDeps type**

In `packages/protocol/src/shared/agent/tool.helpers.ts`, add `questionerDatabase?: QuestionerDatabase` to the `ProtocolDeps` type (following the pattern of other optional deps like `agentDatabase?`). Import `QuestionerDatabase` from the interface.

- [ ] **Step 4: Verify build**

Run: `cd packages/protocol && bun run build && cd ../../backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add backend/.env.example backend/src/protocol-init.ts packages/protocol/src/shared/agent/tool.helpers.ts
git commit -m "feat: wire QuestionerAdapter into ProtocolDeps with QUESTIONER_ENABLED gate"
```
