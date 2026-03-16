# Debug Meta Timing: Tools, Graphs, and Agents

**Date**: 2026-03-17
**Status**: Approved

## Overview

Extend the debug meta payload (returned by `/debug/chat/:sessionId`) to include wall-clock timing for every tool call, every graph invoked by a tool, and every agent invoked within those graphs. This gives a full three-level execution profile per chat turn.

## Data Structures

New and modified types in `protocol/src/types/chat-streaming.types.ts`:

```typescript
// Modified — add durationMs and graphs
interface DebugMetaToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary: string;
  success: boolean;
  durationMs: number;          // wall-clock ms for full tool execution
  steps?: DebugMetaStep[];
  graphs?: DebugMetaGraph[];   // graphs invoked by this tool
}

// New
interface DebugMetaGraph {
  name: string;
  durationMs: number;
  agents: DebugMetaAgent[];
}

// New
interface DebugMetaAgent {
  name: string;
  durationMs: number;
}
```

### Example debug JSON output

```json
{
  "graph": "agent_loop",
  "iterations": 2,
  "tools": [
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
  ]
}
```

## Data Flow

Timing propagates bottom-up:

### Layer 3 — Agent timing (graph nodes)

Each of the 6 affected graph state files gains an `agentTimings` reducer field:

```typescript
agentTimings: Annotation<DebugMetaAgent[]>({
  reducer: (acc, val) => [...acc, ...val],
  default: () => [],
})
```

Graph nodes wrap agent calls:

```typescript
const t = Date.now();
const result = await agent.run(input);
return {
  ...,
  agentTimings: [{ name: "opportunity.evaluator", durationMs: Date.now() - t }],
};
```

### Layer 2 — Graph timing (tool implementations)

Tool files that invoke graphs wrap the graph call and return a `_graphTimings` field alongside the normal result:

```typescript
const t = Date.now();
const result = await graphs.opportunityGraph.invoke(state);
const durationMs = Date.now() - t;
return {
  ...formattedResult,
  _graphTimings: [{
    name: "opportunity",
    durationMs,
    agents: result.agentTimings ?? [],
  }],
};
```

`_graphTimings` is a protocol-internal field stripped by `chat.agent.ts` before the result is treated as tool output.

### Layer 1 — Tool timing (`chat.agent.ts`)

The existing tool-execution block wraps each tool call with `Date.now()` and extracts `_graphTimings`:

```typescript
const t = Date.now();
const toolResult = await executeTool(tool, args);
const durationMs = Date.now() - t;
const graphTimings = toolResult._graphTimings ?? [];
// strip _graphTimings from toolResult before using as LLM tool response
toolsDebug.push({ name, args, resultSummary, success, durationMs, graphs: graphTimings, steps });
```

## Scope of Changes

### Types (1 file)
- `protocol/src/types/chat-streaming.types.ts` — add `durationMs` + `DebugMetaGraph` + `DebugMetaAgent`

### Chat agent (1 file)
- `protocol/src/lib/protocol/agents/chat.agent.ts` — wrap tool calls with timing, extract `_graphTimings`

### Graph states (6 files)
Add `agentTimings: DebugMetaAgent[]` reducer to:
- `protocol/src/lib/protocol/states/opportunity.state.ts`
- `protocol/src/lib/protocol/states/intent.state.ts`
- `protocol/src/lib/protocol/states/profile.state.ts`
- `protocol/src/lib/protocol/states/hyde.state.ts`
- `protocol/src/lib/protocol/states/home.state.ts`
- `protocol/src/lib/protocol/states/intent_index.state.ts`

### Graph nodes (6 files)
Wrap agent `.invoke()` / `.run()` calls and append to `agentTimings`:
- `protocol/src/lib/protocol/graphs/opportunity.graph.ts` — `OpportunityEvaluator`, `OpportunityPresenter`
- `protocol/src/lib/protocol/graphs/intent.graph.ts` — `ExplicitIntentInferrer`, `SemanticVerifier`, `IntentReconciler`
- `protocol/src/lib/protocol/graphs/profile.graph.ts` — `ProfileGenerator`, `HydeGenerator`
- `protocol/src/lib/protocol/graphs/hyde.graph.ts` — `LensInferrer`, `HydeGenerator`
- `protocol/src/lib/protocol/graphs/home.graph.ts` — `OpportunityPresenter`, `HomeCategorizerAgent`
- `protocol/src/lib/protocol/graphs/intent_index.graph.ts` — `IntentIndexer`

### Tool files (4 files)
Wrap graph `.invoke()` calls and return `_graphTimings`:
- `protocol/src/lib/protocol/tools/opportunity.tools.ts`
- `protocol/src/lib/protocol/tools/intent.tools.ts`
- `protocol/src/lib/protocol/tools/profile.tools.ts`
- `protocol/src/lib/protocol/tools/index.tools.ts`

## Out of Scope

- `index.graph.ts` and `index_membership.graph.ts` — pure DB operations, no agents
- Frontend UI changes — timing visible in debug JSON only
- Token counts or LLM API latency breakdown
- `timed()` decorator from `lib/performance` — unrelated monitoring path, not modified
