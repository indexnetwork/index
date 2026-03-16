# Debug Meta Timing: Tools, Graphs, Agents Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Extend `debugMeta` (surfaced by `/debug/chat/:sessionId`) with wall-clock `durationMs` at three levels: tool call → graph invoked by tool → agent invoked inside graph.

**Architecture:** Types first, then bottom-up: add `agentTimings` reducer to 6 graph states, wrap agent calls in graph nodes, wrap graph calls in tool files with `_graphTimings`, finally wrap tool dispatch in `chat.agent.ts` and extract the timing data.

**Tech Stack:** TypeScript, LangGraph (`Annotation.Root`), Bun test

---

## Task 1: Extend types

**Files:**
- Modify: `protocol/src/types/chat-streaming.types.ts:288-305`

**Step 1: Add the two new interfaces and update `DebugMetaToolCall`**

In `chat-streaming.types.ts`, after the existing `DebugMetaStep` interface (line 293), add:

```typescript
/**
 * One agent invocation recorded inside a graph run.
 */
export interface DebugMetaAgent {
  name: string;
  durationMs: number;
}

/**
 * One graph invocation recorded by a tool that calls a LangGraph graph.
 */
export interface DebugMetaGraph {
  name: string;
  durationMs: number;
  agents: DebugMetaAgent[];
}
```

Then update `DebugMetaToolCall` (currently lines 298-305) to:

```typescript
export interface DebugMetaToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary: string;
  success: boolean;
  /** Wall-clock milliseconds for the full tool execution. */
  durationMs: number;
  /** Internal steps (subgraphs, subtasks) when the tool reports debugSteps in its result. */
  steps?: DebugMetaStep[];
  /** LangGraph graphs invoked by this tool, with their agent timings. */
  graphs?: DebugMetaGraph[];
}
```

**Step 2: Run tsc to verify no type errors**

```bash
cd protocol && npx tsc --noEmit
```

Expected: zero errors. Fix any before continuing.

**Step 3: Commit**

```bash
git add protocol/src/types/chat-streaming.types.ts
git commit -m "feat(debug-meta): add DebugMetaGraph, DebugMetaAgent types and durationMs to DebugMetaToolCall"
```

---

## Task 2: Tool timing in `chat.agent.ts`

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.agent.ts:602-739`

The tool dispatch loop starts at line 602 (`for (const tc of toolCalls)`). We need to:
1. Capture `toolStart` before `tool.invoke()`
2. Extract `_graphTimings` from the parsed result
3. Pass `durationMs` and `graphs` into both `toolsDebug.push()` calls (success and failure paths)

**Step 1: Capture tool start time and extract `_graphTimings`**

Around line 638, change:

```typescript
// BEFORE
let result = await tool.invoke(tc.args);
```

```typescript
// AFTER
const toolStart = Date.now();
let result = await tool.invoke(tc.args);
const toolDurationMs = Date.now() - toolStart;
```

In the `try` block, extend the result-parsing section (currently lines 661-687). After extracting `debugSteps`, also extract `_graphTimings`:

```typescript
// Add after the debugSteps extraction (inside the try/catch JSON parse block)
type GraphTiming = { name: string; durationMs: number; agents: Array<{ name: string; durationMs: number }> };
let graphTimings: GraphTiming[] | undefined;
const rawGraphTimings = payload._graphTimings ?? parsed._graphTimings;
if (Array.isArray(rawGraphTimings) && rawGraphTimings.length > 0) {
  graphTimings = rawGraphTimings as GraphTiming[];
  // Strip _graphTimings from the result string sent back to the LLM
  try {
    const cleanedResult = JSON.parse(resultStr) as Record<string, unknown>;
    delete cleanedResult._graphTimings;
    if (cleanedResult.data && typeof cleanedResult.data === 'object') {
      delete (cleanedResult.data as Record<string, unknown>)._graphTimings;
    }
    resultStr = JSON.stringify(cleanedResult);
    result = resultStr;
  } catch { /* keep original if can't clean */ }
}
```

**Step 2: Add `durationMs` and `graphs` to the success push (line ~689)**

```typescript
// BEFORE
toolsDebug.push({
  name: tc.name,
  args: sanitizeForDebugMeta(tc.args) as Record<string, unknown>,
  resultSummary: summary,
  success: true,
  ...(debugSteps?.length ? { steps: debugSteps } : {}),
});
```

```typescript
// AFTER
toolsDebug.push({
  name: tc.name,
  args: sanitizeForDebugMeta(tc.args) as Record<string, unknown>,
  resultSummary: summary,
  success: true,
  durationMs: toolDurationMs,
  ...(debugSteps?.length ? { steps: debugSteps } : {}),
  ...(graphTimings?.length ? { graphs: graphTimings } : {}),
});
```

**Step 3: Add `durationMs` to the unknown tool path (line ~615) and failure path (line ~717)**

For the unknown tool case (around line 615), add `durationMs: 0` (no real timing possible):
```typescript
toolsDebug.push({
  name: tc.name,
  args: sanitizeForDebugMeta(tc.args) as Record<string, unknown>,
  resultSummary: "Unknown tool",
  success: false,
  durationMs: 0,
});
```

For the catch block failure case (around line 717), the `toolStart` is in scope, so use it:
```typescript
toolsDebug.push({
  name: tc.name,
  args: sanitizeForDebugMeta(tc.args) as Record<string, unknown>,
  resultSummary: errMsg,
  success: false,
  durationMs: Date.now() - toolStart,
});
```

**Step 4: Run tsc**

```bash
cd protocol && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.agent.ts
git commit -m "feat(debug-meta): capture tool durationMs and extract _graphTimings in chat agent"
```

---

## Task 3: `agentTimings` in `opportunity.state.ts` + timing in `opportunity.graph.ts`

**Files:**
- Modify: `protocol/src/lib/protocol/states/opportunity.state.ts`
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`

**Step 1: Add import and `agentTimings` field to `OpportunityGraphState`**

In `opportunity.state.ts`, add the import at the top:

```typescript
import type { DebugMetaAgent } from '../../../types/chat-streaming.types';
```

Then add this field to the `Annotation.Root({...})` block (at the end, before the closing `})`):

```typescript
/** Timing records for each agent invocation within this graph run. */
agentTimings: Annotation<DebugMetaAgent[]>({
  reducer: (acc, val) => [...acc, ...val],
  default: () => [],
}),
```

**Step 2: Wrap `evaluator.invokeEntityBundle()` calls in `opportunity.graph.ts`**

There are three invocation sites (lines ~1139, ~1161, ~1509). For each, wrap:

```typescript
// BEFORE (example, line ~1161)
const opportunitiesWithActors = await evaluator.invokeEntityBundle(input, { minScore, returnAll: true });

// AFTER
const _evalStart = Date.now();
const opportunitiesWithActors = await evaluator.invokeEntityBundle(input, { minScore, returnAll: true });
agentTimingsAccum.push({ name: 'opportunity.evaluator', durationMs: Date.now() - _evalStart });
```

Where `agentTimingsAccum` is declared at the top of the node function:
```typescript
const agentTimingsAccum: import('../../../types/chat-streaming.types').DebugMetaAgent[] = [];
```

At the node's return statement, include `agentTimings: agentTimingsAccum`.

Do the same for `OpportunityPresenter` calls (search for `presenter.` in the graph file):
```typescript
const _presenterStart = Date.now();
const cardTexts = await presenter.generateCardTexts(...);
agentTimingsAccum.push({ name: 'opportunity.presenter', durationMs: Date.now() - _presenterStart });
```

**Step 3: Run tsc**

```bash
cd protocol && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/states/opportunity.state.ts \
        protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "feat(debug-meta): track agent timings in opportunity graph"
```

---

## Task 4: `agentTimings` in `intent_index.state.ts` + timing in `intent_index.graph.ts`

**Files:**
- Modify: `protocol/src/lib/protocol/states/intent_index.state.ts`
- Modify: `protocol/src/lib/protocol/graphs/intent_index.graph.ts`

**Step 1: Add import and field to `IntentIndexGraphState` in `intent_index.state.ts`**

```typescript
import type { DebugMetaAgent } from '../../../types/chat-streaming.types';
```

Add to `Annotation.Root`:

```typescript
agentTimings: Annotation<DebugMetaAgent[]>({
  reducer: (acc, val) => [...acc, ...val],
  default: () => [],
}),
```

**Step 2: Wrap `indexer.evaluate()` in `intent_index.graph.ts`**

The call is at line ~111:

```typescript
// BEFORE
const result = await indexer.evaluate(
  intentForIndexing.payload,
  indexContext.indexPrompt,
  indexContext.memberPrompt,
  sourceName
);
```

```typescript
// AFTER
const _indexerStart = Date.now();
const result = await indexer.evaluate(
  intentForIndexing.payload,
  indexContext.indexPrompt,
  indexContext.memberPrompt,
  sourceName
);
const _indexerMs = Date.now() - _indexerStart;
```

Then in the return statements that follow (the `shouldAssign` branches), add `agentTimings: [{ name: 'intent.indexer', durationMs: _indexerMs }]`. For the early-return branch (no evaluation), return `agentTimings: []`.

**Step 3: Run tsc**

```bash
cd protocol && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/states/intent_index.state.ts \
        protocol/src/lib/protocol/graphs/intent_index.graph.ts
git commit -m "feat(debug-meta): track agent timings in intent_index graph"
```

---

## Task 5: `agentTimings` in remaining 4 graph states + nodes

**Files (state):**
- Modify: `protocol/src/lib/protocol/states/intent.state.ts`
- Modify: `protocol/src/lib/protocol/states/profile.state.ts`
- Modify: `protocol/src/lib/protocol/states/hyde.state.ts`
- Modify: `protocol/src/lib/protocol/states/home.state.ts`

**Files (graph):**
- Modify: `protocol/src/lib/protocol/graphs/intent.graph.ts`
- Modify: `protocol/src/lib/protocol/graphs/profile.graph.ts`
- Modify: `protocol/src/lib/protocol/graphs/hyde.graph.ts`
- Modify: `protocol/src/lib/protocol/graphs/home.graph.ts`

**Step 1: Add `agentTimings` to all 4 state files**

Repeat the same pattern from Tasks 3–4 for each state file: add the import and the `agentTimings` `Annotation` field.

**Step 2: Wrap agent calls in each graph**

Apply the same `_start = Date.now()` / `agentTimings: [{ name, durationMs }]` pattern:

| Graph | Agent calls to wrap |
|---|---|
| `intent.graph.ts` | `inferrer.invoke()` → `'intent.inferrer'`, `verifier.invoke()` → `'intent.verifier'`, `reconciler.invoke()` → `'intent.reconciler'` |
| `profile.graph.ts` | `profileGenerator.run()` / `.invoke()` → `'profile.generator'`, `hydeGenerator.run()` → `'hyde.generator'` |
| `hyde.graph.ts` | `lensInferrer.infer()` → `'lens.inferrer'`, `hydeGenerator.run()` → `'hyde.generator'` |
| `home.graph.ts` | `presenter.generateCardTexts()` → `'opportunity.presenter'`, `categorizer.run()` → `'home.categorizer'` |

Each node must declare `const agentTimingsAccum: DebugMetaAgent[] = []` at the top, push timing entries after each agent call, and return `agentTimings: agentTimingsAccum` at the end.

**Step 3: Run tsc**

```bash
cd protocol && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add \
  protocol/src/lib/protocol/states/intent.state.ts \
  protocol/src/lib/protocol/states/profile.state.ts \
  protocol/src/lib/protocol/states/hyde.state.ts \
  protocol/src/lib/protocol/states/home.state.ts \
  protocol/src/lib/protocol/graphs/intent.graph.ts \
  protocol/src/lib/protocol/graphs/profile.graph.ts \
  protocol/src/lib/protocol/graphs/hyde.graph.ts \
  protocol/src/lib/protocol/graphs/home.graph.ts
git commit -m "feat(debug-meta): track agent timings in intent, profile, hyde, home graphs"
```

---

## Task 6: Graph timing in tool files

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts`
- Modify: `protocol/src/lib/protocol/tools/intent.tools.ts`
- Modify: `protocol/src/lib/protocol/tools/profile.tools.ts`
- Modify: `protocol/src/lib/protocol/tools/index.tools.ts`

**Pattern for every `graphs.<name>.invoke(...)` call in each tool file:**

```typescript
// BEFORE
const result = await graphs.opportunity.invoke({ ... });

// AFTER
const _graphStart = Date.now();
const result = await graphs.opportunity.invoke({ ... });
const _graphMs = Date.now() - _graphStart;
```

Then in the tool's return value (the JSON object passed to `success()`), add `_graphTimings` at the **top level** (not inside `data`), so `chat.agent.ts` can find and strip it:

```typescript
return success({
  data: { /* existing result data */ },
  _graphTimings: [{
    name: 'opportunity',           // graph name — match the design doc table
    durationMs: _graphMs,
    agents: result.agentTimings ?? [],
  }],
});
```

**Graph name strings to use per file:**

| Tool file | Graph call | `name` string |
|---|---|---|
| `opportunity.tools.ts` | `graphs.opportunity.invoke(...)` | `"opportunity"` |
| `intent.tools.ts` | `graphs.intent.invoke(...)` | `"intent"` |
| `intent.tools.ts` | `graphs.intentIndex.invoke(...)` | `"intent_index"` |
| `intent.tools.ts` | `graphs.profile.invoke(...)` | `"profile"` |
| `profile.tools.ts` | `graphs.profile.invoke(...)` | `"profile"` |
| `index.tools.ts` | `graphs.index.invoke(...)` | `"index"` |
| `index.tools.ts` | `graphs.indexMembership.invoke(...)` | `"index_membership"` |
| `index.tools.ts` | `graphs.intentIndex.invoke(...)` | `"intent_index"` |

**Note on `index` and `index_membership` graphs:** These have no agents, so `agentTimings` will not be on their result. Use `result.agentTimings ?? []` safely — it will just be an empty array.

**Note on multiple `graphs.opportunity.invoke()` calls in one tool function:** Each call site gets its own `_graphStart`/`_graphMs` locals (use unique variable names: `_graphStart1`, `_graphMs1`, etc.), and the tool collects all of them into a single `_graphTimings` array:

```typescript
_graphTimings: [
  { name: 'opportunity', durationMs: _graphMs1, agents: result1.agentTimings ?? [] },
  { name: 'opportunity', durationMs: _graphMs2, agents: result2.agentTimings ?? [] },
]
```

**Step 1: Apply the pattern to all 4 tool files**

**Step 2: Run tsc**

```bash
cd protocol && npx tsc --noEmit
```

**Step 3: Smoke test**

Start the server (`bun run dev` in `protocol/`) and send a chat message that triggers opportunity discovery. Then hit the debug endpoint:

```bash
curl -s "http://localhost:3001/debug/chat/<sessionId>" | jq '.turns[0].debugMeta.tools[0]'
```

Expected output shape:
```json
{
  "name": "discover_opportunities",
  "durationMs": 1842,
  "resultSummary": "Found 3 matches",
  "success": true,
  "graphs": [
    {
      "name": "opportunity",
      "durationMs": 1701,
      "agents": [
        { "name": "opportunity.evaluator", "durationMs": 890 },
        { "name": "opportunity.presenter", "durationMs": 311 }
      ]
    }
  ]
}
```

**Step 4: Commit**

```bash
git add \
  protocol/src/lib/protocol/tools/opportunity.tools.ts \
  protocol/src/lib/protocol/tools/intent.tools.ts \
  protocol/src/lib/protocol/tools/profile.tools.ts \
  protocol/src/lib/protocol/tools/index.tools.ts
git commit -m "feat(debug-meta): add _graphTimings to tool results for debug meta timing"
```
