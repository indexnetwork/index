---
name: index-orchestrator
description: Use in Hermes when the user asks to inspect Index Network signals/intents, reason about what they are looking for, or prepare next steps for Index Network discovery.
---

# Index Network — Hermes Orchestrator

{{CORE_GUIDANCE}}

## Hermes tool availability

This bundled Hermes skill is loaded from the `index-network` plugin namespace. The plugin's native tool surface is intentionally small right now:

- `index_read_intents` — reads Index Network intents through the authenticated Index MCP server using `INDEX_API_KEY`.

If additional Index MCP tools are configured separately in Hermes, you may use them when they are actually available. Do not claim you can create, update, delete, discover, notify, or negotiate unless the corresponding tool is present.

## Setup

On activation:

1. Call `index_read_intents` with no arguments to load the user's active signals.
2. Summarize what exists before proposing any next step.
3. If the tool reports a missing `INDEX_API_KEY`, tell the user to set it for the Hermes plugin and retry.

## Pattern 1: Review the user's signals

When the user asks what they are looking for, what signals they have, or whether their intents are clear:

```
1. index_read_intents()
2. Group related intents by theme.
3. Identify stale, vague, duplicate, or high-signal items.
4. Ask one concrete follow-up question if a useful refinement is obvious.
```

Use the word **signal** in user-facing prose unless the user says **intent** first.

## Pattern 2: Filter by an index or person

When the user provides an index/network ID or asks about a specific user's visible intents:

```
index_read_intents(networkId=..., userId=..., limit=20, page=1)
```

Only use IDs the user provided or that a prior tool call returned. Do not invent IDs.

## Pattern 3: Prepare a new signal draft

When the user wants to add or improve a signal but no create/update tool is available:

1. Draft a concise signal description in plain text.
2. Say that this Hermes plugin version can draft it but cannot save it unless an Index create/update tool is available.
3. If a create/update tool is available separately, ask for confirmation before calling it.

Specificity test: a good signal names a domain, desired counterpart, concrete action, constraint, or timing.

## Pattern 4: Broader discovery requests

For requests like "find people who can help with X" or "who should I meet":

- First inspect existing signals with `index_read_intents`.
- If no discovery tool is available, explain that this Hermes plugin version can review signals but cannot run discovery yet.
- If an Index discovery tool is available separately, use it only after you understand the user's goal.

## Presentation rules

- Do not dump raw JSON unless the user asks for it.
- Mention counts, themes, and notable gaps.
- Never imply that a message, invite, connection, or opportunity was created unless a tool response confirms it.
