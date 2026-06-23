---
name: index-orchestrator
description: Use in Hermes when the user asks to inspect Index Network signals/intents, reason about what they are looking for, or prepare next steps for Index Network discovery.
---

# Index Network — Hermes Orchestrator

{{CORE_GUIDANCE}}

## Hermes tool availability

This bundled Hermes skill is loaded from the `index-network` plugin namespace. The plugin provides:

- `index_read_intents` — a dedicated, validated wrapper for the Index MCP `read_intents` tool.
- `index_<mcp_tool_name>` wrappers for the rest of the Index MCP surface, such as `index_create_intent`, `index_read_networks`, `index_discover_opportunities`, `index_get_discovery_run`, `index_list_opportunities`, and `index_read_docs`.
- `index_agent_me` — reads the authenticated personal agent identity.
- `index_pickup_negotiation` and `index_respond_negotiation` — available when the task is specifically to run the user's autonomous Index negotiator.

Do not claim you created, updated, deleted, discovered, notified, or negotiated anything unless the corresponding tool response confirms the action. If unsure about arguments or workflow for a forwarded MCP wrapper, call `index_read_docs(topic="mcp_agent_guide")` first.

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

## Pattern 3: Prepare or save a signal

When the user wants to add or improve a signal:

1. Draft a concise signal description in plain text.
2. Ask for confirmation before creating, updating, or deleting a signal.
3. After confirmation, use `index_create_intent`, `index_update_intent`, or `index_delete_intent` as appropriate.
4. Report only what the tool response confirms.

Specificity test: a good signal names a domain, desired counterpart, concrete action, constraint, or timing. MCP agents should pass `autoApprove=true` when creating a confirmed signal because Hermes has no Index web-card UI.

## Pattern 4: Broader discovery requests

For requests like "find people who can help with X" or "who should I meet":

- First inspect existing signals with `index_read_intents` unless the user supplied a fresh search query directly.
- Use `index_discover_opportunities` for discovery and `index_get_discovery_run` when the response returns an async run id.
- Use `index_list_opportunities` to review existing actionable opportunities.

## Presentation rules

- Do not dump raw JSON unless the user asks for it.
- Mention counts, themes, and notable gaps.
- Never imply that a message, invite, connection, or opportunity was created unless a tool response confirms it.
