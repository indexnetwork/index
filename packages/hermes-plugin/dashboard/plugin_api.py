"""Index Network Hermes dashboard plugin backend.

Mounted at /api/plugins/index-network/ by Hermes dashboard. The routes are
read-only and reuse the plugin's native Index MCP tool handlers so dashboard
visibility stays scoped to the configured INDEX_API_KEY principal.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

try:
    from fastapi import APIRouter
except Exception:  # Allows local smoke tests without dashboard dependencies.
    class APIRouter:  # type: ignore
        def get(self, *_args, **_kwargs):
            return lambda fn: fn

router = APIRouter()

_DASHBOARD_DIR = Path(__file__).resolve().parent
_PLUGIN_ROOT = _DASHBOARD_DIR.parent
_TOOLS_PATH = _PLUGIN_ROOT / "tools.py"
_SUMMARY_LIMIT = 12
_PREVIEW_CHARS = 240


def _load_tools_module():
    spec = importlib.util.spec_from_file_location("index_network_hermes_dashboard_tools", _TOOLS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load Index Network tools module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tools = _load_tools_module()


def _parse_tool_json(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"success": False, "error": f"Index tool returned invalid JSON: {exc}"}
    if isinstance(parsed, dict):
        return parsed
    return {"success": True, "data": parsed}


def _call_read_intents() -> dict[str, Any]:
    return _parse_tool_json(tools.index_read_intents({"limit": _SUMMARY_LIMIT, "page": 1}))


def _call_mcp(tool_name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    return _parse_tool_json(tools.index_forwarded_mcp_tool(tool_name, args or {}))


def _data(payload: dict[str, Any]) -> Any:
    if payload.get("success") is False:
        return None
    return payload.get("data") if "data" in payload else payload


def _text(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    if isinstance(value, str):
        return value.strip() or fallback
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, dict):
        for key in ("summary", "description", "title", "name", "text", "value"):
            result = _text(value.get(key))
            if result:
                return result
    return fallback


def _truncate(value: Any, limit: int = _PREVIEW_CHARS) -> str:
    clean = re.sub(r"\s+", " ", _text(value)).strip()
    if len(clean) <= limit:
        return clean
    return clean[: limit - 1].rstrip() + "…"


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _section_error(payload: dict[str, Any]) -> str | None:
    if payload.get("success") is not False:
        return None
    return _text(payload.get("error"), "Index request failed.")


def _same_preview(left: str, right: str) -> bool:
    lhs = re.sub(r"\s+", " ", left).strip().rstrip("…")
    rhs = re.sub(r"\s+", " ", right).strip().rstrip("…")
    if not lhs or not rhs:
        return False
    return lhs == rhs or lhs.startswith(rhs) or rhs.startswith(lhs)


def _normalize_intents(payload: dict[str, Any], intent_networks: dict[str, list[str]] | None = None) -> dict[str, Any]:
    data = _data(payload)
    intents = _list(data.get("intents") if isinstance(data, dict) else None)
    networks_by_intent = intent_networks or {}
    items = []
    for intent in intents[:_SUMMARY_LIMIT]:
        if not isinstance(intent, dict):
            continue
        intent_id = _text(intent.get("id"))
        summary = _text(intent.get("summary"))
        description = _text(intent.get("description") or intent.get("payload") or intent.get("context"))
        title = (
            _truncate(summary, 140)
            or _truncate(description, 140)
            or "Untitled intent"
        )
        detail = _truncate(description)
        item: dict[str, Any] = {"title": title}
        if detail and not _same_preview(title, detail):
            item["detail"] = detail
        status = _text(intent.get("status"))
        if status:
            item["status"] = status
        assigned_networks = networks_by_intent.get(intent_id, []) if intent_id else []
        if assigned_networks:
            item["networks"] = assigned_networks[:4]
        confidence = intent.get("confidence")
        if isinstance(confidence, (int, float)):
            item["meta"] = f"{round(confidence * 100)}% confidence"
        items.append(item)
    total = data.get("totalCount", data.get("count", len(items))) if isinstance(data, dict) else len(items)
    return {"items": items, "count": total if isinstance(total, int) else len(items), "error": _section_error(payload)}


def _parse_opportunity_message(message: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    body_lines: list[str] = []

    def flush() -> None:
        nonlocal current, body_lines
        if current is None:
            return
        detail_lines = []
        status = None
        for line in body_lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.lower().startswith("status:"):
                status = stripped.split(":", 1)[1].strip()
                continue
            if re.match(r"^(profileUrl|acceptUrl|opportunityId|feedCategory|negotiationUrl|confidence):", stripped):
                continue
            if stripped.startswith("<!--"):
                continue
            detail_lines.append(stripped)
        if detail_lines:
            current["detail"] = _truncate(" ".join(detail_lines))
        if status:
            current["status"] = status
        items.append(current)
        current = None
        body_lines = []

    for raw_line in message.splitlines():
        match = re.match(r"^\s*\d+\.\s+(.+?)\s*$", raw_line)
        if match:
            flush()
            current = {"title": _truncate(match.group(1), 120) or "Opportunity"}
            continue
        if current is not None:
            body_lines.append(raw_line)
    flush()
    return items


def _normalize_opportunities(payload: dict[str, Any]) -> dict[str, Any]:
    data = _data(payload)
    if not isinstance(data, dict):
        return {"items": [], "count": 0, "error": _section_error(payload)}
    message = _text(data.get("message"))
    items = _parse_opportunity_message(message)[:_SUMMARY_LIMIT] if message else []
    count = data.get("count", len(items))
    if not items and data.get("summary") and (not isinstance(count, int) or count > 0):
        items = [{"title": _text(data.get("summary")), "detail": _truncate(data.get("message"))}]
    return {
        "items": items,
        "count": count if isinstance(count, int) else len(items),
        "emptyMessage": _text(data.get("message")) if not items else "",
        "error": _section_error(payload),
    }


def _count_from_negotiation_payload(payload: dict[str, Any]) -> int:
    data = _data(payload)
    if not isinstance(data, dict):
        return 0
    count = data.get("totalCount", data.get("count", 0))
    return count if isinstance(count, int) else 0


def _normalize_negotiation_activity(payloads: dict[str, dict[str, Any]]) -> dict[str, Any]:
    errors = [_section_error(payload) for payload in payloads.values()]
    first_error = next((err for err in errors if err), None)
    total = _count_from_negotiation_payload(payloads.get("all", {}))
    waiting = _count_from_negotiation_payload(payloads.get("waiting_for_agent", {}))
    active = _count_from_negotiation_payload(payloads.get("active", {}))
    completed = _count_from_negotiation_payload(payloads.get("completed", {}))
    return {
        "count": total,
        "summary": {
            "active": active,
            "waitingForAgent": waiting,
            "completed": completed,
            "needsAttention": waiting,
        },
        "note": "No negotiation conversations are rendered in this read-only dashboard.",
        "error": first_error,
    }


def _network_key(network: dict[str, Any]) -> str:
    for key in ("networkId", "id", "title", "name"):
        value = _text(network.get(key))
        if value:
            return value
    return json.dumps(network, sort_keys=True, default=str)


def _joined_network_refs(payload: dict[str, Any]) -> list[dict[str, str]]:
    data = _data(payload)
    joined: list[Any] = []
    if isinstance(data, dict):
        joined.extend(_list(data.get("memberOf")))
        joined.extend(_list(data.get("owns")))
    refs: list[dict[str, str]] = []
    seen: set[str] = set()
    for membership in _list(data.get("memberships") if isinstance(data, dict) else None):
        if not isinstance(membership, dict):
            continue
        network_id = _text(membership.get("networkId") or membership.get("id"))
        if not network_id or network_id in seen:
            continue
        seen.add(network_id)
        refs.append({"id": network_id, "title": _text(membership.get("networkTitle") or membership.get("title") or membership.get("name"), "Untitled network")})
    for network in joined:
        if not isinstance(network, dict):
            continue
        network_id = _text(network.get("networkId") or network.get("id"))
        if not network_id or network_id in seen:
            continue
        seen.add(network_id)
        refs.append({"id": network_id, "title": _text(network.get("title") or network.get("name"), "Untitled network")})
    return refs


def _intent_ids(payload: dict[str, Any]) -> list[str]:
    data = _data(payload)
    intents = _list(data.get("intents") if isinstance(data, dict) else None)
    ids: list[str] = []
    for intent in intents[:_SUMMARY_LIMIT]:
        if not isinstance(intent, dict):
            continue
        intent_id = _text(intent.get("id"))
        if intent_id:
            ids.append(intent_id)
    return ids


def _intent_network_titles(networks_payload: dict[str, Any], intent_ids: list[str]) -> dict[str, list[str]]:
    titles_by_network = {ref["id"]: ref["title"] for ref in _joined_network_refs(networks_payload)}
    titles_by_intent: dict[str, list[str]] = {}
    for intent_id in intent_ids[:_SUMMARY_LIMIT]:
        for network_id, network_title in list(titles_by_network.items())[:_SUMMARY_LIMIT]:
            link_payload = _call_mcp("read_intent_indexes", {"intentId": intent_id, "networkId": network_id})
            data = _data(link_payload)
            links = _list(data.get("links") if isinstance(data, dict) else None)
            if not links:
                continue
            titles = titles_by_intent.setdefault(intent_id, [])
            if network_title not in titles:
                titles.append(network_title)
    return titles_by_intent


def _normalize_networks(payload: dict[str, Any]) -> dict[str, Any]:
    data = _data(payload)
    joined: list[Any] = []
    if isinstance(data, dict):
        joined.extend(_list(data.get("memberOf")))
        joined.extend(_list(data.get("owns")))
    seen: set[str] = set()
    items = []
    for network in joined:
        if not isinstance(network, dict):
            continue
        key = _network_key(network)
        if key in seen:
            continue
        seen.add(key)
        title = _text(network.get("title") or network.get("name"), "Untitled network")
        detail = _truncate(network.get("renderedContext") or network.get("prompt") or network.get("description"))
        permissions = _list(network.get("permissions"))
        meta_parts = []
        if network.get("isPersonal") is True:
            meta_parts.append("personal")
        if permissions:
            meta_parts.append(", ".join(_text(p) for p in permissions if _text(p)))
        item: dict[str, Any] = {"title": title}
        if detail:
            item["detail"] = detail
        if meta_parts:
            item["meta"] = " · ".join(meta_parts)
        items.append(item)
    return {"items": items[:_SUMMARY_LIMIT], "count": len(items), "error": _section_error(payload)}


@router.get("/summary")
def summary() -> dict[str, Any]:
    """Return a read-only, user-scoped dashboard summary."""
    intents_payload = _call_read_intents()
    opportunities_payload = _call_mcp("list_opportunities")
    networks_payload = _call_mcp("read_networks")
    memberships_payload = _call_mcp("read_network_memberships")
    intent_networks = _intent_network_titles(memberships_payload, _intent_ids(intents_payload))
    negotiation_payloads = {
        "all": _call_mcp("list_negotiations", {"status": "all", "limit": 1, "page": 1}),
        "active": _call_mcp("list_negotiations", {"status": "active", "limit": 1, "page": 1}),
        "waiting_for_agent": _call_mcp("list_negotiations", {"status": "waiting_for_agent", "limit": 1, "page": 1}),
        "completed": _call_mcp("list_negotiations", {"status": "completed", "limit": 1, "page": 1}),
    }

    return {
        "success": True,
        "sections": {
            "intents": _normalize_intents(intents_payload, intent_networks),
            "opportunities": _normalize_opportunities(opportunities_payload),
            "negotiations": _normalize_negotiation_activity(negotiation_payloads),
            "networks": _normalize_networks(networks_payload),
        },
    }
