"""Tool handlers — what runs when the LLM calls each tool."""

import json


def hello_world(args: dict, **kwargs) -> str:
    """Return a friendly greeting.

    Hermes tool handlers should accept **kwargs for forward compatibility and
    return a JSON string for both success and error cases.
    """
    del kwargs
    name = str(args.get("name") or "World").strip() or "World"
    return json.dumps({"success": True, "greeting": f"Hello, {name}!"})
