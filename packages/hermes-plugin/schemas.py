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
    "research_profile",
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

INDEX_RESPOND_NEGOTIATION = {
    "name": "index_respond_negotiation",
    "description": (
        "OFFLINE -- always refuses. The negotiation-graph rewrite deleted the REST "
        "respond route this bridge submitted turns to, and external agents stay "
        "offline until they are rebuilt on the new auth model. Call it only to be "
        "told that; there is no turn to submit and no substitute tool."
    ),
    "parameters": {
        "type": "object",
        "additionalProperties": False,
        "properties": {},
        "required": [],
    },
}
