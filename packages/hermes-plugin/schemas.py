"""Hermes tool schemas for the Index Network plugin.

Schemas are the LLM-facing contract. Keep them specific about when to call each
native Hermes tool and what arguments are accepted.
"""

INDEX_READ_INTENTS = {
    "name": "index_read_intents",
    "description": (
        "Read Index Network intents/signals through the authenticated Index MCP "
        "server. Use this when the user asks what they are looking for, what "
        "signals they have, or what members of a specific network/community are "
        "seeking. With no parameters, returns the caller's own active intents. "
        "Pass networkId to browse intents in an Index the caller can access; "
        "pass userId to filter to one user where the network scope allows it."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "networkId": {
                "type": "string",
                "description": (
                    "Optional network UUID. When provided, reads intents "
                    "in that network/community."
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

FORWARDED_MCP_TOOLS = (
    "register_agent",
    "list_agents",
    "update_agent",
    "delete_agent",
    "grant_agent_permission",
    "revoke_agent_permission",
    "list_conversations",
    "get_conversation",
    "import_contacts",
    "list_contacts",
    "add_contact",
    "remove_contact",
    "search_contacts",
    "read_user_contexts",
    "record_onboarding_privacy_consent",
    "preview_user_context",
    "confirm_user_context",
    "create_user_context",
    "update_user_context",
    "get_enrichment_run",
    "cancel_enrichment_run",
    "complete_onboarding",
    "import_gmail_contacts",
    "create_intent",
    "update_intent",
    "delete_intent",
    "create_intent_index",
    "read_intent_indexes",
    "delete_intent_index",
    "search_intents",
    "list_negotiations",
    "get_negotiation",
    "respond_to_negotiation",
    "read_networks",
    "read_network_memberships",
    "update_network",
    "create_network",
    "delete_network",
    "create_network_membership",
    "delete_network_membership",
    "discover_opportunities",
    "get_discovery_run",
    "cancel_discovery_run",
    "list_opportunities",
    "update_opportunity",
    "confirm_opportunity_delivery",
    "create_premise",
    "read_premises",
    "update_premise",
    "retract_premise",
    "read_pending_questions",
    "scrape_url",
    "read_docs",
)


def forwarded_mcp_schema(tool_name: str) -> dict:
    """Build a Hermes schema for a pass-through Index MCP tool wrapper."""
    return {
        "name": f"index_{tool_name}",
        "description": (
            f"Call the Index MCP `{tool_name}` tool with the provided JSON arguments. "
            "Use this for Index capabilities that do not have a dedicated Hermes-native wrapper. "
            "If unsure about arguments or workflow, call index_read_docs with topic='mcp_agent_guide' first."
        ),
        "parameters": {
            "type": "object",
            "description": f"Arguments passed directly to the Index MCP `{tool_name}` tool.",
            "additionalProperties": True,
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
