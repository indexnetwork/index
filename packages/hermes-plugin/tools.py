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
import urllib.parse
from subprocess import run as run_process
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
_GUIDANCE_TOPICS = (
    "identity-context",
    "signals",
    "communities-networks",
    "opportunities",
    "negotiations",
    "workflows",
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


def selected_agent() -> dict[str, Any]:
    """Read the agent this key's owner selected to handle negotiations.

    @returns The selected agent entity.
    @throws ValueError when the read fails, or when the API cannot fence a turn
            to one external executor — without that fence a stale negotiator on
            another machine could still submit turns for this owner.
    """
    payload = _api_request("GET", "/agents/me")
    if payload.get("success") is False or payload.get("error"):
        raise ValueError(payload.get("error") or "Index request failed")
    if payload.get("negotiationExecutorFence") is not True:
        raise ValueError("This Index API does not support fenced external turns. Upgrade the API before enabling the Hermes personal agent.")
    return payload["agent"]


def _api_result(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    *,
    no_content_payload: dict[str, Any] | None = None,
) -> str:
    return _json(_with_app_urls(_api_request(method, path, body, no_content_payload=no_content_payload)))


def _query(params: dict[str, Any]) -> str:
    encoded = urllib.parse.urlencode({key: value for key, value in params.items() if value is not None})
    return f"?{encoded}" if encoded else ""


def _required_id(args: dict, key: str) -> tuple[str | None, str | None]:
    value = _clean_string(args.get(key))
    if value is None:
        return None, f"{key} is required."
    return value, None


def index_read_intents(args: dict, **kwargs) -> str:
    """Read the caller's signals, or the signals shared in one community."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")

    limit, limit_error = _positive_int(args.get("limit"), "limit", maximum=100)
    if limit_error:
        return _error(limit_error)
    page, page_error = _positive_int(args.get("page"), "page")
    if page_error:
        return _error(page_error)

    network_id = _clean_string(args.get("networkId"))
    if network_id:
        return _api_result("GET", f"/networks/{urllib.parse.quote(network_id)}/intents{_query({'limit': limit, 'page': page})}")

    body: dict[str, Any] = {}
    if limit is not None:
        body["limit"] = limit
    if page is not None:
        body["page"] = page
    query = _clean_string(args.get("query"))
    if query:
        body["q"] = query
    if args.get("archived") is True:
        body["archived"] = True
    return _api_result("POST", "/intents/list", body)


def index_create_intent(args: dict, **kwargs) -> str:
    """Create a signal, shared in every community unless networkIds narrows it."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    description = _clean_string(args.get("description"))
    if description is None:
        return _error("description is required.")
    body: dict[str, Any] = {"description": description}
    network_ids = args.get("networkIds")
    if isinstance(network_ids, list) and network_ids:
        body["networkIds"] = [str(item) for item in network_ids]
    return _api_result("POST", "/intents", body)


def index_update_intent(args: dict, **kwargs) -> str:
    """Rewrite a signal's description and reprocess it."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    intent_id, error = _required_id(args, "intentId")
    if error:
        return _error(error)
    description = _clean_string(args.get("description"))
    if description is None:
        return _error("description is required.")
    return _api_result("PATCH", f"/intents/{urllib.parse.quote(intent_id)}", {"description": description})


def index_list_intent_networks(args: dict, **kwargs) -> str:
    """List the communities a signal is shared in."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    intent_id, error = _required_id(args, "intentId")
    if error:
        return _error(error)
    return _api_result("GET", f"/intents/{urllib.parse.quote(intent_id)}/networks")


def index_add_intent_to_network(args: dict, **kwargs) -> str:
    """Share a signal in one community."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    intent_id, intent_error = _required_id(args, "intentId")
    if intent_error:
        return _error(intent_error)
    network_id, network_error = _required_id(args, "networkId")
    if network_error:
        return _error(network_error)
    return _api_result(
        "POST",
        f"/intents/{urllib.parse.quote(intent_id)}/networks",
        {"networkId": network_id},
        no_content_payload={"success": True},
    )


def index_read_networks(args: dict, **kwargs) -> str:
    """Read the communities the caller belongs to."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    return _api_result("GET", "/networks")


def index_read_network_memberships(args: dict, **kwargs) -> str:
    """Read one community's roster."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    network_id, error = _required_id(args, "networkId")
    if error:
        return _error(error)
    return _api_result("GET", f"/networks/{urllib.parse.quote(network_id)}/members")


def index_create_network(args: dict, **kwargs) -> str:
    """Create a community, or submit an early-access request when not eligible."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    title = _clean_string(args.get("title"))
    if title is None:
        return _error("title is required.")
    prompt = _clean_string(args.get("prompt"))
    created = _api_request("POST", "/networks", {"title": title, **({"prompt": prompt} if prompt else {})})
    if created.get("status") != 403:
        return _json(created)
    return _api_result("POST", "/network-requests", {"name": title, **({"purpose": prompt} if prompt else {})})


def index_update_network(args: dict, **kwargs) -> str:
    """Change a community's title or description. Owner only."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    network_id, error = _required_id(args, "networkId")
    if error:
        return _error(error)
    settings: dict[str, Any] = {}
    title = _clean_string(args.get("title"))
    if title:
        settings["title"] = title
    prompt = _clean_string(args.get("prompt"))
    if prompt:
        settings["prompt"] = prompt
    if not settings:
        return _error("Supply title or prompt.")
    return _api_result("PUT", f"/networks/{urllib.parse.quote(network_id)}", settings)


def index_join_network(args: dict, **kwargs) -> str:
    """Join an open community."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    network_id, error = _required_id(args, "networkId")
    if error:
        return _error(error)
    return _api_result(
        "POST",
        f"/networks/{urllib.parse.quote(network_id)}/join",
        {},
        no_content_payload={"success": True},
    )


def index_list_opportunities(args: dict, **kwargs) -> str:
    """Read persisted opportunities and their presentation."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    limit, limit_error = _positive_int(args.get("limit"), "limit", maximum=100)
    if limit_error:
        return _error(limit_error)
    status = _clean_string(args.get("status"))
    return _api_result("GET", f"/opportunities{_query({'status': status, 'limit': limit})}")


def index_update_opportunity(args: dict, **kwargs) -> str:
    """Move an opportunity to accepted or rejected. Accept only on owner approval."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    opportunity_id, error = _required_id(args, "opportunityId")
    if error:
        return _error(error)
    status = _clean_string(args.get("status"))
    if status not in {"accepted", "rejected"}:
        return _error("status must be accepted or rejected.")
    return _api_result(
        "PATCH",
        f"/opportunities/{urllib.parse.quote(opportunity_id)}/status",
        {"status": status},
    )


def index_research_profile(args: dict, **kwargs) -> str:
    """Research the owner's public identity without persisting the result."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    return _api_result("POST", "/enrichment/enrich", {})


def index_read_docs(args: dict, **kwargs) -> str:
    """Read the protocol's canonical guidance, optionally narrowed to one topic."""
    del kwargs
    if not isinstance(args, dict):
        return _error("Arguments must be an object.")
    topic = _clean_string(args.get("topic"))
    if topic is not None and topic not in _GUIDANCE_TOPICS:
        return _error(f"topic must be one of: {', '.join(_GUIDANCE_TOPICS)}.")
    return _api_result("GET", f"/docs{_query({'topic': topic})}")


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
        result = run_process(
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

