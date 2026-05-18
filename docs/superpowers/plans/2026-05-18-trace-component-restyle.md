# TRACE component restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `frontend/src/components/chat/ToolCallsDisplay.tsx` from a dark, neon-accented slab into a light, architecturally-iconic trace that matches index.network's visual language, and let it span the full chat-column width.

**Architecture:** Pure visual change. No behavior, parsing, or state-management edits. Class-swap throughout the component, replace a few lucide icons with architecturally-meaningful ones (`Wrench`/`Workflow`/`Bot`/`Sparkles`/`MessagesSquare`/`ArrowLeftRight`/`RotateCw`), and restructure two call sites to lift `<ToolCallsDisplay>` out of the assistant message's `max-w-[90%]` wrapper.

**Tech Stack:** React 19, Tailwind CSS 4, lucide-react, TypeScript (strict).

**Spec:** `docs/superpowers/specs/2026-05-18-trace-component-restyle-design.md`

---

## File map

- Modify `frontend/src/components/chat/ToolCallsDisplay.tsx` — class swaps throughout, lucide imports, `SPEECH_ACT_LABELS` retoning. ~30 surface-area edits across ~1542 lines.
- Modify `frontend/src/components/ChatContent.tsx:1637-1660` — restructure the assistant message branch so `<ToolCallsDisplay>` renders outside the `max-w-[90%]` wrapper.
- Modify `frontend/src/app/onboarding/page.tsx:575-598` — same restructure.

No new files, no dependency changes, no API changes, no test files. Verification is `tsc --noEmit` + `bun run lint` + manual visual check in the dev server.

---

### Task 1: Swap lucide imports

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx:1-13`

- [ ] **Step 1: Update the import block**

Replace the existing import (lines 1-13):

```tsx
import { useState, useEffect } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  X,
  Circle,
  Cpu,
  Zap,
  AlertTriangle,
} from "lucide-react";
import type { TraceEvent } from "@/contexts/AIChatContext";
import { cn } from "@/lib/utils";
```

with:

```tsx
import { useState, useEffect } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Square,
  Circle,
  AlertTriangle,
  Wrench,
  Workflow,
  Bot,
  Sparkles,
  MessagesSquare,
  ArrowLeftRight,
  RotateCw,
  XCircle,
} from "lucide-react";
import type { TraceEvent } from "@/contexts/AIChatContext";
import { cn } from "@/lib/utils";
```

`Play`, `X`, `Cpu`, `Zap` are removed. They have no remaining usages after this plan completes; this task removes them up front so subsequent `tsc` runs surface any I missed.

- [ ] **Step 2: Verify no stale references**

Run: `cd frontend && grep -nE '\b(Play|Cpu|Zap)\b' src/components/chat/ToolCallsDisplay.tsx`
Expected: no matches (the bare `<X` JSX usage on the tool error row is still present; we replace it in Task 3).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "refactor(trace): swap lucide imports for architectural icon set"
```

---

### Task 2: Restyle container + header

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx:1386-1423`

The outer wrapper, the collapsible header bar, the TRACE label, the event count, and the right-side duration/spinner.

- [ ] **Step 1: Replace the outer wrapper**

Replace `<div className="mb-3 font-mono text-[11px] leading-tight border border-gray-200 rounded-lg overflow-hidden bg-gray-900 text-gray-100">` (line 1387) with:

```tsx
<div className="mb-3 font-mono text-[11px] leading-tight border border-[#E8E8E8] rounded-sm overflow-hidden bg-white text-gray-700">
```

- [ ] **Step 2: Replace the header button**

Replace the existing header button (lines 1389-1423) with:

```tsx
<button
  type="button"
  onClick={() => setIsExpanded(!isExpanded)}
  aria-label={isExpanded ? "Collapse trace" : "Expand trace"}
  aria-expanded={isExpanded}
  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-gray-700 hover:bg-gray-50 transition-colors border-b border-[#E8E8E8] bg-[#FAFAFA]"
>
  {isExpanded ? (
    <ChevronDown className="w-3 h-3 text-gray-500" />
  ) : (
    <ChevronRight className="w-3 h-3 text-gray-500" />
  )}
  <span className="font-['Public_Sans'] text-[10px] uppercase tracking-wider font-bold text-black">
    Trace
  </span>
  <span className="w-px h-2.5 bg-gray-300" />
  <span className="text-gray-500 tabular-nums">
    {traceEvents.length} events{wasStoppedByUser ? " (stopped)" : ""}
  </span>
  <span className="text-gray-400 ml-auto flex items-center gap-2">
    {runningTools > 0 || (isStreaming && !wasStoppedByUser) ? (
      <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
    ) : wasStoppedByUser && stoppedAt && firstEvent ? (
      formatDuration(stoppedAt - firstEvent.timestamp)
    ) : (
      totalDuration > 0 && formatDuration(totalDuration)
    )}
  </span>
</button>
```

This collapses the previous yellow/amber/green/red event-count branches into one neutral string — running vs done is communicated by the trailing spinner or duration. The `hasErrors` flag goes unused at the header level; per-tool error coloring still shows in Task 3.

- [ ] **Step 3: Remove now-unused `hasErrors`**

Delete line 1367 (`const hasErrors = parsed.tools.some((t) => t.status === "error");`).

- [ ] **Step 4: Replace the body divider**

Replace `<div className="divide-y divide-gray-800">` (line 1426) with:

```tsx
<div className="divide-y divide-[#F4F4F4]">
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "refactor(trace): light-theme container + header"
```

---

### Task 3: Restyle `ToolRow`

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx:1194-1351`

Tool node identity = `Wrench`. Running = `Loader2`. Error = `XCircle`. Stopped = filled `Square` (amber). Drop full-row colored backgrounds; running rows get a `#FAB8BD` inset-shadow bar plus a faint `#FFFAFB` background.

- [ ] **Step 1: Replace the tool header row JSX**

Replace lines 1210-1271 (everything inside the outer `<div>` from `{/* Tool header row */}` through the closing `</div>` immediately after the duration span — inclusive — but keeping the surrounding `<div>` open for the rest of the component):

```tsx
{/* Tool header row */}
<div
  className={cn(
    "flex items-center gap-2 px-3.5 py-1.5",
    isRunning && "bg-[#FFFAFB] shadow-[inset_2px_0_0_#FAB8BD]",
    isStopped && "bg-amber-50",
    !isRunning && !isStopped && tool.status === "error" && "bg-red-50",
  )}
>
  {hasSteps ? (
    <button
      type="button"
      onClick={() => onToggleExpand(toolIdx)}
      aria-label={isToolExpanded ? `Collapse ${desc.action} details` : `Expand ${desc.action} details`}
      aria-expanded={isToolExpanded}
      aria-controls={`tool-steps-${toolIdx}`}
      className="w-3 h-3 flex items-center justify-center text-gray-500 hover:text-gray-700"
    >
      {isToolExpanded ? (
        <ChevronDown className="w-3 h-3" />
      ) : (
        <ChevronRight className="w-3 h-3" />
      )}
    </button>
  ) : isRunning ? (
    <Loader2 className="w-3 h-3 text-gray-500 animate-spin flex-shrink-0" />
  ) : isStopped ? (
    <Square className="w-3 h-3 text-amber-600 fill-amber-600 flex-shrink-0" />
  ) : tool.status === "error" ? (
    <XCircle className="w-3 h-3 text-red-600 flex-shrink-0" />
  ) : (
    <Wrench className="w-3 h-3 text-gray-800 flex-shrink-0" />
  )}

  <span className={cn(
    "flex-1",
    isStopped ? "text-amber-700" : tool.status === "error" ? "text-red-700" : "text-gray-900",
  )}>
    {isRunning
      ? desc.running
      : isStopped
        ? "Stopped"
        : tool.status === "error"
          ? `Failed: ${desc.action}`
          : desc.action}
    {!isRunning && !isStopped && tool.summary && (
      <span className="text-gray-400"> — {tool.summary}</span>
    )}
  </span>

  <span className="tabular-nums flex-shrink-0 ml-auto text-gray-400">
    {isRunning && tool.startTimestamp ? (
      <RunningTimer startedAt={tool.startTimestamp} />
    ) : isStopped && stoppedAt && tool.startTimestamp ? (
      formatDuration(stoppedAt - tool.startTimestamp)
    ) : tool.durationMs !== undefined ? (
      formatDuration(tool.durationMs)
    ) : null}
  </span>
</div>
```

- [ ] **Step 2: Restyle the expandable step panel wrapper**

Replace line 1290 (`<div id={`tool-steps-${toolIdx}`} className="bg-gray-950 border-l-2 border-gray-700 ml-4 py-1">`) with:

```tsx
<div id={`tool-steps-${toolIdx}`} className="bg-[#FAFAFA] border-l-2 border-[#E8E8E8] ml-4 py-1">
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "refactor(trace): tool row uses Wrench identity icon and light palette"
```

---

### Task 4: Restyle `GraphRow`

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx:1060-1121`

Graph node identity = `Workflow`. Running = `Loader2`. Stopped = filled `Square` (amber).

- [ ] **Step 1: Replace the `GraphRow` function body**

Replace the entire `function GraphRow(...) { ... }` body (lines 1060-1121) with:

```tsx
function GraphRow({ graph, wasStoppedByUser, stoppedAt }: GraphRowProps) {
  const isStopped = graph.isRunning && wasStoppedByUser && stoppedAt;
  const isRunning = graph.isRunning && !wasStoppedByUser;
  const displayName = getGraphDisplayName(graph.name);

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 pl-8 pr-3.5 py-0.5",
          isRunning && "bg-[#FFFAFB] shadow-[inset_2px_0_0_#FAB8BD]",
          isStopped && "bg-amber-50",
        )}
      >
        <span className="text-gray-300 flex-shrink-0 select-none">└─</span>
        {isRunning ? (
          <Loader2 className="w-3 h-3 text-gray-500 animate-spin flex-shrink-0" />
        ) : isStopped ? (
          <Square className="w-3 h-3 text-amber-600 fill-amber-600 flex-shrink-0" />
        ) : (
          <Workflow className="w-3 h-3 text-gray-800 flex-shrink-0" />
        )}
        <span className={cn(
          "flex-1 truncate",
          isStopped ? "text-amber-700" : "text-gray-900",
        )}>
          {isStopped ? "Stopped" : displayName}
        </span>
        <span className="tabular-nums flex-shrink-0 text-gray-400">
          {isRunning && graph.startTimestamp ? (
            <RunningTimer startedAt={graph.startTimestamp} />
          ) : isStopped && stoppedAt && graph.startTimestamp ? (
            formatDuration(stoppedAt - graph.startTimestamp)
          ) : graph.durationMs !== undefined ? (
            formatDuration(graph.durationMs)
          ) : null}
        </span>
      </div>
      {groupConsecutiveAgents(graph.agents).map((entry, eIdx) => {
        if (entry.kind === "single") {
          return (
            <AgentRow
              key={`${entry.agent.name}-${eIdx}`}
              agent={entry.agent}
              wasStoppedByUser={wasStoppedByUser}
              stoppedAt={stoppedAt}
            />
          );
        }
        return (
          <AgentGroupRow
            key={`${entry.name}-group-${eIdx}`}
            name={entry.name}
            agents={entry.agents}
            wasStoppedByUser={wasStoppedByUser}
            stoppedAt={stoppedAt}
          />
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "refactor(trace): graph row uses Workflow identity icon"
```

---

### Task 5: Restyle `AgentRow` + `AgentGroupRow`

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx:884-1052`

Agent node identity = `Bot`. Running = `Loader2`. Stopped = filled `Square`. Group sub-row "scored" badge keeps `emerald-700` (semantic).

- [ ] **Step 1: Replace `AgentRow` body**

Replace lines 884-925 (entire `function AgentRow(...) { ... }` body) with:

```tsx
function AgentRow({ agent, wasStoppedByUser, stoppedAt }: AgentRowProps) {
  const isStopped = agent.isRunning && wasStoppedByUser && stoppedAt;
  const isRunning = agent.isRunning && !wasStoppedByUser;
  const displayName = getAgentDisplayName(agent.name);

  return (
    <div
      className={cn(
        "flex items-center gap-2 pl-12 pr-3.5 py-0.5",
        isRunning && "bg-[#FFFAFB] shadow-[inset_2px_0_0_#FAB8BD]",
        isStopped && "bg-amber-50",
      )}
    >
      <span className="text-gray-300 flex-shrink-0 select-none">└─</span>
      {isRunning ? (
        <Loader2 className="w-2.5 h-2.5 text-gray-500 animate-spin flex-shrink-0" />
      ) : isStopped ? (
        <Square className="w-2.5 h-2.5 text-amber-600 fill-amber-600 flex-shrink-0" />
      ) : (
        <Bot className="w-2.5 h-2.5 text-gray-500 flex-shrink-0" />
      )}
      <span className={cn(
        "flex-1 truncate",
        isStopped ? "text-amber-700" : "text-gray-600",
      )}>
        {isStopped ? "Stopped" : displayName}
        {!isRunning && !isStopped && agent.summary && (
          <span className="text-gray-400"> — {agent.summary}</span>
        )}
      </span>
      <span className="tabular-nums flex-shrink-0 text-gray-400">
        {isRunning && agent.startTimestamp ? (
          <RunningTimer startedAt={agent.startTimestamp} />
        ) : isStopped && stoppedAt && agent.startTimestamp ? (
          formatDuration(stoppedAt - agent.startTimestamp)
        ) : agent.durationMs !== undefined ? (
          formatDuration(agent.durationMs)
        ) : null}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Replace `AgentGroupRow` body**

Replace lines 934-1052 (entire `function AgentGroupRow(...) { ... }` body) with:

```tsx
function AgentGroupRow({ name, agents, wasStoppedByUser, stoppedAt }: AgentGroupRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayName = getAgentDisplayName(name);

  const runningCount = agents.filter((a) => a.isRunning && !wasStoppedByUser).length;
  const stoppedCount = agents.filter((a) => a.isRunning && wasStoppedByUser).length;
  const anyRunning = runningCount > 0;
  const anyStopped = stoppedCount > 0 && !anyRunning;

  const earliestStart = agents.reduce<number | undefined>(
    (min, a) => (a.startTimestamp !== undefined ? (min === undefined ? a.startTimestamp : Math.min(min, a.startTimestamp)) : min),
    undefined,
  );
  const totalCompletedMs = agents.reduce((sum, a) => sum + (a.durationMs ?? 0), 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 pl-12 pr-3.5 py-0.5 w-full text-left hover:bg-gray-50 transition-colors",
          anyRunning && "bg-[#FFFAFB] shadow-[inset_2px_0_0_#FAB8BD]",
          anyStopped && "bg-amber-50",
        )}
      >
        <span className="text-gray-300 flex-shrink-0 select-none">└─</span>
        {isExpanded ? (
          <ChevronDown className="w-2.5 h-2.5 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 text-gray-500 flex-shrink-0" />
        )}
        {anyRunning ? (
          <Loader2 className="w-2.5 h-2.5 text-gray-500 animate-spin flex-shrink-0" />
        ) : anyStopped ? (
          <Square className="w-2.5 h-2.5 text-amber-600 fill-amber-600 flex-shrink-0" />
        ) : (
          <Bot className="w-2.5 h-2.5 text-gray-500 flex-shrink-0" />
        )}
        <span className={cn(
          "flex-1 truncate",
          anyStopped ? "text-amber-700" : "text-gray-600",
        )}>
          {anyStopped ? "Stopped" : displayName}
          <span className="text-gray-400"> ({agents.length})</span>
          {anyRunning && runningCount < agents.length && (
            <span className="text-gray-400"> — {agents.length - runningCount} done, {runningCount} running</span>
          )}
          {!anyRunning && !anyStopped && (() => {
            const scored = agents.filter((a) => isAgentSummaryPassed(a.summary)).length;
            return scored > 0
              ? <span className="text-gray-400"> — <span className="text-emerald-700">{scored} scored</span>, {agents.length - scored} no match</span>
              : <span className="text-gray-400"> — no matches</span>;
          })()}
        </span>
        <span className="tabular-nums flex-shrink-0 text-gray-400">
          {anyRunning && earliestStart ? (
            <RunningTimer startedAt={earliestStart} />
          ) : anyStopped && stoppedAt && earliestStart ? (
            formatDuration(stoppedAt - earliestStart)
          ) : totalCompletedMs > 0 ? (
            <>{formatDuration(totalCompletedMs)} total</>
          ) : null}
        </span>
      </button>

      {isExpanded && agents.map((agent, aIdx) => {
        const agentIsRunning = agent.isRunning && !wasStoppedByUser;
        const agentIsStopped = agent.isRunning && wasStoppedByUser && !!stoppedAt;
        const passed = isAgentSummaryPassed(agent.summary);

        return (
          <div
            key={`${agent.name}-group-${aIdx}`}
            className={cn(
              "flex items-center gap-2 pl-16 pr-3.5 py-0.5",
              agentIsRunning && "bg-[#FFFAFB] shadow-[inset_2px_0_0_#FAB8BD]",
              agentIsStopped && "bg-amber-50",
            )}
          >
            <span className="text-gray-300 flex-shrink-0 select-none">└─</span>
            {agentIsRunning ? (
              <Loader2 className="w-2 h-2 text-gray-500 animate-spin flex-shrink-0" />
            ) : agentIsStopped ? (
              <Square className="w-2 h-2 text-amber-600 fill-amber-600 flex-shrink-0" />
            ) : passed ? (
              <Circle className="w-2 h-2 text-emerald-600 fill-emerald-600 flex-shrink-0" />
            ) : (
              <Circle className="w-2 h-2 text-gray-400 fill-gray-400 flex-shrink-0" />
            )}
            <span className={cn(
              "flex-1 truncate",
              agentIsStopped ? "text-amber-700" : agentIsRunning ? "text-gray-700" : "text-gray-500",
            )}>
              {agentIsStopped
                ? "Stopped"
                : agentIsRunning
                  ? "Running..."
                  : agent.summary ?? getAgentDisplayName(agent.name)}
            </span>
            <span className="tabular-nums flex-shrink-0 text-gray-400">
              {agentIsRunning && agent.startTimestamp ? (
                <RunningTimer startedAt={agent.startTimestamp} />
              ) : agentIsStopped && stoppedAt && agent.startTimestamp ? (
                formatDuration(stoppedAt - agent.startTimestamp)
              ) : agent.durationMs !== undefined ? (
                formatDuration(agent.durationMs)
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "refactor(trace): agent rows use Bot identity icon and gray palette"
```

---

### Task 6: Restyle inline timeline rows (iteration_start, llm_start, llm_end, hallucination_detected)

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx:1444-1535`

These are the rows rendered directly by the `parsed.timeline.map(...)` switch in `ToolCallsDisplay`. They cover iteration boundaries, model thinking, model decisions, and hallucination recovery.

- [ ] **Step 1: Replace `iteration_start` rendering**

Replace lines 1445-1459 (the `if (item.kind === "iteration_start")` block) with:

```tsx
if (item.kind === "iteration_start") {
  return (
    <div
      key={`iter-${idx}`}
      className="flex items-center gap-2 px-3.5 py-1.5 bg-[#FFF5F6] shadow-[inset_2px_0_0_#FAB8BD]"
    >
      <RotateCw className="w-3 h-3 text-[#FAB8BD] flex-shrink-0" />
      <span className="text-gray-900 font-medium">
        Starting iteration {event.iteration}
      </span>
      <span className="text-gray-400 text-[10px] ml-auto">
        {formatTime(event.timestamp)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Replace `hallucination_detected` rendering**

Replace lines 1462-1477 (the `if (item.kind === "hallucination_detected")` block) with:

```tsx
if (item.kind === "hallucination_detected") {
  return (
    <div
      key={`hallucination-${idx}`}
      className="flex items-center gap-2 px-3.5 py-1.5 bg-amber-50"
    >
      <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
      <span className="text-amber-700 font-medium">
        Hallucinated {event.summary} block — auto-invoking {event.name}
      </span>
      <span className="text-gray-400 text-[10px] ml-auto">
        {formatTime(event.timestamp)}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Replace `llm_start` rendering**

Replace lines 1479-1519 (the `if (item.kind === "llm_start")` block) with:

```tsx
if (item.kind === "llm_start") {
  const duration = item.duration ?? null;
  const wouldBeRunning = duration === null;
  const isRunning = wouldBeRunning && !wasStoppedByUser;
  const isStopped = wouldBeRunning && wasStoppedByUser && stoppedAt;

  return (
    <div
      key={`llm-start-${idx}`}
      className={cn(
        "flex items-center gap-2 px-3.5 py-1.5",
        isRunning && "bg-[#FFFAFB] shadow-[inset_2px_0_0_#FAB8BD]",
        isStopped && "bg-amber-50",
      )}
    >
      {isRunning ? (
        <Loader2 className="w-3 h-3 text-gray-500 animate-spin flex-shrink-0" />
      ) : isStopped ? (
        <Square className="w-3 h-3 text-amber-600 fill-amber-600 flex-shrink-0" />
      ) : (
        <Sparkles className="w-3 h-3 text-gray-500 flex-shrink-0" />
      )}
      <span className={isStopped ? "text-amber-700" : "text-gray-800"}>
        {isRunning
          ? "Thinking about your request..."
          : isStopped
            ? "Stopped"
            : "Analyzed your request"}
      </span>
      <span className="tabular-nums flex-shrink-0 ml-auto text-gray-400">
        {isRunning ? (
          <RunningTimer startedAt={event.timestamp} />
        ) : isStopped && stoppedAt ? (
          formatDuration(stoppedAt - event.timestamp)
        ) : duration !== null ? (
          formatDuration(duration)
        ) : null}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Replace `llm_end` rendering**

Replace lines 1521-1534 (the `if (item.kind === "llm_end")` block) with:

```tsx
if (item.kind === "llm_end") {
  return (
    <div key={`llm-end-${idx}`} className="flex items-center gap-2 px-3.5 py-1.5">
      <Sparkles className="w-3 h-3 text-[#FAB8BD] fill-[#FAB8BD] flex-shrink-0" />
      <span className="text-gray-800">
        {event.hasToolCalls && event.toolNames
          ? `Decided to ${event.toolNames
              .map((t) => getToolDescription(t).action.toLowerCase())
              .join(", ")}`
          : "Preparing response"}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "refactor(trace): inline timeline rows use new icon set and light palette"
```

---

### Task 7: Restyle `NegotiationTree`

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx:1123-1183`

The legend says negotiation graph = `MessagesSquare`; turns = `ArrowLeftRight`. The current emoji-based `outcomeIcon` function is dropped.

- [ ] **Step 1: Delete `outcomeIcon` helper**

Delete lines 1123-1128 (`function outcomeIcon(o: NegotiationNode["outcome"]): string { ... }`) — it's only used inside `NegotiationTree` and the rewrite below replaces it inline.

- [ ] **Step 2: Replace `NegotiationTree` body**

Replace the entire `function NegotiationTree(...) { ... }` body (lines 1130-1183) with:

```tsx
function NegotiationTree({ negotiations }: { negotiations: NegotiationNode[] }) {
  const [openIdxs, setOpenIdxs] = useState<Set<number>>(new Set());

  if (negotiations.length === 0) return null;

  return (
    <div className="pl-8 pr-3.5 py-1 bg-white">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-gray-300 flex-shrink-0 select-none">└─</span>
        <MessagesSquare className="w-3 h-3 text-gray-800 flex-shrink-0" />
        <span className="text-gray-600">Negotiations</span>
        <span className="text-gray-400">({negotiations.length})</span>
      </div>
      {negotiations.map((n, i) => {
        const isOpen = openIdxs.has(i);
        const toggle = () => {
          const next = new Set(openIdxs);
          if (isOpen) next.delete(i); else next.add(i);
          setOpenIdxs(next);
        };
        const outcomeColor =
          n.outcome === "accepted"
            ? "text-emerald-700"
            : n.outcome === "waiting_for_agent" || n.isRunning
              ? "text-gray-500"
              : "text-gray-600";
        return (
          <div key={`${n.opportunityId}-${i}`} className="ml-5 mb-0.5">
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-2 text-left hover:text-gray-900 transition-colors"
              title={n.outcomeReasoning ?? ""}
            >
              {isOpen ? (
                <ChevronDown className="w-2.5 h-2.5 text-gray-500 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-2.5 h-2.5 text-gray-500 flex-shrink-0" />
              )}
              <span className="font-medium text-gray-700">{n.candidateName ?? n.candidateUserId}</span>
              <span className={outcomeColor}>
                — {n.outcome ?? (n.isRunning ? "running" : "unknown")}
              </span>
              <span className="text-gray-400">
                ({n.turns.length} turn{n.turns.length === 1 ? "" : "s"}
                {n.durationMs != null ? `, ${formatDuration(n.durationMs)}` : ""})
              </span>
            </button>
            {isOpen && (
              <ol className="ml-5 mt-1 space-y-0.5">
                {n.turns.map((t) => (
                  <li key={t.turnIndex} className="flex items-start gap-2">
                    <ArrowLeftRight className="w-2.5 h-2.5 text-gray-500 flex-shrink-0 mt-1" />
                    <div className="flex-1">
                      <span className="text-gray-400">{t.turnIndex + 1}.</span>{" "}
                      <span className="text-gray-400 text-[10px]">[{t.actor}]</span>{" "}
                      <span className="font-medium text-gray-700">{t.action}</span>
                      {t.message && <span className="text-gray-600"> — {t.message}</span>}
                      {t.reasoning && (
                        <div className="ml-5 text-gray-400 italic">{t.reasoning}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "refactor(trace): negotiation tree uses MessagesSquare + ArrowLeftRight"
```

---

### Task 8: Restyle step detail sub-components

**Files:**
- Modify: `frontend/src/components/chat/ToolCallsDisplay.tsx:206-810`

`ScoreBar`, `CandidateScore`, `SearchQueryDisplay`, `FelicityScores`, `MatchGroupSummary`, `CandidatePassedGroup`, `CandidateFailedGroup`, and the generic step row inside the expanded panel (`groupSteps(...).map(...)` block).

- [ ] **Step 1: Restyle `ScoreBar` track**

Replace line 218 (`<div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">`) with:

```tsx
<div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
```

And line 217 (`<span className="w-16 text-gray-500">{label}</span>`) — keep as-is (gray-500 still reads on white). And line 224-226 — replace `text-gray-400` with `text-gray-500` so the readout sits on a lighter background:

```tsx
<span className="w-8 text-right tabular-nums text-gray-500">
  {Math.round(value)}
</span>
```

- [ ] **Step 2: Restyle `CandidateScore` wrapper**

Replace line 268 (`<div className="ml-5 mt-1 mb-1 p-2 bg-gray-800/50 rounded border border-gray-700/50 space-y-1">`) with:

```tsx
<div className="ml-5 mt-1 mb-1 p-2 bg-[#FAFAFA] rounded-sm border border-[#E8E8E8] space-y-1">
```

Update line 270 (`<span className="text-gray-300 font-medium">{name}</span>`) to:

```tsx
<span className="text-gray-700 font-medium">{name}</span>
```

The `scoreColor` ternary (lines 260-265) — keep green/yellow/red but shift `400`→`600` for contrast on white:

```tsx
const scoreColor =
  displayScore >= 70
    ? "text-emerald-600"
    : displayScore >= 50
      ? "text-amber-600"
      : "text-red-600";
```

Update the "passed" / "below threshold" spans (lines 274-277):

```tsx
{passed !== undefined && (
  <span className={passed ? "text-emerald-700" : "text-red-700"}>
    {passed ? "✓ passed" : "✗ below threshold"}
  </span>
)}
```

Update "via {strategy}" line 280:

```tsx
<span className="text-gray-400">via {strategy}</span>
```

Update bio (line 284) and reasoning (line 289) inside the card:

```tsx
{bio && (
  <div className="text-[10px] text-gray-500 italic">
    {bio}
  </div>
)}
{reasoning && (
  <div className="text-[10px] text-gray-600 leading-relaxed">
    {reasoning}
  </div>
)}
```

- [ ] **Step 3: Restyle `SearchQueryDisplay`**

Replace lines 312-321 (the entire inner JSX) with:

```tsx
<div className="ml-5 mt-1 mb-1 p-2 bg-[#FAFAFA] rounded-sm border border-[#E8E8E8]">
  {strategy && (
    <div className="text-[10px] text-gray-500 font-medium mb-1">
      Strategy: {strategy}
    </div>
  )}
  <div className="text-[10px] text-gray-700 leading-relaxed whitespace-pre-wrap">
    {displayText}
  </div>
</div>
```

- [ ] **Step 4: Restyle `FelicityScores` wrapper and labels**

Replace line 337 (`<div className="ml-5 mt-1 mb-1 p-2 bg-gray-800/50 rounded border border-gray-700/50 space-y-1.5">`) with:

```tsx
<div className="ml-5 mt-1 mb-1 p-2 bg-[#FAFAFA] rounded-sm border border-[#E8E8E8] space-y-1.5">
```

Update line 340 (`<span className="text-gray-500">Speech Act:</span>`) — keep.
Update line 345 (`<span className="text-gray-600 ml-2">`) — keep (still reads on white).

- [ ] **Step 5: Retone `SPEECH_ACT_LABELS`**

Replace lines 198-204 with:

```tsx
const SPEECH_ACT_LABELS: Record<string, { label: string; color: string }> = {
  COMMISSIVE: { label: "Commitment", color: "text-emerald-700" },
  DIRECTIVE: { label: "Request", color: "text-sky-700" },
  DECLARATION: { label: "Declaration", color: "text-violet-700" },
  ASSERTIVE: { label: "Statement", color: "text-gray-600" },
  EXPRESSIVE: { label: "Expression", color: "text-amber-700" },
};
```

- [ ] **Step 6: Restyle `MatchGroupSummary`**

Replace lines 737-751 (entire returned JSX) with:

```tsx
return (
  <div className="px-3.5 py-0.5 text-gray-500">
    <div className="flex items-center gap-2">
      <Circle className="w-1.5 h-1.5 text-gray-400 fill-gray-400 flex-shrink-0" />
      <span>
        {steps.length} matches
        {topScores.length > 0 && (
          <span className="text-gray-400">
            {" "}(top: {topScores.join(", ")}{suffix})
          </span>
        )}
      </span>
    </div>
  </div>
);
```

- [ ] **Step 7: Restyle `CandidatePassedGroup`**

Replace lines 757-769 (the inner JSX of the `<>`) with:

```tsx
<>
  {steps.map((step, stepIdx) => (
    <div key={`cand-pass-${stepIdx}`} className="px-3.5 py-0.5 text-gray-500">
      <div className="flex items-center gap-2">
        <Circle className="w-1.5 h-1.5 text-emerald-600 fill-emerald-600 flex-shrink-0" />
        <span>
          candidate
          {step.detail && <span className="text-gray-400">: {step.detail}</span>}
        </span>
      </div>
      {step.data && <CandidateScore data={step.data as CandidateData} />}
    </div>
  ))}
</>
```

- [ ] **Step 8: Restyle `CandidateFailedGroup`**

Replace lines 777-808 (entire returned JSX) with:

```tsx
<div className="px-3.5 py-0.5 text-gray-500">
  <button
    type="button"
    onClick={() => setIsExpanded(!isExpanded)}
    className="flex items-center gap-2 hover:text-gray-700 transition-colors"
  >
    {isExpanded ? (
      <ChevronDown className="w-2.5 h-2.5 text-gray-400 flex-shrink-0" />
    ) : (
      <ChevronRight className="w-2.5 h-2.5 text-gray-400 flex-shrink-0" />
    )}
    <span className="text-gray-500">
      {steps.length} below threshold
    </span>
  </button>
  {isExpanded && (
    <div className="mt-1">
      {steps.map((step, stepIdx) => (
        <div key={`cand-fail-${stepIdx}`} className="py-0.5">
          <div className="flex items-center gap-2 ml-4">
            <Circle className="w-1.5 h-1.5 text-gray-400 fill-gray-400 flex-shrink-0" />
            <span>
              candidate
              {step.detail && <span className="text-gray-400">: {step.detail}</span>}
            </span>
          </div>
          {step.data && <CandidateScore data={step.data as CandidateData} />}
        </div>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 9: Restyle the generic step row inside the expanded panel**

In `ToolRow`, replace lines 1308-1345 (the trailing `return` inside the `groupSteps(...).map(...)` block — the "single" branch) with:

```tsx
return (
  <div
    key={`${step.step}-${groupIdx}`}
    className="px-3.5 py-0.5 text-gray-500"
  >
    <div className="flex items-center gap-2">
      <Circle className="w-1.5 h-1.5 text-gray-400 fill-gray-400 flex-shrink-0" />
      <span>
        {step.step}
        {step.detail && (
          <span className="text-gray-400">
            : {step.detail}
          </span>
        )}
      </span>
    </div>
    {step.data && isFelicity && (
      <FelicityScores data={step.data as FelicityData} />
    )}
    {step.data && isSearchQuery && (
      <SearchQueryDisplay data={step.data as SearchQueryData} />
    )}
    {step.data && !isFelicity && !isSearchQuery && (
      <div className="ml-4 mt-1 text-xs text-gray-500 space-y-0.5">
        {Object.entries(step.data).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <span className="text-gray-400 flex-shrink-0">{key}:</span>
            <span className="text-gray-500 break-all">
              {typeof value === "string"
                ? value.length > 200 ? value.slice(0, 200) + "..." : value
                : (() => { const s = JSON.stringify(value); return s.length > 200 ? s.slice(0, 200) + "..." : s; })()}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);
```

- [ ] **Step 10: Type-check + lint**

Run: `cd frontend && bunx tsc --noEmit && bun run lint`
Expected: no new errors or warnings introduced in `ToolCallsDisplay.tsx`.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "refactor(trace): light-theme sub-panels (scores, candidates, felicity, queries)"
```

---

### Task 9: Lift `<ToolCallsDisplay>` out of `max-w-[90%]` in `ChatContent.tsx`

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx:1630-1660` (approximately)

Restructure so the assistant "Index" label and the trace render outside the width-capped wrapper; only the message body stays constrained.

- [ ] **Step 1: Read the surrounding context**

Run: `cd frontend && grep -n "ToolCallsDisplay\|max-w-\[90%\]" src/components/ChatContent.tsx | head -20`

Confirm the surrounding structure matches the spec's expectations. The relevant block today is the `msg.role === "assistant"` branch starting around line 1637.

- [ ] **Step 2: Snapshot the existing user-branch and assistant-branch JSX**

Open `frontend/src/components/ChatContent.tsx`. Locate the existing outer `<div className={cn(msg.role === "user" ? "max-w-[75%]" : "max-w-[90%]", …)}>` wrapper. Identify two regions that will be **moved verbatim** in Step 3:
- **USER BODY** — everything inside the existing `<article className="max-w-none">` when `msg.role === "user"` (the user's markdown rendering and any user-side child components).
- **ASSISTANT BODY** — everything inside the existing `<article className="max-w-none">` when `msg.role === "assistant"` **except** the `<ToolCallsDisplay …>` element itself (the `AssistantMessageContent`, intent proposal cards, opportunity cards, dividers, suggestion chips, and all related handler wiring).

Copy both regions verbatim. They are not edited — only relocated.

- [ ] **Step 3: Apply the restructure**

Replace the block from line 1637 (the outer `<div className="...max-w-[90%]...">`) through line 1660 (the closing of the `ToolCallsDisplay` insertion). Specifically, the existing shape is:

```tsx
<div
  className={cn(
    msg.role === "user" ? "max-w-[75%]" : "max-w-[90%]",
    msg.role === "user"
      ? "bg-[#FAFAFA] text-gray-900 border border-[#E8E8E8] rounded-4xl px-4 py-1 text-sm leading-relaxed"
      : "text-gray-900",
  )}
>
  {msg.role === "assistant" && (
    <span className="text-[10px] uppercase tracking-wider text-black font-bold mb-1 block">
      Index
    </span>
  )}
  <article className="max-w-none">
    {msg.role === "assistant" ? (
      <>
        {msg.traceEvents && msg.traceEvents.length > 0 && (
          <ToolCallsDisplay
            traceEvents={msg.traceEvents}
            isStreaming={msg.isStreaming}
            wasStoppedByUser={msg.wasStoppedByUser}
            stoppedAt={msg.stoppedAt}
          />
        )}
        ...rest of assistant body...
      </>
    ) : (
      ...user body...
    )}
  </article>
</div>
```

Restructure it to split the user and assistant branches so the assistant branch renders the label + trace at full width, then the `max-w-[90%]` only wraps the message body:

```tsx
{msg.role === "user" ? (
  <div className="max-w-[75%] bg-[#FAFAFA] text-gray-900 border border-[#E8E8E8] rounded-4xl px-4 py-1 text-sm leading-relaxed">
    <article className="max-w-none">
      ...user body unchanged...
    </article>
  </div>
) : (
  <div className="w-full text-gray-900">
    <span className="text-[10px] uppercase tracking-wider text-black font-bold mb-1 block">
      Index
    </span>
    {msg.traceEvents && msg.traceEvents.length > 0 && (
      <ToolCallsDisplay
        traceEvents={msg.traceEvents}
        isStreaming={msg.isStreaming}
        wasStoppedByUser={msg.wasStoppedByUser}
        stoppedAt={msg.stoppedAt}
      />
    )}
    <div className="max-w-[90%]">
      <article className="max-w-none">
        ...rest of assistant body unchanged...
      </article>
    </div>
  </div>
)}
```

Paste the **USER BODY** captured in Step 2 in place of `...user body unchanged...`, and the **ASSISTANT BODY** in place of `...rest of assistant body unchanged...`. No content inside those regions is edited — only their wrapping changes.

- [ ] **Step 4: Diff-check that body content is byte-identical**

Run: `cd frontend && git diff -U0 src/components/ChatContent.tsx | grep -E '^\+' | grep -v '^\+\+\+' | wc -l`

Compare against: `cd frontend && git diff -U0 src/components/ChatContent.tsx | grep -E '^-' | grep -v '^---' | wc -l`

Both counts should be close — the only added lines are the new wrapper structure; the only removed lines are the old wrapper. If you see many more additions than removals (or vice versa), body content was accidentally edited; revert and redo Step 3.

- [ ] **Step 5: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChatContent.tsx
git commit -m "refactor(chat): render trace at full chat-column width"
```

---

### Task 10: Lift `<ToolCallsDisplay>` out of `max-w-[90%]` in `onboarding/page.tsx`

**Files:**
- Modify: `frontend/src/app/onboarding/page.tsx:573-600` (approximately)

Same restructure as Task 9, applied to the onboarding chat surface.

- [ ] **Step 1: Read the surrounding context**

Run: `cd frontend && grep -n "ToolCallsDisplay\|max-w-\[90%\]" src/app/onboarding/page.tsx | head -20`

Confirm the layout matches the structure shown in Task 9.

- [ ] **Step 2: Snapshot the existing user-branch and assistant-branch JSX**

Same approach as Task 9 Step 2: copy the **USER BODY** and **ASSISTANT BODY** (everything inside the existing `<article className="max-w-none">`, minus the `<ToolCallsDisplay>` element) verbatim. The onboarding-specific behavior — the `msg.id !== "onboarding-greeting"` guard on the "Index" label, and the onboarding `handleOpportunityAction` callback wiring — must be preserved exactly.

- [ ] **Step 3: Apply the restructure**

Apply the same split as Task 9: extract the user branch into its own `max-w-[75%]` wrapper; in the assistant branch, render the "Index" label and `<ToolCallsDisplay>` at full width, then put the rest of the assistant body inside a `max-w-[90%]` wrapper.

The resulting shape:

```tsx
{msg.role === "user" ? (
  <div className="max-w-[75%] bg-[#FAFAFA] text-gray-900 border border-[#E8E8E8] rounded-4xl px-4 py-1 text-sm leading-relaxed">
    <article className="max-w-none">
      ...user body unchanged...
    </article>
  </div>
) : (
  <div className="w-full text-gray-900">
    {msg.id !== "onboarding-greeting" && (
      <span className="text-[10px] uppercase tracking-wider text-black font-bold mb-1 block">
        Index
      </span>
    )}
    {msg.traceEvents && msg.traceEvents.length > 0 && (
      <ToolCallsDisplay
        traceEvents={msg.traceEvents}
        isStreaming={msg.isStreaming}
        wasStoppedByUser={msg.wasStoppedByUser}
        stoppedAt={msg.stoppedAt}
      />
    )}
    <div className="max-w-[90%]">
      <article className="max-w-none">
        ...rest of assistant body unchanged...
      </article>
    </div>
  </div>
)}
```

- [ ] **Step 4: Diff-check that body content is byte-identical**

Run: `cd frontend && git diff -U0 src/app/onboarding/page.tsx | grep -E '^\+' | grep -v '^\+\+\+' | wc -l`

Compare against: `cd frontend && git diff -U0 src/app/onboarding/page.tsx | grep -E '^-' | grep -v '^---' | wc -l`

Roughly equal counts (off only by the few wrapper-structure lines). Significant divergence means body content was edited; revert and redo Step 3.

- [ ] **Step 5: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/onboarding/page.tsx
git commit -m "refactor(onboarding): render trace at full chat-column width"
```

---

### Task 11: Final verification (lint, type-check, visual)

**Files:** none modified.

- [ ] **Step 1: Lint**

Run: `cd frontend && bun run lint`
Expected: no errors introduced by this branch. Pre-existing warnings on unrelated files are acceptable.

- [ ] **Step 2: Type-check**

Run: `cd frontend && bunx tsc --noEmit`
Expected: clean pass.

- [ ] **Step 3: Confirm no stale icon imports**

Run: `cd frontend && grep -nE '\b(Play|Cpu|Zap)\b' src/components/chat/ToolCallsDisplay.tsx`
Expected: no matches.

Run: `cd frontend && grep -n '\bX\b' src/components/chat/ToolCallsDisplay.tsx`
Expected: either no matches or only false-positives (e.g. inside a string). If `<X` JSX usage remains, delete `X` from the lucide import block.

- [ ] **Step 4: Start the dev server**

From repo root: `bun run dev`. Open the resulting localhost URL and sign in.

- [ ] **Step 5: Walk a chat session that triggers the trace**

In the chat UI, send a message that will invoke `discover_opportunities` (e.g., "find me opportunities about AI safety"). Observe:

- TRACE panel matches the spec: white background, sharp 2px corners, `#FAFAFA` header strip, IBM Plex Mono body, uppercase "TRACE" label, gray event count, gray-400 duration.
- While streaming, running rows show a pink `#FAB8BD` left inset bar and a faint `#FFFAFB` background; the spinner is gray-500.
- When a tool completes, the row shows `Wrench` in gray-800; graphs show `Workflow`; agents show `Bot`.
- LLM "Decided to …" beats render a pink `Sparkles`; iteration boundaries render a pink `RotateCw`.
- The trace spans the full chat column (not capped at 90%); the message body beneath it is still 90%-capped.

- [ ] **Step 6: Walk the onboarding flow**

Open `/onboarding` and trigger an assistant response that emits a trace. Verify the same visual treatment renders and the "Index" label still hides for the onboarding greeting (`onboarding-greeting` id).

- [ ] **Step 7: Sanity-check error and stopped states**

If reachable in the current environment, trigger a tool error (e.g., disconnect the backend mid-call) and a user-stop (hit the Stop button mid-stream). Confirm:

- Errored tool row: `XCircle` red-600, `bg-red-50`, text-red-700.
- Stopped rows: filled `Square` amber-600, `bg-amber-50`, text-amber-700.

If these states can't be triggered manually, note the visual treatment is unverified and revisit before merging.

- [ ] **Step 8: Commit any final fixes**

If the visual walk surfaced a regression, fix it and commit:

```bash
git add frontend/src/components/chat/ToolCallsDisplay.tsx
git commit -m "fix(trace): <describe the regression>"
```

If no fixes are needed, this task closes without an additional commit.
