"""Hermes tool schemas for the Index Network plugin.

Schemas are the LLM-facing contract. Keep them specific about when to call each
native Hermes tool and what arguments are accepted.
"""

GUIDANCE_TOPICS = (
    "identity-context",
    "signals",
    "communities-networks",
    "opportunities",
    "negotiations",
    "workflows",
)


def _native_schema(name, description, properties, required):
    return {"name": f"index_{name}", "description": description,
            "parameters": {"type": "object", "additionalProperties": False,
                           "properties": properties, "required": required}}


_STRING = {"type": "string"}
# Setup only. The negotiator itself runs `@indexnetwork/agent` in its own
# process, so Hermes exposes no tools for reading matches, taking turns, or
# asking the owner questions — that logic is not reimplemented here.
NATIVE_AGENT_SCHEMAS = {
    "configure_personal_agent": _native_schema("configure_personal_agent", "Enable the Index personal agent on this machine for the already selected external Index agent. Binds this conversation as the owner's private channel and starts the negotiator; Index events then wake each signal as its matches move. Call when the owner asks Hermes to handle negotiations.", {"agentId": _STRING}, ["agentId"]),
    "focus_intent": _native_schema("focus_intent", "Point this conversation's later owner messages at one Index signal. The personal agent asks and answers here itself: never supply, invent, or paraphrase an answer in tool arguments.", {"intentId": _STRING}, ["intentId"]),
}

INDEX_READ_INTENTS = {
    "name": "index_read_intents",
    "description": (
        "Read Index Network intents/signals. Use this when the user asks what "
        "they are looking for, what signals they have, or what members of a "
        "specific network/community are seeking. With no parameters, returns "
        "the caller's own active intents. Pass networkId to browse the intents "
        "shared in a community the caller belongs to; pass query to match the "
        "caller's own intents by text."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "networkId": {
                "type": "string",
                "description": (
                    "Optional network UUID. When provided, reads the intents "
                    "shared in that network/community instead of the caller's own."
                ),
            },
            "query": {
                "type": "string",
                "description": "Optional text matched against the caller's own intents.",
            },
            "archived": {
                "type": "boolean",
                "description": "Include the caller's archived intents.",
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

INDEX_CREATE_INTENT = {
    "name": "index_create_intent",
    "description": (
        "Create one Index Network signal from the user's own words. The signal "
        "is shared in every community the caller belongs to unless networkIds "
        "narrows it. Only create a signal the user actually asked for."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": "What the user is looking for, in their own words.",
            },
            "networkIds": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional network UUIDs to share the signal in.",
            },
        },
        "required": ["description"],
    },
}

INDEX_UPDATE_INTENT = {
    "name": "index_update_intent",
    "description": (
        "Rewrite one of the caller's own signals and reprocess it. Use this when "
        "what the user is looking for has changed."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "intentId": {"type": "string", "description": "The signal's UUID."},
            "description": {"type": "string", "description": "The rewritten signal text."},
        },
        "required": ["intentId", "description"],
    },
}

INDEX_LIST_INTENT_NETWORKS = {
    "name": "index_list_intent_networks",
    "description": "List the communities one of the caller's signals is shared in.",
    "parameters": {
        "type": "object",
        "properties": {
            "intentId": {"type": "string", "description": "The signal's UUID."},
        },
        "required": ["intentId"],
    },
}

INDEX_ADD_INTENT_TO_NETWORK = {
    "name": "index_add_intent_to_network",
    "description": (
        "Share one of the caller's signals in a community they belong to. Read "
        "index_read_networks first if the network UUID is not already known."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "intentId": {"type": "string", "description": "The signal's UUID."},
            "networkId": {"type": "string", "description": "The community's UUID."},
        },
        "required": ["intentId", "networkId"],
    },
}

INDEX_READ_NETWORKS = {
    "name": "index_read_networks",
    "description": (
        "Read the communities the caller belongs to, with their titles and join "
        "policies. Use this to resolve a community name to its UUID."
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}

INDEX_READ_NETWORK_MEMBERSHIPS = {
    "name": "index_read_network_memberships",
    "description": (
        "Read one community's roster. The caller must be a current member."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "networkId": {"type": "string", "description": "The community's UUID."},
        },
        "required": ["networkId"],
    },
}

INDEX_CREATE_NETWORK = {
    "name": "index_create_network",
    "description": (
        "Create a community when the caller is eligible; otherwise this submits "
        "an early-access creation request on their behalf. The response says "
        "which of the two happened."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "The community's name."},
            "prompt": {"type": "string", "description": "Optional description of who belongs in it."},
        },
        "required": ["title"],
    },
}

INDEX_UPDATE_NETWORK = {
    "name": "index_update_network",
    "description": "Change a community's title or description. The caller must own it.",
    "parameters": {
        "type": "object",
        "properties": {
            "networkId": {"type": "string", "description": "The community's UUID."},
            "title": {"type": "string", "description": "The new name."},
            "prompt": {"type": "string", "description": "The new description."},
        },
        "required": ["networkId"],
    },
}

INDEX_JOIN_NETWORK = {
    "name": "index_join_network",
    "description": (
        "Join an open community on the caller's behalf. Invite-only communities "
        "refuse this and need an invitation instead."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "networkId": {"type": "string", "description": "The community's UUID."},
        },
        "required": ["networkId"],
    },
}

INDEX_LIST_OPPORTUNITIES = {
    "name": "index_list_opportunities",
    "description": (
        "Read the opportunities already discovered for the caller. This reviews "
        "persisted results; it does not start discovery."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "description": "Optional filter: pending, accepted, rejected, or expired.",
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "description": "Optional result limit from 1 to 100.",
            },
        },
        "required": [],
    },
}

INDEX_UPDATE_OPPORTUNITY = {
    "name": "index_update_opportunity",
    "description": (
        "Accept or reject an opportunity. Agent agreement is not owner approval: "
        "only send accepted after the user has explicitly confirmed it."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "opportunityId": {"type": "string", "description": "The opportunity's UUID."},
            "status": {
                "type": "string",
                "enum": ["accepted", "rejected"],
                "description": "The requested transition.",
            },
        },
        "required": ["opportunityId", "status"],
    },
}

INDEX_RESEARCH_PROFILE = {
    "name": "index_research_profile",
    "description": (
        "Research the owner's public identity and return a suggested profile "
        "without persisting it. Use this to prefill a profile for review."
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}

INDEX_READ_DOCS = {
    "name": "index_read_docs",
    "description": (
        "Read the Index protocol's canonical guidance. Call this with "
        "topic='workflows' when unsure how a sequence of Index calls should go."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "topic": {
                "type": "string",
                "enum": list(GUIDANCE_TOPICS),
                "description": "Optional topic. Omit for the summary and topic list.",
            },
        },
        "required": [],
    },
}

INDEX_AGENT_ME = {
    "name": "index_agent_me",
    "description": (
        "Return the Index Network agent the key's owner selected to handle "
        "negotiations. Use this when you need the agent id you are speaking as."
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
