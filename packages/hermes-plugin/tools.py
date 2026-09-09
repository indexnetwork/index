"""Hermes tool handlers for the Index Network plugin.

Handlers follow the official Hermes plugin contract:
- signature: handler(args: dict, **kwargs) -> str
- always return a JSON string
- catch errors and return JSON error payloads instead of raising
"""

from __future__ import annotations

import copy
import json
import os
import platform
import shutil
import subprocess
import urllib.parse
from typing import Any

from .env_transport import TransportError
from .transport import get_transport, reset_transport, set_transport_for_tests

# Universal-link host for Index deep links. The macOS app claims /c/*, /o/* and
# /u/* through its apple-app-site-association file, so the same https URL opens
# the app when it is installed and the web landing page when it is not. The
# plugin never detects app installation: it runs on the agent's host, which is
# usually not the user's Mac, so the OS decides at click time.
INDEX_APP_BASE_URL = "https://index.network"
_MAX_APP_URL_WALK_DEPTH = 16
_OPEN_URL_TIMEOUT_SECONDS = 15
_FORWARDED_TOOLS = frozenset(
    {
        "research_profile",
        "create_intent",
        "update_intent",
        "add_intent_to_network",
        "list_intent_networks",
        "search_intents",
        "read_networks",
        "read_network_memberships",
        "update_network",
        "create_network",
        "create_network_membership",
        "list_opportunities",
        "update_opportunity",
        "read_docs",
    }
)


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"))


def _error(message: str, **extra: Any) -> str:
    payload: dict[str, Any] = {"success": False, "error": message}
    payload.update(extra)
    return _json(payload)


def _error_payload(message: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"success": False, "error": message}
    payload.update(extra)
    return payload


def _clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _positive_int(value: Any, name: str, *, maximum: int | None = None) -> tuple[int | None, str | None]:
    if value is None:
        return None, None
    if isinstance(value, bool):
        return None, f"{name} must be an integer."
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None, f"{name} must be an integer."
    if parsed < 1:
        return None, f"{name} must be at least 1."
    if maximum is not None and parsed > maximum:
        return None, f"{name} must be at most {maximum}."
    return parsed, None


def _app_base_url() -> str:
    """Return the universal-link origin used for Index deep links.

    Only a well-formed `https://<host>` origin is honored. A malformed or
    schemeless override (for example `index.network`) falls back to the constant:
    a base that parses to an empty scheme/netloc would make every relative path
    compare equal to it in `index_open_app` and turn that tool into a generic
    local-file opener.
    """
    raw = os.environ.get("INDEX_APP_BASE_URL", "").strip().rstrip("/")
    if not raw:
        return INDEX_APP_BASE_URL
    try:
        parts = urllib.parse.urlsplit(raw)
    except ValueError:
        return INDEX_APP_BASE_URL
    if parts.scheme != "https" or not parts.netloc:
        return INDEX_APP_BASE_URL
    return raw


def _attach_app_urls(value: Any, base_url: str, depth: int = 0) -> None:
    """Attach `appUrl` to every opportunity-shaped object in a decoded payload.

    An object counts as an opportunity when it carries a non-empty
    `opportunityId`. Existing `appUrl` values are never overwritten.
    """
    if depth > _MAX_APP_URL_WALK_DEPTH:
        return
    if isinstance(value, dict):
        opportunity_id = _clean_string(value.get("opportunityId"))
        if opportunity_id and not _clean_string(value.get("appUrl")):
            value["appUrl"] = f"{base_url}/o/{opportunity_id}"
        for item in value.values():
            _attach_app_urls(item, base_url, depth + 1)
        return
    if isinstance(value, list):
        for item in value:
            _attach_app_urls(item, base_url, depth + 1)


def _with_app_urls(payload: Any) -> Any:
    """Return the payload with deep links attached, or untouched on any surprise."""
    try:
        enriched = copy.deepcopy(payload)
        _attach_app_urls(enriched, _app_base_url())
        return enriched
    except Exception:  # noqa: BLE001 - deep links are additive; never fail a response.
        return payload


def _call_index_tool(tool_name: str, arguments: dict[str, Any]) -> str:
    try:
        result = get_transport().call_tool(tool_name, arguments)
        return _json(_with_app_urls(result))
    except TransportError as exc:
        return _json(exc.as_payload())
    except Exception as exc:  # noqa: BLE001 - Hermes handlers must not raise.
        return _error(f"Index transport response could not be processed: {exc}")


def _api_request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    *,
    no_content_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        result = get_transport().request_rest(method, path, body)
        if result.get("no_content") is True and no_content_payload is not None:
            return no_content_payload
        return result
    except TransportError as exc:
        return exc.as_payload()
    except Exception as exc:  # noqa: BLE001 - Hermes handlers must not raise.
        return _error_payload(f"Index transport response could not be processed: {exc}")


def index_forwarded_tool(tool_name: str, args: dict, **kwargs) -> str:
    """Forward a Hermes tool call to an allowlisted Index CLI tool."""
    del kwargs
    if tool_name not in _FORWARDED_TOOLS:
        return _error(f"Unsupported Index CLI tool: {tool_name}")
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    return _call_index_tool(tool_name, args)


def make_tool_handler(tool_name: str):
    """Create a Hermes handler for an allowlisted pass-through Index CLI tool."""
    if tool_name not in _FORWARDED_TOOLS:
        raise ValueError(f"Unsupported Index CLI tool: {tool_name}")

    def handler(args: dict, **kwargs) -> str:
        return index_forwarded_tool(tool_name, args, **kwargs)

    handler.__name__ = f"index_{tool_name}"
    handler.__doc__ = f"Forward to the Index CLI {tool_name} tool."
    return handler


def index_read_intents(args: dict, **kwargs) -> str:
    """Read Index Network intents through the canonical HTTP read_intents tool."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")

    arguments: dict[str, Any] = {}

    network_id = _clean_string(args.get("networkId"))
    if network_id:
        arguments["networkId"] = network_id

    user_id = _clean_string(args.get("userId"))
    if user_id:
        arguments["userId"] = user_id

    limit, limit_error = _positive_int(args.get("limit"), "limit", maximum=100)
    if limit_error:
        return _error(limit_error)
    if limit is not None:
        arguments["limit"] = limit

    page, page_error = _positive_int(args.get("page"), "page")
    if page_error:
        return _error(page_error)
    if page is not None:
        arguments["page"] = page

    return _call_index_tool("read_intents", arguments)


def _url_opener_command(url: str, system: str | None = None) -> list[str] | None:
    """Return the platform command that hands a URL to the OS, if there is one."""
    resolved = (system or platform.system() or "").strip().lower()
    if resolved == "darwin":
        return ["open", url]
    if resolved == "windows":
        # Never route through `cmd /c start`: subprocess quotes an argument only
        # when it contains whitespace, so cmd.exe metacharacters (& | ^ < > %)
        # inside an otherwise valid https://index.network URL would survive
        # unquoted and execute as separate commands. rundll32 is handed the URL
        # as a single argv entry and no shell ever re-parses it.
        return ["rundll32", "url.dll,FileProtocolHandler", url]
    if shutil.which("xdg-open"):
        return ["xdg-open", url]
    return None


def _open_url(command: list[str]) -> str | None:
    """Run a URL-opener command. Returns None on success, an error string otherwise."""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=_OPEN_URL_TIMEOUT_SECONDS,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001 - Hermes handlers must not raise.
        return str(exc)
    if result.returncode != 0:
        return (result.stderr or "").strip() or f"exit code {result.returncode}"
    return None


def index_open_app(args: dict, **kwargs) -> str:
    """Open an Index universal link with the operating system's default handler."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")

    base_url = _app_base_url()
    target = _clean_string(args.get("target")) or base_url

    try:
        base_parts = urllib.parse.urlsplit(base_url)
        target_parts = urllib.parse.urlsplit(target)
    except ValueError:
        return _error(f"target must be an {base_url} URL.")
    # An absolute https origin is required in its own right, not just an origin
    # that matches the base: a bare filesystem path used as a target has an empty
    # scheme and netloc and must never be handed to the OS opener.
    if target_parts.scheme != "https" or not target_parts.netloc:
        return _error(f"target must be an {base_url} URL.")
    if target_parts.scheme != base_parts.scheme or target_parts.netloc != base_parts.netloc:
        return _error(f"target must be an {base_url} URL.")

    command = _url_opener_command(target)
    if command is None:
        return _error(
            f"No URL opener is available on this host. Open {target} manually to continue in the Index app.",
            url=target,
        )

    failure = _open_url(command)
    if failure is not None:
        return _error(f"Could not open {target}: {failure}", url=target)
    return _json({"success": True, "url": target})


def index_agent_me(args: dict, **kwargs) -> str:
    """Return the agent the key's owner selected to handle negotiations."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    payload = _api_request("GET", "/agents/me")
    if payload.get("success") is False:
        return _json(payload)
    merged = {"success": True}
    merged.update(payload)
    merged["success"] = True
    return _json(merged)

