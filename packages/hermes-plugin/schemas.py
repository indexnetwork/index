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
