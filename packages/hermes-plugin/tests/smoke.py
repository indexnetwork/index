"""Smoke tests for the Index Network Hermes plugin."""

from __future__ import annotations

import ast
import base64
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PYTHON_FILES = ["__init__.py", "schemas.py", "tools.py", "dashboard/plugin_api.py", "dashboard/auth_login.py"]
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


def http_error(status, payload, *, url="https://api.example.test/api/error"):
    """A urllib HTTPError whose body carries a JSON `{error, advisory}` (matches REST 4xx)."""
    body = json.dumps(payload).encode()
    return urllib.error.HTTPError(url, status, "HTTP error", {"Content-Type": "application/json"}, io.BytesIO(body))


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
        + ["index_agent_me", "index_open_app", "index_pickup_negotiation", "index_respond_negotiation"]
    )
    assert tool_names == expected_tool_names, tool_names
    assert len(tool_names) == len(set(tool_names))
    assert "index_create_intent" in tool_names
    for removed in ("discover_opportunities", "get_discovery_run", "cancel_discovery_run"):
        assert removed not in plugin.schemas.FORWARDED_MCP_TOOLS
        assert f"index_{removed}" not in tool_names
    assert "list_opportunities" in plugin.schemas.FORWARDED_MCP_TOOLS
    assert "index_list_opportunities" in tool_names
    assert "index_read_docs" in tool_names
    assert [entry["schema"]["name"] for entry in ctx.tools] == tool_names
    handlers_by_name = {entry["name"]: entry["handler"] for entry in ctx.tools}
    assert handlers_by_name["index_read_intents"] == plugin.tools.index_read_intents
    assert handlers_by_name["index_agent_me"] == plugin.tools.index_agent_me
    assert handlers_by_name["index_open_app"] == plugin.tools.index_open_app
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
    for removed in ("discover_opportunities", "get_discovery_run", "cancel_discovery_run"):
        assert f"index_{removed}" not in manifest_tools

    # Install no longer prompts for a key: browser login is the primary path, so
    # INDEX_API_KEY must not be a required env (a manual override still works).
    plugin_yaml_lines = (ROOT / "plugin.yaml").read_text().splitlines()
    assert not any(line.strip() == "requires_env:" for line in plugin_yaml_lines), "requires_env must be removed"

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
    assert "/onboarding/enrich" in dashboard_js
    assert "/onboarding/confirm" in dashboard_js
    assert "needsProfileConfirm" in dashboard_js
    assert "Getting started" in dashboard_js
    assert "gettingStarted" in dashboard_js
    assert "index-dashboard__getting-started" in dashboard_js
    assert "SettingUpScreen" in dashboard_js
    assert "index-dashboard__setting-up" in dashboard_js
    assert "Looks good" in dashboard_js
    assert "Getting a sense of you" in dashboard_js
    assert "index-dashboard__getting-started-btn" in dashboard_js
    assert "index-dashboard__opp-id--clickable" in dashboard_js
    # Mac/CLI-parity browser login gate + sign out.
    assert "LoginScreen" in dashboard_js
    assert "Log in with browser" in dashboard_js
    assert "/auth/status" in dashboard_js
    assert "/auth/login/start" in dashboard_js
    assert "/auth/login/status" in dashboard_js
    assert "/auth/logout" in dashboard_js
    assert "index-dashboard__login" in dashboard_js
    assert "needsLogin" in dashboard_js
    assert "Sign out" in dashboard_js
    # Background pollers must be gated on the signed-in state so pre-login 401s
    # cannot race the login transition (else the user must reload the page).
    assert 'auth !== "authed"' in dashboard_js
    # Private-network invite join (hermes://l/<code> / #invite=), Mac parity.
    assert "InviteJoinModal" in dashboard_js
    assert "/invite/" in dashboard_js
    assert "index-network-invite" in dashboard_js
    assert "You're invited to join" in dashboard_js
    assert "Join network" in dashboard_js

    # Hermes Desktop ships the same Getting started gate via the built bundle.
    desktop_js_path = ROOT / "desktop" / "dist" / "plugin.js"
    assert desktop_js_path.exists(), "desktop/dist/plugin.js missing — run bun run build:desktop"
    subprocess.run(["node", "--check", str(desktop_js_path)], check=True)
    desktop_js = desktop_js_path.read_text()
    assert "/onboarding/enrich" in desktop_js
    assert "/onboarding/confirm" in desktop_js
    assert "Getting started" in desktop_js
    assert "needsProfileConfirm" in desktop_js
    assert "index-dashboard__getting-started" in desktop_js
    assert "SettingUpScreen" in desktop_js
    assert "index-dashboard__setting-up" in desktop_js
    assert "getting started" in desktop_js  # palette keyword from desktop/tail.js
    # Hermes Desktop ships the same browser-login gate via the built bundle.
    assert "Log in with browser" in desktop_js
    assert "/auth/login/start" in desktop_js
    assert "index-dashboard__login" in desktop_js
    # Desktop claims hermes://l/<code> via hermesDesktop.onDeepLink.
    assert "InviteJoinModal" in desktop_js
    assert 'kind !== \'l\'' in desktop_js or 'kind !== "l"' in desktop_js
    assert "onDeepLink" in desktop_js
    assert "onOpenUser" in dashboard_js
    assert "onStartChat" in dashboard_js
    assert "unresolved_uptake_questions" in dashboard_js
    assert "Continue anyway" in dashboard_js
    assert "startChatWithOpportunity" in dashboard_js
    assert "counterpartUserId" in dashboard_js
    # Mac-app parity: chat opens via the opportunity start-chat route, pause/resume
    # hits the intent status route, and the accept/skip scope rides along.
    assert "/start-chat" in dashboard_js
    assert "togglePauseIntent" in dashboard_js
    assert "intentScopeId" in dashboard_js
    assert "PAUSED" in dashboard_js
    # The debug question seeder must not ship.
    assert "injectDebugQuestions" not in dashboard_js
    assert "remove before merging" not in dashboard_js
    assert "MessagesPanel" in dashboard_js
    assert "index-dashboard__msg-thread" in dashboard_js
    assert "/conversations/stream" in dashboard_js
    assert "extractContent" in dashboard_js
    assert "isInternal" in dashboard_js
    assert "index-dashboard__msg-bubble--internal" in dashboard_js
    assert 'senderId === "agent:" + currentUserId' in dashboard_js
    assert "index_msg_read" in dashboard_js
    assert "index-dashboard__msg-conv-badge" in dashboard_js
    assert "index-dashboard__msg-search" in dashboard_js
    # Realtime is authoritative streaming (web-app parity): reconnect with
    # exponential backoff + optimistic send/rollback, not interval polling.
    # The stream is consumed via SDK.authedFetch + a body reader (NOT a raw
    # EventSource, which cannot carry the Hermes session-token header in
    # loopback mode).
    assert "Math.pow(2, retries" in dashboard_js
    assert "scheduleRetry" in dashboard_js
    assert "optimisticId" in dashboard_js
    assert "SDK.authedFetch" in dashboard_js
    assert "getReader" in dashboard_js
    assert "text/event-stream" in dashboard_js
    assert "document.hidden" not in dashboard_js
    assert "new window.EventSource" not in dashboard_js
    assert "/profile/avatar" in dashboard_js
    assert "onArchive" in dashboard_js
    assert "/archive" in dashboard_js
    assert "payload.mock" not in dashboard_js

    dashboard_css = (ROOT / "dashboard" / "dist" / "style.css").read_text()
    assert "index-dashboard__msg-panel" in dashboard_css
    assert "index-dashboard__msg-bubble" in dashboard_css
    assert "index-dashboard__msg-bubble--internal" in dashboard_css
    assert "index-dashboard__msg-conv-badge" in dashboard_css
    assert "index-dashboard__msg-conv-dot" in dashboard_css
    assert "index-dashboard__msg-search" in dashboard_css
    assert "index-dashboard__getting-started" in dashboard_css
    assert "index-dashboard__setting-up" in dashboard_css
    assert "index-dashboard__getting-started-btn" in dashboard_css
    assert "index-dashboard-setting-stripes" in dashboard_css
    assert "index-dashboard__login" in dashboard_css
    assert "index-dashboard__login-btn" in dashboard_css
    assert "index-dashboard__profile-signout" in dashboard_css

    dashboard_readme = (ROOT / "dashboard" / "README.md").read_text()
    package_readme = (ROOT / "README.md").read_text()
    assert "write-enabled for pending-question answers" in dashboard_readme
    assert "dashboard/plugin_api.py" in dashboard_readme
    assert "../tools.py" in dashboard_readme
    assert "claim pending negotiation turns" in dashboard_readme
    assert "answering pending Index questions" in package_readme
    assert "dashboard/plugin_api.py" in package_readme
    assert "Log in with browser" in package_readme
    assert "Log in with browser" in dashboard_readme
    assert "/auth/login/start" in dashboard_readme
    assert "tools.py" in package_readme
    assert "### `index_open_app`" in package_readme
    assert "INDEX_APP_BASE_URL" in package_readme
    assert "no app-installation detection" in package_readme
    for stale in ("/c/<code>", "connect link", "x-index-surface"):
        assert stale not in package_readme, stale
        assert stale not in dashboard_readme, stale

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

        # Every opportunity-bearing MCP response gets an https universal link.
        # There is no app-installation detection: the plugin runs on the agent's
        # host, and the OS decides app vs landing page when the link is clicked.
        list_opportunities = handlers_by_name["index_list_opportunities"]
        captured = []
        install_fake_urlopen(
            [
                mcp_text_response(
                    {
                        "success": True,
                        "data": {
                            "opportunities": [
                                {"opportunityId": "opp-1", "status": "pending"},
                                {"opportunityId": "opp-2", "status": "negotiating"},
                            ],
                            "count": 2,
                        },
                    },
                    response_id=50,
                )
            ],
            captured,
        )
        opportunities = json.loads(list_opportunities({}))
        assert [opp["appUrl"] for opp in opportunities["data"]["opportunities"]] == [
            "https://index.network/o/opp-1",
            "https://index.network/o/opp-2",
        ]

        captured = []
        install_fake_urlopen(
            [mcp_text_response({"success": True, "opportunityId": "opp-single"}, response_id=51)],
            captured,
        )
        single = json.loads(list_opportunities({"opportunityId": "opp-single"}))
        assert single == {
            "success": True,
            "opportunityId": "opp-single",
            "appUrl": "https://index.network/o/opp-single",
        }

        # Nested/wrapped payloads are walked at any depth, and an appUrl that the
        # backend already set is never overwritten.
        captured = []
        install_fake_urlopen(
            [
                mcp_text_response(
                    {
                        "success": True,
                        "data": {
                            "groups": [
                                {
                                    "intent": {
                                        "id": "intent-1",
                                        "matches": [{"opportunityId": "opp-nested"}],
                                    }
                                },
                                {"opportunityId": "opp-kept", "appUrl": "https://index.network/o/custom"},
                            ]
                        },
                    },
                    response_id=52,
                )
            ],
            captured,
        )
        nested = json.loads(list_opportunities({}))
        groups = nested["data"]["groups"]
        assert groups[0]["intent"]["matches"][0]["appUrl"] == "https://index.network/o/opp-nested"
        assert groups[1]["appUrl"] == "https://index.network/o/custom"

        # A payload without opportunities is returned untouched.
        captured = []
        install_fake_urlopen(
            [mcp_text_response({"success": True, "data": {"networks": [{"id": "network-1"}]}}, response_id=53)],
            captured,
        )
        untouched = json.loads(list_opportunities({}))
        assert untouched == {"success": True, "data": {"networks": [{"id": "network-1"}]}}

        # Odd payloads (blank ids, non-string ids, cycles, unexpected objects)
        # must never raise; they degrade to the response as-is.
        odd = {"opportunityId": "   ", "nested": {"opportunityId": 42}, "other": {1, 2}}
        assert plugin.tools._with_app_urls(odd) == odd
        cyclic = {"opportunityId": "opp-cycle"}
        cyclic["self"] = cyclic
        assert plugin.tools._with_app_urls(cyclic)["appUrl"] == "https://index.network/o/opp-cycle"
        assert plugin.tools._with_app_urls("not-a-container") == "not-a-container"

        # The universal-link origin is overridable for dev/staging.
        os.environ["INDEX_APP_BASE_URL"] = "https://staging.index.network/"
        try:
            assert plugin.tools._with_app_urls({"opportunityId": "opp-1"})["appUrl"] == (
                "https://staging.index.network/o/opp-1"
            )
        finally:
            os.environ.pop("INDEX_APP_BASE_URL", None)

        # index_open_app hands an Index universal link to the OS. It never probes
        # for an installed app and never opens foreign URLs.
        opened = []
        original_opener_command = plugin.tools._url_opener_command
        original_open_url = plugin.tools._open_url
        plugin.tools._url_opener_command = lambda url, system=None: ["open", url]
        plugin.tools._open_url = lambda command: opened.append(command) or None
        try:
            assert json.loads(plugin.tools.index_open_app({})) == {
                "success": True,
                "url": "https://index.network",
            }
            assert json.loads(plugin.tools.index_open_app({"target": "https://index.network/o/opp-1"})) == {
                "success": True,
                "url": "https://index.network/o/opp-1",
            }
            assert opened == [
                ["open", "https://index.network"],
                ["open", "https://index.network/o/opp-1"],
            ]
            for foreign in (
                "index://o/opp-1",
                "https://evil.test/o/opp-1",
                "http://index.network/o/opp-1",
                "https://index.network.evil.test/o/opp-1",
            ):
                rejected = json.loads(plugin.tools.index_open_app({"target": foreign}))
                assert rejected["success"] is False, foreign
                assert rejected["error"] == "target must be an https://index.network URL."
            assert len(opened) == 2
            assert json.loads(plugin.tools.index_open_app("nope")) == {
                "success": False,
                "error": "Arguments must be an object.",
            }

            # A schemeless INDEX_APP_BASE_URL (a plausible operator typo) must not
            # degrade the tool into a generic local-file opener. Both the base
            # fallback and the absolute-https target check reject a relative path,
            # and no opener is invoked.
            os.environ["INDEX_APP_BASE_URL"] = "index.network"
            try:
                assert plugin.tools._app_base_url() == "https://index.network"
                for relative in ("/etc/passwd", "etc/passwd", "//evil.test/x"):
                    local = json.loads(plugin.tools.index_open_app({"target": relative}))
                    assert local["success"] is False, relative
                    assert local["error"] == "target must be an https://index.network URL."
                assert len(opened) == 2
            finally:
                os.environ.pop("INDEX_APP_BASE_URL", None)

            # A base that is malformed in other ways falls back the same way.
            for bad_base in ("http://index.network", "index://index.network", "https://", "::"):
                os.environ["INDEX_APP_BASE_URL"] = bad_base
                try:
                    assert plugin.tools._app_base_url() == "https://index.network", bad_base
                finally:
                    os.environ.pop("INDEX_APP_BASE_URL", None)

            plugin.tools._open_url = lambda command: "exit code 1"
            failed = json.loads(plugin.tools.index_open_app({"target": "https://index.network/o/opp-1"}))
            assert failed["success"] is False
            assert failed["url"] == "https://index.network/o/opp-1"

            plugin.tools._url_opener_command = lambda url, system=None: None
            manual = json.loads(plugin.tools.index_open_app({"target": "https://index.network/o/opp-1"}))
            assert manual["success"] is False
            assert manual["url"] == "https://index.network/o/opp-1"
            assert "manually" in manual["error"]
        finally:
            plugin.tools._url_opener_command = original_opener_command
            plugin.tools._open_url = original_open_url

        assert plugin.tools._url_opener_command("https://index.network", system="Darwin") == [
            "open",
            "https://index.network",
        ]
        # Windows must not route through `cmd /c start`: subprocess quotes an
        # argument only when it contains whitespace, so cmd.exe metacharacters in
        # an otherwise valid index.network URL would survive unquoted and run as
        # separate commands. rundll32 takes the URL as one argv entry, unparsed.
        injecting_url = "https://index.network/o/x&calc"
        windows_command = plugin.tools._url_opener_command(injecting_url, system="Windows")
        assert windows_command == [
            "rundll32",
            "url.dll,FileProtocolHandler",
            injecting_url,
        ]
        assert "cmd" not in windows_command
        assert windows_command.count(injecting_url) == 1
        assert subprocess.list2cmdline(windows_command) == (
            "rundll32 url.dll,FileProtocolHandler https://index.network/o/x&calc"
        )
        assert plugin.tools._url_opener_command("https://index.network", system="Windows") == [
            "rundll32",
            "url.dll,FileProtocolHandler",
            "https://index.network",
        ]

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
                # summary → GET /auth/me (identity + onboarding gate).
                FakeResponse({
                    "user": {
                        "id": "user-1",
                        "onboarding": {"profileConfirmedAt": "2026-01-01T00:00:00.000Z"},
                    }
                }),
                # _call_read_intents → POST /intents/list (carries lifecycle status; includes PAUSED).
                FakeResponse(
                    {
                        "intents": [
                            {
                                "id": "intent-1",
                                "summary": "Find robotics mentors",
                                "payload": "Looking for mentors in applied robotics.",
                                "status": "ACTIVE",
                                "pendingQuestionCount": 1,
                                "waitingOpportunityCount": 1,
                            }
                        ],
                        "pagination": {"current": 1, "total": 1, "count": 1, "totalCount": 1},
                    }
                ),
                # _call_questions_by_intent("pending") → server-scoped per intent
                # (identical query to the Mac app; nested detection/payload).
                FakeResponse(
                    {
                        "questions": [
                            {
                                "id": "question-1",
                                "status": "pending",
                                "detection": {"mode": "intent", "sourceType": "intent", "sourceId": "intent-1"},
                                "payload": {
                                    "title": "Robotics focus",
                                    "prompt": "Which robotics area should Index prioritize?",
                                    "options": [{"label": "Hiring", "description": "Find mentors for recruiting."}],
                                    "multiSelect": False,
                                },
                            },
                        ]
                    }
                ),
                # _call_questions_by_intent("answered") → server-scoped settled records
                # per intent (identical scope to the Mac app), surviving reloads.
                FakeResponse(
                    {
                        "questions": [
                            {
                                "id": "question-answered",
                                "status": "answered",
                                "detection": {"mode": "intent", "sourceType": "intent", "sourceId": "intent-1"},
                                "payload": {
                                    "title": "Focus",
                                    "prompt": "Which robotics area did you pick?",
                                    "options": [],
                                    "multiSelect": False,
                                },
                                "answer": {
                                    "selectedOptions": ["Hiring"],
                                    "freeText": "",
                                    "answeredAt": "2026-06-01T00:00:00.000Z",
                                },
                            }
                        ]
                    }
                ),
                # GET /networks (joined) and GET /networks/discovery/public (discover).
                FakeResponse(
                    {
                        "networks": [
                            {
                                "id": "network-1",
                                "title": "Robotics Guild",
                                "prompt": "People building robotics companies.",
                                "isPersonal": False,
                                "type": "community",
                                "user": {"id": "owner-x", "name": "Owner"},
                                "_count": {"members": 3},
                            }
                        ],
                        "pagination": {"current": 1, "total": 1, "count": 1, "totalCount": 1},
                    }
                ),
                FakeResponse({"networks": [{"id": "network-2", "title": "Not joined", "memberCount": 5}]}),
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
                            },
                            {
                                "id": "opp-rejected",
                                "status": "rejected",
                                "detection": {"triggeredBy": "intent-1"},
                                "counterpartName": "Rejected Match",
                                "actors": [
                                    {"userId": "user-1", "networkId": "network-1", "intent": "intent-1", "role": "agent"},
                                    {"userId": "rejected-other", "networkId": "network-1", "role": "patient"},
                                ],
                            },
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
            ],
            captured,
        )
        summary = dashboard_api.summary()
        assert summary["success"] is True
        assert summary["onboarding"] == {
            "profileConfirmedAt": "2026-01-01T00:00:00.000Z",
            "needsProfileConfirm": False,
        }
        intents = summary["intents"]
        assert len(intents) == 1
        intent = intents[0]
        assert intent["id"] == "intent-1"
        assert intent["title"] == "Looking for mentors in applied robotics."
        # Mac-app signalStatus parity: an active intent with no accepted or
        # negotiating opportunities reads "live".
        assert intent["status"] == "live"
        assert intent["lifecycleStatus"] == "ACTIVE"
        assert intent["questionCount"] == 1
        assert intent["opportunityCount"] == 1
        # Consolidated badge count from the server list fields.
        assert intent["pendingCount"] == 2
        assert intent["totalOpportunityCount"] == 2
        assert intent["statusCounts"]["pending"] == 1
        # Rejected is hidden entirely (mac-app parity): no bucket, no count.
        assert "rejected" not in intent["statusCounts"]
        assert intent["statusCounts"]["expired"] == 1
        assert intent["networks"] == ["Robotics Guild"]
        assert intent["questions"][0]["id"] == "question-1"
        assert intent["questions"][0]["options"][0]["label"] == "Hiring"
        # Settled records ride along per intent, pending counts unaffected.
        assert intent["answeredQuestions"][0]["id"] == "question-answered"
        assert intent["answeredQuestions"][0]["answerText"] == "Hiring"
        assert intent["opportunities"][0]["opportunityId"] == "opp-1"
        assert intent["opportunities"][0]["avatar"] == "https://api.example.test/api/storage/avatars/other/pic.png"
        assert intent["opportunities"][0]["name"] == "Ada"
        assert intent["opportunities"][0]["subtitle"] == "Suggested connection"
        assert intent["opportunities"][0]["mainText"] == "Can advise on robotics hiring."
        assert "networks" not in intent["opportunities"][0]
        assert intent["opportunities"][0]["counterpartUserId"] == "other"
        assert intent["opportunities"][0]["intentScopeId"] == "intent-1"
        # Questions are server-scoped per intent, so the general questions
        # bucket is always empty (only unlinked opportunities remain general).
        assert summary["general"]["count"] == 1
        assert summary["general"]["questionCount"] == 0
        assert summary["general"]["opportunityCount"] == 1
        assert summary["general"]["questions"] == []
        assert summary["general"]["opportunities"][0]["opportunityId"] == "opp-general"
        assert summary["general"]["opportunities"][0]["counterpartUserId"] == "other-general"
        all_opp_ids = [
            opp["opportunityId"]
            for group in summary["intents"] + [summary["general"]]
            for opp in group.get("opportunities", [])
        ]
        assert "opp-waiting-on-other" not in all_opp_ids
        assert "opp-rejected" not in all_opp_ids
        assert summary["general"]["statusCounts"]["pending"] == 1
        assert summary["negotiations"]["count"] == 2
        assert summary["negotiations"]["items"][0]["opportunityId"] == "opp-1"
        assert summary["negotiations"]["items"][0]["subtitle"] == "Looking for mentors in applied robotics."
        assert summary["negotiations"]["items"][0]["counterpartUserId"] == "other"
        assert summary["networks"]["count"] == 1
        assert summary["networks"]["items"][0]["title"] == "Robotics Guild"
        assert summary["totals"] == {
            "intents": 1,
            "questions": 1,
            "opportunities": 2,
            "totalOpportunities": 3,
            "statusCounts": {"pending": 2, "negotiating": 0, "accepted": 0, "expired": 1},
        }
        # The summary is now fully REST (Mac-app parity): no MCP tool calls remain.
        calls = [(entry["method"], entry["url"]) for entry in captured]
        assert calls[:8] == [
            ("GET", "https://api.example.test/api/auth/me"),
            ("POST", "https://api.example.test/api/intents/list"),
            ("GET", "https://api.example.test/api/questions?status=pending&scopeType=intent&scopeId=intent-1"),
            ("GET", "https://api.example.test/api/questions?status=answered&scopeType=intent&scopeId=intent-1"),
            ("GET", "https://api.example.test/api/networks"),
            ("GET", "https://api.example.test/api/networks/discovery/public"),
            ("GET", "https://api.example.test/api/opportunities"),
            ("GET", "https://api.example.test/api/opportunities?status=expired"),
        ]
        assert captured[1]["body"] == {"limit": 100, "page": 1, "archived": False}
        # No per-counterpart /users/:id fetches: cards no longer carry socials.
        assert calls[8:] == []

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

        # Accept over REST PATCH /opportunities/:id/status (Mac-app parity).
        captured = []
        install_fake_urlopen([FakeResponse({"opportunity": {"id": "opp-1"}, "counterpartUserId": "other"})], captured)
        accept_result = dashboard_api.accept_opportunity("opp-1")
        assert accept_result == {"success": True, "status": "accepted"}
        assert captured[-1]["method"] == "PATCH"
        assert captured[-1]["url"] == "https://api.example.test/api/opportunities/opp-1/status"
        assert captured[-1]["body"] == {"status": "accepted"}
        assert dashboard_api.accept_opportunity("") == {
            "success": False,
            "error": "An opportunity id is required.",
        }

        # The 409 uptake advisory (arriving under details.advisory) is surfaced top-level.
        captured = []
        advisory = {
            "code": "unresolved_uptake_questions",
            "advisoryOnly": True,
            "opportunityId": "opp-1",
            "questions": [{"id": "q-1", "title": "Capacity", "prompt": "Can they deliver?", "options": [], "multiSelect": False}],
            "acknowledgedUptakeQuestionIds": [],
        }
        install_fake_urlopen(
            [http_error(409, {"error": "Resolve pending uptake questions.", "advisory": advisory})],
            captured,
        )
        advisory_result = dashboard_api.accept_opportunity("opp-1")
        assert advisory_result["success"] is False
        assert advisory_result["advisory"] == advisory
        # Accept is a REST call now, so no `appUrl` is minted here: the deep-link
        # walk only runs over MCP responses (covered by the index_list_opportunities
        # and _with_app_urls cases above).
        assert "appUrl" not in advisory_result["advisory"]

        # Continue-anyway retry carries acknowledged IDs (deduped) and intent scope.
        captured = []
        install_fake_urlopen([FakeResponse({"opportunity": {"id": "opp-1"}})], captured)
        acknowledged_result = dashboard_api.accept_opportunity(
            "opp-1", {"acknowledgedUptakeQuestionIds": ["q-1", "q-1"], "scopeId": "intent-1"}
        )
        assert acknowledged_result["success"] is True
        assert captured[-1]["body"] == {
            "status": "accepted",
            "scopeType": "intent",
            "scopeId": "intent-1",
            "acknowledgedUptakeQuestionIds": ["q-1"],
        }
        assert dashboard_api.accept_opportunity("opp-1", {"acknowledgedUptakeQuestionIds": "q-1"}) == {
            "success": False,
            "error": "acknowledgedUptakeQuestionIds must be an array of non-empty strings.",
        }

        captured = []
        install_fake_urlopen([FakeResponse({"opportunity": {"id": "opp-1"}})], captured)
        assert dashboard_api.skip_opportunity("opp-1") == {"success": True, "status": "rejected"}
        assert captured[-1]["method"] == "PATCH"
        assert captured[-1]["url"] == "https://api.example.test/api/opportunities/opp-1/status"
        assert captured[-1]["body"] == {"status": "rejected"}

        # Start chat over REST POST /opportunities/:id/start-chat, returning the DM id.
        captured = []
        install_fake_urlopen(
            [FakeResponse({"conversationId": "conv-9", "counterpartUserId": "other", "opportunity": {}})],
            captured,
        )
        start_chat_result = dashboard_api.start_chat("opp-1", {"scopeId": "intent-1"})
        assert start_chat_result["success"] is True
        assert start_chat_result["conversationId"] == "conv-9"
        assert start_chat_result["counterpartUserId"] == "other"
        assert start_chat_result["chatUrl"] == "https://index.network/chat/conv-9"
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == "https://api.example.test/api/opportunities/opp-1/start-chat"
        assert captured[-1]["body"] == {"scopeType": "intent", "scopeId": "intent-1"}
        assert dashboard_api.start_chat("") == {"success": False, "error": "An opportunity id is required."}

        # Pause/resume an intent over REST PATCH /intents/:id/status.
        captured = []
        install_fake_urlopen([FakeResponse({"success": True, "intent": {"id": "intent-1", "status": "PAUSED"}, "changed": True})], captured)
        pause_result = dashboard_api.set_intent_status("intent-1", {"status": "PAUSED"})
        assert pause_result == {"success": True, "status": "PAUSED"}
        assert captured[-1]["method"] == "PATCH"
        assert captured[-1]["url"] == "https://api.example.test/api/intents/intent-1/status"
        assert captured[-1]["body"] == {"status": "PAUSED"}
        assert dashboard_api.set_intent_status("intent-1", {"status": "nope"}) == {
            "success": False,
            "error": "status must be one of: ACTIVE, PAUSED.",
        }
        assert dashboard_api.set_intent_status("", {"status": "PAUSED"}) == {
            "success": False,
            "error": "An intent id is required.",
        }

        # Join a public network over REST POST /networks/:id/join.
        captured = []
        install_fake_urlopen([FakeResponse({"network": {"id": "network-2"}})], captured)
        assert dashboard_api.join_network("network-2") == {"success": True}
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == "https://api.example.test/api/networks/network-2/join"
        assert dashboard_api.join_network("") == {"success": False, "error": "A network id is required."}

        # Private-network invite preview + accept (hermes://l/<code>).
        captured = []
        install_fake_urlopen(
            [
                FakeResponse(
                    {
                        "network": {
                            "id": "network-9",
                            "title": "Edge Lab",
                            "_count": {"members": 12},
                        }
                    }
                )
            ],
            captured,
        )
        assert dashboard_api.preview_invite("share-abc") == {
            "success": True,
            "network": {"id": "network-9", "title": "Edge Lab", "memberCount": 12},
        }
        assert captured[-1]["method"] == "GET"
        assert captured[-1]["url"] == "https://api.example.test/api/networks/share/share-abc"
        assert dashboard_api.preview_invite("") == {
            "success": False,
            "error": "An invite code is required.",
        }

        captured = []
        install_fake_urlopen(
            [
                FakeResponse(
                    {
                        "index": {"id": "network-9", "title": "Edge Lab"},
                        "membership": {"id": "mem-1"},
                        "alreadyMember": False,
                    }
                )
            ],
            captured,
        )
        accepted = dashboard_api.accept_invite("share-abc")
        assert accepted["success"] is True
        assert accepted["index"]["title"] == "Edge Lab"
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == (
            "https://api.example.test/api/networks/invitation/share-abc/accept"
        )
        assert dashboard_api.accept_invite("") == {
            "success": False,
            "error": "An invite code is required.",
        }

        captured = []
        install_fake_urlopen(
            [
                # profile() resolves identity + email/timezone/prefs from GET /auth/me.
                FakeResponse(
                    {
                        "user": {
                            "id": "user-1",
                            "email": "ada@example.test",
                            "timezone": "Europe/London",
                            "notificationPreferences": {"connectionUpdates": False, "weeklyNewsletter": True},
                        }
                    }
                ),
                # read_user_contexts now goes through the REST tool surface
                # (POST /tools/read_user_contexts), which the browser-login CLI
                # key can call, unlike the MCP surface. Response is the REST
                # {success, data} envelope.
                FakeResponse(
                    {
                        "success": True,
                        "data": {
                            "hasProfile": True,
                            "name": "Ada Lovelace",
                            "bio": "Builds robots.",
                            "location": "London",
                            "context": "Ada is a robotics engineer.",
                        },
                    }
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
        assert profile_obj["email"] == "ada@example.test"
        assert profile_obj["timezone"] == "Europe/London"
        assert profile_obj["notificationPreferences"] == {"connectionUpdates": False, "weeklyNewsletter": True}
        assert prof["mockedFields"] == ["email"]
        assert prof["onboarding"] == {"profileConfirmedAt": None, "needsProfileConfirm": True}
        profile_tool_calls = [(entry["method"], entry["url"]) for entry in captured if entry["body"] is not None]
        assert profile_tool_calls == [("POST", "https://api.example.test/api/tools/read_user_contexts")]
        profile_rest_calls = [(entry["method"], entry["url"]) for entry in captured if entry["body"] is None]
        assert profile_rest_calls == [
            ("GET", "https://api.example.test/api/auth/me"),
            ("GET", "https://api.example.test/api/users/user-1"),
        ]

        captured = []
        install_fake_urlopen(
            [
                FakeResponse(
                    {
                        "enriched": True,
                        "profile": {
                            "name": "Ada Lovelace",
                            "intro": "Builds robots.",
                            "location": "London",
                            "avatar": None,
                            "socials": [{"label": "twitter", "value": "ada"}],
                        },
                    }
                )
            ],
            captured,
        )
        enrich_result = dashboard_api.onboarding_enrich({})
        assert enrich_result["success"] is True
        assert enrich_result["enriched"] is True
        assert enrich_result["profile"]["name"] == "Ada Lovelace"
        assert enrich_result["profile"]["socials"] == [{"label": "twitter", "value": "ada"}]
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == "https://api.example.test/api/enrichment/enrich"

        captured = []
        install_fake_urlopen(
            [
                # confirm_user_context now goes through the REST tool surface
                # (POST /tools/confirm_user_context) so the browser-login CLI key
                # is accepted; the MCP surface denies it as an enrollment key.
                FakeResponse(
                    {"success": True, "data": {"created": True, "message": "Profile saved from approved draft."}}
                ),
                FakeResponse({"success": True, "user": {"id": "user-1"}}),
                FakeResponse(
                    {
                        "user": {
                            "id": "user-1",
                            "onboarding": {"profileConfirmedAt": "2026-06-01T00:00:00.000Z"},
                        }
                    }
                ),
            ],
            captured,
        )
        confirm_result = dashboard_api.onboarding_confirm(
            {
                "name": "Ada L.",
                "intro": "Builds robots.",
                "location": "London",
                "socials": [{"label": "twitter", "value": "ada"}],
            }
        )
        assert confirm_result["success"] is True
        assert confirm_result["onboarding"] == {
            "profileConfirmedAt": "2026-06-01T00:00:00.000Z",
            "needsProfileConfirm": False,
        }
        assert confirm_result["applied"]["name"] == "Ada L."
        confirm_tool = [entry for entry in captured if entry["body"] and "/tools/confirm_user_context" in entry["url"]]
        assert confirm_tool[0]["method"] == "POST"
        assert confirm_tool[0]["body"]["query"]["draft"]["identity"]["name"] == "Ada L."
        assert captured[-2]["method"] == "PATCH"
        assert captured[-2]["url"] == "https://api.example.test/api/auth/profile/update"
        assert dashboard_api.onboarding_confirm("nope") == {
            "success": False,
            "error": "Confirm body must be an object.",
        }

        captured = []
        install_fake_urlopen([FakeResponse({"success": True, "user": {"id": "user-1"}})], captured)
        update_ok = dashboard_api.update_profile(
            {"name": "Ada L.", "notificationPreferences": {"connectionUpdates": False, "weeklyNewsletter": True}}
        )
        assert update_ok["success"] is True
        assert "mock" not in update_ok
        assert update_ok["applied"]["name"] == "Ada L."
        assert update_ok["applied"]["notificationPreferences"] == {"connectionUpdates": False, "weeklyNewsletter": True}
        assert captured[-1]["method"] == "PATCH"
        assert captured[-1]["url"] == "https://api.example.test/api/auth/profile/update"
        assert captured[-1]["body"]["name"] == "Ada L."
        assert dashboard_api.update_profile("nope") == {"success": False, "error": "Profile body must be an object."}

        captured = []
        install_fake_urlopen([FakeResponse({"success": True, "intro": "Generated intro."})], captured)
        intro_result = dashboard_api.generate_intro({})
        assert intro_result == {"success": True, "intro": "Generated intro."}
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == "https://api.example.test/api/enrichment/sync"

        avatar_calls = []
        original_multipart = dashboard_api._api_multipart

        def fake_multipart(path, field, filename, content, content_type):
            avatar_calls.append((path, field, filename, content_type, len(content)))
            return {"success": True, "avatarUrl": "avatars/user-1/uploaded.png"}

        dashboard_api._api_multipart = fake_multipart
        try:
            avatar_ok = dashboard_api.upload_avatar(
                {"dataUrl": "data:image/png;base64," + base64.b64encode(b"pixels").decode("ascii")}
            )
        finally:
            dashboard_api._api_multipart = original_multipart
        assert avatar_ok["success"] is True
        assert avatar_ok["avatarUrl"] == "https://api.example.test/api/storage/avatars/user-1/uploaded.png"
        assert avatar_calls == [("/storage/avatars", "avatar", "avatar.png", "image/png", 6)]
        assert dashboard_api.upload_avatar({"dataUrl": "not-a-data-url"})["success"] is False

        captured = []
        install_fake_urlopen([FakeResponse({"success": True})], captured)
        archive_ok = dashboard_api.archive_intent("intent-1")
        assert archive_ok == {"success": True}
        assert captured[-1]["method"] == "PATCH"
        assert captured[-1]["url"] == "https://api.example.test/api/intents/intent-1/archive"
        assert dashboard_api.archive_intent("") == {"success": False, "error": "An intent id is required."}

        captured = []
        install_fake_urlopen(
            [
                FakeResponse({"user": {"id": "user-1"}}),
                FakeResponse(
                    {
                        "conversations": [
                            {
                                "id": "conv-1",
                                "participants": [
                                    {"participantId": "user-1", "participantType": "user", "name": "Me"},
                                    {
                                        "participantId": "other",
                                        "participantType": "user",
                                        "name": "Grace",
                                        "avatar": "avatars/other/g.png",
                                    },
                                ],
                                "metadata": {},
                                "lastMessage": {
                                    "parts": [{"type": "text", "text": "hi there"}],
                                    "senderId": "other",
                                    "createdAt": "2026-06-01T00:00:00.000Z",
                                },
                                "lastMessageAt": "2026-06-01T00:00:00.000Z",
                                "createdAt": "2026-05-31T00:00:00.000Z",
                            },
                            {
                                # Human-to-agent thread — must be filtered out of the list.
                                "id": "conv-h2a",
                                "participants": [
                                    {"participantId": "user-1", "participantType": "user", "name": "Me"},
                                    {"participantId": "agent:peer", "participantType": "agent", "name": "SF Connections", "ownerName": "Grace"},
                                ],
                                "metadata": {},
                                "lastMessage": {
                                    "parts": [{"kind": "data", "data": {"message": "I've looked through your network"}}],
                                    "senderId": "agent:peer",
                                    "createdAt": "2026-06-01T01:00:00.000Z",
                                },
                                "lastMessageAt": "2026-06-01T01:00:00.000Z",
                                "createdAt": "2026-05-31T00:00:00.000Z",
                            },
                        ]
                    }
                ),
            ],
            captured,
        )
        conv_list = dashboard_api.list_conversations()
        assert conv_list["success"] is True
        assert conv_list["currentUserId"] == "user-1"
        # Only the human-to-human conversation is listed (H2A is excluded).
        assert len(conv_list["conversations"]) == 1
        assert [c["id"] for c in conv_list["conversations"]] == ["conv-1"]
        conv = conv_list["conversations"][0]
        assert conv["id"] == "conv-1"
        assert conv["counterpartUserId"] == "other"
        assert conv["counterpartName"] == "Grace"
        assert conv["title"] == "Grace"
        assert conv["avatar"] == "https://api.example.test/api/storage/avatars/other/g.png"
        assert conv["lastMessagePreview"] == "hi there"
        assert conv["kind"] == "dm"

        # Agent/negotiation threads: the user's own agent must be skipped as the
        # counterpart, the human behind the peer agent surfaces via ownerName,
        # and the conversation is tagged as a negotiation.
        negotiation = dashboard_api._normalize_conversation(
            {
                "id": "conv-neg",
                "participants": [
                    {"participantId": "agent:user-1", "participantType": "agent", "name": "My Agent", "ownerName": "Me"},
                    {"participantId": "agent:peer", "participantType": "agent", "name": "Peer Agent", "ownerName": "Grace"},
                ],
                "metadata": {},
                "lastMessageAt": "2026-06-02T00:00:00.000Z",
            },
            "user-1",
        )
        assert negotiation["kind"] == "negotiation"
        assert negotiation["counterpartUserId"] == "agent:peer"
        assert negotiation["counterpartName"] == "Grace"

        captured = []
        install_fake_urlopen(
            [
                FakeResponse(
                    {
                        "conversation": {
                            "id": "conv-2",
                            "participants": [
                                {"participantId": "user-1", "participantType": "user", "name": "Me"},
                                {"participantId": "other", "participantType": "user", "name": "Grace"},
                            ],
                            "metadata": {},
                            "lastMessage": None,
                            "lastMessageAt": None,
                            "createdAt": "2026-06-02T00:00:00.000Z",
                        }
                    }
                ),
                FakeResponse({"user": {"id": "user-1"}}),
            ],
            captured,
        )
        dm = dashboard_api.create_dm({"peerUserId": "other"})
        assert dm["success"] is True
        assert dm["conversation"]["id"] == "conv-2"
        assert dm["conversation"]["counterpartUserId"] == "other"
        assert captured[0]["method"] == "POST"
        assert captured[0]["url"] == "https://api.example.test/api/conversations/dm"
        assert captured[0]["body"] == {"peerUserId": "other"}
        assert dashboard_api.create_dm({}) == {"success": False, "error": "peerUserId is required."}

        captured = []
        install_fake_urlopen(
            [
                FakeResponse({"user": {"id": "user-1"}}),
                FakeResponse(
                    {
                        "messages": [
                            {
                                "id": "m1",
                                "conversationId": "conv-1",
                                "senderId": "other",
                                "parts": [{"type": "text", "text": "hi there"}],
                                "createdAt": "2026-06-01T00:00:00.000Z",
                            }
                        ]
                    }
                ),
            ],
            captured,
        )
        msgs = dashboard_api.list_messages("conv-1")
        assert msgs["success"] is True
        assert msgs["currentUserId"] == "user-1"
        assert msgs["messages"][0]["id"] == "m1"
        assert msgs["messages"][0]["parts"] == [{"type": "text", "text": "hi there"}]
        assert dashboard_api.list_messages("") == {"success": False, "error": "A conversation id is required."}

        # _message_text must extract text from every part shape the backend emits:
        # plain text (type), agent text (kind), and data parts (data.message / reasoning).
        assert dashboard_api._message_text([{"type": "text", "text": "hi there"}]) == "hi there"
        assert dashboard_api._message_text([{"kind": "text", "text": "from seren"}]) == "from seren"
        assert dashboard_api._message_text([{"kind": "data", "data": {"message": "agent msg"}}]) == "agent msg"
        assert dashboard_api._message_text([{"kind": "data", "data": {"assessment": {"reasoning": "because"}}}]) == "because"
        assert dashboard_api._message_text([{"kind": "other"}]) == ""

        captured = []
        install_fake_urlopen(
            [
                FakeResponse(
                    {
                        "message": {
                            "id": "m2",
                            "conversationId": "conv-1",
                            "senderId": "user-1",
                            "parts": [{"type": "text", "text": "yo"}],
                            "createdAt": "2026-06-01T00:01:00.000Z",
                        }
                    }
                )
            ],
            captured,
        )
        sent = dashboard_api.send_message("conv-1", {"text": "yo"})
        assert sent["success"] is True
        assert sent["message"]["id"] == "m2"
        assert captured[-1]["method"] == "POST"
        assert captured[-1]["url"] == "https://api.example.test/api/conversations/conv-1/messages"
        assert captured[-1]["body"] == {"parts": [{"type": "text", "text": "yo"}]}
        assert dashboard_api.send_message("conv-1", {"text": ""}) == {
            "success": False,
            "error": "Message text is required.",
        }
        assert dashboard_api.send_message("", {"text": "yo"}) == {
            "success": False,
            "error": "A conversation id is required.",
        }

        captured = []
        install_fake_urlopen(
            [
                FakeResponse({"user": {"id": "user-1"}}),
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
                # read_user_contexts(userId) via the REST tool surface.
                FakeResponse(
                    {
                        "success": True,
                        "data": {"hasProfile": True, "name": "Grace Hopper", "context": "Grace builds compilers."},
                    }
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
            ("GET", "https://api.example.test/api/auth/me"),
            ("GET", "https://api.example.test/api/opportunities"),
            ("GET", "https://api.example.test/api/opportunities?status=expired"),
            ("GET", "https://api.example.test/api/users/other"),
        ]
        public_tool = [(entry["method"], entry["url"], entry["body"]) for entry in captured if entry["body"]]
        assert public_tool == [
            ("POST", "https://api.example.test/api/tools/read_user_contexts", {"query": {"userId": "other"}}),
        ]

        assert dashboard_api.public_profile("") == {"success": False, "error": "A user id is required."}

        # --- Mac/CLI-parity browser login backend -----------------------------
        auth_login = dashboard_api.auth_login
        env_dir = tempfile.mkdtemp()
        env_file = os.path.join(env_dir, ".env")
        old_env_path = os.environ.pop("HERMES_ENV_PATH", None)
        old_key_id = os.environ.pop("INDEX_API_KEY_ID", None)
        os.environ["HERMES_ENV_PATH"] = env_file
        try:
            # .env merge: update INDEX_API_KEY in place, keep the other vars.
            with open(env_file, "w", encoding="utf-8") as handle:
                handle.write("FOO=1\nINDEX_API_KEY=old\nBAR=2\n")
            auth_login.persist_api_key("minted-key", "kid-1")
            merged = open(env_file, encoding="utf-8").read()
            assert "FOO=1" in merged and "BAR=2" in merged
            assert "INDEX_API_KEY=minted-key" in merged
            assert "INDEX_API_KEY_ID=kid-1" in merged
            assert os.environ["INDEX_API_KEY"] == "minted-key"
            auth_login.clear_api_key()
            cleared = open(env_file, encoding="utf-8").read()
            assert "INDEX_API_KEY" not in cleared
            assert "FOO=1" in cleared and "BAR=2" in cleared
            assert "INDEX_API_KEY" not in os.environ

            # Login origin pairs with the active API env: an explicit
            # INDEX_APP_BASE_URL wins, otherwise it derives from INDEX_API_URL by
            # dropping the leading `protocol.` label (so dev never mints a prod key).
            saved_api_url = os.environ.get("INDEX_API_URL")
            os.environ.pop("INDEX_APP_BASE_URL", None)
            try:
                os.environ["INDEX_API_URL"] = "https://protocol.dev.index.network/api"
                assert dashboard_api._login_app_base_url() == "https://dev.index.network"
                os.environ["INDEX_API_URL"] = "https://protocol.index.network/api"
                assert dashboard_api._login_app_base_url() == "https://index.network"
                os.environ["INDEX_APP_BASE_URL"] = "https://staging.index.network"
                assert dashboard_api._login_app_base_url() == "https://staging.index.network"
            finally:
                os.environ.pop("INDEX_APP_BASE_URL", None)
                if saved_api_url is not None:
                    os.environ["INDEX_API_URL"] = saved_api_url

            # Loopback handshake drives poll_status to success (real sockets).
            urllib.request.urlopen = old_urlopen
            auth_url = auth_login.start_login("https://app.example.test")
            parsed_auth = urllib.parse.urlsplit(auth_url)
            assert parsed_auth.path == "/cli-auth"
            auth_params = urllib.parse.parse_qs(parsed_auth.query)
            assert auth_params["version"] == ["2"]
            callback = auth_params["callback"][0]
            state = auth_params["state"][0]
            assert auth_login.poll_status()["status"] == "pending"
            with old_urlopen(
                callback + "?" + urllib.parse.urlencode({"state": state, "api_key": "loop-key", "key_id": "loop-kid"})
            ) as resp:
                assert resp.status == 200
            success = auth_login.poll_status()
            assert success["status"] == "success"
            assert os.environ["INDEX_API_KEY"] == "loop-key"
            assert os.environ["INDEX_API_KEY_ID"] == "loop-kid"
            assert auth_login.poll_status()["status"] == "idle"  # terminal + torn down

            # A mismatched callback state fails the attempt.
            auth_url2 = auth_login.start_login("https://app.example.test")
            callback2 = urllib.parse.parse_qs(urllib.parse.urlsplit(auth_url2).query)["callback"][0]
            try:
                old_urlopen(callback2 + "?" + urllib.parse.urlencode({"state": "wrong", "api_key": "x", "key_id": "y"}))
                raise AssertionError("mismatched state should return HTTP 400")
            except urllib.error.HTTPError as exc:
                assert exc.code == 400
            # The bad callback did not resolve the session; it is still pending.
            assert auth_login.poll_status()["status"] == "pending"

            # /auth/status: a working key is authenticated; a missing key needs login.
            captured = []
            install_fake_urlopen([FakeResponse({"user": {"id": "user-1", "email": "ada@example.test"}})], captured)
            status_ok = dashboard_api.auth_status()
            assert status_ok["authenticated"] is True and status_ok["needsLogin"] is False
            assert captured[-1]["url"] == "https://api.example.test/api/auth/me"
            os.environ.pop("INDEX_API_KEY", None)
            needs = dashboard_api.auth_status()
            assert needs["authenticated"] is False and needs["needsLogin"] is True

            # /auth/status: an authenticated key that 401s falls back to the gate.
            os.environ["INDEX_API_KEY"] = "stale-key"
            captured = []
            install_fake_urlopen([http_error(401, {"error": "Unauthorized."})], captured)
            unauthorized = dashboard_api.auth_status()
            assert unauthorized["needsLogin"] is True

            # /auth/logout: best-effort revoke with the stored id, then clear.
            os.environ["INDEX_API_KEY"] = "loop-key"
            os.environ["INDEX_API_KEY_ID"] = "loop-kid"
            with open(env_file, "w", encoding="utf-8") as handle:
                handle.write("INDEX_API_KEY=loop-key\nINDEX_API_KEY_ID=loop-kid\nKEEP=yes\n")
            captured = []
            install_fake_urlopen([FakeResponse({"success": True})], captured)
            logout = dashboard_api.auth_logout()
            assert logout == {"success": True, "needsLogin": True}
            assert captured[-1]["method"] == "POST"
            assert captured[-1]["url"] == "https://api.example.test/api/auth/cli-credential/revoke"
            assert captured[-1]["body"] == {"keyId": "loop-kid", "targetKey": "loop-key"}
            after_logout = open(env_file, encoding="utf-8").read()
            assert "INDEX_API_KEY" not in after_logout and "KEEP=yes" in after_logout
            assert "INDEX_API_KEY" not in os.environ
        finally:
            urllib.request.urlopen = old_urlopen
            os.environ.pop("HERMES_ENV_PATH", None)
            if old_env_path is not None:
                os.environ["HERMES_ENV_PATH"] = old_env_path
            os.environ.pop("INDEX_API_KEY_ID", None)
            if old_key_id is not None:
                os.environ["INDEX_API_KEY_ID"] = old_key_id
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
