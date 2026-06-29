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
    package_json = json.loads((ROOT / "package.json").read_text())
    plugin_yaml_version = next(
        line.split(":", 1)[1].strip()
        for line in (ROOT / "plugin.yaml").read_text().splitlines()
        if line.startswith("version:")
    )
    assert dashboard_manifest["version"] == package_json["version"] == plugin_yaml_version
    assert dashboard_manifest["name"] == "index-network"
    assert dashboard_manifest["label"] == "Index"
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
    assert "Intents" in dashboard_js
    assert "Networks" in dashboard_js
    assert "Questions" in dashboard_js
    assert "Radar" in dashboard_js
    assert "hashchange" in dashboard_js
    assert "index-dashboard__question-actions" in dashboard_js
    assert "/dismiss" in dashboard_js
    assert "index-dashboard__header-refresh" in dashboard_js
    assert 'header[role="banner"]' in dashboard_js
    assert "index-dashboard__avatar-img" in dashboard_js
    assert "AUTO-REFRESH" in dashboard_js
    assert "index-dashboard__switch" in dashboard_js
    assert "setInterval" in dashboard_js
    assert "5000" in dashboard_js
    assert "/api/" + "plugins/index-network" in dashboard_js
    assert "SDK.fetchJSON" in dashboard_js
    assert "index_pickup_negotiation" not in dashboard_js
    assert "index_respond_negotiation" not in dashboard_js
    assert "index-dashboard__hdr-account" in dashboard_js
    assert "ProfilePanel" in dashboard_js
    assert "Notification Settings" in dashboard_js
    assert "/profile" in dashboard_js
    assert "index-dashboard__opp-id--clickable" in dashboard_js
    assert "onOpenUser" in dashboard_js
    assert "counterpartUserId" in dashboard_js

    dashboard_readme = (ROOT / "dashboard" / "README.md").read_text()
    package_readme = (ROOT / "README.md").read_text()
    assert "write-enabled for pending-question answers" in dashboard_readme
    assert "dashboard/plugin_api.py" in dashboard_readme
    assert "../tools.py" in dashboard_readme
    assert "claim pending negotiation turns" in dashboard_readme
    assert "answering pending Index questions" in package_readme
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
                                    "id": "intent-1",
                                    "summary": "Find robotics mentors",
                                    "description": "Looking for mentors in applied robotics.",
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
                            "questions": [
                                {
                                    "id": "question-1",
                                    "title": "Robotics focus",
                                    "prompt": "Which robotics area should Index prioritize?",
                                    "options": [{"label": "Hiring", "description": "Find mentors for recruiting."}],
                                    "multiSelect": False,
                                    "mode": "intent",
                                    "sourceType": "intent",
                                    "sourceId": "intent-1",
                                },
                                {
                                    "id": "question-2",
                                    "title": "Onboarding",
                                    "prompt": "Tell us about yourself.",
                                    "options": [],
                                    "multiSelect": False,
                                    "mode": "enrichment",
                                    "sourceType": "profile",
                                    "sourceId": "user-1",
                                },
                            ],
                            "count": 2,
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
                                    "networkId": "network-1",
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
                            "userId": "user-1",
                            "count": 1,
                            "memberships": [
                                {
                                    "networkId": "network-1",
                                    "networkTitle": "Robotics Guild",
                                    "permissions": ["member"],
                                }
                            ],
                        },
                    },
                    response_id=13,
                ),
                FakeResponse(
                    {
                        "opportunities": [
                            {
                                "id": "opp-1",
                                "status": "pending",
                                "detection": {"triggeredBy": "intent-1"},
                                "counterpartName": "Ada",
                                "counterpartAvatar": "avatars/other/pic.png",
                                "interpretation": {"category": "mentor", "reasoning": "Can advise on robotics hiring."},
                                "actors": [
                                    {"userId": "user-1", "networkId": "network-1", "intent": "intent-1", "role": "agent"},
                                    {"userId": "other", "networkId": "network-1", "intent": "other-intent", "role": "patient"},
                                ],
                            },
                            {
                                "id": "opp-general",
                                "status": "pending",
                                "detection": {},
                                "counterpartName": "Grace",
                                "interpretation": {"category": "intro", "reasoning": "Worth a direct follow-up."},
                                "actors": [
                                    {"userId": "user-1", "networkId": "network-1", "role": "agent"},
                                    {"userId": "intro", "networkId": "network-1", "role": "introducer"},
                                    {"userId": "other-general", "networkId": "network-1", "role": "patient"},
                                ],
                            },
                            {
                                "id": "opp-waiting-on-other",
                                "status": "pending",
                                "detection": {},
                                "counterpartName": "Already Sent",
                                "interpretation": {"category": "intro", "reasoning": "Waiting for the other side."},
                                "actors": [
                                    {
                                        "userId": "user-1",
                                        "networkId": "network-1",
                                        "role": "agent",
                                        "actedAt": "2026-05-12T10:00:00.000Z",
                                    },
                                    {"userId": "other-waiting", "networkId": "network-1", "role": "patient"},
                                ],
                            }
                        ]
                    }
                ),
                FakeResponse(
                    {
                        "opportunities": [
                            {
                                "id": "opp-expired",
                                "status": "expired",
                                "detection": {"triggeredBy": "intent-1"},
                                "counterpartName": "Expired Match",
                                "actors": [
                                    {"userId": "user-1", "networkId": "network-1", "intent": "intent-1", "role": "agent"},
                                    {"userId": "expired-other", "networkId": "network-1", "role": "patient"},
                                ],
                            }
                        ]
                    }
                ),
                FakeResponse(
                    {
                        "opportunities": [
                            {
                                "id": "opp-rejected",
                                "status": "rejected",
                                "detection": {"triggeredBy": "intent-1"},
                                "counterpartName": "Rejected Match",
                                "actors": [
                                    {"userId": "user-1", "networkId": "network-1", "intent": "intent-1", "role": "agent"},
                                    {"userId": "rejected-other", "networkId": "network-1", "role": "patient"},
                                ],
                            }
                        ]
                    }
                ),
            ],
            captured,
        )
        summary = dashboard_api.summary()
        assert summary["success"] is True
        intents = summary["intents"]
        assert len(intents) == 1
        intent = intents[0]
        assert intent["id"] == "intent-1"
        assert intent["title"] == "Looking for mentors in applied robotics."
        assert intent["status"] == "running"
        assert intent["questionCount"] == 1
        assert intent["opportunityCount"] == 1
        assert intent["totalOpportunityCount"] == 3
        assert intent["statusCounts"]["pending"] == 1
        assert intent["statusCounts"]["rejected"] == 1
        assert intent["statusCounts"]["expired"] == 1
        assert intent["networks"] == ["Robotics Guild"]
        assert intent["questions"][0]["id"] == "question-1"
        assert intent["questions"][0]["options"][0]["label"] == "Hiring"
        assert intent["opportunities"][0]["opportunityId"] == "opp-1"
        assert intent["opportunities"][0]["avatar"] == "https://api.example.test/api/storage/avatars/other/pic.png"
        assert intent["opportunities"][0]["name"] == "Ada"
        assert intent["opportunities"][0]["subtitle"] == "Suggested connection"
        assert intent["opportunities"][0]["mainText"] == "Can advise on robotics hiring."
        assert intent["opportunities"][0]["networks"] == ["Robotics Guild"]
        assert intent["opportunities"][0]["counterpartUserId"] == "other"
        assert summary["general"]["count"] == 2
        assert summary["general"]["questionCount"] == 1
        assert summary["general"]["opportunityCount"] == 1
        assert summary["general"]["questions"][0]["id"] == "question-2"
        assert summary["general"]["opportunities"][0]["opportunityId"] == "opp-general"
        assert summary["general"]["opportunities"][0]["counterpartUserId"] == "other-general"
        all_opp_ids = [
            opp["opportunityId"]
            for group in summary["intents"] + [summary["general"]]
            for opp in group.get("opportunities", [])
        ]
        assert "opp-waiting-on-other" not in all_opp_ids
        assert summary["general"]["statusCounts"]["pending"] == 1
        assert summary["negotiations"]["count"] == 2
        assert summary["negotiations"]["items"][0]["opportunityId"] == "opp-1"
        assert summary["negotiations"]["items"][0]["subtitle"] == "Looking for mentors in applied robotics."
        assert summary["negotiations"]["items"][0]["counterpartUserId"] == "other"
        assert summary["networks"]["count"] == 1
        assert summary["networks"]["items"][0]["title"] == "Robotics Guild"
        assert summary["totals"] == {
            "intents": 1,
            "questions": 2,
            "opportunities": 2,
            "totalOpportunities": 4,
            "statusCounts": {"pending": 2, "negotiating": 0, "accepted": 0, "rejected": 1, "expired": 1},
        }
        mcp_calls = [entry["body"]["params"]["name"] for entry in captured if entry["body"]]
        assert mcp_calls == ["read_intents", "read_pending_questions", "read_networks", "read_network_memberships"]
        rest_calls = [(entry["method"], entry["url"]) for entry in captured if entry["body"] is None]
        assert rest_calls == [
            ("GET", "https://api.example.test/api/opportunities"),
            ("GET", "https://api.example.test/api/opportunities?status=expired"),
            ("GET", "https://api.example.test/api/opportunities?status=rejected"),
        ]

        captured = []
        install_fake_urlopen([FakeResponse({"success": True})], captured)
        answer_result = dashboard_api.answer_question(
            "question-1",
            {"selectedOptions": ["Hiring"], "freeText": "Recruiting mentors matter most."},
        )
        assert answer_result == {"success": True}
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == "https://api.example.test/api/questions/question-1/answer"
        assert captured[-1]["body"] == {"selectedOptions": ["Hiring"], "freeText": "Recruiting mentors matter most."}
        assert dashboard_api.answer_question("question-1", {"selectedOptions": []}) == {
            "success": False,
            "error": "Choose an option or add a free-text answer.",
        }

        captured = []
        install_fake_urlopen([FakeResponse({"success": True})], captured)
        assert dashboard_api.dismiss_question("question-1") == {"success": True}
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == "https://api.example.test/api/questions/question-1/dismiss"

        captured = []
        install_fake_urlopen([mcp_text_response({"success": True, "conversationId": "conv-9"})], captured)
        accept_result = dashboard_api.accept_opportunity("opp-1")
        assert accept_result["success"] is True
        assert accept_result["status"] == "accepted"
        assert accept_result["conversationId"] == "conv-9"
        assert accept_result["chatUrl"] == "https://index.network/chat/conv-9"
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["body"]["params"] == {
            "name": "update_opportunity",
            "arguments": {"opportunityId": "opp-1", "status": "accepted"},
        }
        assert dashboard_api.accept_opportunity("") == {
            "success": False,
            "error": "An opportunity id is required.",
        }

        captured = []
        install_fake_urlopen([mcp_text_response({"success": True})], captured)
        assert dashboard_api.skip_opportunity("opp-1") == {"success": True, "status": "rejected"}
        assert captured[-1]["body"]["params"] == {
            "name": "update_opportunity",
            "arguments": {"opportunityId": "opp-1", "status": "rejected"},
        }

        captured = []
        install_fake_urlopen(
            [
                mcp_text_response(
                    {"success": True, "data": {"userId": "user-1", "count": 0, "memberships": []}},
                    response_id=20,
                ),
                mcp_text_response(
                    {
                        "success": True,
                        "hasProfile": True,
                        "name": "Ada Lovelace",
                        "bio": "Builds robots.",
                        "location": "London",
                        "context": "Ada is a robotics engineer.",
                    },
                    response_id=21,
                ),
                FakeResponse(
                    {
                        "user": {
                            "id": "user-1",
                            "name": "Ada Lovelace",
                            "intro": "Builds robots.",
                            "location": "London",
                            "avatar": "avatars/user-1/a.png",
                            "socials": [{"id": "s1", "label": "twitter", "value": "ada"}],
                        }
                    }
                ),
            ],
            captured,
        )
        prof = dashboard_api.profile()
        assert prof["success"] is True
        profile_obj = prof["profile"]
        assert profile_obj["id"] == "user-1"
        assert profile_obj["name"] == "Ada Lovelace"
        assert profile_obj["intro"] == "Builds robots."
        assert profile_obj["location"] == "London"
        assert profile_obj["avatar"] == "https://api.example.test/api/storage/avatars/user-1/a.png"
        assert profile_obj["socials"] == [{"label": "twitter", "value": "ada"}]
        assert profile_obj["context"] == "Ada is a robotics engineer."
        assert profile_obj["notificationPreferences"] == {"connectionUpdates": True, "weeklyNewsletter": True}
        assert "timezone" in prof["mockedFields"]
        profile_mcp_calls = [entry["body"]["params"]["name"] for entry in captured if entry["body"]]
        assert profile_mcp_calls == ["read_network_memberships", "read_user_contexts"]
        profile_rest_calls = [(entry["method"], entry["url"]) for entry in captured if entry["body"] is None]
        assert profile_rest_calls == [("GET", "https://api.example.test/api/users/user-1")]

        update_ok = dashboard_api.update_profile(
            {"name": "Ada L.", "notificationPreferences": {"connectionUpdates": False, "weeklyNewsletter": True}}
        )
        assert update_ok["success"] is True
        assert update_ok["mock"] is True
        assert update_ok["applied"]["name"] == "Ada L."
        assert update_ok["applied"]["notificationPreferences"] == {"connectionUpdates": False, "weeklyNewsletter": True}
        assert dashboard_api.update_profile("nope") == {"success": False, "error": "Profile body must be an object."}

        assert dashboard_api.generate_intro({"intro": "current"}) == {"success": True, "mock": True, "intro": "current"}

        captured = []
        install_fake_urlopen(
            [
                mcp_text_response(
                    {"success": True, "data": {"userId": "user-1", "count": 0, "memberships": []}},
                    response_id=30,
                ),
                FakeResponse(
                    {
                        "opportunities": [
                            {
                                "id": "opp-profile",
                                "actors": [
                                    {"userId": "user-1", "role": "agent"},
                                    {"userId": "other", "role": "patient"},
                                ],
                            }
                        ]
                    }
                ),
                FakeResponse({"opportunities": []}),
                FakeResponse({"opportunities": []}),
                FakeResponse(
                    {
                        "user": {
                            "id": "other",
                            "name": "Grace Hopper",
                            "intro": "Compiler pioneer.",
                            "location": "New York",
                            "avatar": "avatars/other/g.png",
                            "socials": [{"id": "s2", "label": "github", "value": "grace"}],
                        }
                    }
                ),
                mcp_text_response(
                    {"success": True, "hasProfile": True, "name": "Grace Hopper", "context": "Grace builds compilers."},
                    response_id=31,
                ),
            ],
            captured,
        )
        other = dashboard_api.public_profile("other")
        assert other["success"] is True
        assert other["readOnly"] is True
        other_profile = other["profile"]
        assert other_profile["id"] == "other"
        assert other_profile["name"] == "Grace Hopper"
        assert other_profile["intro"] == "Compiler pioneer."
        assert other_profile["location"] == "New York"
        assert other_profile["avatar"] == "https://api.example.test/api/storage/avatars/other/g.png"
        assert other_profile["socials"] == [{"label": "github", "value": "grace"}]
        assert other_profile["context"] == "Grace builds compilers."
        public_rest = [(entry["method"], entry["url"]) for entry in captured if entry["body"] is None]
        assert public_rest == [
            ("GET", "https://api.example.test/api/opportunities"),
            ("GET", "https://api.example.test/api/opportunities?status=expired"),
            ("GET", "https://api.example.test/api/opportunities?status=rejected"),
            ("GET", "https://api.example.test/api/users/other"),
        ]
        public_mcp = [entry["body"]["params"] for entry in captured if entry["body"]]
        assert public_mcp == [
            {"name": "read_network_memberships", "arguments": {}},
            {"name": "read_user_contexts", "arguments": {"userId": "other"}},
        ]

        assert dashboard_api.public_profile("") == {"success": False, "error": "A user id is required."}
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
