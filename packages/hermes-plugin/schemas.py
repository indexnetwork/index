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
    "read_user_contexts",
    "preview_user_context",
    "confirm_user_context",
    "create_user_context",
    "update_user_context",
    "get_enrichment_run",
    "cancel_enrichment_run",
    "create_intent",
    "update_intent",
    "create_intent_index",
    "read_intent_indexes",
    "search_intents",
    "list_negotiations",
    "get_negotiation",
    "respond_to_negotiation",
    "read_networks",
    "read_network_memberships",
    "update_network",
    "create_network",
    "create_network_membership",
    "list_opportunities",
    "update_opportunity",
    "confirm_opportunity_delivery",
    "create_premise",
    "read_premises",
    "update_premise",
    "retract_premise",
    "read_pending_questions",
    "read_activity_summary",
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
        "configured API key. Use this before autonomous negotiation when "
        "you need the agent id or want to verify the connection is agent-bound."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

INDEX_OPEN_APP = {
    "name": "index_open_app",
    "description": (
        "Open an Index Network universal link (https://index.network/...) with the "
        "operating system's default handler. Use this when the user asks to open "
        "Index, an opportunity, or a profile on this machine — for example with the "
        "appUrl returned on opportunities by index_list_opportunities. The link "
        "opens the Index macOS app when it is installed and the Index web page "
        "otherwise; only index.network URLs are accepted."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "target": {
                "type": "string",
                "description": (
                    "Optional https://index.network URL to open, such as an "
                    "opportunity appUrl. Defaults to https://index.network."
                ),
            },
        },
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
        "Consume this scheduled pass by submitting one closed response for the "
        "negotiation returned by index_pickup_negotiation. The server selects "
        "the protocol action and shared prose from fixed templates."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
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
                "enum": ["accept", "decline", "request_time", "continue"],
                "description": (
                    "One closed directive copied from the pickup response's allowedActions. "
                    "No model-authored shared message is accepted."
                ),
            },
            "roleAlignment": {
                "type": "string",
                "enum": ["peers", "owner_leads", "counterparty_leads"],
                "description": "Closed role alignment used to derive protocol roles.",
            },
        },
        "required": ["negotiationId", "action", "roleAlignment"],
    },
}

INDEX_CONSULT_OWNER = {
    "name": "index_consult_owner",
    "description": (
        "Pause one eligible claimed negotiation turn and ask the owning user a "
        "privacy-minimal question. Use only when pickup returns canConsultOwner=true. "
        "A successful consultation ends this autonomous pass; do not also respond."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
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
            "reason": {
                "type": "string",
                "enum": [
                    "consequential_disclosure_permission",
                    "repeated_non_convergence",
                    "insufficient_commitment_authority",
                    "unresolved_owner_constraint",
                ],
                "description": (
                    "Required closed server consultation category. The server "
                    "must independently derive the same category for this claim."
                ),
            },
        },
        "required": ["negotiationId", "reason"],
    },
}
