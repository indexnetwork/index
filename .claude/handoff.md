---
trigger: "Bug: Chat agent stops sending messages during opportunity discovery. The opportunity graph has 6+ internal nodes (prep → scope → resolve → discovery → evaluation → ranking → persist) that take 10-30+ seconds total, but none emit trace events to the user. Only the evaluator agent inside the evaluation node emits agent_start/agent_end. The tool emits graph_start before invoking and graph_end after, but everything in between is silent."
type: fix
branch: fix/opportunity-trace-events
created: 2026-03-26
---

## Related Files
- protocol/src/lib/protocol/graphs/opportunity.graph.ts (main target — add traceEmitter calls to nodes)
- protocol/src/lib/protocol/tools/opportunity.tools.ts (tool that calls the graph; already emits graph_start/end)
- protocol/src/lib/protocol/agents/chat.agent.ts (agent loop; propagates traceEmitter via requestContext)
- protocol/src/lib/protocol/streamers/chat.streamer.ts (streams events to frontend; already handles agent_start/end)
- frontend/src/components/chat/ToolCallsDisplay.tsx (display names for trace events; needs new entries)
- protocol/src/lib/request-context.ts (AsyncLocalStorage carrying traceEmitter callback)

## Relevant Docs
- docs/domain/opportunities.md — opportunity discovery lifecycle and graph flow
- docs/design/protocol-deep-dive.md — protocol agent/graph patterns and trace instrumentation

## Scope
Add traceEmitter agent_start/agent_end calls at the boundary of each significant opportunity graph node (prep, scope, resolve, discovery, ranking, persist) so the frontend shows real-time progress during the 10-30s opportunity discovery pipeline. The evaluation node already emits these events for the evaluator agent — extend the same pattern to the other nodes. Also add AGENT_DISPLAY_NAMES entries in the frontend ToolCallsDisplay.tsx for the new trace event names (e.g. "opportunity-prep" → "Preparing search...", "opportunity-discovery" → "Searching candidates...", etc.). Follow the existing kebab-case naming convention for trace event agent names.
