# Agent Negotiation Framing

**Date:** 2026-04-27

## Problem

Two places where opportunity results lack context about agent-to-agent negotiation:

1. **Ambient/digest updates** (Telegram etc.): The openclaw main-agent prompt doesn't instruct the agent to frame notifications as the result of background negotiation. The user sees "Seren looks relevant..." with no context about how this was discovered.
2. **Manual discovery** (MCP `create_opportunities`): When the user triggers discovery via chat, the tool response says "Found N potential connection(s)." with no mention that the system negotiated with other people's agents.

## Changes

### 1. Openclaw plugin ambient/digest prompt

**File:** `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`

Edit `perTypeInstruction()`:

- **`ambient_discovery`** case (lines 127-143): Add a framing instruction telling the agent to open with a brief line about how the user's Index agent has been negotiating with other agents in the background and these are the new possibilities it found.
- **`daily_digest`** case (lines 117-126): Similar framing appropriate for a daily summary of background negotiations.

The framing is an instruction to the agent (not hardcoded text), so the agent still speaks in its own voice.

### 2. MCP discovery tool response

**File:** `packages/protocol/src/opportunity/opportunity.tools.ts`

Edit `buildOpportunityPresentation()` (lines 171-205):

- For the MCP path (`isMcp=true`), update the summarization instruction (line 189) to tell the agent to frame results as coming from negotiation with other people's agents. Change from "Summarize these for the user in natural prose" to include framing like "Present these as connections your agent found by negotiating with other people's agents."
- The `leadIn` strings at call sites can stay as-is since the summarization instruction will provide the framing.

## Files to Change

- `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts` -- `perTypeInstruction()` function
- `packages/protocol/src/opportunity/opportunity.tools.ts` -- `buildOpportunityPresentation()` MCP summarization instruction
