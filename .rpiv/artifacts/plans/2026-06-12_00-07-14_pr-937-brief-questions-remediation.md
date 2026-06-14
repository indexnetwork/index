---
date: 2026-06-12T00:07:14+0300
author: Yankı Ekin Yüksel
commit: 1d1c539839
branch: dev
repository: index
topic: "PR #937 review remediation — brief-question hardening"
tags: [plan, code-review-remediation, protocol, mcp-tools, questioner, agentvillage, daily-brief]
status: ready
parent: ".rpiv/artifacts/designs/2026-06-11_23-01-27_pr-937-brief-questions-remediation.md"
phase_count: 5
phases:
  - { n: 1, title: "Protocol tool hardening — scope clamp + limit pushdown + error reporting" }
  - { n: 2, title: "Backend SQL-side filters — adapter modes/limit + dep pass-through" }
  - { n: 3, title: "Digest marker + prompt sanitization infrastructure" }
  - { n: 4, title: "Brief context fetch hardening + delivered-question filtering" }
  - { n: 5, title: "Compose/stage/send wiring — marker embed, diagnostics, delivered-state persistence" }
last_updated: 2026-06-12T00:07:14+0300
last_updated_by: Yankı Ekin Yüksel
last_updated_note: "Step 5 triage: 4 reviewer findings applied (version bullet, registration-scope bullet, URL stripping, strict typeof mapper guards)"
---

# PR #937 Review Remediation — Brief-Question Hardening Implementation Plan

## Overview

Hardens the `read_pending_questions` pipeline introduced in PR #937 end-to-end, per design `.rpiv/artifacts/designs/2026-06-11_23-01-27_pr-937-brief-questions-remediation.md`: the protocol tool enforces a scoped-key mode clamp and pushes `limit` into the data layer; the backend adapter applies mode/limit filters SQL-side; and the AgentVillage daily-brief scripts gain tool-error discrimination, markdown-safe prompt rendering, and once-ever question dedup via digest markers persisted in heartbeat state. All 8 findings of the parent review (1🔴 4🟡 3🔵 + 3💭) are addressed.

**Working tree**: all paths below are relative to the PR worktree `/Users/aposto/Projects/index/.worktrees/feat-agentvillage-brief-questions` (branch `feat/agentvillage-brief-questions` @ `bf791443`). AgentVillage paths (`skills/index-network/...`) are inside the submodule `packages/edge-city/agentvillage/` (@ `78215c6`). **Run implement from the PR worktree, not the `dev` checkout.**

**Cross-repo landing**: Phases 1-2 commit on the monorepo PR branch; Phases 3-5 commit inside the `packages/edge-city/agentvillage` submodule and follow the Edge-City PR flow (commit in submodule → push branch to Edge-City/agentvillage → bump the monorepo submodule pointer). Monorepo CI does not exercise the Phase 3-5 tests — run them locally per the phase criteria.

**Protocol version bump**: 3.3.1 → 3.3.2 in `packages/protocol/package.json` ships with Phase 1 (carried from the design's Ordering Constraints so it is not dropped).

## Desired End State

A scoped AgentVillage agent key calling the tool sees only self-owned questions, SQL-limited:

```ts
// MCP tools/call read_pending_questions {limit: 5} with a network-scoped key:
// handler internally does
const questions = await deps.findPendingQuestions(context.userId, {
  modes: ['profile', 'intent', 'discovery'],   // because context.networkId is set
  limit: 5,
});
// → {"success":true,"data":{"questions":[...], "scopeRestriction":{"isScoped":true, ...}}}
```

The brief pipeline never repeats a question and never trusts prompt content:

```ts
// prepare (02:00): fetch 5, filter delivered, render first survivor — sanitized + marked
const { questions } = await fetchPendingQuestionsFromMcp({ apiKey, mcpUrl }); // limit: 5
// questions: [{ id: "q-2", prompt: "What kind of collaboration…" }]  (q-1 already delivered)
// composed body contains:
// **One for you:** What kind of collaboration are you most open to right now?
// <!-- digest-question:id=q-2 -->
// <!-- digest-diagnostics: questionSource=mcp warnings=0 -->

// send (08:00): extract ids from approved body, persist, strip metadata
// heartbeat-state.json → "deliveredQuestions": { "ids": ["q-1", "q-2"] }
// finalBrief contains the question text but no HTML comments
```

A tool-level failure is loud, not silent:

```ts
// MCP returns {success:false,error:"Question lookup is not available."} + isError
const result = await fetchPendingQuestionsFromMcp({ apiKey, mcpUrl });
// → { questions: [], source: "unavailable", reason: "tool error: Question lookup is not available." }
// context.diagnostics.warnings: ["questions MCP unavailable: tool error: Question lookup is not available."]
```

## What We're NOT Doing

- Opportunity-visibility join for negotiation questions under scoped keys (review's harder alternative — high risk, low reward; revisit only if scoped briefs need negotiation questions).
- AgentVillage-side answer/dismiss tools or web-app answer surfaces (the brief's "Reply to me anytime!" routing stays as-is; dedup bounds the repetition instead).
- A network column on the `questions` table or any DB schema change.
- Changes to the chat tool factory (`tool.factory.ts`) — questioner tool is correctly absent there (review X1 check passed).
- Surfacing diagnostics anywhere beyond the staged Kanban body (no Kanban API metadata fields, no new files).

## Phase 1: Protocol tool hardening — scope clamp + limit pushdown + error reporting

### Overview

Widens the `findPendingQuestions` dep contract with `modes`/`limit` filters, and rewrites `read_pending_questions` to clamp network-scoped agent keys to self-owned modes (S2), push `limit` into the dep (Q2 tool side), report lookup failures via `reportToolError` (Q4), and return the tool array `as const` (Q7). Includes the protocol version bump 3.3.1 → 3.3.2.

### Changes Required:

#### 1. ToolDeps contract widening
**File**: `packages/protocol/src/shared/agent/tool.helpers.ts` (lines 463-467 area)
**Changes**: Widen the `findPendingQuestions` member of `ToolDeps`. Add one import alongside the existing `PendingQuestionSummary` import (line 32):

```ts
import type { QuestionMode } from "../schemas/question.schema.js";
```

Replace the existing member (lines 458-467) with:

```ts
  /**
   * Lookup pending questions for a user, optionally filtered by source,
   * detection mode, or capped by count (hosts apply `limit` SQL-side).
   * Used by tools to attach contextually relevant questions to their results.
   * Injected by the composition root — absent when question delivery is disabled.
   */
  findPendingQuestions?: (
    userId: string,
    filters?: {
      sourceType?: string;
      sourceId?: string;
      /** Restrict to questions whose detection mode is in this set. */
      modes?: QuestionMode[];
      /** Maximum rows to return; hosts should apply this in the query. */
      limit?: number;
    },
  ) => Promise<PendingQuestionSummary[]>;
```

#### 2. Questioner tool rewrite
**File**: `packages/protocol/src/questioner/questioner.tools.ts`
**Changes**: Full file replacement — scoped-key mode clamp behind `Boolean(context.networkId)`, dep-level `modes`/`limit` pushdown with defense-in-depth post-filter, `scopeRestriction` payload, `reportToolError` on throw, `as const` return:

```ts
import { z } from "zod";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { error, success } from "../shared/agent/tool.helpers.js";
import type { QuestionMode } from "../shared/schemas/question.schema.js";

/**
 * Detection modes whose questions derive solely from the caller's own data
 * (profile gaps, own intents, own discovery sessions). Negotiation-mode
 * questions are excluded for network-scoped agents: their prompts are seeded
 * from opportunity metadata that can reference out-of-scope networks and
 * other users' content (same leak class as the getOpportunitiesForUser fix).
 */
const SELF_OWNED_MODES: QuestionMode[] = ["profile", "intent", "discovery"];

/**
 * Creates MCP tool definitions for the questioner domain.
 * Exposes `read_pending_questions` for retrieving the caller's pending
 * questions generated by QuestionerAgent (profile, intent, negotiation, discovery modes).
 *
 * Network-scoped agent keys (context.networkId set via applyNetworkScopeToContext)
 * are clamped to self-owned modes; the result then carries a `scopeRestriction`
 * block mirroring the network-tools convention.
 *
 * @param defineTool - Tool factory provided by the composition root.
 * @param deps       - Shared tool dependencies; `findPendingQuestions` is optional
 *                     and the tool fails gracefully when absent.
 */
export function createQuestionerTools(defineTool: DefineTool, deps: ToolDeps) {
  const readPendingQuestions = defineTool({
    name: "read_pending_questions",
    description:
      "Returns pending questions generated for the authenticated user across all modes " +
      "(profile, intent, negotiation, discovery). These are questions generated by the " +
      "system to help surface missing signals, refine intents, or capture engagement context.\n\n" +
      "**Returns:** List of pending questions, each with `id`, `title`, `prompt`, `options`, " +
      "`multiSelect`, `mode`, `sourceType`, `sourceId`, `createdAt`, and optional `expiresAt`. " +
      "Network-scoped agents receive only profile/intent/discovery questions plus a " +
      "`scopeRestriction` note.\n\n" +
      "**Use:** Call with no arguments to get all pending questions, or pass `limit` to cap the " +
      "count. For the daily brief the script calls with a small `limit` and renders the first " +
      "question that has not been delivered yet.",
    querySchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Maximum number of questions to return (1-10, default 10)."),
    }),
    handler: async ({ context, query }) => {
      if (!deps.findPendingQuestions) {
        return error("Question lookup is not available.");
      }

      const limit = query.limit ?? 10;
      // Scoped-key discriminator: applyNetworkScopeToContext sets networkId
      // only for network-scoped agent keys (mcp.server.ts:558).
      const isScoped = Boolean(context.networkId);

      try {
        const fetched = await deps.findPendingQuestions(context.userId, {
          ...(isScoped ? { modes: SELF_OWNED_MODES } : {}),
          limit,
        });
        // Defense-in-depth: hosts apply `modes`/`limit` SQL-side; re-apply both
        // here so the clamp holds even when a custom dep ignores the filters.
        const visible = isScoped
          ? fetched.filter((q) => (SELF_OWNED_MODES as string[]).includes(q.mode))
          : fetched;
        const limited = visible.slice(0, limit);

        if (isScoped) {
          return success({
            questions: limited,
            scopeRestriction: {
              isScoped: true,
              scopedToIndex: context.indexName ?? context.networkId,
              message:
                `Results exclude negotiation questions because this agent is scoped to ` +
                `"${context.indexName ?? "this index"}".`,
            },
          });
        }

        return success({ questions: limited });
      } catch (err) {
        deps.reportToolError?.(err, {
          operation: "read-pending-questions",
          toolName: "read_pending_questions",
          userId: context.userId,
        });
        return error("Failed to read pending questions.");
      }
    },
  });

  return [readPendingQuestions] as const;
}
```

#### 3. Tool spec rewrite
**File**: `packages/protocol/src/questioner/tests/questioner.tools.spec.ts`
**Changes**: Full file replacement — adds clamp/limit/error-reporting/defense-in-depth tests:

```ts
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { createQuestionerTools } from "../questioner.tools.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { PendingQuestionSummary } from "../../shared/schemas/pending-question.schema.js";

const userId = '00000000-0000-4000-8000-000000000001';

type CapturedFilters = {
  sourceType?: string;
  sourceId?: string;
  modes?: string[];
  limit?: number;
} | undefined;

function makeContext(overrides?: Partial<ResolvedToolContext>): ResolvedToolContext {
  return {
    userId,
    userName: 'Test User',
    userEmail: 'test@example.com',
    user: { id: userId, name: 'Test User', email: 'test@example.com' } as never,
    userProfile: null,
    userNetworks: [],
    indexScope: [],
    isOnboarding: false,
    hasName: true,
    ...overrides,
  } as ResolvedToolContext;
}

const mockQuestion: PendingQuestionSummary = {
  id: 'q-0001',
  title: 'Collaboration focus',
  prompt: 'What kind of collaboration are you most open to right now?',
  options: [
    { label: 'Co-building', description: 'Working together on a project' },
    { label: 'Knowledge exchange', description: 'Sharing expertise' },
  ],
  multiSelect: false,
  mode: 'profile',
  sourceType: 'profile',
  sourceId: userId,
  createdAt: '2026-06-11T00:00:00Z',
};

function makeDeps(overrides?: {
  findPendingQuestions?: ((userId: string, filters?: CapturedFilters) => Promise<PendingQuestionSummary[]>) | undefined;
  reportToolError?: (error: unknown, report: Record<string, unknown>) => void;
}) {
  return {
    findPendingQuestions: overrides?.findPendingQuestions,
    reportToolError: overrides?.reportToolError,
  } as never;
}

function makeDefineTool() {
  type ToolSpec = {
    name: string;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  };
  const tools = new Map<string, ToolSpec>();
  const defineTool = (spec: ToolSpec) => { tools.set(spec.name, spec); return spec; };
  async function call(name: string, query: unknown, context: ResolvedToolContext = makeContext()): Promise<unknown> {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return JSON.parse(await tool.handler({ context, query }));
  }
  return { defineTool, call };
}

describe("createQuestionerTools", () => {
  describe("read_pending_questions", () => {
    it("returns questions from findPendingQuestions", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({ findPendingQuestions: async () => [mockQuestion] }));
      const result = await call("read_pending_questions", {}) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions).toHaveLength(1);
      expect(result.data.questions[0].id).toBe("q-0001");
    });

    it("returns an empty list when no questions are pending", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({ findPendingQuestions: async () => [] }));
      const result = await call("read_pending_questions", {}) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions).toHaveLength(0);
    });

    it("returns an error when findPendingQuestions is absent", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({ findPendingQuestions: undefined }));
      const result = await call("read_pending_questions", {}) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });

    it("pushes the limit into the data-layer filters and re-caps defensively", async () => {
      const { defineTool, call } = makeDefineTool();
      let captured: CapturedFilters;
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async (_userId, filters) => {
          captured = filters;
          return [
            mockQuestion,
            { ...mockQuestion, id: "q-0002" },
            { ...mockQuestion, id: "q-0003" },
          ];
        },
      }));
      const result = await call("read_pending_questions", { limit: 1 }) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(captured?.limit).toBe(1);
      expect(result.data.questions).toHaveLength(1);
      expect(result.data.questions[0].id).toBe("q-0001");
    });

    it("clamps network-scoped callers to self-owned modes and reports the restriction", async () => {
      const { defineTool, call } = makeDefineTool();
      let captured: CapturedFilters;
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async (_userId, filters) => {
          captured = filters;
          return [mockQuestion];
        },
      }));
      const scoped = makeContext({ networkId: 'net-0001', indexName: 'Edge Esmeralda' });
      const result = await call("read_pending_questions", {}, scoped) as {
        success: boolean;
        data: { questions: PendingQuestionSummary[]; scopeRestriction?: { isScoped: boolean; scopedToIndex: string } };
      };
      expect(result.success).toBe(true);
      expect(captured?.modes).toEqual(["profile", "intent", "discovery"]);
      expect(result.data.scopeRestriction?.isScoped).toBe(true);
      expect(result.data.scopeRestriction?.scopedToIndex).toBe("Edge Esmeralda");
    });

    it("does not clamp modes for unscoped callers", async () => {
      const { defineTool, call } = makeDefineTool();
      let captured: CapturedFilters;
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async (_userId, filters) => {
          captured = filters;
          return [mockQuestion];
        },
      }));
      const result = await call("read_pending_questions", {}) as { success: boolean; data: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(captured?.modes).toBeUndefined();
      expect(result.data.scopeRestriction).toBeUndefined();
    });

    it("excludes negotiation-mode rows for scoped callers even when the dep ignores the modes filter", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async () => [
          { ...mockQuestion, id: "q-neg", mode: "negotiation", sourceType: "opportunity", sourceId: "opp-1" },
          mockQuestion,
        ],
      }));
      const scoped = makeContext({ networkId: 'net-0001', indexName: 'Edge Esmeralda' });
      const result = await call("read_pending_questions", {}, scoped) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions.map((q) => q.id)).toEqual(["q-0001"]);
    });

    it("reports and surfaces an error when the lookup throws", async () => {
      const { defineTool, call } = makeDefineTool();
      const reports: Array<Record<string, unknown>> = [];
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async () => { throw new Error("db down"); },
        reportToolError: (_err, report) => { reports.push(report); },
      }));
      const result = await call("read_pending_questions", {}) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to read pending questions");
      expect(reports).toHaveLength(1);
      expect(reports[0].toolName).toBe("read_pending_questions");
      expect(reports[0].operation).toBe("read-pending-questions");
    });
  });
});
```

#### 4. Protocol version bump
**File**: `packages/protocol/package.json`
**Changes**: Bump `"version": "3.3.1"` → `"version": "3.3.2"` (repo convention: protocol contract changes ship with a patch bump in the implementation PR).

### Success Criteria:

#### Automated Verification:
- [x] Protocol package compiles: `cd packages/protocol && bun run build`
- [x] Tool spec passes: `cd packages/protocol && bun test src/questioner/tests/questioner.tools.spec.ts`
- [x] Clamp is context-derived, not caller-supplied: `grep -n "SELF_OWNED_MODES" packages/protocol/src/questioner/questioner.tools.ts` shows the constant applied behind `Boolean(context.networkId)`, and `querySchema` exposes no `modes` parameter
- [x] Peer conventions present: `grep -n "as const" packages/protocol/src/questioner/questioner.tools.ts` and `grep -n "reportToolError" packages/protocol/src/questioner/questioner.tools.ts` both return matches
- [x] Protocol version bumped: `grep -n '"version": "3.3.2"' packages/protocol/package.json` returns a match

#### Manual Verification:
- [ ] Code review: the handler-level clamp (dep filter + defense-in-depth post-filter) means a scoped principal cannot receive negotiation-mode rows from this tool regardless of host dep behavior; full end-to-end MCP verification deferred to Slice 2's criteria

---

## Phase 2: Backend SQL-side filters — adapter modes/limit + dep pass-through

### Overview

Implements the widened protocol contract backend-side: `AdapterQuestionFilters` gains `modes` + `limit`, `QuestionerAdapter.findPending` applies both in SQL (`detection->>'mode' IN (...)` + `.limit(n)`), and all three `findPendingQuestions` dep sites widen their inline signatures (bodies unchanged — `AdapterQuestionFilters` is a structural superset).

### Changes Required:

#### 1. Adapter filters + SQL
**File**: `backend/src/adapters/questioner.adapter.ts`
**Changes**: Three targeted changes (local types only — adapters never import protocol interfaces).

(1) Extend `AdapterQuestionFilters`:

```ts
/** Optional filters for the `findPending` query. */
export interface AdapterQuestionFilters {
  mode?: 'discovery' | 'intent' | 'profile' | 'negotiation';
  sourceType?: string;
  sourceId?: string;
  /** Filter to questions linked to a specific conversation. */
  conversationId?: string;
  /** When true, only return questions with no conversationId (sidebar-only). */
  noConversation?: boolean;
  /** Restrict to questions whose detection mode is in this set. */
  modes?: Array<'discovery' | 'intent' | 'profile' | 'negotiation'>;
  /** Maximum rows to return (applied as a SQL LIMIT). */
  limit?: number;
}
```

(2) In `findPending`, after the existing `noConversation` condition block, add (reuses the existing single-value `detection->>'mode'` SQL shape; `or` is already imported at line 14):

```ts
    if (filters?.modes && filters.modes.length > 0) {
      const modeConditions = filters.modes.map(
        (mode) => sql`${questions.detection}->>'mode' = ${mode}`,
      );
      conditions.push(or(...modeConditions)!);
    }
```

(3) Replace the final query with a limit-aware version, and update the `@param filters` TSDoc line to `Optional narrowing filters (mode/modes, source, conversation, SQL limit).`:

```ts
    const baseQuery = this.db
      .select()
      .from(questions)
      .where(and(...conditions))
      .orderBy(questions.createdAt);

    const rows = filters?.limit && filters.limit > 0
      ? await baseQuery.limit(filters.limit)
      : await baseQuery;
```

#### 2. MCP controller dep widening
**File**: `backend/src/controllers/mcp.controller.ts` (line ~633)
**Changes**: Widen the inline dep signature; body unchanged (`filters` passes straight through — `AdapterQuestionFilters` is a structural superset):

```ts
    findPendingQuestions: async (
      userId: string,
      filters?: {
        sourceType?: string;
        sourceId?: string;
        modes?: Array<'discovery' | 'intent' | 'profile' | 'negotiation'>;
        limit?: number;
      },
    ) => {
      const rows = await questionerAdapter.findPending(userId, filters);
      return rows.map((row): PendingQuestionSummary => ({
        id: row.id,
        title: row.payload.title,
        prompt: row.payload.prompt,
        options: row.payload.options,
        multiSelect: row.payload.multiSelect,
        mode: row.detection.mode,
        sourceType: row.detection.sourceType,
        sourceId: row.detection.sourceId,
        createdAt: row.createdAt,
        ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
      }));
    },
```

#### 3. Tool service dep widening (×2 sites)
**File**: `backend/src/services/tool.service.ts` (lines ~93 and ~184)
**Changes**: Apply the identical signature widening at BOTH `findPendingQuestions` sites; bodies unchanged — same code block as the mcp.controller.ts change above (each site already binds its own `questionerAdapter`).

#### 4. Adapter spec extensions
**File**: `backend/tests/questioner.adapter.spec.ts`
**Changes**:

(1) Extend the `afterAll` cleanup to also remove `test-user-2` rows:

```ts
afterAll(async () => {
  // Clean up all test rows (regardless of status) by deterministic marker
  await db.delete(questions).where(
    sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: 'test-user-1' }])}::jsonb`,
  );
  await db.delete(questions).where(
    sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: 'test-user-2' }])}::jsonb`,
  );
  await client.end({ timeout: 5 });
});
```

(2) Append inside `describe('QuestionerAdapter', ...)` (dedicated `test-user-2` keeps the shared-state tests unaffected):

```ts
  it('findPending filters by a modes set, excluding other modes', async () => {
    await adapter.persist([
      makePersistable({
        detection: { mode: 'profile', sourceType: 'profile', sourceId: 'test-user-2', timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
      makePersistable({
        detection: { mode: 'negotiation', sourceType: 'opportunity', sourceId: 'test-opp-2', timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
    ]);
    const pending = await adapter.findPending('test-user-2', {
      modes: ['profile', 'intent', 'discovery'],
    });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    for (const q of pending) {
      expect(q.detection.mode).not.toBe('negotiation');
    }
    const all = await adapter.findPending('test-user-2');
    expect(all.some((q) => q.detection.mode === 'negotiation')).toBe(true);
  });

  it('findPending applies the SQL limit preserving oldest-first order', async () => {
    await adapter.persist([
      makePersistable({
        detection: { mode: 'intent', sourceType: 'intent', sourceId: 'test-intent-2a', timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
      makePersistable({
        detection: { mode: 'intent', sourceType: 'intent', sourceId: 'test-intent-2b', timestamp: new Date().toISOString() },
        actors: [{ userId: 'test-user-2', role: 'subject' as const }],
      }),
    ]);
    const all = await adapter.findPending('test-user-2');
    expect(all.length).toBeGreaterThan(1);
    const limited = await adapter.findPending('test-user-2', { limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].id).toBe(all[0].id);
  });
```

#### 5. Wiring alignment test
**File**: `backend/tests/mcp.findPendingQuestions.test.ts`
**Changes**: Add `ToolDeps` to the existing type import and append one compile-time alignment test inside the existing describe block:

```ts
import type { PendingQuestionSummary, ToolDeps } from "@indexnetwork/protocol";
```

```ts
  it("widened filters shape (modes + limit) matches the ToolDeps contract", () => {
    type FindPendingQuestions = NonNullable<ToolDeps["findPendingQuestions"]>;
    const impl: FindPendingQuestions = async (_userId, filters) => {
      // Compile-time: filters must carry modes + limit alongside source filters.
      const modes: Array<"discovery" | "intent" | "profile" | "negotiation"> | undefined = filters?.modes;
      const limit: number | undefined = filters?.limit;
      void modes;
      void limit;
      return [];
    };
    expect(typeof impl).toBe("function");
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Backend type-checks with the widened protocol contract: `cd backend && bun run lint`
- [x] Adapter spec passes: `cd backend && bun test tests/questioner.adapter.spec.ts`
- [x] Wiring alignment test passes: `cd backend && bun test tests/mcp.findPendingQuestions.test.ts`
- [x] LIMIT applied in SQL, not post-fetch: `grep -n "limit(filters.limit)" backend/src/adapters/questioner.adapter.ts` returns a match and `grep -n "slice(0" backend/src/adapters/questioner.adapter.ts` returns none
- [x] All three dep sites widened: `grep -c "modes?: Array" backend/src/controllers/mcp.controller.ts` returns 1 and `grep -c "modes?: Array" backend/src/services/tool.service.ts` returns 2

#### Manual Verification:
- [ ] End-to-end (deferred from Slice 1): an MCP `read_pending_questions` call with a network-scoped agent key returns `scopeRestriction.isScoped: true` and no negotiation-mode questions; an unscoped key still receives all modes
- [ ] Registration scope holds (precedent lesson "MCP registry yes, chat factory no"): `grep -n "createQuestionerTools" packages/protocol/src/shared/agent/tool.registry.ts` returns a match and `grep -n "createQuestionerTools\|read_pending_questions" packages/protocol/src/shared/agent/tool.factory.ts` returns none

---

## Phase 3: Digest marker + prompt sanitization infrastructure

### Overview

Adds the digest-question and digest-diagnostics marker machinery plus the prompt sanitizer (S1) to the digest sanitization module: marker constants, `extractDigestQuestionIds`, extended `stripDigestMetadata`, and `sanitizeQuestionPrompt` (HTML comments stripped first so a prompt cannot inject markers). **Submodule change** — commits inside `packages/edge-city/agentvillage`.

### Changes Required:

#### 1. Markers, extractor, strip extension, sanitizer
**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/validate-digest-urls.ts`
**Changes**: Four targeted additions.

(1) New marker constants next to the existing `DIGEST_OPPORTUNITY_MARKER`:

```ts
/** Hidden marker that ties a rendered question to the question record it represents. */
const DIGEST_QUESTION_MARKER = /<!--\s*digest-question:id=([^\s>]+)\s*-->/g;

/** Hidden marker carrying prepare-time diagnostics for the Kanban reviewer (never user-facing). */
const DIGEST_DIAGNOSTICS_MARKER = /<!--\s*digest-diagnostics:[^>]*-->/g;
```

(2) New extractor mirroring `extractDigestOpportunityIds`, placed directly after it:

```ts
/**
 * Extract question ids from digest metadata markers that remain in the edited body.
 *
 * @param markdown - the editable digest body
 * @returns unique question ids in first-seen order
 */
export function extractDigestQuestionIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(DIGEST_QUESTION_MARKER)) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}
```

(3) `stripDigestMetadata` extended to remove all three marker kinds:

```ts
/**
 * Remove internal digest metadata comments from user-facing output.
 *
 * @param markdown - the digest body
 * @returns markdown without digest opportunity/question/diagnostics markers
 */
export function stripDigestMetadata(markdown: string): string {
  return markdown
    .replace(DIGEST_OPPORTUNITY_MARKER, "")
    .replace(DIGEST_QUESTION_MARKER, "")
    .replace(DIGEST_DIAGNOSTICS_MARKER, "");
}
```

(4) New prompt sanitizer (S1) placed before `sanitizeDigestUrls`:

```ts
/** HTML comments are removed from prompts BEFORE control-char stripping so a
 *  prompt cannot inject digest metadata markers into the composed body. */
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** URL-like substrings removed from prompts BEFORE control-char stripping
 *  (so autolink wrappers still match): the digest URL guard does not cover
 *  bare/autolink URLs, so a markdown link must not degrade into a bare URL. */
const PROMPT_URL = /\bhttps?:\/\/\S+/gi;

/**
 * Markdown/HTML control characters stripped from interpolated question prompts:
 * emphasis/code (`*`, `_`, "`", `~`), link brackets (`[`, `]`), and angle
 * brackets (`<`, `>`). Line-anchored syntax (headers, quotes, lists, fences)
 * is neutralized by whitespace collapsing instead.
 */
const PROMPT_CONTROL_CHARS = /[*_`~[\]<>]/g;

/**
 * Sanitize an LLM-generated question prompt for inline interpolation into the
 * digest body. The prompt is untrusted content (negotiation-mode prompts can be
 * seeded from other users' data): strip HTML comments, strip URL-like
 * substrings, strip markdown control characters, collapse all whitespace to
 * single spaces, and cap the length.
 *
 * @param prompt    - the raw question prompt
 * @param maxLength - maximum output length (default 280); longer prompts are
 *                    cut at the cap and suffixed with an ellipsis
 * @returns plain-text prompt safe to embed in one markdown line
 */
export function sanitizeQuestionPrompt(prompt: string, maxLength = 280): string {
  const flattened = prompt
    .replace(HTML_COMMENT, " ")
    .replace(PROMPT_URL, " ")
    .replace(PROMPT_CONTROL_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.length <= maxLength) return flattened;
  return `${flattened.slice(0, maxLength - 1).trimEnd()}…`;
}
```

#### 2. Marker/sanitizer tests
**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/tests/validate-digest-urls.test.ts`
**Changes**: Update the import to include the new exports:

```ts
import {
  extractDigestOpportunityIds,
  extractDigestQuestionIds,
  sanitizeDigestUrls,
  sanitizeQuestionPrompt,
  stripDigestMetadata,
} from "../validate-digest-urls";
```

Append at the end of the file:

```ts
describe("extractDigestQuestionIds", () => {
  test("extracts unique question ids in first-seen order", () => {
    const md = [
      "**One for you:** What stage? <!-- digest-question:id=q-1 -->",
      "<!-- digest-question:id=q-2 -->",
      "<!-- digest-question:id=q-1 -->",
    ].join("\n");

    expect(extractDigestQuestionIds(md)).toEqual(["q-1", "q-2"]);
  });

  test("ignores malformed or empty markers", () => {
    const md = "<!-- digest-question:id= --> <!-- digest-question --> <!-- digest-opportunity:id=opp-1 -->";

    expect(extractDigestQuestionIds(md)).toEqual([]);
  });
});

describe("stripDigestMetadata — question and diagnostics markers", () => {
  test("removes question and diagnostics markers alongside opportunity markers", () => {
    const md = [
      "<!-- digest-opportunity:id=opp-1 -->Alex",
      "**One for you:** What stage? <!-- digest-question:id=q-1 -->",
      "<!-- digest-diagnostics: questionSource=mcp warnings=0 -->",
    ].join("\n");

    const output = stripDigestMetadata(md);

    expect(output).not.toContain("digest-opportunity");
    expect(output).not.toContain("digest-question");
    expect(output).not.toContain("digest-diagnostics");
    expect(output).toContain("Alex");
    expect(output).toContain("What stage?");
  });

  test("sanitizeDigestUrls with stripDigestMetadata removes the new markers", () => {
    const md = "Body <!-- digest-question:id=q-9 --> <!-- digest-diagnostics: questionSource=unavailable warnings=1 -->";

    const { output } = sanitizeDigestUrls(md, { stripDigestMetadata: true });

    expect(output).not.toContain("digest-question");
    expect(output).not.toContain("digest-diagnostics");
  });
});

describe("sanitizeQuestionPrompt", () => {
  test("passes plain prose through unchanged", () => {
    const prompt = "What kind of collaboration are you most open to right now?";

    expect(sanitizeQuestionPrompt(prompt)).toBe(prompt);
  });

  test("strips markdown emphasis, code, and link syntax", () => {
    const prompt = "Would you join **[urgent](https://evil.com/c/abc)** `rm -rf` _now_?";

    const output = sanitizeQuestionPrompt(prompt);

    expect(output).not.toContain("*");
    expect(output).not.toContain("[");
    expect(output).not.toContain("`");
    expect(output).not.toContain("_");
    expect(output).not.toContain("evil.com");
    expect(output).toContain("urgent");
  });

  test("strips bare and autolink URLs so prompts cannot contribute links", () => {
    const prompt = "Interested? See https://evil.example.com/phish or <https://evil.example.com/2>";

    const output = sanitizeQuestionPrompt(prompt);

    expect(output).not.toContain("http");
    expect(output).not.toContain("evil.example.com");
    expect(output).toContain("Interested?");
  });

  test("collapses newlines so line-anchored markdown cannot activate", () => {
    const prompt = "Question?\n# Fake header\n> fake quote\n- fake list";

    const output = sanitizeQuestionPrompt(prompt);

    expect(output).not.toContain("\n");
    expect(output).toBe("Question? # Fake header fake quote - fake list");
  });

  test("removes HTML comments including digest-marker injection attempts", () => {
    const prompt = "Real question? <!-- digest-question:id=evil --> tail";

    const output = sanitizeQuestionPrompt(prompt);

    expect(output).toBe("Real question? tail");
    expect(extractDigestQuestionIds(output)).toEqual([]);
  });

  test("caps the length with an ellipsis", () => {
    const prompt = "x".repeat(400);

    const output = sanitizeQuestionPrompt(prompt);

    expect(output.length).toBeLessThanOrEqual(280);
    expect(output.endsWith("…")).toBe(true);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Script tests pass: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/validate-digest-urls.test.ts`
- [x] Marker-injection guard holds: the test "removes HTML comments including digest-marker injection attempts" asserts `extractDigestQuestionIds(sanitizeQuestionPrompt(...))` is empty
- [x] URL guard holds: the test "strips bare and autolink URLs so prompts cannot contribute links" asserts no `http` substring survives sanitization
- [x] All three marker kinds stripped: `grep -c 'MARKER, "")' packages/edge-city/agentvillage/skills/index-network/scripts/validate-digest-urls.ts` returns 3

#### Manual Verification:
- [ ] The diagnostics marker regex tolerates arbitrary key=value content without consuming past the closing `-->` (the `[^>]*` body stops at the first `>`)

---

## Phase 4: Brief context fetch hardening + delivered-question filtering

### Overview

Rewrites `fetchPendingQuestionsFromMcp` with full error-envelope discrimination (I2+Q5): JSON-RPC `error` → MCP `isError` → `parsed.success === false` → JSON.parse failure, each producing `source:"unavailable"` with a distinct `reason`. Slims `BriefQuestion` to `{id, prompt}` (Q6), fetches a batch of 5, and filters already-delivered questions against the date-unscoped `deliveredQuestions` state key (I1+Q1 read side). **Submodule change.**

### Changes Required:

#### 1. Fetch hardening + dedup read
**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts`
**Changes**: Five targeted changes.

(1) `BriefQuestion` slims to id+prompt (Q6 — title/mode were never rendered; id is now load-bearing for dedup):

```ts
export interface BriefQuestion {
  id: string;
  prompt: string;
}
```

(2) New constant near the top-of-file constants:

```ts
/** Pending questions fetched per brief: a small batch so already-delivered
 *  questions can be filtered out while a fresh one remains to render. */
const QUESTION_FETCH_LIMIT = 5;
```

(3) `McpToolResult` gains the transport-level error flag:

```ts
type McpToolResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};
```

(4) `fetchPendingQuestionsFromMcp` replaced in full:

```ts
/**
 * Fetch pending questions by calling the Index MCP server directly via
 * JSON-RPC with read_pending_questions. Mirrors fetchOpportunitiesFromMcp.
 *
 * Fetches a small batch (QUESTION_FETCH_LIMIT) so the caller can filter out
 * already-delivered questions and still have a fresh one to render.
 *
 * NEVER throws — all errors are caught internally.
 * Returns `{ questions, source, reason }`: `source` distinguishes a successful
 * (possibly-empty) fetch from a failure, and `reason` carries the failure
 * detail for diagnostics. Tool-level errors (MCP `isError` / `success:false`
 * payloads), transport failures, and malformed payloads produce distinct reasons.
 */
export async function fetchPendingQuestionsFromMcp(opts: {
  apiKey: string;
  mcpUrl: string;
}): Promise<{ questions: BriefQuestion[]; source: "mcp" | "unavailable"; reason?: string }> {
  try {
    const initResp = await postMcpMessage(opts.mcpUrl, opts.apiKey, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "agentvillage-digest", version: "1.0.0" },
      },
    });
    if (initResp.error) {
      return { questions: [], source: "unavailable", reason: `initialize error: ${initResp.error.message}` };
    }

    const toolResp = await postMcpMessage(opts.mcpUrl, opts.apiKey, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "read_pending_questions", arguments: { limit: QUESTION_FETCH_LIMIT } },
    });
    if (toolResp.error) {
      return { questions: [], source: "unavailable", reason: `tool call error: ${toolResp.error.message}` };
    }

    const result = toolResp.result as McpToolResult | undefined;
    const text = result?.content?.find((c) => c.type === "text")?.text ?? "";

    let parsed: { success?: boolean; error?: string; data?: { questions?: unknown[] } } | null = null;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text) as { success?: boolean; error?: string; data?: { questions?: unknown[] } };
      } catch {
        return { questions: [], source: "unavailable", reason: "malformed tool payload (invalid JSON)" };
      }
    }

    // Tool-level failures are not JSON-RPC errors: the MCP server returns them
    // as text content flagged with `isError`, serialized as {success:false}.
    if (result?.isError || parsed?.success === false) {
      return { questions: [], source: "unavailable", reason: `tool error: ${parsed?.error ?? "unknown"}` };
    }

    if (!parsed?.data?.questions || !Array.isArray(parsed.data.questions)) {
      return { questions: [], source: "mcp" };
    }

    const questions = parsed.data.questions
      .filter((q): q is Record<string, unknown> => q !== null && typeof q === "object")
      // Strict typeof guards: object/array payloads must be dropped, not
      // coerced into "[object Object]" strings that would render in a brief.
      .filter(
        (q): q is { id: string; prompt: string } =>
          typeof q.id === "string" && q.id.length > 0 &&
          typeof q.prompt === "string" && q.prompt.length > 0,
      )
      .map((q) => ({ id: q.id, prompt: q.prompt }));
    return { questions, source: "mcp" };
  } catch (err) {
    return {
      questions: [],
      source: "unavailable",
      reason: `transport failure: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

(5) Delivered-question read + filter, placed next to `filterDedupedOpportunities`/`readDeliveredIds`:

```ts
/**
 * Drop questions that were already rendered in a previous brief.
 * Unlike opportunity dedup (same-day only), delivered question ids are
 * date-unscoped: a question appears in at most one brief, ever.
 */
export function filterDeliveredQuestions(questions: BriefQuestion[], deliveredIds: Set<string>): BriefQuestion[] {
  return questions.filter((q) => !deliveredIds.has(q.id));
}

async function readDeliveredQuestionIds(stateFile: string): Promise<Set<string>> {
  try {
    const raw = await Bun.file(stateFile).text();
    const parsed = JSON.parse(raw) as { deliveredQuestions?: { ids?: unknown } };
    if (Array.isArray(parsed.deliveredQuestions?.ids)) {
      return new Set(parsed.deliveredQuestions.ids.filter((id): id is string => typeof id === "string"));
    }
  } catch {
    // missing/malformed state should not block the brief
  }
  return new Set();
}
```

And the questions block inside `buildDailyBriefContext` becomes:

```ts
  let questions: BriefQuestion[] = [];
  let questionSource: "mcp" | "unavailable" = "unavailable";

  if (apiKey) {
    const questionResult = await fetchPendingQuestionsFromMcp({ apiKey, mcpUrl });
    const deliveredQuestionIds = await readDeliveredQuestionIds(options.stateFile ?? "memory/heartbeat-state.json");
    questions = filterDeliveredQuestions(questionResult.questions, deliveredQuestionIds);
    questionSource = questionResult.source;
    if (questionResult.source === "unavailable") {
      warnings.push(`questions MCP unavailable: ${questionResult.reason ?? "unknown"}`);
    }
  }
```

#### 2. Context builder tests
**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/tests/build-daily-brief-context.test.ts`
**Changes**:

(a) Add `filterDeliveredQuestions` to the existing import from `"../build-daily-brief-context"`.

(b) In the existing test "returns questions and source mcp on success" (~line 407): remove the `expect(result.questions[0].mode).toBe("profile")` assertion — `BriefQuestion` no longer carries mode/title (the mock payload may keep returning them; the mapper drops them). Keep id/prompt assertions.

(c) In the existing test "returns source unavailable when response body is malformed": add `expect(result.reason).toContain("malformed");`.

(d) Append inside `describe("fetchPendingQuestionsFromMcp", ...)`:

```ts
  test("treats a success:false tool payload as unavailable with a tool-error reason", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}") as { method: string };
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "Question lookup is not available." }) }],
        },
      });
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: MCP_URL });
      expect(result.source).toBe("unavailable");
      expect(result.questions).toEqual([]);
      expect(result.reason).toContain("Question lookup is not available.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("treats a JSON-RPC error on tools/call as unavailable with a tool-call reason", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}") as { method: string };
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32603, message: "internal error" },
      });
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: MCP_URL });
      expect(result.source).toBe("unavailable");
      expect(result.questions).toEqual([]);
      expect(result.reason).toContain("tool call error: internal error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("treats the isError flag alone as unavailable even when the payload parses", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}") as { method: string };
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: {
          content: [{ type: "text", text: JSON.stringify({ success: true, data: { questions: [] } }) }],
          isError: true,
        },
      });
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: MCP_URL });
      expect(result.source).toBe("unavailable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reports a transport reason when the network fails", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: MCP_URL });
      expect(result.source).toBe("unavailable");
      expect(result.reason).toContain("transport failure");
      expect(result.reason).toContain("connection refused");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("requests a batch of 5 questions", async () => {
    const originalFetch = globalThis.fetch;
    let capturedLimit: number | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}") as { method: string; params?: { arguments?: { limit?: number } } };
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
      }
      capturedLimit = body.params?.arguments?.limit;
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { questions: [] } }) }] },
      });
    }) as typeof fetch;

    try {
      await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: MCP_URL });
      expect(capturedLimit).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
```

(e) Append after `describe("fetchPendingQuestionsFromMcp", ...)`:

```ts
describe("filterDeliveredQuestions", () => {
  test("drops questions whose ids were already delivered", () => {
    const questions = [
      { id: "q-1", prompt: "First?" },
      { id: "q-2", prompt: "Second?" },
    ];

    expect(filterDeliveredQuestions(questions, new Set(["q-1"]))).toEqual([
      { id: "q-2", prompt: "Second?" },
    ]);
  });

  test("keeps everything when nothing was delivered", () => {
    const questions = [{ id: "q-1", prompt: "First?" }];

    expect(filterDeliveredQuestions(questions, new Set())).toEqual(questions);
  });
});
```

(f) Add a buildDailyBriefContext-level test (inside the same describe block as "buildDailyBriefContext sets opportunitySource to mcp...") proving date-unscoped dedup with a temp state file:

```ts
  test("buildDailyBriefContext filters questions already delivered on a previous day", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.INDEX_API_KEY;
    const originalMcpUrl = process.env.INDEX_MCP_URL;
    const originalEdgeosKey = process.env.EDGEOS_API_KEY;
    const originalControlPlaneUrl = process.env.EDGE_AGENT_CONTROL_PLANE_URL;
    const originalAdminToken = process.env.ADMIN_TOKEN;
    delete process.env.EDGEOS_API_KEY;
    delete process.env.EDGE_AGENT_CONTROL_PLANE_URL;
    delete process.env.ADMIN_TOKEN;
    process.env.INDEX_API_KEY = "test-key";
    process.env.INDEX_MCP_URL = "https://test.example.com/mcp";

    const stateFile = `/tmp/heartbeat-state-${Date.now()}.json`;
    await Bun.write(stateFile, JSON.stringify({
      deliveredToday: { date: "2026-06-09", ids: [] },
      deliveredQuestions: { ids: ["q-old"] },
    }));

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("open-meteo") || url.includes("weather.gov")) {
        return new Response("unavailable", { status: 503, statusText: "Service Unavailable" });
      }
      if (url === "https://test.example.com/mcp") {
        const body = JSON.parse(init?.body as string ?? "{}") as { method: string };
        if (body.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
        }
        const params = (body as { params?: { name?: string } }).params;
        if (params?.name === "read_pending_questions") {
          return Response.json({
            jsonrpc: "2.0",
            id: 2,
            result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { questions: [
              { id: "q-old", prompt: "Already asked?" },
              { id: "q-new", prompt: "Fresh question?" },
            ] } }) }] },
          });
        }
        return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "" }] } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const context = await buildDailyBriefContext({ date: "2026-06-10", userFiles: [], stateFile });
      expect(context.diagnostics.questionSource).toBe("mcp");
      expect(context.questions).toEqual([{ id: "q-new", prompt: "Fresh question?" }]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.INDEX_API_KEY;
      else process.env.INDEX_API_KEY = originalApiKey;
      if (originalMcpUrl === undefined) delete process.env.INDEX_MCP_URL;
      else process.env.INDEX_MCP_URL = originalMcpUrl;
      if (originalEdgeosKey === undefined) delete process.env.EDGEOS_API_KEY;
      else process.env.EDGEOS_API_KEY = originalEdgeosKey;
      if (originalControlPlaneUrl === undefined) delete process.env.EDGE_AGENT_CONTROL_PLANE_URL;
      else process.env.EDGE_AGENT_CONTROL_PLANE_URL = originalControlPlaneUrl;
      if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = originalAdminToken;
    }
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Script tests pass: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/build-daily-brief-context.test.ts`
- [x] All five failure envelopes covered independently in `describe("fetchPendingQuestionsFromMcp")`: JSON-RPC `error` on tools/call, `result.isError` alone, `parsed.success === false` alone, JSON.parse failure, and transport throw — each asserting `source:"unavailable"` and a distinct reason
- [x] Dedup is date-unscoped: the buildDailyBriefContext test seeds `deliveredQuestions.ids` (no date key) and proves cross-day filtering
- [x] BriefQuestion carries no dead fields: `grep -n "title\|mode: String" packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts` shows no BriefQuestion-related title/mode mapping

#### Manual Verification:
- [ ] A real failed MCP question fetch shows up in `memory/daily-brief-context.json` diagnostics as `questionSource: "unavailable"` with a `questions MCP unavailable: <reason>` warning

---

## Phase 5: Compose/stage/send wiring — marker embed, diagnostics, delivered-state persistence

### Overview

Wires the marker/sanitizer infrastructure into the brief lifecycle: compose renders the oldest surviving question sanitized + marked and appends the diagnostics comment (Q3); stage persists `questionIds`; send extracts question ids from the operator-approved body, merges them into the date-unscoped `deliveredQuestions` state key pruned to 50 (I1+Q1 write side), and strips all metadata before delivery. **Submodule change.**

### Changes Required:

#### 1. Compose + stage
**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts`
**Changes**:

(1) Import widened:

```ts
import { sanitizeDigestUrls, sanitizeQuestionPrompt } from "./validate-digest-urls";
```

(2) New helper next to `opportunityMarker`:

```ts
function questionMarker(id: string): string {
  return id ? `<!-- digest-question:id=${id} -->` : "";
}
```

(3) `composeDailyBrief` return type becomes `{ body: string; opportunityIds: string[]; questionIds: string[] }`. The question section (currently after the "That's it for now" line) and the return statement are replaced with:

```ts
  const questionIds: string[] = [];
  const pendingQuestions = context.questions ?? [];
  if (pendingQuestions.length > 0) {
    // The context builder already filtered delivered questions (Slice 4);
    // render the oldest surviving question, sanitized (S1) and marked (I1).
    const question = pendingQuestions[0];
    const prompt = sanitizeQuestionPrompt(question.prompt);
    if (prompt) {
      questionIds.push(question.id);
      lines.push("");
      lines.push("---");
      lines.push("");
      lines.push(`**One for you:** ${questionMarker(question.id)}${prompt}`);
      lines.push("");
      lines.push("Reply to me anytime!");
    }
  }

  // Operator-facing diagnostics for the Kanban draft; stripped before delivery.
  lines.push("");
  lines.push(`<!-- digest-diagnostics: questionSource=${context.diagnostics.questionSource ?? "unavailable"} warnings=${context.diagnostics.warnings.length} -->`);

  return { body: lines.join("\n").replace(/\n{3,}/g, "\n\n"), opportunityIds, questionIds };
```

(4) In `stageDailyBrief`: destructure `const { body, opportunityIds, questionIds } = composeDailyBrief(context);`, add `questionIds` to the persisted prepared state:

```ts
  state.prepared = {
    date,
    taskId,
    taskTitle: `Morning digest — ${date}`,
    opportunityIds,
    questionIds,
  };
```

and widen the return type/value to `Promise<{ taskId: string; body: string; opportunityIds: string[]; questionIds: string[] }>` returning `{ taskId, body: sanitizedBody, opportunityIds, questionIds }`. The `main()` output line becomes:

```ts
  process.stdout.write(`${JSON.stringify({ taskId: result.taskId, opportunityIds: result.opportunityIds, questionIds: result.questionIds })}\n`);
```

Note: `DailyBriefContext.diagnostics.questionSource` is optional (`questionSource?: "mcp" | "unavailable"`, build-daily-brief-context.ts:123), so the `?? "unavailable"` fallback in compose is required and the existing `baseContext` fixture (no questionSource key) stays valid.

#### 2. Send — extract + persist + strip
**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/send-daily-brief.ts`
**Changes**:

(1) Import widened:

```ts
import { extractDigestOpportunityIds, extractDigestQuestionIds, sanitizeDigestUrls } from "./validate-digest-urls";
```

(2) New constant after the imports:

```ts
/** Max delivered-question ids retained in heartbeat state. Questions expire
 *  after 7 days and at most one ships per brief, so 50 is ample headroom. */
const DELIVERED_QUESTION_CAP = 50;
```

(3) `SendResult` gains the field:

```ts
interface SendResult {
  taskId: string;
  opportunityIds: string[];
  questionIds: string[];
  finalBrief: string;
}
```

(4) In `sendDailyBrief`, after `const opportunityIds = extractDigestOpportunityIds(body);`:

```ts
  const questionIds = extractDigestQuestionIds(body);
```

(5) After the existing `state.deliveredToday = {...}` assignment and BEFORE `await writeJson(stateFile, state);`:

```ts
  const deliveredQuestions = state.deliveredQuestions && typeof state.deliveredQuestions === "object" && !Array.isArray(state.deliveredQuestions)
    ? state.deliveredQuestions as Record<string, unknown>
    : {};
  const previousQuestionIds = stringArray(deliveredQuestions.ids);
  const mergedQuestionIds = Array.from(new Set([...previousQuestionIds, ...questionIds]));
  // Date-unscoped (unlike deliveredToday): a question appears in at most one
  // brief, ever. Prune to the most recent entries.
  state.deliveredQuestions = { ids: mergedQuestionIds.slice(-DELIVERED_QUESTION_CAP) };
```

(6) Return becomes `{ taskId, opportunityIds, questionIds, finalBrief }`.

#### 3. Stage tests
**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief.test.ts`
**Changes**:

(a) Replace the existing "renders a One for you section when questions are pending" test (its fixture used the old `{id,title,prompt,mode}` shape — the only fixture in the file with title/mode):

```ts
  test("renders a One for you section when questions are pending", () => {
    const { body, questionIds } = composeDailyBrief({
      ...baseContext,
      questions: [
        { id: "q-0001", prompt: "What kind of collaboration are you most open to right now?" },
      ],
    });
    expect(body).toContain("**One for you:** <!-- digest-question:id=q-0001 -->What kind of collaboration are you most open to right now?");
    expect(body).toContain("Reply to me anytime!");
    expect(questionIds).toEqual(["q-0001"]);
  });
```

(b) Append inside `describe("composeDailyBrief", ...)`:

```ts
  test("sanitizes markdown and marker injection out of the question prompt", () => {
    const { body } = composeDailyBrief({
      ...baseContext,
      questions: [
        { id: "q-0002", prompt: "Join **now**? <!-- digest-question:id=evil -->\n# header" },
      ],
    });
    expect(body).toContain("**One for you:** <!-- digest-question:id=q-0002 -->Join now? # header");
    expect(body).not.toContain("id=evil");
  });

  test("skips the question section when the sanitized prompt is empty", () => {
    const { body, questionIds } = composeDailyBrief({
      ...baseContext,
      questions: [{ id: "q-0003", prompt: "<!-- nothing but a comment -->" }],
    });
    expect(body).not.toContain("**One for you:**");
    expect(questionIds).toEqual([]);
  });

  test("appends a digest-diagnostics marker reflecting questionSource and warnings", () => {
    const { body } = composeDailyBrief(baseContext);
    expect(body).toContain("<!-- digest-diagnostics: questionSource=unavailable warnings=0 -->");

    const { body: withSource } = composeDailyBrief({
      ...baseContext,
      diagnostics: { ...baseContext.diagnostics, questionSource: "mcp", warnings: ["x"] },
    });
    expect(withSource).toContain("<!-- digest-diagnostics: questionSource=mcp warnings=1 -->");
  });
```

#### 4. Send tests
**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/tests/send-daily-brief.test.ts`
**Changes**: Append inside `describe("sendDailyBrief", ...)`:

```ts
  test("extracts question ids, persists date-unscoped deliveredQuestions, and strips question metadata", async () => {
    tempWorkspace();
    await Bun.write("state.json", JSON.stringify({
      prepared: { date: "2026-06-04", taskId: "t_digest", opportunityIds: [], questionIds: ["q-2"] },
      deliveredToday: { date: "2026-06-03", ids: [] },
      deliveredQuestions: { ids: ["q-1"] },
    }));
    const body = [
      "🌞 Good morning",
      "**One for you:** <!-- digest-question:id=q-2 -->What stage are you at?",
      "<!-- digest-diagnostics: questionSource=mcp warnings=0 -->",
    ].join("\n");

    const result = await sendDailyBrief({
      date: "2026-06-04",
      stateFile: "state.json",
      outgoingFile: "outgoing.md",
      hermes: (args) => {
        if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_digest", status: "ready", body } });
        if (args[0] === "kanban" && args[1] === "complete") return "completed";
        throw new Error(`unexpected hermes call: ${args.join(" ")}`);
      },
    });

    expect("silent" in result).toBe(false);
    if ("silent" in result) throw new Error("unexpected silent result");
    expect(result.questionIds).toEqual(["q-2"]);
    expect(result.finalBrief).toContain("What stage are you at?");
    expect(result.finalBrief).not.toContain("digest-question");
    expect(result.finalBrief).not.toContain("digest-diagnostics");

    const state = JSON.parse(await Bun.file("state.json").text()) as {
      deliveredQuestions: { ids: string[] };
      prepared: unknown;
      deliveredToday: unknown;
    };
    expect(state.deliveredQuestions.ids).toEqual(["q-1", "q-2"]);
    expect(state.prepared).toBeDefined();
    expect(state.deliveredToday).toBeDefined();
  });

  test("prunes deliveredQuestions to the cap, dropping oldest first", async () => {
    tempWorkspace();
    const seeded = Array.from({ length: 50 }, (_, i) => `q-seed-${i}`);
    await Bun.write("state.json", JSON.stringify({
      prepared: { date: "2026-06-04", taskId: "t_digest" },
      deliveredQuestions: { ids: seeded },
    }));
    const body = "**One for you:** <!-- digest-question:id=q-new -->Fresh?";

    const result = await sendDailyBrief({
      date: "2026-06-04",
      stateFile: "state.json",
      outgoingFile: "outgoing.md",
      hermes: (args) => {
        if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_digest", status: "ready", body } });
        if (args[0] === "kanban" && args[1] === "complete") return "completed";
        throw new Error(`unexpected hermes call: ${args.join(" ")}`);
      },
    });

    expect("silent" in result).toBe(false);
    const state = JSON.parse(await Bun.file("state.json").text()) as { deliveredQuestions: { ids: string[] } };
    expect(state.deliveredQuestions.ids).toHaveLength(50);
    expect(state.deliveredQuestions.ids).toContain("q-new");
    expect(state.deliveredQuestions.ids).not.toContain("q-seed-0");
  });

  test("tolerates a state file without deliveredQuestions (first deploy)", async () => {
    tempWorkspace();
    await Bun.write("state.json", JSON.stringify({
      prepared: { date: "2026-06-04", taskId: "t_digest" },
    }));
    const body = "**One for you:** <!-- digest-question:id=q-first -->Hello?";

    const result = await sendDailyBrief({
      date: "2026-06-04",
      stateFile: "state.json",
      outgoingFile: "outgoing.md",
      hermes: (args) => {
        if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_digest", status: "ready", body } });
        if (args[0] === "kanban" && args[1] === "complete") return "completed";
        throw new Error(`unexpected hermes call: ${args.join(" ")}`);
      },
    });

    expect("silent" in result).toBe(false);
    const state = JSON.parse(await Bun.file("state.json").text()) as { deliveredQuestions: { ids: string[] } };
    expect(state.deliveredQuestions.ids).toEqual(["q-first"]);
  });
```

### Success Criteria:

#### Automated Verification:
- [x] Stage tests pass: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts`
- [x] Send tests pass: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/send-daily-brief.test.ts`
- [x] Full script suite passes: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/`
- [x] Protocol + backend baselines: `cd packages/protocol && bun run build` and `cd backend && bun test tests/questioner.adapter.spec.ts tests/mcp.findPendingQuestions.test.ts`
- [x] Marker round-trip: stage test asserts `digest-question:id=` present in the composed body; send test asserts it absent from `finalBrief` and its id present in `state.deliveredQuestions.ids`
- [x] Sibling state keys preserved: send test asserts `prepared` and `deliveredToday` survive the deliveredQuestions write

#### Manual Verification:
- [ ] Run the 02:00 prepare flow against a staging key: the Kanban draft shows the sanitized question + diagnostics comment; after approval and the 08:00 send, the Telegram brief shows the question text with no HTML comments, and the next day's brief shows a different (or no) question

---

## Testing Strategy

### Automated:
- Protocol: `cd packages/protocol && bun run build` and `bun test src/questioner/tests/questioner.tools.spec.ts` (Phase 1)
- Backend: `cd backend && bun run lint`, `bun test tests/questioner.adapter.spec.ts tests/mcp.findPendingQuestions.test.ts` (Phase 2)
- AgentVillage scripts: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/` (Phases 3-5; not exercised by monorepo CI — run locally)
- Grep-based structural checks per phase (clamp derivation, SQL limit, marker strips, dep-site widening counts)

### Manual Testing Steps:
1. MCP `read_pending_questions` with a network-scoped agent key → `scopeRestriction.isScoped: true`, no negotiation-mode questions; unscoped key → all modes (Phase 2 criteria).
2. Force an MCP question-fetch failure → `memory/daily-brief-context.json` shows `questionSource: "unavailable"` with a `questions MCP unavailable: <reason>` warning (Phase 4 criteria).
3. Staging end-to-end: 02:00 prepare shows sanitized question + diagnostics comment in the Kanban draft; post-approval 08:00 send delivers the question with no HTML comments; next day's brief shows a different (or no) question (Phase 5 criteria).
4. Verify the diagnostics marker regex (`[^>]*`) stops at the first `>` for arbitrary key=value content (Phase 3 criteria).
5. Prompt containing a literal `<!-- digest-question:id=evil -->` never produces an extractable id (marker self-injection precedent).
6. After filtering, the rendered question is the oldest undelivered — stable between prepare re-runs on the same day (deterministic selection).

## Performance Considerations

- Q2 fix removes the fetch-all-then-slice pattern: `findPending` now applies `LIMIT` in SQL. Pending-question cardinality per user is small (≤3 per generation, 7-day TTL), so this is hygiene, not a hot path.
- The mode filter uses the existing `detection->>'mode'` JSONB extraction already used by `filters.mode` (`questioner.adapter.ts:148`) — no new index needed at current scale.
- Brief fetch goes from `limit: 1` to `limit: 5` — negligible.

## Migration Notes

No DB schema change. `memory/heartbeat-state.json` gains the `deliveredQuestions` key additively: readers default to an empty set when the key is missing or malformed (same defensive shape as `readDeliveredIds`, `build-daily-brief-context.ts:394-405`). No rollback concern — removing the code leaves an inert key.

## Developer Context

Carried from the design's checkpoint decisions: marker pattern over state-only dedup (survives operator edits); widened dep filters over a separate scoped dep; `reportToolError` + `as const` peer alignment included; mode clamp = profile/intent/discovery (discovery is self-owned, advisor-endorsed); once-ever repeat policy; Q5/Q3/Q6 discussion items all folded in.

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 5._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| coverage | ## Verification Notes §7 (design) / Phase 1 §4 | <n/a> | blocker | verification-coverage | Note "Protocol package version bump (3.3.1 → 3.3.2) belongs to the implementation PR per repo convention" — the bump is in Phase 1 Changes Required §4 but has no Success Criteria bullet | Add a Phase 1 `#### Automated Verification:` bullet checking `packages/protocol/package.json` contains `"version": "3.3.2"` | applied: grep-based version bullet added to Phase 1 Automated Verification |
| coverage | ## Precedents §4 (design) | <n/a> | blocker | verification-coverage | Lesson "Registration scope needs explicit review: MCP registry yes, chat factory no" — plan's What We're NOT Doing mentions the chat factory but no Success Criteria bullet verifies it | Add a Phase 1 or Phase 2 verification bullet requiring review/grep that `read_pending_questions` is registered in MCP only and absent from the chat tool factory (`tool.factory.ts`) | applied: grep-based registration-scope bullet added to Phase 2 Manual Verification (registry: tool.registry.ts; factory: tool.factory.ts) |
| code | Phase 3 §1 (validate-digest-urls.ts) | packages/edge-city/agentvillage/skills/index-network/scripts/validate-digest-urls.ts:39 | concern | code-quality | `sanitizeQuestionPrompt` strips `[` and `]` but leaves `(https://evil.com/...)`, and the existing URL guard explicitly does not cover bare/autolink URLs, so a markdown link in a prompt becomes a user-facing bare URL | Strip URL-like substrings from question prompts before removing markdown control characters | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-06-11_23-01-27_pr-937-brief-questions-remediation.md): PROMPT_URL regex pass added to sanitizeQuestionPrompt + dedicated URL test + Phase 3 criteria bullet |
| code | Phase 4 §1 (build-daily-brief-context.ts) | packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:724 | concern | code-quality | The proposed mapper uses `String(q.id ?? "")` and `String(q.prompt ?? "")`, so malformed object/array prompt payloads pass validation as `"[object Object]"` instead of being dropped | Require `typeof q.id === "string"` and `typeof q.prompt === "string"` before mapping | applied (plan-local; design follow-up: .rpiv/artifacts/designs/2026-06-11_23-01-27_pr-937-brief-questions-remediation.md): mapper replaced with strict typeof string guards; String() coercion removed |

## References

- Design: `.rpiv/artifacts/designs/2026-06-11_23-01-27_pr-937-brief-questions-remediation.md`
- Parent review: `.rpiv/artifacts/reviews/2026-06-11_22-36-43_pr-937-agentvillage-brief-questions.md`
- PR: indexnetwork/index #937 (`feat/agentvillage-brief-questions` @ `bf791443`, submodule `78215c6`)
- Worktree: `/Users/aposto/Projects/index/.worktrees/feat-agentvillage-brief-questions`
- Peer template: `packages/protocol/src/network/network.tools.ts`
- Precedent commits: `fcc62ba`, `b7a9061`, `631f50de`, `420c5602` (see parent review Precedents table)
