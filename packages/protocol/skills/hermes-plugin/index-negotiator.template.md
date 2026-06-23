---
name: index-negotiator
description: Use in Hermes when the user asks about Index Network negotiations, pending turns, proposal review, acceptance, rejection, or counters.
---

# Index Network — Hermes Negotiator

{{CORE_GUIDANCE}}

## Scope

This skill covers **human review and action** on Index Network negotiations from Hermes.

The current `index-network` Hermes plugin may not expose negotiation tools natively. Before taking action, verify that negotiation tools are actually available in the current Hermes session.

Expected tool names, when configured through the full Index MCP surface, are:

- `list_negotiations`
- `get_negotiation`
- `respond_to_negotiation`

If those tools are not available, say that this Hermes plugin version can explain the negotiation workflow but cannot read or change negotiations from the current session.

## Pattern 1: List pending negotiations

When the user asks "what negotiations do I have?", "show my pending turns", or "what's waiting for me?":

```
1. Confirm `list_negotiations` is available.
2. list_negotiations()
3. Filter for status "pending" or turns awaiting the user's action.
4. Show who proposed, what is proposed, and current status.
5. Ask which one they want to review.
```

Present negotiations naturally. Do not dump raw JSON unless asked.

## Pattern 2: Review a specific negotiation

When the user names or picks a negotiation:

```
1. get_negotiation(negotiationId=...)
2. Show the latest proposal, the user's or agent's latest response, and current status.
3. Ask whether the user wants to accept, reject, or counter.
```

If the user does not know the ID, list negotiations first.

## Pattern 3: Respond to a negotiation

Always confirm before sending a response.

### Accept

```
1. Confirm the proposal details from get_negotiation.
2. Ask: "I'll accept [brief summary]. Confirm?"
3. On confirmation: respond_to_negotiation(action="accept", ...)
4. Report only what the tool confirms.
```

### Reject

```
1. Confirm which proposal is being rejected.
2. Ask for confirmation.
3. On confirmation: respond_to_negotiation(action="reject", ...)
4. Report only what the tool confirms.
```

### Counter

```
1. Ask what counter the user wants to send.
2. Restate it and ask for confirmation.
3. On confirmation: respond_to_negotiation(action="counter", message=...)
4. Report only what the tool confirms.
```

## Safety rules

- Do not accept, reject, or counter without explicit user confirmation.
- Do not fabricate proposal details.
- Do not claim that a notification, message, contact, or opportunity was created unless a tool response confirms it.
- If tools are unavailable, stop at explanation or draft preparation.
