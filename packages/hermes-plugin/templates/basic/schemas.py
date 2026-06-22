"""Tool schemas — what the LLM sees."""

HELLO_WORLD = {
    "name": "hello_world",
    "description": "Return a friendly greeting for the provided name.",
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Name to greet.",
            },
        },
        "required": ["name"],
    },
}
