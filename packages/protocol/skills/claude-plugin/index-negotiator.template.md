---
name: index-negotiator
description: Use when the user asks about negotiations, pending turns, reviewing what their agent sent, accepting or rejecting a proposal, or countering an offer on Index Network.
---

# Index Network — Negotiator

{{CORE_GUIDANCE}}

## Scope

This skill covers **human review and action** on negotiations. Silent autonomous negotiation turns (background agent responses) are handled by the user's personal agent, not this skill.

## Setup

On activation, verify MCP tools are available by checking `list_negotiations` is callable.

If tools are unavailable:
- **OAuth (default):** call any Index tool — it challenges with OAuth on first use.
- **API key:** add `"headers": {"x-api-key": "<key>"}` to the `index-network` MCP server config and reload.

---

## Pattern 1: List pending negotiations

When the user asks "what negotiations do I have?", "show my pending turns", "what's waiting for me?":

```
1. list_negotiations() → returns all negotiations
2. Filter for status "pending" (turns awaiting the user's action)
3. For each: show who proposed, what they proposed, and what your agent countered (if anything)
4. Ask: "Which one would you like to review in detail?"
```

Present each negotiation naturally — do not dump raw JSON. Include the other party's name, a brief summary of what's on the table, and the current status.

## Pattern 2: Review a specific negotiation

When the user names or picks a negotiation to review:

```
1. get_negotiation(negotiationId=...) → full turn history
2. Show:
   - What the other party proposed (latest turn from them)
   - What your agent responded (your latest turn, if any)
   - Current status
3. Ask: "Would you like to accept, reject, or counter?"
```

If the user doesn't know the negotiation ID: call `list_negotiations()` first and ask them to pick.

## Pattern 3: Respond to a negotiation

**Always confirm before sending.**

### Accept

```
1. get_negotiation(negotiationId=...) if not already loaded → confirm details
2. Tell the user: "I'll accept [brief summary of what's being accepted]. Confirm?"
3. On confirmation: respond_to_negotiation(negotiationId=..., action="accept", reasoning="why you're accepting", suggestedRoles={ownUser: "peer", otherUser: "peer"})
4. Report outcome
```

### Reject

```
1. Confirm: "I'll reject this proposal. Confirm?"
2. On confirmation: respond_to_negotiation(negotiationId=..., action="reject", reasoning="why you're rejecting", suggestedRoles={ownUser: "peer", otherUser: "peer"})
3. Report outcome
```

### Counter

```
1. Ask the user what they'd like to counter with (if not already stated)
2. Tell the user: "I'll send: '[their message]'. Confirm?"
3. On confirmation: respond_to_negotiation(negotiationId=..., action="counter", reasoning="why you're countering", suggestedRoles={ownUser: "peer", otherUser: "peer"}, message="user's message")
4. Report outcome
```

## Notes

- Do NOT take action (accept/reject/counter) without explicit user confirmation
- Do NOT fabricate negotiation content — only describe what `get_negotiation` returns
- If a negotiation is already accepted or closed, tell the user its status and do not offer action options
