# Fix: OpenClaw Agent Not Using Index Network Tools for Discovery

**Date:** 2026-04-24
**Status:** Proposed
**Scope:** `packages/protocol/skills/openclaw/SKILL.md.template`, `packages/openclaw-plugin/skills/index-network/SKILL.md`

## Problem

Agents running the OpenClaw plugin default to web search (Google, Bing) when users ask to find people, instead of using Index Network's `create_opportunities` tool. The agent doesn't load user context on session start and doesn't know when or how to use Index tools.

### Evidence (from real conversation)

1. User: "find people building AI agents in NYC" → Agent googles meetups instead of calling `create_opportunities(searchQuery="people building AI agents in NYC")`
2. User: "looking for consumer AI investors in brooklyn" → Agent scrapes Google/Bing for VC lists instead of using Index discovery
3. User has to explicitly say "use index" before the agent tries the MCP tools
4. Even then, the agent fumbles through MCP configuration issues instead of calling tools directly

### Root Cause

The OpenClaw skill is **bootstrap-only**. After MCP setup it says:

> "Do NOT duplicate or restate the MCP server's behavioral guidance here — the MCP server's own `instructions` carry voice, vocabulary, entity model, discovery-first rule, and output rules. Follow those."

But `MCP_INSTRUCTIONS` (in `packages/protocol/src/mcp/mcp.server.ts`) is a ~40-line contract about voice/vocabulary/entity model — it contains **zero workflow patterns**. The per-tool descriptions do contain hints like "discovery-first rule", but the agent needs to already know which tool to call to read its description. Chicken-and-egg problem.

**Comparison:** The Claude plugin's `index-orchestrator` skill has ~160 lines of orchestration guidance (Setup + Patterns 0-7) that tell the agent exactly when to use which tool. The OpenClaw plugin has none of this.

## Proposed Solution

Add a post-bootstrap orchestration section to `packages/protocol/skills/openclaw/SKILL.md.template` that mirrors the Claude plugin's patterns, adapted for OpenClaw.

### 1. Update Detect routing

Change the "Both YES" route from "Stop reading this file" to "Skip to **Index Network — using the tools** below."

### 2. Add "Index Network — using the tools" section after Handoff

This section applies to **every conversation**, not just bootstrap.

#### Session start

At the start of every new conversation, the agent should silently call (no raw output to user):

1. `read_docs(topic="mcp_agent_guide")` — learn output formatting and workflow rules
2. `read_user_profiles` — load the user's profile
3. `read_intents` — load their active signals
4. `read_network_memberships` — load community memberships (note `isPersonal: true` for contacts index)

#### Discovery-first rule

For ANY request about finding people, connections, investors, collaborators, co-founders, mentors, or introductions — ALWAYS use `create_opportunities` FIRST. Never default to web search.

Only fall back to web search if:
- Index returns no results AND the user explicitly asks for broader results, OR
- The request is clearly not about people

#### Workflow patterns

| User intent | Tool to call | Notes |
|---|---|---|
| Find a specific person by name | `read_user_profiles(query="name")` | If no match, offer discovery |
| Open-ended discovery ("find me investors", "who's building X") | `create_opportunities(searchQuery="...")` | Do NOT create intent for these |
| Save/create a signal (user explicitly says "save", "create", "remember") | `create_intent(description="...", autoApprove=true)` | Always `autoApprove: true` |
| URL shared with a request | `scrape_url(url)` then `create_intent` or `create_opportunities` | Scrape first, then route |
| Add a contact | `add_contact(email, name)` | |
| Import contacts | `import_contacts(contacts=[...])` | |
| Browse communities | `read_networks()` → `read_intents(networkId)` | Use preloaded memberships first |

#### MCP agent output rules

- Never dump raw JSON — synthesize in natural language
- Never reference "cards", "panels", or web UI elements
- Present opportunities with counterpart name, match reasoning, and next steps
- Use `autoApprove: true` on all `create_intent` calls

### 3. Rebuild generated skills

Run `bun scripts/build-skills.ts` to regenerate `packages/openclaw-plugin/skills/index-network/SKILL.md`.

## Files to Change

- `packages/protocol/skills/openclaw/SKILL.md.template` — add orchestration section
- `packages/openclaw-plugin/skills/index-network/SKILL.md` — auto-generated from template

## Design Decisions

- **Keep patterns in the OpenClaw template, not `core-guidance.partial.md`** — The Claude plugin already has its own version (Patterns 0-7) with different interaction assumptions. The two runtimes have different context window constraints and interaction models.
- **Shorter than Claude version** — OpenClaw agents may have tighter context windows. Focus on decision trees (when to use which tool) rather than full call signatures with all parameters.
- **`autoApprove: true` emphasis** — OpenClaw agents operate via API tools with no UI for proposal approval. This must be explicit.

## Test Plan

- [ ] Deploy updated skill to an OpenClaw agent
- [ ] New conversation: verify agent silently loads context (profiles, intents, memberships)
- [ ] "find people building AI agents in NYC" → verify `create_opportunities` is called, not web search
- [ ] "save a signal for AI agent builders" → verify `create_intent(autoApprove=true)` is called
- [ ] "looking for consumer AI investors in brooklyn" → verify `create_opportunities` is called
- [ ] Verify agent does NOT create intents for open-ended discovery requests
