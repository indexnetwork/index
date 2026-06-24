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
PYTHON_FILES = ["__init__.py", "schemas.py", "tools.py", "dashboard/plugin_api.py"]
DASHBOARD_FILES = [
    "dashboard/manifest.json",
    "dashboard/dist/index.js",
    "dashboard/dist/style.css",
    "dashboard/plugin_api.py",
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


def load_dashboard_api():
    spec = importlib.util.spec_from_file_location(
        "index_network_dashboard_api",
        ROOT / "dashboard" / "plugin_api.py",
    )
    if spec is None or spec.loader is None:
        raise AssertionError("Could not create import spec for dashboard API")
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


def mcp_text_response(payload, *, response_id=1):
    return FakeResponse(
        {
            "jsonrpc": "2.0",
            "id": response_id,
            "result": {"content": [{"type": "text", "text": json.dumps(payload)}]},
        }
    )


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
    assert dashboard_manifest["api"] == "plugin_api.py"
    assert dashboard_manifest["tab"]["path"] == "/index-network"
    for key in ("entry", "css", "api"):
        assert (ROOT / "dashboard" / dashboard_manifest[key]).exists(), dashboard_manifest[key]

    dashboard_js_path = ROOT / "dashboard" / "dist" / "index.js"
    subprocess.run(["node", "--check", str(dashboard_js_path)], check=True)
    dashboard_js = dashboard_js_path.read_text()
    assert 'register("index-network"' in dashboard_js
    assert "Live read-only" in dashboard_js
    assert "Intents" in dashboard_js
    assert "Opportunities" in dashboard_js
    assert "Negotiation activity" in dashboard_js
    assert "Networks" in dashboard_js
    assert "/api/" + "plugins/index-network" in dashboard_js
    assert "SDK.fetchJSON" in dashboard_js
    assert "index_pickup_negotiation" not in dashboard_js
    assert "index_respond_negotiation" not in dashboard_js

    dashboard_readme = (ROOT / "dashboard" / "README.md").read_text()
    package_readme = (ROOT / "README.md").read_text()
    assert "live and read-only" in dashboard_readme
    assert "dashboard/plugin_api.py" in dashboard_readme
    assert "../tools.py" in dashboard_readme
    assert "claim pending negotiation turns" in dashboard_readme
    assert "live read-only" in package_readme
    assert "dashboard/plugin_api.py" in package_readme
    assert "tools.py" in package_readme

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

        dashboard_api = load_dashboard_api()
        captured = []
        install_fake_urlopen(
            [
                mcp_text_response(
                    {
                        "success": True,
                        "data": {
                            "intents": [
                                {
                                    "id": "intent-hidden",
                                    "summary": "Find robotics mentors",
                                    "description": "Looking for mentors in applied robotics.",
                                    "status": "active",
                                    "confidence": 0.91,
                                }
                            ],
                            "count": 1,
                        },
                    },
                    response_id=10,
                ),
                mcp_text_response(
                    {
                        "success": True,
                        "data": {
                            "found": True,
                            "count": 1,
                            "message": "You have 1 opportunity.\n\n1. Ada\n   Can advise on robotics hiring.\n   status: draft\n   opportunityId: hidden\n\nDo NOT print raw JSON.",
                        },
                    },
                    response_id=11,
                ),
                mcp_text_response(
                    {
                        "success": True,
                        "data": {
                            "memberOf": [
                                {
                                    "networkId": "network-hidden",
                                    "title": "Robotics Guild",
                                    "prompt": "People building robotics companies.",
                                    "permissions": ["member"],
                                }
                            ],
                            "owns": [],
                            "publicNetworks": [{"title": "Not joined"}],
                        },
                    },
                    response_id=12,
                ),
                mcp_text_response(
                    {
                        "success": True,
                        "data": {
                            "userId": "user-hidden",
                            "count": 1,
                            "memberships": [
                                {
                                    "networkId": "network-hidden",
                                    "networkTitle": "Robotics Guild",
                                    "permissions": ["member"],
                                }
                            ],
                        },
                    },
                    response_id=13,
                ),
                mcp_text_response(
                    {
                        "success": True,
                        "data": {
                            "links": [
                                {
                                    "intentId": "intent-hidden",
                                    "networkId": "network-hidden",
                                    "intentTitle": "Looking for mentors in applied robotics.",
                                    "relevancyScore": 0.94,
                                }
                            ],
                            "count": 1,
                        },
                    },
                    response_id=14,
                ),
                mcp_text_response(
                    {"success": True, "data": {"count": 1, "totalCount": 7, "negotiations": [{"status": "completed"}]}},
                    response_id=15,
                ),
                mcp_text_response(
                    {"success": True, "data": {"count": 1, "totalCount": 2, "negotiations": [{"status": "active"}]}},
                    response_id=16,
                ),
                mcp_text_response(
                    {"success": True, "data": {"count": 1, "totalCount": 1, "negotiations": [{"status": "waiting_for_agent"}]}},
                    response_id=17,
                ),
                mcp_text_response(
                    {"success": True, "data": {"count": 1, "totalCount": 4, "negotiations": [{"status": "completed"}]}},
                    response_id=18,
                ),
            ],
            captured,
        )
        summary = dashboard_api.summary()
        assert summary["success"] is True
        sections = summary["sections"]
        assert sections["intents"]["items"][0]["title"] == "Find robotics mentors"
        assert sections["intents"]["items"][0]["detail"] == "Looking for mentors in applied robotics."
        assert sections["intents"]["items"][0]["networks"] == ["Robotics Guild"]
        assert sections["opportunities"]["items"][0]["title"] == "Ada"
        assert sections["negotiations"]["count"] == 7
        assert sections["negotiations"]["summary"] == {
            "active": 2,
            "waitingForAgent": 1,
            "completed": 4,
            "needsAttention": 1,
        }
        assert sections["networks"]["items"][0]["title"] == "Robotics Guild"
        assert sections["networks"]["count"] == 1
        assert [entry["body"]["params"]["name"] for entry in captured] == [
            "read_intents",
            "list_opportunities",
            "read_networks",
            "read_network_memberships",
            "read_intent_indexes",
            "list_negotiations",
            "list_negotiations",
            "list_negotiations",
            "list_negotiations",
        ]
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
