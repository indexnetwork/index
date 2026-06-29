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
import os
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

        def patch(self, *_args, **_kwargs):
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
# latent/draft (pre-send) fold into "pending"; stalled (a stalled negotiation)
# folds into "negotiating".
_STATUS_BUCKET = {
    "latent": "pending",
    "draft": "pending",
    "pending": "pending",
    "negotiating": "negotiating",
    "stalled": "negotiating",
    "accepted": "accepted",
    "rejected": "rejected",
    "expired": "expired",
}

# Raw statuses surfaced in the flat Negotiations view (decoupled from the
# split pending/negotiating display buckets above).
_NEGOTIATION_STATUSES = {"pending", "negotiating", "stalled"}


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


def _web_url() -> str:
    """Resolve the Index web app origin for outbound chat/profile links."""
    raw = os.environ.get("INDEX_WEB_URL", "").strip()
    return (raw or "https://index.network").rstrip("/")


def _update_opportunity(opportunity_id: str, status: str) -> dict[str, Any]:
    return _call_mcp("update_opportunity", {"opportunityId": opportunity_id, "status": status})


def _call_answer_question(question_id: str, answer: dict[str, Any]) -> dict[str, Any]:
    return tools._api_request("POST", f"/questions/{quote(question_id, safe='')}/answer", answer)


def _call_dismiss_question(question_id: str) -> dict[str, Any]:
    return tools._api_request("POST", f"/questions/{quote(question_id, safe='')}/dismiss")


def _resolve_user_id() -> str | None:
    """Resolve the current API-key principal's userId via read_network_memberships."""
    data = _data(_call_mcp("read_network_memberships"))
    if isinstance(data, dict):
        user_id = _text(data.get("userId"))
        if user_id:
            return user_id
    return None


def _fetch_user(user_id: str) -> dict[str, Any]:
    """Fetch the public user row (avatar, socials, intro, location) over REST."""
    payload = tools._api_request("GET", f"/users/{quote(user_id, safe='')}")
    if payload.get("success") is False:
        return payload
    user = payload.get("user")
    return user if isinstance(user, dict) else {}


def _profile_socials(user: dict[str, Any]) -> list[dict[str, str]]:
    socials: list[dict[str, str]] = []
    for social in _list(user.get("socials")):
        if not isinstance(social, dict):
            continue
        label = _text(social.get("label"))
        value = _text(social.get("value"))
        if label and value:
            socials.append({"label": label, "value": value})
    return socials


# Fields the dashboard surfaces but cannot read or persist with an API key today
# (their Index endpoints are session-only). They are mocked client-visibly so the
# UI is complete; real persistence is tracked for the guard-relaxation follow-up.
_MOCKED_PROFILE_FIELDS = ["email", "timezone", "notificationPreferences", "avatarUpload"]


def _sanitize_profile_update(body: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(body, dict):
        return None, "Profile body must be an object."
    update: dict[str, Any] = {}
    for key in ("name", "intro", "location", "timezone"):
        value = body.get(key)
        if value is not None:
            if not isinstance(value, str):
                return None, f"{key} must be a string."
            update[key] = value.strip()
    socials = body.get("socials")
    if socials is not None:
        if not isinstance(socials, list):
            return None, "socials must be an array."
        clean_socials: list[dict[str, str]] = []
        for social in socials:
            if not isinstance(social, dict):
                return None, "Each social must be an object."
            label = _text(social.get("label"))
            value = _text(social.get("value"))
            if label and value:
                clean_socials.append({"label": label, "value": value})
        update["socials"] = clean_socials
    prefs = body.get("notificationPreferences")
    if prefs is not None:
        if not isinstance(prefs, dict):
            return None, "notificationPreferences must be an object."
        update["notificationPreferences"] = {
            "connectionUpdates": bool(prefs.get("connectionUpdates")),
            "weeklyNewsletter": bool(prefs.get("weeklyNewsletter")),
        }
    return update, None


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


def _counterpart_user_id(opp: dict[str, Any], current_user_id: str | None) -> str:
    """Resolve the displayed counterpart, preferring non-introducer actors."""
    if not current_user_id:
        return ""
    fallback = ""
    for actor in _list(opp.get("actors")):
        if not isinstance(actor, dict):
            continue
        uid = _text(actor.get("userId"))
        if not uid or uid == current_user_id:
            continue
        if not fallback:
            fallback = uid
        if _text(actor.get("role")) != "introducer":
            return uid
    return fallback


def _visible_counterpart_user_ids(current_user_id: str) -> set[str]:
    """Return user ids visible through the caller's opportunity cards."""
    visible: set[str] = set()
    for query in ("", "?status=expired", "?status=rejected"):
        opportunities, _ = _fetch_opportunities(query)
        for opp in opportunities:
            status = _text(opp.get("status"))
            if status in {"latent", "pending"} and not _is_actionable_for_viewer(opp, current_user_id):
                continue
            counterpart_id = _counterpart_user_id(opp, current_user_id)
            if counterpart_id:
                visible.add(counterpart_id)
    return visible


def _opportunity_item(opp: dict[str, Any], network_titles: dict[str, str], current_user_id: str | None = None) -> dict[str, Any]:
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
    counterpart_id = _counterpart_user_id(opp, current_user_id)
    if counterpart_id:
        item["counterpartUserId"] = counterpart_id
    return item


def _is_actionable_for_viewer(opp: dict[str, Any], current_user_id: str | None) -> bool:
    """Mirror HomeGraph isActionableForViewer for live radar statuses."""
    if not current_user_id:
        return False
    actors = [actor for actor in _list(opp.get("actors")) if isinstance(actor, dict)]
    viewer_actors = [actor for actor in actors if _text(actor.get("userId")) == current_user_id]
    if not viewer_actors:
        return False

    status = _text(opp.get("status"))
    introducer = next((actor for actor in actors if _text(actor.get("role")) == "introducer"), None)
    has_introducer = introducer is not None
    introducer_approved = bool(introducer and introducer.get("approved") is True)

    for actor in viewer_actors:
        role = _text(actor.get("role"))
        acted_at = _text(actor.get("actedAt"))
        if role == "introducer":
            if status == "latent" and not introducer_approved:
                return True
            continue
        if status == "latent" and (not has_introducer or introducer_approved):
            return True
        if status == "pending" and not acted_at:
            return True
    return False


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


def _member_count(network: dict[str, Any]) -> int | None:
    for key in ("memberCount", "members"):
        value = network.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return int(value)
    count_obj = network.get("_count")
    if isinstance(count_obj, dict) and isinstance(count_obj.get("members"), (int, float)):
        return int(count_obj["members"])
    return None


def _owned_networks_map(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Map of network id -> raw `owns` entry (carries memberCount and implies owner role)."""
    data = _data(payload)
    owned: dict[str, dict[str, Any]] = {}
    if isinstance(data, dict):
        for network in _list(data.get("owns")):
            if isinstance(network, dict):
                network_id = _text(network.get("networkId") or network.get("id"))
                if network_id:
                    owned[network_id] = network
    return owned


def _normalize_networks(payload: dict[str, Any]) -> dict[str, Any]:
    owned = _owned_networks_map(payload)
    seen: set[str] = set()
    items = []
    for network in _joined_networks(payload):
        key = _network_key(network)
        if key in seen:
            continue
        seen.add(key)
        title = _text(network.get("title") or network.get("name"), "Untitled network")
        detail = _truncate(network.get("renderedContext") or network.get("prompt") or network.get("description"))
        permissions = [_text(p).lower() for p in _list(network.get("permissions")) if _text(p)]
        network_id = _text(network.get("networkId") or network.get("id"))
        is_personal = network.get("isPersonal") is True
        is_owner = (network_id and network_id in owned) or ("owner" in permissions)
        member_count = _member_count(network)
        if member_count is None and network_id in owned:
            member_count = _member_count(owned[network_id])

        item: dict[str, Any] = {"title": title}
        if network_id:
            item["id"] = network_id
        image_url = _text(network.get("imageUrl"))
        if image_url:
            item["imageUrl"] = image_url
        if member_count is not None:
            item["memberCount"] = member_count
        item["isPersonal"] = is_personal
        item["role"] = "owner" if is_owner else "member"
        net_type = _text(network.get("type"))
        if net_type:
            item["type"] = net_type
        if detail:
            item["detail"] = detail
        items.append(item)
    items.sort(key=lambda n: (not n.get("isPersonal"), n.get("title", "").lower()))
    return {
        "items": items,
        "count": len(items),
        "discover": _normalize_public_networks(payload),
        "error": _section_error(payload),
    }


def _normalize_public_networks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Joinable public communities (read_networks `publicNetworks`) for the Discover tab."""
    data = _data(payload)
    raw = _list(data.get("publicNetworks")) if isinstance(data, dict) else []
    seen: set[str] = set()
    items = []
    for network in raw:
        if not isinstance(network, dict):
            continue
        network_id = _text(network.get("networkId") or network.get("id"))
        key = network_id or _text(network.get("title"))
        if not key or key in seen:
            continue
        seen.add(key)
        item: dict[str, Any] = {"title": _text(network.get("title") or network.get("name"), "Untitled network")}
        if network_id:
            item["id"] = network_id
        member_count = _member_count(network)
        if member_count is not None:
            item["memberCount"] = member_count
        net_type = _text(network.get("type"))
        if net_type:
            item["type"] = net_type
        detail = _truncate(network.get("renderedContext") or network.get("prompt") or network.get("description"))
        if detail:
            item["detail"] = detail
        items.append(item)
    items.sort(key=lambda n: n.get("title", "").lower())
    return items


def _empty_status_counts() -> dict[str, int]:
    return {"pending": 0, "negotiating": 0, "accepted": 0, "rejected": 0, "expired": 0}


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
    opps_extra: list[dict[str, Any]],
    questions_payload: dict[str, Any],
    network_titles: dict[str, str],
    current_user_id: str | None = None,
) -> dict[str, Any]:
    intents: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    negotiations: list[dict[str, Any]] = []

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
            _text(intent.get("description"))
            or _text(intent.get("payload"))
            or _text(intent.get("summary"))
            or "Untitled intent"
        )
        ensure(intent_id, title)

    known_ids = set(intents.keys())
    opp_to_intent: dict[str, str] = {}

    seen_opp_ids: set[str] = set()

    general_opportunities: list[dict[str, Any]] = []
    general_status_counts = _empty_status_counts()

    def place_opportunity(opp: dict[str, Any]) -> None:
        intent_id = _intent_for_opportunity(opp, known_ids)
        intent = intents.get(intent_id) if intent_id else None
        opp_id = _text(opp.get("id"))
        if opp_id:
            if opp_id in seen_opp_ids:
                return
            seen_opp_ids.add(opp_id)
            if intent is not None:
                opp_to_intent[opp_id] = intent_id
        status = _text(opp.get("status"))
        if status in {"latent", "pending"} and not _is_actionable_for_viewer(opp, current_user_id):
            return
        bucket = _STATUS_BUCKET.get(status, "pending")
        item = _opportunity_item(opp, network_titles, current_user_id)
        if intent is None:
            general_status_counts[bucket] = general_status_counts.get(bucket, 0) + 1
            general_opportunities.append(item)
            if status in _NEGOTIATION_STATUSES:
                nego = dict(item)
                nego["subtitle"] = "General"
                negotiations.append(nego)
            return
        intent["statusCounts"][bucket] = intent["statusCounts"].get(bucket, 0) + 1
        intent["opportunities"].append(item)
        if status in _NEGOTIATION_STATUSES:
            nego = dict(item)
            nego["subtitle"] = intent["title"]
            negotiations.append(nego)
        for net in _opportunity_networks(opp, network_titles):
            if net not in intent["networks"]:
                intent["networks"].append(net)

    for opp in opps_live:
        place_opportunity(opp)
    for opp in opps_extra:
        place_opportunity(opp)

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

    general_total_opportunity_count = sum(general_status_counts.values())
    general_actionable_opportunity_count = general_status_counts.get("pending", 0)
    totals = {
        "intents": 0,
        "questions": len(general),
        # Sidebar/header opportunity counts represent cards the viewer can act on now,
        # matching HomeGraph rather than historical radar totals.
        "opportunities": general_actionable_opportunity_count,
        "totalOpportunities": general_total_opportunity_count,
        "statusCounts": dict(general_status_counts),
    }
    ordered_intents: list[dict[str, Any]] = []
    for intent_id in order:
        intent = intents[intent_id]
        counts = intent["statusCounts"]
        total_opportunity_count = sum(counts.values())
        actionable_opportunity_count = counts.get("pending", 0)
        question_count = len(intent["questions"])
        intent["opportunityCount"] = actionable_opportunity_count
        intent["totalOpportunityCount"] = total_opportunity_count
        intent["questionCount"] = question_count
        intent["networks"] = intent["networks"][:4]
        intent["status"] = "running" if actionable_opportunity_count else ("calibrating" if question_count else "idle")
        totals["intents"] += 1
        totals["questions"] += question_count
        totals["opportunities"] += actionable_opportunity_count
        totals["totalOpportunities"] += total_opportunity_count
        for bucket, value in counts.items():
            totals["statusCounts"][bucket] += value
        ordered_intents.append(intent)

    return {
        "intents": ordered_intents,
        "general": {
            "questions": general,
            "opportunities": general_opportunities,
            "statusCounts": general_status_counts,
            "questionCount": len(general),
            "opportunityCount": general_actionable_opportunity_count,
            "totalOpportunityCount": general_total_opportunity_count,
            "count": len(general) + general_actionable_opportunity_count,
        },
        "negotiations": {"items": negotiations, "count": len(negotiations)},
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
    # The default list hides resolved statuses, so fetch them explicitly to keep
    # the radar's expired/rejected chip counts and their listed items consistent.
    opps_expired, _ = _fetch_opportunities("?status=expired")
    opps_rejected, _ = _fetch_opportunities("?status=rejected")

    memberships_data = _data(memberships_payload)
    current_user_id = _text(memberships_data.get("userId")) if isinstance(memberships_data, dict) else ""

    network_titles = _network_title_map(networks_payload, memberships_payload)
    dashboard = _build_dashboard(
        intents_payload, opps_live, opps_expired + opps_rejected, questions_payload, network_titles, current_user_id or None
    )

    negotiations = dashboard["negotiations"]
    if opps_error:
        negotiations["error"] = opps_error

    errors = {
        "intents": _section_error(intents_payload),
        "questions": _section_error(questions_payload),
        "opportunities": opps_error,
        "networks": _section_error(networks_payload),
    }

    return {
        "success": True,
        "webUrl": _web_url(),
        "intents": dashboard["intents"],
        "general": dashboard["general"],
        "negotiations": negotiations,
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


@router.post("/networks/{network_id}/join")
def join_network(network_id: str) -> dict[str, Any]:
    """Self-join an open (joinPolicy 'anyone') community via MCP create_network_membership."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload = _call_mcp("create_network_membership", {"networkId": network_id})
    if payload.get("success") is False:
        return payload
    return {"success": True}


@router.post("/opportunities/{opportunity_id}/accept")
def accept_opportunity(opportunity_id: str) -> dict[str, Any]:
    """Accept an opportunity (Start chat) via MCP update_opportunity → status=accepted.

    Returns the new conversation's web chat URL when the tool surfaces one.
    """
    opportunity_id = _text(opportunity_id)
    if not opportunity_id:
        return {"success": False, "error": "An opportunity id is required."}
    payload = _update_opportunity(opportunity_id, "accepted")
    if payload.get("success") is False:
        return payload
    data = _data(payload)
    conversation_id = _text(data.get("conversationId")) if isinstance(data, dict) else ""
    result: dict[str, Any] = {"success": True, "status": "accepted"}
    if conversation_id:
        result["conversationId"] = conversation_id
        result["chatUrl"] = f"{_web_url()}/chat/{quote(conversation_id, safe='')}"
    return result


@router.post("/opportunities/{opportunity_id}/skip")
def skip_opportunity(opportunity_id: str) -> dict[str, Any]:
    """Skip (decline) an opportunity via MCP update_opportunity → status=rejected."""
    opportunity_id = _text(opportunity_id)
    if not opportunity_id:
        return {"success": False, "error": "An opportunity id is required."}
    payload = _update_opportunity(opportunity_id, "rejected")
    if payload.get("success") is False:
        return payload
    return {"success": True, "status": "rejected"}


@router.get("/profile")
def profile() -> dict[str, Any]:
    """Return the current user's profile.

    Identity (name, bio, location, context) comes from the MCP `read_user_contexts`
    self-read; avatar and socials come from the public `GET /users/:id`. Email,
    timezone, and notification preferences are session-only on Index, so they are
    returned as mock defaults (see `_MOCKED_PROFILE_FIELDS`).
    """
    user_id = _resolve_user_id()
    if not user_id:
        return {"success": False, "error": "Could not resolve the current user from the configured API key."}

    contexts = _data(_call_mcp("read_user_contexts")) or {}
    user = _fetch_user(user_id)

    name = _text(user.get("name")) or _text(contexts.get("name") if isinstance(contexts, dict) else None)
    intro = _text(user.get("intro")) or _text(contexts.get("bio") if isinstance(contexts, dict) else None)
    location = _text(user.get("location")) or _text(contexts.get("location") if isinstance(contexts, dict) else None)
    context_text = _text(contexts.get("context") if isinstance(contexts, dict) else None)

    profile_obj: dict[str, Any] = {
        "id": user_id,
        "name": name,
        "intro": intro,
        "location": location,
        "avatar": _avatar_url(user.get("avatar")),
        "socials": _profile_socials(user),
        "context": context_text,
        # Mocked (session-only on Index — not readable with an API key):
        "email": "",
        "timezone": "",
        "notificationPreferences": {"connectionUpdates": True, "weeklyNewsletter": True},
    }
    return {"success": True, "profile": profile_obj, "mockedFields": _MOCKED_PROFILE_FIELDS}


@router.get("/profile/{user_id}")
def public_profile(user_id: str) -> dict[str, Any]:
    """Return another user's public, read-only profile (web `/u/:id` equivalent).

    Backed by the public `GET /users/:id` (avatar, socials, intro, location) plus the
    user's `context` paragraph from MCP `read_user_contexts(userId)`.
    """
    user_id = _text(user_id)
    if not user_id:
        return {"success": False, "error": "A user id is required."}

    current_user_id = _resolve_user_id()
    if not current_user_id:
        return {"success": False, "error": "Could not resolve the current user from the configured API key."}
    if user_id != current_user_id and user_id not in _visible_counterpart_user_ids(current_user_id):
        return {"success": False, "error": "Profile is not visible from the current dashboard."}

    user = _fetch_user(user_id)
    if isinstance(user, dict) and user.get("success") is False:
        return user

    contexts = _data(_call_mcp("read_user_contexts", {"userId": user_id})) or {}
    context_text = _text(contexts.get("context") if isinstance(contexts, dict) else None)

    profile_obj: dict[str, Any] = {
        "id": user_id,
        "name": _text(user.get("name")),
        "intro": _text(user.get("intro")),
        "location": _text(user.get("location")),
        "avatar": _avatar_url(user.get("avatar")),
        "socials": _profile_socials(user),
        "context": context_text,
    }
    return {"success": True, "profile": profile_obj, "readOnly": True}


@router.patch("/profile")
def update_profile(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Validate a profile update and acknowledge it.

    Index's profile-write endpoints (`PATCH /auth/profile/update`, avatar upload)
    are session-only, so this is a mock acknowledgement — the payload is validated
    but not persisted. Real persistence is tracked for the guard-relaxation follow-up.
    """
    update, validation_error = _sanitize_profile_update(body)
    if validation_error:
        return {"success": False, "error": validation_error}
    return {"success": True, "mock": True, "applied": update or {}}


@router.post("/profile/intro")
def generate_intro(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Acknowledge an AI intro-generation request.

    Index's intro generation (`POST /enrichment/sync`) is session-only, so this is a
    mock that echoes the current intro back unchanged.
    """
    current = _text(body.get("intro")) if isinstance(body, dict) else ""
    return {"success": True, "mock": True, "intro": current}
