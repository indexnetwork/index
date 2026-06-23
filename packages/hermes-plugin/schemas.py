"""Hermes tool schemas for the Index Network plugin.

Schemas are the LLM-facing contract. Keep them specific about when to call each
native Hermes tool and what arguments are accepted.
"""

INDEX_READ_INTENTS = {
    "name": "index_read_intents",
    "description": (
        "Read Index Network intents/signals through the authenticated Index MCP "
        "server. Use this when the user asks what they are looking for, what "
        "signals they have, or what members of a specific Index/community are "
        "seeking. With no parameters, returns the caller's own active intents. "
        "Pass networkId to browse intents in an Index the caller can access; "
        "pass userId to filter to one user where the Index scope allows it."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "networkId": {
                "type": "string",
                "description": (
                    "Optional Index/network UUID. When provided, reads intents "
                    "in that Index/community."
                ),
            },
            "userId": {
                "type": "string",
                "description": (
                    "Optional user UUID. Filters to one user's intents when the "
                    "authenticated Index agent is allowed to read them."
                ),
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "description": "Optional page size from 1 to 100.",
            },
            "page": {
                "type": "integer",
                "minimum": 1,
                "description": "Optional 1-based page number. Used with limit.",
            },
        },
        "required": [],
    },
}

INDEX_AGENT_ME = {
    "name": "index_agent_me",
    "description": (
        "Return the authenticated Index Network personal agent bound to the "
        "configured INDEX_API_KEY. Use this before autonomous negotiation when "
        "you need the agent id or want to verify the key is agent-bound."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

INDEX_PICKUP_NEGOTIATION = {
    "name": "index_pickup_negotiation",
    "description": (
        "Poll Index Network for one pending negotiation turn assigned to this "
        "personal agent and claim it if present. Use this in autonomous/scheduled "
        "negotiator runs before deciding whether to respond. If pending is false, "
        "there is no work and the run should stay silent."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agentId": {
                "type": "string",
                "description": (
                    "Optional personal agent UUID. Omit to resolve it from "
                    "/agents/me using the configured agent-bound API key."
                ),
            },
        },
        "required": [],
    },
}

INDEX_RESPOND_NEGOTIATION = {
    "name": "index_respond_negotiation",
    "description": (
        "Respond to a claimed Index Network negotiation turn as the user's "
        "personal agent. Use after index_pickup_negotiation returns pending=true. "
        "Choose one action, provide concise reasoning, and include suggested "
        "roles for both sides."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agentId": {
                "type": "string",
                "description": (
                    "Optional personal agent UUID. Omit to resolve it from "
                    "/agents/me using the configured agent-bound API key."
                ),
            },
            "negotiationId": {
                "type": "string",
                "description": "Required negotiation UUID returned by index_pickup_negotiation.",
            },
            "action": {
                "type": "string",
                "enum": ["propose", "accept", "reject", "counter", "question"],
                "description": (
                    "One negotiation response action. Use counter to propose a "
                    "modified introduction, question to ask for missing context, "
                    "accept/reject for final decisions, or propose for an initial proposal."
                ),
            },
            "message": {
                "type": "string",
                "description": (
                    "Optional human-readable message. Required for counter and "
                    "question actions; recommended whenever the decision needs explanation."
                ),
            },
            "reasoning": {
                "type": "string",
                "description": "Required private rationale for the assessment and chosen action.",
            },
            "suggestedRoles": {
                "type": "object",
                "description": "Required role assessment for the caller and counterparty.",
                "properties": {
                    "ownUser": {
                        "type": "string",
                        "enum": ["agent", "patient", "peer"],
                        "description": "Suggested role for the user's side of the opportunity.",
                    },
                    "otherUser": {
                        "type": "string",
                        "enum": ["agent", "patient", "peer"],
                        "description": "Suggested role for the counterparty's side of the opportunity.",
                    },
                },
                "required": ["ownUser", "otherUser"],
            },
        },
        "required": ["negotiationId", "action", "reasoning", "suggestedRoles"],
    },
}
