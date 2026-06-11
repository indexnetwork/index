---
date: 2026-06-11T01:52:40+0300
author: Yankı Ekin Yüksel
commit: 9291ec3595
branch: feat/agentvillage-brief-questions
repository: index
topic: "AgentVillage Daily Brief — Pending Questions via MCP Tool"
tags: [plan, agentvillage, daily-brief, questioner, mcp-tool, edge-esmeralda]
status: ready
parent: .rpiv/artifacts/research/2026-06-11_01-20-31_agentvillage-daily-brief-questions.md
phase_count: 3
phases:
  - { n: 1, title: "MCP tool + registry" }
  - { n: 2, title: "Context fetch" }
  - { n: 3, title: "Brief composition" }
unresolved_phase_count: 0
last_updated: 2026-06-11T01:52:40+0300
last_updated_by: Yankı Ekin Yüksel
---

# AgentVillage Daily Brief — Pending Questions Implementation Plan

## Overview
Add a `read_pending_questions` MCP tool that exposes the QuestionerAgent's DB-persisted questions, then wire it into the daily brief prepare pipeline: `build-daily-brief-context.ts` fetches the first pending question via JSON-RPC and adds it to `DailyBriefContext`; `composeDailyBrief()` appends a "**One for you:**" section (prompt-only, fail-closed). `send.md` delivers verbatim — no changes to the send side.

## Requirements
- Every AgentVillage user receives one contextual question appended to their daily morning brief
- Questions come from the existing QuestionerAgent/QuestionerQueue backend (not LLM-generated on the fly)
- Question delivery is fail-closed: if the MCP fetch fails, the brief still delivers without a question
- The question is part of the staged Kanban body and goes through the human approval gate before delivery
- Only one question per brief (focused morning UX)
- Question format: prompt text + "Reply to me anytime!" — no options listed
- `send.md` and `send-daily-brief.ts` are unchanged

## Current State Analysis
The daily brief pipeline has two cron jobs managed by `install_index.ts`:
- `prepare` (02:00): runs `stage-daily-brief.ts` → `composeDailyBrief()` → Kanban stage+block
- `send` (08:00): delivers `finalBrief` verbatim after human approval

### Key Discoveries
- `build-daily-brief-context.ts:350` — `fetchOpportunitiesFromMcp()` is the template: postMcpMessage(initialize) → postMcpMessage(tools/call) → parse text content → fail-closed on error
- `tool.registry.ts:78-83` — `create*Tools(dt, deps)` pattern: all 11 domains registered the same way; new questioner domain slots in after `createPremiseTools(dt, deps)`
- `tool.helpers.ts:463` — `findPendingQuestions?` already in `ToolDeps` with signature `(userId, filters?) => Promise<PendingQuestionSummary[]>`
- `mcp.controller.ts:632-644` — `findPendingQuestions` already wired in the MCP server's toolDeps (calls `questionerAdapter.findPending()` and maps to `PendingQuestionSummary`)
- `stage-daily-brief.ts:207` — `composeDailyBrief()` section gate pattern: `if (context.X.length > 0) { lines.push(...); hasVerifiedContent = true; }`
- `premise.tools.spec.ts:1-80` — test pattern: `makeDefineTool()` shim + `makeDeps(overrides)` + `call('tool_name', query)`; `describe/it/expect` from `bun:test`

### Constraints
- `prepare.md:step1` — "Do not call `list_opportunities` or any other MCP tool" is about the LLM agent; the *script* (`build-daily-brief-context.ts`) already makes MCP calls directly via `postMcpMessage`. This constraint doesn't block adding another `postMcpMessage` call in the script.
- `send.md:5` — "nothing before it, nothing after it" — no change needed; questions are baked into `finalBrief` body by the prepare step
- Fail-closed is mandatory: `7b6e679` ("fail closed on staging/send script error") established this pattern; any new fetch that fails must not block brief delivery

## Desired End State

The daily brief body will end with a new section when the user has pending questions:

```
...That's it for now. You can always ask me for more detail, or any other questions you have!

---

**One for you:** What kind of collaboration are you most open to right now?

Reply to me anytime!
```

The `DailyBriefContext` type gains:
```typescript
interface DailyBriefContext {
  // ...existing fields...
  questions: BriefQuestion[];
  diagnostics: {
    // ...existing fields...
    questionSource: "mcp" | "unavailable";
  };
}
```

The `read_pending_questions` MCP tool is callable:
```json
{ "name": "read_pending_questions", "arguments": { "limit": 1 } }
// → { "questions": [{ "id": "...", "title": "...", "prompt": "...", "mode": "profile", ... }] }
```

## What We're NOT Doing
- `tool.factory.ts` changes — chat agents don't need `read_pending_questions` in chat sessions
- `mcp.controller.ts` changes — `findPendingQuestions` is already wired
- `prepare.md` changes — the script does the work, prompt is unchanged
- `send.md` changes — delivers verbatim
- `heartbeat-state.json` dedup key — backend question lifecycle (pending→answered) prevents re-showing answered questions; no extra state needed for increment 1
- `signal-elicitation` gate relaxation — increment 2
- Dedicated engagement heartbeat task — increment 3
- Options display — prompt-only format decided; options not shown in brief

## Decisions

### Decision: Tool file location
**Ambiguity**: questions span all modes (profile, intent, negotiation, discovery), so `opportunity.tools.ts` is wrong. Where does `read_pending_questions` live?
**Options considered**: `opportunity.tools.ts` (wrong domain), `utility.tools.ts` (generic catch-all), `questioner/questioner.tools.ts` (owned domain)
**Decision**: New `packages/protocol/src/questioner/questioner.tools.ts` — follows `{domain}.{purpose}.ts` naming convention, owned domain, parallel to `questioner.agent.ts`, `questioner.types.ts`, `questioner.presets.ts`.

### Decision: Tool registration path
**Ambiguity**: `tool.factory.ts` (LangChain chat tools) vs `tool.registry.ts` (MCP server tools)
**Decision**: `tool.registry.ts` only — the script calls the MCP JSON-RPC endpoint directly; chat agents don't need this tool. `createQuestionerTools(dt, deps)` call after `createPremiseTools(dt, deps)` at `tool.registry.ts:83`.

### Decision: Question count per brief
**Options**: 1 (focused) vs 3 (full queue)
**Decision**: 1 — morning brief is focused. Single actionable item. User can chat with Edge for more.

### Decision: Question format in brief
**Options**: prompt + options, prompt only
**Decision**: Prompt only — `**One for you:** {prompt}\n\nReply to me anytime!`

### Decision: Fetch approach
**Decision**: Follow `fetchOpportunitiesFromMcp()` pattern at `build-daily-brief-context.ts:350` — `postMcpMessage(initialize)` then `postMcpMessage(tools/call, 'read_pending_questions', { limit: 1 })`, parse JSON from `result.content[0].text`, fail-closed returning `[]` on any error.

## Phase 1: MCP tool + registry

### Overview
Define `read_pending_questions` MCP tool in a new `questioner.tools.ts` file and register it in `tool.registry.ts`. This is the protocol-layer foundation — the script in Phase 2 depends on this tool existing as an MCP endpoint. Depends on nothing.

### Changes Required:

#### 1. packages/protocol/src/questioner/questioner.tools.ts
**File**: packages/protocol/src/questioner/questioner.tools.ts
**Changes**: NEW — defines `createQuestionerTools` with `read_pending_questions` tool

```typescript
import { z } from "zod";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { success, error } from "../shared/agent/tool.helpers.js";

/**
 * Creates MCP tool definitions for the questioner domain.
 * Exposes `read_pending_questions` for retrieving the caller's pending
 * questions generated by QuestionerAgent (profile, intent, negotiation, discovery modes).
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
      "`multiSelect`, `mode`, `sourceType`, `sourceId`, `createdAt`, and optional `expiresAt`.\n\n" +
      "**Use:** Call with no arguments to get all pending questions, or pass `limit` to cap the " +
      "count. For the daily brief the script calls with `limit: 1` to retrieve the first question.",
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

      const questions = await deps.findPendingQuestions(context.userId);
      const limit = query.limit ?? 10;
      const limited = questions.slice(0, limit);

      return success({ questions: limited });
    },
  });

  return [readPendingQuestions];
}
```

#### 2. packages/protocol/src/shared/agent/tool.registry.ts
**File**: packages/protocol/src/shared/agent/tool.registry.ts
**Changes**: MODIFY — import + call `createQuestionerTools(dt, deps)` after `createPremiseTools`

```typescript
// Add after: import { createPremiseTools } from '../../premise/premise.tools.js';
import { createQuestionerTools } from '../../questioner/questioner.tools.js';

// Add after: createPremiseTools(dt, deps);
createQuestionerTools(dt, deps);
```

#### 3. packages/protocol/src/questioner/tests/questioner.tools.spec.ts
**File**: packages/protocol/src/questioner/tests/questioner.tools.spec.ts
**Changes**: NEW — unit tests for `read_pending_questions` success + absent-dep paths

```typescript
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { createQuestionerTools } from "../questioner.tools.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { PendingQuestionSummary } from "../../shared/schemas/pending-question.schema.js";

const userId = '00000000-0000-4000-8000-000000000001';

const context: ResolvedToolContext = {
  userId,
  userName: 'Test User',
  userEmail: 'test@example.com',
  user: { id: userId, name: 'Test User', email: 'test@example.com' } as never,
  userProfile: null,
  userNetworks: [],
  indexScope: [],
  isOnboarding: false,
  hasName: true,
};

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
  findPendingQuestions?: ((userId: string) => Promise<PendingQuestionSummary[]>) | undefined;
}) {
  return { findPendingQuestions: overrides?.findPendingQuestions } as never;
}

function makeDefineTool() {
  type ToolSpec = {
    name: string;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  };
  const tools = new Map<string, ToolSpec>();
  const defineTool = (spec: ToolSpec) => { tools.set(spec.name, spec); return spec; };
  async function call(name: string, query: unknown): Promise<unknown> {
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

    it("respects the limit parameter", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async () => [
          mockQuestion,
          { ...mockQuestion, id: "q-0002" },
          { ...mockQuestion, id: "q-0003" },
        ],
      }));
      const result = await call("read_pending_questions", { limit: 1 }) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions).toHaveLength(1);
      expect(result.data.questions[0].id).toBe("q-0001");
    });
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] `cd packages/protocol && bun test src/questioner/tests/questioner.tools.spec.ts` — all 4 tests pass
- [x] `grep -r 'createQuestionerTools' packages/protocol/src/shared/agent/tool.registry.ts` — returns a match
- [x] `grep -r 'read_pending_questions' packages/protocol/src/shared/agent/tool.factory.ts` — returns nothing
- [x] `cd packages/protocol && bun run build` — compiles without errors

#### Manual Verification:
- [x] `questioner.tools.ts` is located in `packages/protocol/src/questioner/` (not `opportunity/`)
- [x] `tool.registry.ts` calls `createQuestionerTools(dt, deps)` after `createPremiseTools(dt, deps)`

## Phase 2: Context fetch

### Overview
Add `BriefQuestion` local type, `DailyBriefContext.questions` field, `diagnostics.questionSource`, and `fetchPendingQuestionsFromMcp()` function to `build-daily-brief-context.ts`. Depends on Phase 1 (tool must exist as MCP endpoint).

### Changes Required:

#### 1. packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts
**File**: packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts
**Changes**: MODIFY — add BriefQuestion type, questions field to DailyBriefContext, fetchPendingQuestionsFromMcp(), integrate into buildDailyBriefContext()

```typescript
// ── ADD after BriefOpportunity interface ────────────────────────────────────

export interface BriefQuestion {
  id: string;
  title: string;
  prompt: string;
  mode: string;
}

// ── MODIFY DailyBriefContext interface ──────────────────────────────────────
// Add to DailyBriefContext (optional — follows weatherSource? precedent):
//   questions?: BriefQuestion[];
// Add to DailyBriefContext.diagnostics:
//   questionSource?: "mcp" | "unavailable";

// ── ADD after fetchOpportunitiesFromMcp function ───────────────────────────

/**
 * Fetch the first pending question by calling the Index MCP server directly
 * via JSON-RPC with read_pending_questions. Mirrors fetchOpportunitiesFromMcp.
 *
 * NEVER throws — all errors are caught internally.
 * Returns `{ questions, source }` so callers can distinguish a successful
 * (possibly-empty) fetch from a silent failure.
 */
export async function fetchPendingQuestionsFromMcp(opts: {
  apiKey: string;
  mcpUrl: string;
}): Promise<{ questions: BriefQuestion[]; source: "mcp" | "unavailable" }> {
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
    if (initResp.error) return { questions: [], source: "unavailable" };

    const toolResp = await postMcpMessage(opts.mcpUrl, opts.apiKey, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "read_pending_questions", arguments: { limit: 1 } },
    });
    if (toolResp.error) return { questions: [], source: "unavailable" };

    const result = toolResp.result as McpToolResult | undefined;
    const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
    if (!text.trim()) return { questions: [], source: "mcp" };

    const parsed = JSON.parse(text) as { success?: boolean; data?: { questions?: unknown[] } };
    if (!parsed.data?.questions || !Array.isArray(parsed.data.questions)) return { questions: [], source: "mcp" };
    const questions = parsed.data.questions
      .filter((q): q is Record<string, unknown> => q !== null && typeof q === "object")
      .map((q) => ({
        id: String(q.id ?? ""),
        title: String(q.title ?? ""),
        prompt: String(q.prompt ?? ""),
        mode: String(q.mode ?? ""),
      }))
      .filter((q) => q.id && q.prompt);
    return { questions, source: "mcp" };
  } catch {
    return { questions: [], source: "unavailable" };
  }
}

// ── MODIFY buildDailyBriefContext — after the opportunity fetch block ───────
// Add after: } else if (options.opportunitiesFile) { ... }

  let questions: BriefQuestion[] = [];
  let questionSource: "mcp" | "unavailable" = "unavailable";

  if (apiKey) {
    const questionResult = await fetchPendingQuestionsFromMcp({ apiKey, mcpUrl });
    questions = questionResult.questions;
    questionSource = questionResult.source;
    if (questionResult.source === "unavailable") {
      warnings.push("questions MCP unavailable");
    }
  }

// ── MODIFY return statement — add questions and questionSource ──────────────
  return {
    // ...existing fields unchanged...
    questions,
    // ...
    diagnostics: {
      announcementsSource: announcementResult.source,
      calendarSource: eventResult.source,
      rsvpSource: rsvpResult.source,
      opportunitySource,
      questionSource,
      weatherSource: weather.source,
      warnings,
      interestTags,
    },
  };
```

#### 2. packages/edge-city/agentvillage/skills/index-network/scripts/tests/build-daily-brief-context.test.ts
**File**: packages/edge-city/agentvillage/skills/index-network/scripts/tests/build-daily-brief-context.test.ts
**Changes**: MODIFY — add fetchPendingQuestionsFromMcp to imports, update existing MCP mock to differentiate tool calls, add 2 new tests

```typescript
// ── MODIFY import — add fetchPendingQuestionsFromMcp ────────────────────────
import {
  buildDailyBriefContext,
  extractInterestTags,
  fetchOpportunitiesFromMcp,
  fetchPendingQuestionsFromMcp,
  filterDedupedOpportunities,
  formatPacificTime,
  pacificDayBounds,
  parseOpportunityTranscript,
  selectEvents,
} from "../build-daily-brief-context";

// ── UPDATE existing "sets opportunitySource to mcp" test mock ────────────────
// In the fetch mock, change tools/call handler to differentiate by params.name:
    if (body.method === "tools/call") {
      const params = (body as { params?: { name?: string } }).params;
      if (params?.name === "read_pending_questions") {
        return Response.json({
          jsonrpc: "2.0",
          id: 2,
          result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { questions: [] } }) }] },
        });
      }
      return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: opportunityText }] } });
    }

// ── ADD two new tests ────────────────────────────────────────────────────────

  test("fetchPendingQuestionsFromMcp returns questions from read_pending_questions", async () => {
    const originalFetch = globalThis.fetch;
    const mockQuestion = {
      id: "q-0001",
      title: "Collaboration focus",
      prompt: "What kind of collaboration are you most open to right now?",
      mode: "profile",
    };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://test.mcp.com/mcp") {
        const body = JSON.parse(init?.body as string ?? "{}") as { method: string };
        if (body.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
        }
        if (body.method === "tools/call") {
          return Response.json({
            jsonrpc: "2.0",
            id: 2,
            result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { questions: [mockQuestion] } }) }] },
          });
        }
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: "https://test.mcp.com/mcp" });
      expect(result.source).toBe("mcp");
      expect(result.questions).toHaveLength(1);
      expect(result.questions[0].id).toBe("q-0001");
      expect(result.questions[0].prompt).toBe("What kind of collaboration are you most open to right now?");
      expect(result.questions[0].mode).toBe("profile");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fetchPendingQuestionsFromMcp returns source unavailable when response body is malformed", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "not json {{{{" }] },
      });
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: "https://test.mcp.com/mcp" });
      // Malformed JSON triggers the catch block—source is unavailable
      expect(result.source).toBe("unavailable");
      expect(result.questions).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
```

### Success Criteria:

#### Automated Verification:
- [ ] `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/build-daily-brief-context.test.ts` — all tests pass including 2 new fetchPendingQuestionsFromMcp tests
- [ ] `grep 'questionSource' packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts` — returns a match
- [ ] `grep 'questions\?: BriefQuestion' packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts` — returns a match (optional field)

#### Manual Verification:
- [ ] `fetchPendingQuestionsFromMcp` is exported from `build-daily-brief-context.ts` and never throws
- [ ] `BriefQuestion` interface is exported with `id`, `title`, `prompt`, `mode` fields
- [ ] `DailyBriefContext.questions` is optional (`questions?:`) following `weatherSource?` precedent
- [ ] `buildDailyBriefContext` sets `questionSource = "mcp"` only when `apiKey` is set

## Phase 3: Brief composition

### Overview
Modify `composeDailyBrief()` in `stage-daily-brief.ts` to render the "One for you" questions section. Depends on Phase 2 (`DailyBriefContext.questions` field must exist). Can run in parallel with Phase 2 after Phase 1.

### Changes Required:

#### 1. packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts
**File**: packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts
**Changes**: MODIFY — add questions section rendering to composeDailyBrief()

```typescript
// In composeDailyBrief(), replace the current ending:
//
//   lines.push("That's it for now. You can always ask me for more detail, or any other questions you have!");
//   return { body: lines.join("\n").replace(/\n{3,}/g, "\n\n"), opportunityIds };
//
// With:

  lines.push("That's it for now. You can always ask me for more detail, or any other questions you have!");

  const pendingQuestions = context.questions ?? [];
  if (pendingQuestions.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`**One for you:** ${pendingQuestions[0].prompt}`);
    lines.push("");
    lines.push("Reply to me anytime!");
  }

  return { body: lines.join("\n").replace(/\n{3,}/g, "\n\n"), opportunityIds };
```

#### 2. packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief.test.ts
**File**: packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief.test.ts
**Changes**: MODIFY — add 3 test cases for One for you section rendering inside describe("composeDailyBrief")

```typescript
  test("renders a One for you section when questions are pending", () => {
    const { body } = composeDailyBrief({
      ...baseContext,
      questions: [
        {
          id: "q-0001",
          title: "Collaboration focus",
          prompt: "What kind of collaboration are you most open to right now?",
          mode: "profile",
        },
      ],
    });
    expect(body).toContain("**One for you:** What kind of collaboration are you most open to right now?");
    expect(body).toContain("Reply to me anytime!");
  });

  test("does not render a One for you section when questions are absent", () => {
    const { body } = composeDailyBrief({ ...baseContext });
    expect(body).not.toContain("**One for you:**");
    expect(body).not.toContain("Reply to me anytime!");
  });

  test("does not render a One for you section when questions array is empty", () => {
    const { body } = composeDailyBrief({ ...baseContext, questions: [] });
    expect(body).not.toContain("**One for you:**");
  });
```

### Success Criteria:

#### Automated Verification:
- [ ] `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts` — all tests pass including 3 new One for you section tests
- [ ] `grep 'One for you' packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts` — returns a match
- [ ] `cd packages/protocol && bun run build` — compiles without errors

#### Manual Verification:
- [ ] The question section appears AFTER "That's it for now..." in the brief body, preceded by `---`
- [ ] No question section in brief when `context.questions` is undefined or []
- [ ] `baseContext` in `stage-daily-brief.test.ts` does not need `questions` field (it's optional)

## Ordering Constraints
- Phase 2 and Phase 3 both depend on Phase 1 (tool.registry.ts must expose `read_pending_questions`)
- Phase 3 depends on Phase 2 (needs `DailyBriefContext.questions` type to exist)
- Sequential order: 1 → 2 → 3

## Verification Notes
- **Fail-closed regression**: after Phase 3, run `composeDailyBrief({ ...baseContext, questions: [] })` — brief must still deliver without a questions section
- **No content leak**: the questions section must not appear when `context.questions.length === 0`
- **Tool not in chat tools**: `grep -r 'read_pending_questions' packages/protocol/src/shared/agent/tool.factory.ts` must return nothing
- **Tool in MCP registry**: `grep -r 'createQuestionerTools' packages/protocol/src/shared/agent/tool.registry.ts` must return a match
- **Precedent (7b6e679)**: fetch failures in the script must not throw — all errors caught and return `[]`/default

## Performance Considerations
- One extra MCP round trip (initialize + tools/call) per user per day at 02:00 AM — negligible latency impact
- `limit: 1` prevents over-fetching; only the first pending question is retrieved
- `postMcpMessage` already uses Bun's native `fetch` with no explicit timeout — consistent with how `fetchOpportunitiesFromMcp` works

## Migration Notes
N/A — no schema changes, no DB migrations, no backwards compatibility concerns. Feature is additive; existing briefs without questions are unaffected.

## Pattern References
- `packages/protocol/src/premise/tests/premise.tools.spec.ts:1-80` — tool test pattern (makeDefineTool shim, makeDeps factory, bun:test)
- `packages/protocol/src/intent/intent.tools.ts:76-135` — read_intents tool definition shape (defineTool, querySchema, handler)
- `packages/protocol/src/shared/agent/tool.registry.ts:78-83` — create*Tools registration pattern
- `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:350-391` — fetchOpportunitiesFromMcp (MCP JSON-RPC call + fail-closed pattern)
- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:207-213` — composeDailyBrief section gate pattern (if length > 0, push lines, push "")

## Developer Context
**Q (discover: Core goal):** Both signal AND engagement — richer profiles (cold-start) AND engagement nudges (warm-path throughput).
**Q (discover: Delivery architecture):** Incremental — brief first (this plan), then relax signal-elicitation gate, then dedicated heartbeat tasks.
**Q (research: Delivery path):** Prepare step, not send. send.md hard rule stays intact.
**Q (research: Question tool location):** New `packages/protocol/src/questioner/questioner.tools.ts`.
**Q (research: Backend scope):** Yes — MCP tool + wiring required.
**Q (blueprint: tool.registry.ts direction):** Follow create*Tools pattern — confirmed.
**Q (blueprint: fetchOpportunitiesFromMcp direction):** Follow that pattern — confirmed.
**Q (blueprint: question count):** 1 per brief.
**Q (blueprint: question format):** Prompt only — "**One for you:** {prompt}\n\nReply to me anytime!"

## Plan History
- Phase 1: MCP tool + registry — approved as generated
- Phase 2: Context fetch — approved as generated
- Phase 3: Brief composition — approved as generated

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §1 (questioner.tools.ts) | packages/protocol/src/shared/agent/tool.helpers.ts:463 | concern | code-quality | The tool description says `limit` "Defaults to 10 when omitted," but the handler returns all `deps.findPendingQuestions()` results when `query.limit` is absent — no DB-level limit enforced. | Apply `const limit = query.limit ?? 10` before slicing the returned questions. | applied: `const limit = query.limit ?? 10` before slice; description updated to "default 10" |
| code | Phase 2 §1 (build-daily-brief-context.ts) | packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:707-714 | concern | codebase-fit | `questionSource` is set to `"mcp"` whenever `apiKey` exists, even when `fetchPendingQuestionsFromMcp()` silently returns `[]` on error — inconsistent with the `opportunitySource` path which marks `"mcp"` only after a successful fetch. | Return `{ questions, source }` from `fetchPendingQuestionsFromMcp()` to distinguish success from silent failure; set `questionSource: "unavailable"` plus push a warning when the call fails internally. | applied: `fetchPendingQuestionsFromMcp` returns `{ questions, source }`, sets `questionSource: "unavailable"` + pushes warning on catch; test updated for new return shape |

## References
- `.rpiv/artifacts/discover/2026-06-11_00-58-19_agentvillage-daily-brief-questions.md` — FRD
- `.rpiv/artifacts/research/2026-06-11_01-20-31_agentvillage-daily-brief-questions.md` — Research artifact
