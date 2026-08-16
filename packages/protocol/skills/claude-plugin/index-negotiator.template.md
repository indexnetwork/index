---
name: index-negotiator
description: Use when the user asks about negotiations, pending turns, reviewing what their agent sent, accepting or declining a proposal, or countering an offer on Index Network.
---

# Index Network — Negotiator

{{CORE_GUIDANCE}}

## Scope

This skill covers human review and influence over agent-to-agent (A2A) negotiations. A2A acceptance is not owner approval: an agent-side accept can create a pending opportunity, but does not approve a connection or start human-to-human messaging. Owner approval happens through native opportunity-review surfaces, not this MCP workflow.

## Setup

On activation, verify that `list_negotiations` is callable.

If tools are unavailable:
- **OAuth (default):** call an Index tool. It challenges with OAuth on first use.
- **API key:** add `x-api-key` to the `index-network` MCP server config and reload.

---

## Pattern 1: List negotiations that need attention

When the user asks what needs review, call `list_negotiations` with `status: waiting_for_agent` and `detail: narrative`. For history, use `status: all` instead.

Present only returned facts: the negotiation ID, role, status, latest action/message preview, recent turns, and lifecycle. Do not invent a counterparty name from the ID or claim an opportunity or owner approval exists.

Ask which negotiation the user wants to review in detail.

## Pattern 2: Review a negotiation

When the user selects a negotiation, call `get_negotiation` with its negotiation ID. Explain the returned turn history, lifecycle, `seat`, `protocolVersion`, and `allowedActions`.

Only offer actions listed in `allowedActions`. Do not infer that `accept`, `reject`, `decline`, or any other action is available from the status alone.

## Pattern 3: Respond to a negotiation

**Always obtain explicit user confirmation before sending an A2A turn.**

1. Call `get_negotiation` immediately before acting to refresh `allowedActions`.
2. Explain the proposed action and its effect. Make clear that an agent-side accept only recommends a potential match and leaves any resulting opportunity pending owner review.
3. On confirmation, call `respond_to_negotiation` with an action included in `allowedActions`, factual reasoning, and appropriate `suggestedRoles`.
4. Include `message` when the chosen action is `counter` or `question`.
5. Report only the returned outcome.

## Notes

- Do not fabricate negotiation content, available actions, or approval state.
- Never send a turn without explicit user confirmation.
- If the negotiation is completed or `allowedActions` is empty, explain its returned status and do not offer a response.
- Use the exact action vocabulary returned by `get_negotiation`; legacy and v2 negotiations have different allowed actions.
