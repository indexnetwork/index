"""Smoke tests for the Index Network Hermes plugin."""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PYTHON_FILES = ["__init__.py", "schemas.py", "tools.py"]
DASHBOARD_FILES = [
    "dashboard/manifest.json",
    "dashboard/dist/index.js",
    "dashboard/dist/style.css",
]


class FakeContext:
    def __init__(self) -> None:
        self.tools = []
        self.skills = []
        self.hooks = []
        self.commands = []

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)

    def register_skill(self, name, skill_md):
        self.skills.append((name, skill_md))

    def register_hook(self, name, handler):
        self.hooks.append((name, handler))

    def register_command(self, name, handler, description="", args_hint=""):
        self.commands.append((name, handler, description, args_hint))


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


class FakeResponse:
    def __init__(self, payload=None, *, status=200, headers=None):
        self.payload = payload
        self.status = status
        self.code = status
        self.headers = headers or {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        if self.payload is None:
            return b""
        if isinstance(self.payload, bytes):
            return self.payload
        return json.dumps(self.payload).encode()


def install_fake_urlopen(responses, captured):
    queue = list(responses)

    def fake_urlopen(request, timeout):
        captured.append(
            {
                "timeout": timeout,
                "url": request.full_url,
                "method": request.get_method(),
                "headers": dict(request.header_items()),
                "body": None if request.data is None else json.loads(request.data.decode()),
            }
        )
        if not queue:
            raise AssertionError("Unexpected urlopen call")
        response = queue.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    urllib.request.urlopen = fake_urlopen
    return queue


def main() -> None:
    for relative_path in PYTHON_FILES:
        source = (ROOT / relative_path).read_text()
        ast.parse(source, filename=relative_path)

    plugin = load_plugin()
    ctx = FakeContext()
    plugin.register(ctx)
    assert set(plugin.schemas.FORWARDED_MCP_TOOLS) == plugin.tools._FORWARDED_MCP_TOOLS

    tool_names = [entry["name"] for entry in ctx.tools]
    expected_tool_names = (
        ["index_read_intents"]
        + [f"index_{name}" for name in plugin.schemas.FORWARDED_MCP_TOOLS]
        + ["index_agent_me", "index_pickup_negotiation", "index_respond_negotiation"]
    )
    assert tool_names == expected_tool_names, tool_names
    assert len(tool_names) == len(set(tool_names))
    assert "index_create_intent" in tool_names
    assert "index_discover_opportunities" in tool_names
    assert "index_read_docs" in tool_names
    assert [entry["schema"]["name"] for entry in ctx.tools] == tool_names
    handlers_by_name = {entry["name"]: entry["handler"] for entry in ctx.tools}
    assert handlers_by_name["index_read_intents"] == plugin.tools.index_read_intents
    assert handlers_by_name["index_agent_me"] == plugin.tools.index_agent_me
    assert handlers_by_name["index_pickup_negotiation"] == plugin.tools.index_pickup_negotiation
    assert handlers_by_name["index_respond_negotiation"] == plugin.tools.index_respond_negotiation
    assert handlers_by_name["index_create_intent"].__name__ == "index_create_intent"

    manifest_tools = []
    in_tools = False
    for line in (ROOT / "plugin.yaml").read_text().splitlines():
        if line == "provides_tools:":
            in_tools = True
            continue
        if in_tools and line and not line.startswith("  - "):
            break
        if in_tools and line.startswith("  - "):
            manifest_tools.append(line.removeprefix("  - "))
    assert manifest_tools == tool_names

    for relative_path in DASHBOARD_FILES:
        assert (ROOT / relative_path).exists(), f"missing dashboard file: {relative_path}"

    dashboard_manifest = json.loads((ROOT / "dashboard" / "manifest.json").read_text())
    assert dashboard_manifest["name"] == "index-network"
    assert dashboard_manifest["label"] == "Index Network"
    assert dashboard_manifest["entry"] == "dist/index.js"
    assert dashboard_manifest["css"] == "dist/style.css"
    assert "api" not in dashboard_manifest
    assert dashboard_manifest["tab"]["path"] == "/index-network"
    for key in ("entry", "css"):
        assert (ROOT / "dashboard" / dashboard_manifest[key]).exists(), dashboard_manifest[key]
    assert not (ROOT / "dashboard" / "plugin_api.py").exists()

    dashboard_js_path = ROOT / "dashboard" / "dist" / "index.js"
    subprocess.run(["node", "--check", str(dashboard_js_path)], check=True)
    dashboard_js = dashboard_js_path.read_text()
    assert 'register("index-network"' in dashboard_js
    assert "Static read-only" in dashboard_js
    assert "Static-only" in dashboard_js
    assert "Signals" in dashboard_js
    assert "communities" in dashboard_js
    assert "internal identifiers" in dashboard_js
    assert "raw records" in dashboard_js
    assert "/api/" + "plugins/" not in dashboard_js
    assert "SDK.fetchJSON" not in dashboard_js
    assert "Live read-only" not in dashboard_js
    assert "raw JSON" not in dashboard_js
    assert "tool_call" not in dashboard_js
    assert "intentId" not in dashboard_js
    assert "networkId" not in dashboard_js
    assert "opportunityId" not in dashboard_js
    assert "index_pickup_negotiation" not in dashboard_js
    assert "index_respond_negotiation" not in dashboard_js



    dashboard_readme = (ROOT / "dashboard" / "README.md").read_text()
    package_readme = (ROOT / "README.md").read_text()
    assert "static and read-only" in dashboard_readme
    assert "mount Python backend routes" in dashboard_readme
    assert "Live dashboard routes are deliberately deferred" in dashboard_readme
    assert "../tools.py" in dashboard_readme
    assert "static-only" in package_readme
    assert "never calls live Index APIs" in package_readme
    assert "tools.py" in package_readme
    forbidden_api_path = "dashboard/" + "plugin_api.py"
    assert forbidden_api_path not in package_readme

    assert [name for name, _path in ctx.skills] == ["index-negotiator", "index-orchestrator"]
    for _name, skill_md in ctx.skills:
        assert pathlib.Path(skill_md).name == "SKILL.md"
        assert pathlib.Path(skill_md).exists()

    assert len(ctx.hooks) == 1
    hook_name, hook = ctx.hooks[0]
    assert hook_name == "pre_llm_call"
    assert 'skill_view("index-network:index-orchestrator")' in hook(user_message="Show my Index Network intents")
    assert hook(user_message="What is the weather?") is None
    assert hook(user_message="I am looking for a cofounder") is None
    assert hook({"message": "I am looking for a cofounder signal"}) is not None
    assert [name for name, _handler, _description, _args_hint in ctx.commands] == ["index"]
    assert ctx.commands[0][2] == "Load Index Network orchestrator guidance"
    assert 'skill_view("index-network:index-orchestrator")' in ctx.commands[0][1]()

    old_api_key = os.environ.pop("INDEX_API_KEY", None)
    old_api_url = os.environ.pop("INDEX_API_URL", None)
    old_urlopen = urllib.request.urlopen
    try:
        missing_key = json.loads(plugin.tools.index_read_intents({}))
        assert missing_key["success"] is False
        assert "INDEX_API_KEY" in missing_key["error"]

        missing_key_api = json.loads(plugin.tools.index_agent_me({}))
        assert missing_key_api["success"] is False
        assert "INDEX_API_KEY" in missing_key_api["error"]

        invalid_limit = json.loads(plugin.tools.index_read_intents({"limit": 101}))
        assert invalid_limit == {"success": False, "error": "limit must be at most 100."}

        captured = []
        install_fake_urlopen(
            [
                FakeResponse(
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
                )
            ],
            captured,
        )
        os.environ["INDEX_API_KEY"] = "test-key"
        ok = json.loads(plugin.tools.index_read_intents({"limit": 10, "page": 1}))
        assert ok == {"success": True, "data": {"intents": [], "count": 0}}
        assert captured[-1]["body"]["method"] == "tools/call"
        assert captured[-1]["body"]["params"] == {"name": "read_intents", "arguments": {"limit": 10, "page": 1}}
        assert captured[-1]["headers"]["X-api-key"] == "test-key"

        captured = []
        install_fake_urlopen(
            [
                FakeResponse(
                    {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps({"success": True, "intentId": "intent-1"}),
                                }
                            ]
                        },
                    }
                )
            ],
            captured,
        )
        create_intent = handlers_by_name["index_create_intent"]
        created = json.loads(create_intent({"description": "Find robotics mentors", "autoApprove": True}))
        assert created == {"success": True, "intentId": "intent-1"}
        assert captured[-1]["body"]["params"] == {
            "name": "create_intent",
            "arguments": {"description": "Find robotics mentors", "autoApprove": True},
        }
        assert json.loads(create_intent([])) == {"success": False, "error": "Arguments must be an object."}

        os.environ["INDEX_API_URL"] = "https://api.example.test/api"
        captured = []
        install_fake_urlopen([FakeResponse({"agent": {"id": "agent-1", "name": "Hermes"}})], captured)
        me = json.loads(plugin.tools.index_agent_me({}))
        assert me == {"success": True, "agent": {"id": "agent-1", "name": "Hermes"}}
        assert captured[-1]["method"] == "GET"
        assert captured[-1]["url"] == "https://api.example.test/api/agents/me"
        assert captured[-1]["headers"]["X-api-key"] == "test-key"

        captured = []
        install_fake_urlopen([FakeResponse(None, status=204)], captured)
        pickup_empty = json.loads(plugin.tools.index_pickup_negotiation({"agentId": "agent-1"}))
        assert pickup_empty == {"success": True, "pending": False}
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == "https://api.example.test/api/agents/agent-1/negotiations/pickup"

        captured = []
        pending_payload = {"negotiationId": "neg-1", "turn": {"counterpartyAction": "propose"}}
        install_fake_urlopen([FakeResponse({"agent": {"id": "agent-2"}}), FakeResponse(pending_payload)], captured)
        pickup_pending = json.loads(plugin.tools.index_pickup_negotiation({}))
        assert pickup_pending == {
            "success": True,
            "pending": True,
            "negotiationId": "neg-1",
            "turn": {"counterpartyAction": "propose"},
        }
        assert [entry["url"] for entry in captured] == [
            "https://api.example.test/api/agents/me",
            "https://api.example.test/api/agents/agent-2/negotiations/pickup",
        ]

        captured = []
        install_fake_urlopen([FakeResponse({"success": True, "status": "recorded"})], captured)
        response = json.loads(
            plugin.tools.index_respond_negotiation(
                {
                    "agentId": "agent-1",
                    "negotiationId": "neg-1",
                    "action": "counter",
                    "message": "Could we clarify timing first?",
                    "reasoning": "The opportunity is promising but timing is unclear.",
                    "suggestedRoles": {"ownUser": "agent", "otherUser": "peer"},
                }
            )
        )
        assert response == {"success": True, "status": "recorded"}
        assert captured[-1]["url"] == "https://api.example.test/api/agents/agent-1/negotiations/neg-1/respond"
        assert captured[-1]["body"] == {
            "action": "counter",
            "message": "Could we clarify timing first?",
            "assessment": {
                "reasoning": "The opportunity is promising but timing is unclear.",
                "suggestedRoles": {"ownUser": "agent", "otherUser": "peer"},
            },
        }

        assert json.loads(plugin.tools.index_respond_negotiation({"agentId": "agent-1"})) == {
            "success": False,
            "error": "negotiationId is required.",
        }
        assert json.loads(
            plugin.tools.index_respond_negotiation(
                {
                    "agentId": "agent-1",
                    "negotiationId": "neg-1",
                    "action": "pause",
                    "reasoning": "No valid action.",
                    "suggestedRoles": {"ownUser": "agent", "otherUser": "peer"},
                }
            )
        ) == {"success": False, "error": "action must be one of: propose, accept, reject, counter, question."}
        assert json.loads(
            plugin.tools.index_respond_negotiation(
                {
                    "agentId": "agent-1",
                    "negotiationId": "neg-1",
                    "action": "question",
                    "reasoning": "Need more context.",
                    "suggestedRoles": {"ownUser": "agent", "otherUser": "peer"},
                }
            )
        ) == {"success": False, "error": "message is required for counter and question actions."}
    finally:
        urllib.request.urlopen = old_urlopen
        if old_api_key is not None:
            os.environ["INDEX_API_KEY"] = old_api_key
        else:
            os.environ.pop("INDEX_API_KEY", None)
        if old_api_url is not None:
            os.environ["INDEX_API_URL"] = old_api_url
        else:
            os.environ.pop("INDEX_API_URL", None)


if __name__ == "__main__":
    main()
