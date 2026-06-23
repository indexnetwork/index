"""Smoke tests for the Index Network Hermes plugin."""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PYTHON_FILES = ["__init__.py", "schemas.py", "tools.py"]


class FakeContext:
    def __init__(self) -> None:
        self.tools = []
        self.skills = []

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)

    def register_skill(self, name, skill_md):
        self.skills.append((name, skill_md))


def load_plugin():
    spec = importlib.util.spec_from_file_location(
        "index_network_hermes_plugin",
        ROOT / "__init__.py",
        submodule_search_locations=[str(ROOT)],
    )
    if spec is None or spec.loader is None:
        raise AssertionError("Could not create import spec for plugin")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    for relative_path in PYTHON_FILES:
        source = (ROOT / relative_path).read_text()
        ast.parse(source, filename=relative_path)

    plugin = load_plugin()
    ctx = FakeContext()
    plugin.register(ctx)

    tool_names = [entry["name"] for entry in ctx.tools]
    assert tool_names == ["index_read_intents"], tool_names
    assert ctx.tools[0]["schema"]["name"] == "index_read_intents"
    assert callable(ctx.tools[0]["handler"])

    old_api_key = os.environ.pop("INDEX_API_KEY", None)
    old_urlopen = urllib.request.urlopen
    try:
        missing_key = json.loads(plugin.tools.index_read_intents({}))
        assert missing_key["success"] is False
        assert "INDEX_API_KEY" in missing_key["error"]

        invalid_limit = json.loads(plugin.tools.index_read_intents({"limit": 101}))
        assert invalid_limit == {"success": False, "error": "limit must be at most 100."}

        class FakeResponse:
            headers = {"Content-Type": "application/json"}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                return json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps({"success": True, "data": {"intents": [], "count": 0}}),
                                }
                            ]
                        },
                    }
                ).encode()

        captured = {}

        def fake_urlopen(request, timeout):
            captured["timeout"] = timeout
            captured["headers"] = dict(request.header_items())
            captured["body"] = json.loads(request.data.decode())
            return FakeResponse()

        urllib.request.urlopen = fake_urlopen
        os.environ["INDEX_API_KEY"] = "test-key"
        ok = json.loads(plugin.tools.index_read_intents({"limit": 10, "page": 1}))
        assert ok == {"success": True, "data": {"intents": [], "count": 0}}
        assert captured["body"]["method"] == "tools/call"
        assert captured["body"]["params"] == {"name": "read_intents", "arguments": {"limit": 10, "page": 1}}
        assert captured["headers"]["X-api-key"] == "test-key"
    finally:
        urllib.request.urlopen = old_urlopen
        if old_api_key is not None:
            os.environ["INDEX_API_KEY"] = old_api_key
        else:
            os.environ.pop("INDEX_API_KEY", None)


if __name__ == "__main__":
    main()
