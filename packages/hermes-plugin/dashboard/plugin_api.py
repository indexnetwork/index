"""Index Network Hermes dashboard plugin backend.

Mounted at /api/plugins/index-network/ by Hermes dashboard. The routes reuse
the plugin's native Index tool handlers so dashboard visibility and
question-answer writes stay scoped to the configured INDEX_API_KEY principal.

The dashboard is intent-centric: each intent (intent) carries its own pending
questions and its own opportunities ("radar"). Questions and opportunities not
tied to a intent land in a "general" bucket. Networks are returned separately
for the Networks view.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    from fastapi import APIRouter, Body
except Exception:  # Allows local smoke tests without dashboard dependencies.
    def Body(default=None, **_kwargs):  # type: ignore
        return default

    class APIRouter:  # type: ignore
        def get(self, *_args, **_kwargs):
            return lambda fn: fn

        def post(self, *_args, **_kwargs):
            return lambda fn: fn

router = APIRouter()

_DASHBOARD_DIR = Path(__file__).resolve().parent
_PLUGIN_ROOT = _DASHBOARD_DIR.parent
_TOOLS_PATH = _PLUGIN_ROOT / "tools.py"
_INTENT_PAGE_SIZE = 100
_MAX_INTENT_PAGES = 10
_QUESTION_LIMIT = 10
_PREVIEW_CHARS = 240

# Maps raw opportunity status values to the radar status strip buckets.
_STATUS_BUCKET = {
    "latent": "ready",
    "draft": "ready",
    "pending": "negotiating",
    "negotiating": "negotiating",
    "stalled": "negotiating",
    "accepted": "accepted",
    "rejected": "expired",
    "expired": "expired",
}


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
    """Fetch all of the caller's intents across pages so every intent resolves a title."""
    all_intents: list[dict[str, Any]] = []
    last_error: dict[str, Any] | None = None
    page = 1
    while page <= _MAX_INTENT_PAGES:
        payload = _parse_tool_json(tools.index_read_intents({"limit": _INTENT_PAGE_SIZE, "page": page}))
        if payload.get("success") is False:
            last_error = payload
            break
        data = _data(payload)
        intents = _list(data.get("intents") if isinstance(data, dict) else None)
        all_intents.extend(intent for intent in intents if isinstance(intent, dict))
        total_pages = data.get("totalPages") if isinstance(data, dict) else None
        if isinstance(total_pages, int):
            if page >= total_pages:
                break
        elif len(intents) < _INTENT_PAGE_SIZE:
            break
        page += 1
    if not all_intents and last_error is not None:
        return last_error
    return {"success": True, "data": {"intents": all_intents, "count": len(all_intents)}}


def _call_mcp(tool_name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    return _parse_tool_json(tools.index_forwarded_mcp_tool(tool_name, args or {}))


def _call_pending_questions() -> dict[str, Any]:
    return _call_mcp("read_pending_questions", {"limit": _QUESTION_LIMIT})


def _call_answer_question(question_id: str, answer: dict[str, Any]) -> dict[str, Any]:
    return tools._api_request("POST", f"/questions/{quote(question_id, safe='')}/answer", answer)


def _call_dismiss_question(question_id: str) -> dict[str, Any]:
    return tools._api_request("POST", f"/questions/{quote(question_id, safe='')}/dismiss")


def _fetch_opportunities(query: str = "") -> tuple[list[dict[str, Any]], str | None]:
    """Fetch raw opportunity rows over REST so intent linkage is preserved."""
    payload = tools._api_request("GET", "/opportunities" + query)
    if payload.get("success") is False:
        return [], _section_error(payload)
    rows = payload.get("opportunities")
    if not isinstance(rows, list):
        return [], None
    return [opp for opp in rows if isinstance(opp, dict)], None


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


def _normalize_question_options(value: Any) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    for option in _list(value):
        if isinstance(option, str):
            label = _text(option)
            if label:
                options.append({"label": label, "description": ""})
            continue
        if not isinstance(option, dict):
            continue
        label = _text(option.get("label"))
        if not label:
            continue
        options.append({"label": label, "description": _text(option.get("description"))})
    return options


def _question_item(question: dict[str, Any]) -> dict[str, Any] | None:
    question_id = _text(question.get("id"))
    if not question_id:
        return None
    mode = _text(question.get("mode"))
    source_type = _text(question.get("sourceType"))
    meta_parts = [part for part in (mode, source_type) if part]
    item: dict[str, Any] = {
        "id": question_id,
        "title": _text(question.get("title"), "Question"),
        "prompt": _text(question.get("prompt")),
        "options": _normalize_question_options(question.get("options")),
        "multiSelect": bool(question.get("multiSelect")),
    }
    if mode:
        item["mode"] = mode
    if question.get("createdAt"):
        item["createdAt"] = _text(question.get("createdAt"))
    if question.get("expiresAt"):
        item["expiresAt"] = _text(question.get("expiresAt"))
    if meta_parts:
        item["meta"] = " · ".join(meta_parts)
    return item


def _question_target(question: dict[str, Any], opp_to_intent: dict[str, str], known_ids: set[str]) -> str | None:
    """Resolve which intent (intent id) a pending question belongs to, or None for general."""
    mode = _text(question.get("mode"))
    source_id = _text(question.get("sourceId"))
    if mode == "intent" and source_id in known_ids:
        return source_id
    if mode == "negotiation":
        mapped = opp_to_intent.get(source_id)
        if mapped:
            return mapped
    return None


def _opportunity_networks(opp: dict[str, Any], network_titles: dict[str, str]) -> list[str]:
    nets: list[str] = []
    for actor in _list(opp.get("actors")):
        if not isinstance(actor, dict):
            continue
        title = network_titles.get(_text(actor.get("networkId")))
        if title and title not in nets:
            nets.append(title)
    return nets


def _avatar_url(value: Any) -> str:
    """Resolve a stored avatar (S3 key, /api/storage path, or absolute URL) to a public URL."""
    raw = _text(value)
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    base = tools._api_url().rstrip("/")
    origin = base[:-4] if base.endswith("/api") else base
    path = raw.lstrip("/")
    if not path.startswith("api/storage/"):
        path = "api/storage/" + path
    return f"{origin}/{path}"


def _opportunity_item(opp: dict[str, Any], network_titles: dict[str, str]) -> dict[str, Any]:
    """Build a card-shaped opportunity item aligned with the Index web OpportunityCard."""
    interpretation = opp.get("interpretation") if isinstance(opp.get("interpretation"), dict) else {}
    item: dict[str, Any] = {
        "opportunityId": _text(opp.get("id")),
        "name": _text(opp.get("counterpartName"), "New match"),
        "subtitle": "Suggested connection",
        "mainText": _truncate(interpretation.get("reasoning")),
    }
    avatar = _avatar_url(opp.get("counterpartAvatar"))
    if avatar:
        item["avatar"] = avatar
    status = _text(opp.get("status"))
    if status:
        item["status"] = status
    nets = _opportunity_networks(opp, network_titles)
    if nets:
        item["networks"] = nets[:4]
    score = interpretation.get("confidence")
    if not isinstance(score, (int, float)):
        try:
            score = float(_text(opp.get("confidence")))
        except (TypeError, ValueError):
            score = None
    if isinstance(score, (int, float)) and score > 0:
        item["score"] = score
    return item


def _intent_for_opportunity(opp: dict[str, Any], known_ids: set[str]) -> str | None:
    candidates: list[str] = []
    detection = opp.get("detection")
    if isinstance(detection, dict):
        triggered = _text(detection.get("triggeredBy"))
        if triggered:
            candidates.append(triggered)
    for actor in _list(opp.get("actors")):
        if isinstance(actor, dict):
            actor_intent = _text(actor.get("intent"))
            if actor_intent:
                candidates.append(actor_intent)
    for candidate in candidates:
        if candidate in known_ids:
            return candidate
    return candidates[0] if candidates else None


def _network_key(network: dict[str, Any]) -> str:
    for key in ("networkId", "id", "title", "name"):
        value = _text(network.get(key))
        if value:
            return value
    return json.dumps(network, sort_keys=True, default=str)


def _joined_networks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = _data(payload)
    joined: list[Any] = []
    if isinstance(data, dict):
        joined.extend(_list(data.get("memberOf")))
        joined.extend(_list(data.get("owns")))
    return [network for network in joined if isinstance(network, dict)]


def _network_title_map(networks_payload: dict[str, Any], memberships_payload: dict[str, Any]) -> dict[str, str]:
    titles: dict[str, str] = {}
    data = _data(memberships_payload)
    for membership in _list(data.get("memberships") if isinstance(data, dict) else None):
        if not isinstance(membership, dict):
            continue
        network_id = _text(membership.get("networkId") or membership.get("id"))
        if network_id and network_id not in titles:
            titles[network_id] = _text(
                membership.get("networkTitle") or membership.get("title") or membership.get("name"),
                "Untitled network",
            )
    for network in _joined_networks(networks_payload):
        network_id = _text(network.get("networkId") or network.get("id"))
        if network_id and network_id not in titles:
            titles[network_id] = _text(network.get("title") or network.get("name"), "Untitled network")
    return titles


def _normalize_networks(payload: dict[str, Any]) -> dict[str, Any]:
    seen: set[str] = set()
    items = []
    for network in _joined_networks(payload):
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
    return {"items": items, "count": len(items), "error": _section_error(payload)}


def _empty_status_counts() -> dict[str, int]:
    return {"ready": 0, "negotiating": 0, "accepted": 0, "expired": 0}


def _sanitize_answer_payload(body: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(body, dict):
        return None, "Answer body must be an object."
    selected_options = body.get("selectedOptions")
    if not isinstance(selected_options, list) or not all(isinstance(option, str) for option in selected_options):
        return None, "selectedOptions must be an array of strings."
    answer: dict[str, Any] = {"selectedOptions": [option.strip() for option in selected_options if option.strip()]}
    free_text = body.get("freeText")
    if free_text is not None:
        if not isinstance(free_text, str):
            return None, "freeText must be a string."
        free_text = free_text.strip()
        if free_text:
            answer["freeText"] = free_text
    if not answer["selectedOptions"] and not answer.get("freeText"):
        return None, "Choose an option or add a free-text answer."
    return answer, None


def _build_dashboard(
    intents_payload: dict[str, Any],
    opps_live: list[dict[str, Any]],
    opps_expired: list[dict[str, Any]],
    questions_payload: dict[str, Any],
    network_titles: dict[str, str],
) -> dict[str, Any]:
    intents: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    def ensure(intent_id: str, title: str | None = None) -> dict[str, Any]:
        existing = intents.get(intent_id)
        if existing is None:
            existing = {
                "id": intent_id,
                "title": title or "Untitled intent",
                "questions": [],
                "opportunities": [],
                "networks": [],
                "statusCounts": _empty_status_counts(),
            }
            intents[intent_id] = existing
            order.append(intent_id)
        elif title and existing["title"] == "Untitled intent":
            existing["title"] = title
        return existing

    intents_data = _data(intents_payload)
    for intent in _list(intents_data.get("intents") if isinstance(intents_data, dict) else None):
        if not isinstance(intent, dict):
            continue
        intent_id = _text(intent.get("id"))
        if not intent_id:
            continue
        title = (
            _truncate(intent.get("summary"), 140)
            or _truncate(intent.get("description") or intent.get("payload"), 140)
            or "Untitled intent"
        )
        ensure(intent_id, title)

    known_ids = set(intents.keys())
    opp_to_intent: dict[str, str] = {}

    def place_opportunity(opp: dict[str, Any], counted_only: bool) -> None:
        intent_id = _intent_for_opportunity(opp, known_ids)
        intent = intents.get(intent_id) if intent_id else None
        if intent is None:
            return
        opp_id = _text(opp.get("id"))
        if opp_id:
            opp_to_intent[opp_id] = intent_id
        bucket = _STATUS_BUCKET.get(_text(opp.get("status")), "ready")
        intent["statusCounts"][bucket] = intent["statusCounts"].get(bucket, 0) + 1
        if counted_only:
            return
        intent["opportunities"].append(_opportunity_item(opp, network_titles))
        for net in _opportunity_networks(opp, network_titles):
            if net not in intent["networks"]:
                intent["networks"].append(net)

    for opp in opps_live:
        place_opportunity(opp, counted_only=False)
    for opp in opps_expired:
        place_opportunity(opp, counted_only=True)

    known_ids = set(intents.keys())
    general: list[dict[str, Any]] = []
    questions_data = _data(questions_payload)
    for question in _list(questions_data.get("questions") if isinstance(questions_data, dict) else None):
        if not isinstance(question, dict):
            continue
        item = _question_item(question)
        if item is None:
            continue
        target = _question_target(question, opp_to_intent, known_ids)
        if target and target in intents:
            intents[target]["questions"].append(item)
        else:
            general.append(item)

    totals = {"intents": 0, "questions": len(general), "opportunities": 0, "statusCounts": _empty_status_counts()}
    ordered_intents: list[dict[str, Any]] = []
    for intent_id in order:
        intent = intents[intent_id]
        counts = intent["statusCounts"]
        opportunity_count = sum(counts.values())
        question_count = len(intent["questions"])
        intent["opportunityCount"] = opportunity_count
        intent["questionCount"] = question_count
        intent["networks"] = intent["networks"][:4]
        intent["status"] = "running" if opportunity_count else ("calibrating" if question_count else "idle")
        totals["intents"] += 1
        totals["questions"] += question_count
        totals["opportunities"] += opportunity_count
        for bucket, value in counts.items():
            totals["statusCounts"][bucket] += value
        ordered_intents.append(intent)

    return {
        "intents": ordered_intents,
        "general": {"questions": general, "count": len(general)},
        "totals": totals,
    }


@router.get("/summary")
def summary() -> dict[str, Any]:
    """Return a intent-centric, user-scoped dashboard summary."""
    intents_payload = _call_read_intents()
    questions_payload = _call_pending_questions()
    networks_payload = _call_mcp("read_networks")
    memberships_payload = _call_mcp("read_network_memberships")

    opps_live, opps_error = _fetch_opportunities()
    opps_expired, _ = _fetch_opportunities("?status=expired")

    network_titles = _network_title_map(networks_payload, memberships_payload)
    dashboard = _build_dashboard(intents_payload, opps_live, opps_expired, questions_payload, network_titles)

    errors = {
        "intents": _section_error(intents_payload),
        "questions": _section_error(questions_payload),
        "opportunities": opps_error,
        "networks": _section_error(networks_payload),
    }

    return {
        "success": True,
        "intents": dashboard["intents"],
        "general": dashboard["general"],
        "networks": _normalize_networks(networks_payload),
        "totals": dashboard["totals"],
        "errors": {key: value for key, value in errors.items() if value},
    }


@router.post("/questions/{question_id}/answer")
def answer_question(question_id: str, body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Submit an answer for a pending Index question owned by this API-key principal."""
    answer, validation_error = _sanitize_answer_payload(body)
    if validation_error:
        return {"success": False, "error": validation_error}
    payload = _call_answer_question(question_id, answer or {})
    if payload.get("success") is False:
        return payload
    return {"success": True}


@router.post("/questions/{question_id}/dismiss")
def dismiss_question(question_id: str) -> dict[str, Any]:
    """Skip (dismiss) a pending Index question owned by this API-key principal."""
    payload = _call_dismiss_question(question_id)
    if payload.get("success") is False:
        return payload
    return {"success": True}
