# TRACE component restyle — design

**Date:** 2026-05-18
**Scope:** Frontend visual change. No behavior changes.

## Problem

`frontend/src/components/chat/ToolCallsDisplay.tsx` renders the assistant's tool/graph/agent trace as a dark slab (`bg-gray-900`, neon yellow/purple/orange/teal accents, `rounded-lg`) sitting inside a light-cream (`#FDFDFD`) chat page. It clashes with the rest of the site's restrained, sharp-cornered, mostly-grayscale aesthetic. It is also visually capped at `max-w-[90%]` because it's rendered inside the assistant message bubble's width wrapper, so the trace doesn't span the full chat column.

## Goal

Restyle the trace so it reads as part of the index.network surface — quiet, monochrome, sharp-cornered, IBM Plex Mono — and let it span the full chat column width. No structural or behavioral changes.

## Design (Option A: restrained monochrome + brand pink accent)

### Container

- Background: `#FFFFFF`.
- Border: 1px `#E8E8E8` (matches user chat bubble).
- Corners: `rounded-sm` (2px). Drop `rounded-lg`. Keep `overflow-hidden` (still needed so children clip to the rounded corners).
- Width: full chat column. Lift `<ToolCallsDisplay>` out of the `max-w-[90%]` wrapper at the two call sites; the trace stays under the "INDEX" label but is rendered as a sibling to the constrained message body.

### Header

- Background: `#FAFAFA`. Bottom border: 1px `#E8E8E8`.
- Padding: `px-3.5 py-2.5`.
- **TRACE** label: `text-[10px] uppercase tracking-wider font-bold text-black font-['Public_Sans']` — same treatment as the "Index" tag.
- 1px × 10px vertical divider (`bg-gray-300`) replaces the `│` glyph.
- Event count: IBM Plex Mono, gray-500. Drop the yellow/amber/green coloring of the count — running vs done is communicated by the trailing spinner / duration instead.
- Chevron: gray-500.
- Right-side duration / spinner: gray-400.

### Rows

- Body font: IBM Plex Mono 11px (unchanged). Base text color: gray-700.
- Row separator: 1px `#F4F4F4` (very faint).
- No full-row colored backgrounds for "running" anywhere. The running indication moves to:
  - A 2px left inset shadow (`shadow-[inset_2px_0_0_#FAB8BD]`) on the row.
  - A barely-tinted background `#FFFAFB`.
- Tree connectors (`└─`): `text-gray-300`, unchanged structure.

### Icon vocabulary

Icons now reflect the protocol architecture. Each row's icon represents *what the thing is* (architecture); it swaps to a state glyph when running, errored, or stopped. New lucide imports needed: `Wrench`, `Workflow`, `Bot`, `Sparkles`, `MessagesSquare`, `ArrowLeftRight`, `RotateCw`, `XCircle`. The current imports `Play`, `Cpu`, `Zap` can be removed. `Loader2`, `Square`, `Circle`, `ChevronDown`, `ChevronRight`, `X`, `AlertTriangle` are retained (`X` can also go if `XCircle` fully replaces it — verify no remaining usage).

**Architecture → identity icon mapping (steady / done state):**

| Concept                          | Identity icon                  |
|----------------------------------|--------------------------------|
| Tool (MCP tool call)             | `Wrench`                       |
| Graph (LangGraph workflow)       | `Workflow`                     |
| Agent (LLM node inside a graph)  | `Bot`                          |
| LLM step (orchestrator thinking) | `Sparkles`                     |
| Negotiation graph                | `MessagesSquare`               |
| Negotiation turn                 | `ArrowLeftRight`               |
| Iteration boundary               | `RotateCw`                     |
| Hallucination recovery           | `AlertTriangle`                |

**State swap rules (applies to durational rows: tool, graph, agent, llm "Analyzed your request"):**

- Running → `Loader2` (spin) replaces the identity icon
- Done → identity icon (`Wrench` / `Workflow` / `Bot` / `Sparkles`)
- Error (tool only) → `XCircle`
- Stopped by user → `Square` filled (amber)

Point-in-time events (`iteration_start`, llm_end "Decided to…", negotiation turns, hallucination) have no "running" state — they always show their identity icon.

**Full per-row spec:**

| Element                          | Text color           | Icon while running | Icon when done / steady               | Icon on error | Icon when stopped |
|----------------------------------|----------------------|--------------------|----------------------------------------|---------------|-------------------|
| Tool node (`desc.action`)        | `text-gray-900`      | `Loader2` gray-500 | `Wrench` `w-3 h-3 text-gray-800`       | `XCircle` `w-3 h-3 text-red-600` | `Square` filled `text-amber-600 fill-amber-600` |
| Graph node                       | `text-gray-900`      | `Loader2` gray-500 | `Workflow` `w-3 h-3 text-gray-800`     | —             | `Square` filled `text-amber-600 fill-amber-600` |
| Agent node                       | `text-gray-600`      | `Loader2` gray-500 | `Bot` `w-2.5 h-2.5 text-gray-500`      | —             | `Square` filled `text-amber-600 fill-amber-600` |
| Agent group (collapsed summary)  | `text-gray-600`      | `Loader2` gray-500 | `Bot` `w-2.5 h-2.5 text-gray-500`      | —             | `Square` filled `text-amber-600 fill-amber-600` |
| Agent group "scored" highlight   | `text-emerald-700`   | (same) | (same) — keeps emerald for the count |   |   |
| LLM "Analyzed your request"      | `text-gray-800`      | `Loader2` gray-500 | `Sparkles` `w-3 h-3 text-gray-500`     | —             | `Square` filled `text-amber-600 fill-amber-600` |
| LLM "Decided to …" (llm_end)     | `text-gray-800`      | — (point-in-time)  | `Sparkles` `w-3 h-3 text-[#FAB8BD] fill-[#FAB8BD]` | — | — |
| iteration_start                  | `text-gray-900 font-medium` | — (point-in-time) | `RotateCw` `w-3 h-3 text-[#FAB8BD]`; row background `bg-[#FFF5F6]`; left inset shadow 2px `#FAB8BD` | — | — |
| Negotiation graph row            | `text-gray-900`      | `Loader2` gray-500 | `MessagesSquare` `w-3 h-3 text-gray-800` | —           | `Square` filled `text-amber-600 fill-amber-600` |
| Negotiation turn row             | `text-gray-600`      | — (point-in-time)  | `ArrowLeftRight` `w-2.5 h-2.5 text-gray-500` | —       | — |
| Hallucination detected           | `text-amber-700`     | — (point-in-time)  | `AlertTriangle` `w-3 h-3 text-amber-600`; row background `bg-amber-50` | — | — |
| Sub-step leaf in expanded panel  | `text-gray-500`      | —                  | `Circle` `w-1.5 h-1.5 text-gray-400 fill-gray-400` (unchanged) | — | — |
| Detail / summary suffix          | `text-gray-400`      | —                  | —                                      | —             | — |
| Duration / timestamp             | `text-gray-400`      | —                  | —                                      | —             | — |
| "no matches" / "below threshold" | `text-gray-500` (was red-400) | —          | —                                      | —             | — |

`#FAB8BD` is the site's existing selection color from `globals.css`. We're reusing it; no new tokens introduced.

**Why architecture survives in the done state.** Most of the time a user looks at a finished trace, not a streaming one. With identity-on-done, the completed trace reads top-down as `Wrench → Workflow → Bot → Bot → Bot → MessagesSquare → ArrowLeftRight`, conveying the actual structure of what the protocol did. While streaming, those rows briefly show spinners — state takes over until each unit finishes, then identity returns.

**Running indication on the row itself.** In addition to the spinner glyph, any row in the `running` state gets a 2px left inset shadow in `#FAB8BD` plus a faint `#FFFAFB` background. When the row completes, the bar disappears. This keeps the "what's live right now" cue subtle but unmistakable.

### Step detail panel (expandable)

- Background: `#FAFAFA` (was `bg-gray-950`).
- Left rail: 2px `#E8E8E8`.
- Inline panels (FelicityScores, CandidateScore, SearchQueryDisplay): swap dark `bg-gray-800/50` / `bg-blue-900/20` for `bg-[#FAFAFA]` with `border-[#E8E8E8]`. Score bar track becomes `bg-gray-200`; the fill keeps `bg-green-500 / bg-yellow-500 / bg-red-500` (semantic).
- Score number colors keep semantic green/yellow/red (these are quantitative readouts, not chrome).

### Buttons / hover

- Header button hover: `hover:bg-gray-50` (was `hover:bg-gray-800`).
- Group toggle hover: `hover:bg-gray-50` (was `hover:bg-gray-800/50`).

### Sub-panels with their own color tokens

`SPEECH_ACT_LABELS` (lines 198-204) currently uses neon-on-dark text colors. Retone:
- COMMISSIVE: `text-emerald-700`
- DIRECTIVE: `text-sky-700`
- DECLARATION: `text-violet-700`
- ASSERTIVE: `text-gray-600`
- EXPRESSIVE: `text-amber-700`

## Width change

In `frontend/src/components/ChatContent.tsx:1637-1660` and `frontend/src/app/onboarding/page.tsx:575-598`, restructure so that:

```jsx
{msg.role === "assistant" && (
  <>
    <span className="text-[10px] uppercase tracking-wider text-black font-bold mb-1 block">Index</span>
    {msg.traceEvents?.length > 0 && (
      <ToolCallsDisplay … />   // full width
    )}
    <div className="max-w-[90%]">
      <article className="max-w-none">
        <AssistantMessageContent … />
        …
      </article>
    </div>
  </>
)}
```

The user message branch is unchanged. The "Index" label moves above the trace; the existing `max-w-[90%]` wrapper now only constrains the message body and the cards beneath it. This avoids negative margins.

## Out of scope

- All trace-parsing logic (`parseTraceEvents`, `groupSteps`, `groupConsecutiveAgents`).
- Trace event types / payloads (no backend changes).
- Tree structure, expand/collapse behavior, running timers, candidate / felicity / search-query sub-panel structure.
- Dark mode: the site does not currently have a dark theme; we are not adding one.

## Files touched

- `frontend/src/components/chat/ToolCallsDisplay.tsx` — class swaps throughout; `SPEECH_ACT_LABELS` retoned.
- `frontend/src/components/ChatContent.tsx` — restructure the assistant message branch so `<ToolCallsDisplay>` is rendered outside the `max-w-[90%]` wrapper.
- `frontend/src/app/onboarding/page.tsx` — same restructure in the onboarding chat.

No new files, no dependency changes, no API changes.

## Testing

- Run `bun run lint` and `tsc --noEmit` in `frontend/`.
- Visual verification in browser (`bun run dev` at root, walk a chat session with a `discover_opportunities` call to see the full hierarchy, including running/streaming, error, stopped, and expanded step panels).
- Check both `/onboarding` and the main chat surface render the trace at full chat-column width and that the existing 90%-capped message body is unchanged.
