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

import base64
import importlib.util
import json
import os
import re
from functools import lru_cache
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    from fastapi import APIRouter, Body
    from fastapi.responses import StreamingResponse
except Exception:  # Allows local smoke tests without dashboard dependencies.
    StreamingResponse = None  # type: ignore

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


def _update_opportunity(
    opportunity_id: str,
    status: str,
    acknowledged_uptake_question_ids: list[str] | None = None,
) -> dict[str, Any]:
    arguments: dict[str, Any] = {"opportunityId": opportunity_id, "status": status}
    if acknowledged_uptake_question_ids:
        arguments["acknowledgedUptakeQuestionIds"] = acknowledged_uptake_question_ids
    return _call_mcp("update_opportunity", arguments)


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


def _fetch_me() -> dict[str, Any]:
    """Fetch the authenticated user's account row (email, timezone, notif prefs) over REST."""
    payload = tools._api_request("GET", "/auth/me")
    if not isinstance(payload, dict) or payload.get("success") is False:
        return {}
    user = payload.get("user")
    return user if isinstance(user, dict) else {}


def _notification_preferences(value: Any) -> dict[str, bool]:
    prefs = value if isinstance(value, dict) else {}
    return {
        "connectionUpdates": bool(prefs.get("connectionUpdates", True)),
        "weeklyNewsletter": bool(prefs.get("weeklyNewsletter", True)),
    }


_AVATAR_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}


def _decode_data_url(data_url: str) -> tuple[bytes, str, str | None]:
    """Decode a `data:<mime>;base64,<payload>` URL into (bytes, mime, error)."""
    if not data_url or not data_url.startswith("data:"):
        return b"", "", "An image data URL is required."
    header, _, payload = data_url[len("data:"):].partition(",")
    if not payload or "base64" not in header:
        return b"", "", "Only base64-encoded image data URLs are supported."
    content_type = header.split(";", 1)[0].strip().lower() or "image/png"
    if content_type not in _AVATAR_EXTENSIONS:
        return b"", "", "Unsupported image type. Use PNG, JPEG, WebP, or GIF."
    try:
        content = base64.b64decode(payload, validate=False)
    except (ValueError, TypeError) as exc:
        return b"", "", f"Could not decode image data: {exc}"
    if not content:
        return b"", "", "The image data was empty."
    return content, content_type, None


def _avatar_filename(content_type: str) -> str:
    return f"avatar.{_AVATAR_EXTENSIONS.get(content_type, 'png')}"


def _api_multipart(path: str, field: str, filename: str, content: bytes, content_type: str) -> dict[str, Any]:
    """POST a single-file multipart/form-data body to the Index API with the plugin key."""
    api_key = os.environ.get("INDEX_API_KEY", "").strip()
    if not api_key:
        return {"success": False, "error": "INDEX_API_KEY is required."}

    boundary = "----IndexHermesBoundary" + base64.urlsafe_b64encode(os.urandom(12)).decode("ascii").rstrip("=")
    preamble = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")
    body = preamble + content + f"\r\n--{boundary}--\r\n".encode("utf-8")

    headers = {k: v for k, v in tools._headers(api_key).items() if k.lower() != "content-type"}
    headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"

    base_url = tools._api_url().rstrip("/")
    request_path = path if path.startswith("/") else f"/{path}"
    request = urllib.request.Request(f"{base_url}{request_path}", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=tools._timeout_seconds()) as response:
            parsed = tools._parse_api_response(response.read())
            return parsed if isinstance(parsed, dict) else {"success": True, "data": parsed}
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")[:2_000]
        return {"success": False, "error": f"Avatar upload failed with status {exc.code}.", "status": exc.code, "body": body_text}
    except urllib.error.URLError as exc:
        return {"success": False, "error": f"Avatar upload request failed: {exc.reason}"}
    except Exception as exc:  # noqa: BLE001 - handlers must not raise.
        return {"success": False, "error": f"Avatar upload could not be processed: {exc}"}


@lru_cache(maxsize=512)
def _counterpart_socials(user_id: str) -> tuple[tuple[str, str], ...]:
    """Cached (label, value) social links for a counterpart, for radar cards.

    Socials rarely change, so an lru_cache keeps summary loads cheap instead of
    re-fetching each counterpart's public row on every refresh.
    """
    if not user_id:
        return ()
    try:
        user = _fetch_user(user_id)
    except Exception:
        return ()
    return tuple((s["label"], s["value"]) for s in _profile_socials(user))


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


# Fields the dashboard reads but does not let the user edit. `email` is sourced
# read-only from `GET /auth/me` (it is not in the profile update schema); every
# other profile field is now both readable and persisted through the API.
_MOCKED_PROFILE_FIELDS = ["email"]


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
        socials = _counterpart_socials(counterpart_id)
        if socials:
            item["socials"] = [{"label": label, "value": value} for label, value in socials]
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
    # Acting is per-user, not per-actor-row: re-detection can append duplicate
    # viewer rows without actedAt after the viewer already accepted/rejected.
    viewer_acted = any(_text(actor.get("actedAt")) for actor in viewer_actors)

    for actor in viewer_actors:
        role = _text(actor.get("role"))
        if role == "introducer":
            if status == "latent" and not introducer_approved:
                return True
            continue
        if status == "latent" and (not has_introducer or introducer_approved):
            return True
        if status == "pending" and not viewer_acted:
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
def accept_opportunity(
    opportunity_id: str,
    body: dict[str, Any] | None = Body(default=None),
) -> dict[str, Any]:
    """Accept an opportunity (Start chat) via MCP update_opportunity → status=accepted.

    Returns the new conversation's web chat URL when the tool surfaces one.
    """
    opportunity_id = _text(opportunity_id)
    if not opportunity_id:
        return {"success": False, "error": "An opportunity id is required."}
    acknowledged = body.get("acknowledgedUptakeQuestionIds") if isinstance(body, dict) else None
    if acknowledged is not None and (
        not isinstance(acknowledged, list)
        or any(not isinstance(question_id, str) or not question_id.strip() for question_id in acknowledged)
    ):
        return {"success": False, "error": "acknowledgedUptakeQuestionIds must be an array of non-empty strings."}
    acknowledged_ids = list(dict.fromkeys(question_id.strip() for question_id in (acknowledged or [])))
    payload = _update_opportunity(opportunity_id, "accepted", acknowledged_ids)
    if payload.get("success") is False:
        # Preserve the structured advisory exactly; the dashboard needs its
        # question IDs and public question shapes for a continue-anyway retry.
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
    timezone, and notification preferences are sourced from the now API-key-capable
    `GET /auth/me` (email stays read-only — see `_MOCKED_PROFILE_FIELDS`).
    """
    user_id = _resolve_user_id()
    if not user_id:
        return {"success": False, "error": "Could not resolve the current user from the configured API key."}

    contexts = _data(_call_mcp("read_user_contexts")) or {}
    user = _fetch_user(user_id)
    me = _fetch_me()

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
        "email": _text(me.get("email")),
        "timezone": _text(me.get("timezone")),
        "notificationPreferences": _notification_preferences(me.get("notificationPreferences")),
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
    """Persist a profile update via the API-key-capable `PATCH /auth/profile/update`.

    Accepts name, intro, location, timezone, socials[], notificationPreferences, and
    an optional avatar URL (produced by `POST /profile/avatar`).
    """
    update, validation_error = _sanitize_profile_update(body)
    if validation_error:
        return {"success": False, "error": validation_error}
    avatar = _text(body.get("avatar")) if isinstance(body, dict) else ""
    if avatar:
        update = dict(update or {})
        update["avatar"] = avatar
    if not update:
        return {"success": True, "applied": {}}
    payload = tools._api_request("PATCH", "/auth/profile/update", update)
    if payload.get("success") is False:
        return payload
    return {"success": True, "applied": update}


@router.post("/profile/avatar")
def upload_avatar(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Upload an avatar image (data URL) to `POST /storage/avatars`, returning its public URL.

    The client sends the picked file as a base64 `dataUrl`; this decodes it and
    re-forwards it as multipart/form-data (field `avatar`) with the plugin API key.
    """
    data_url = _text(body.get("dataUrl")) if isinstance(body, dict) else ""
    content, content_type, decode_error = _decode_data_url(data_url)
    if decode_error:
        return {"success": False, "error": decode_error}
    filename = _avatar_filename(content_type)
    payload = _api_multipart("/storage/avatars", "avatar", filename, content, content_type)
    if payload.get("success") is False:
        return payload
    avatar_url = _text(payload.get("avatarUrl"))
    if not avatar_url:
        return {"success": False, "error": "Avatar upload did not return a URL.", "response": payload}
    return {"success": True, "avatarUrl": _avatar_url(avatar_url)}


@router.post("/profile/intro")
def generate_intro(_body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Generate an AI intro via the API-key-capable `POST /enrichment/sync`.

    The enrichment graph persists the identity bio to `users.intro`; the sync
    response surfaces it as a flat `intro` field which is echoed back to the client.
    """
    payload = tools._api_request("POST", "/enrichment/sync")
    if payload.get("success") is False:
        return payload
    intro = _text(payload.get("intro"))
    return {"success": True, "intro": intro}


@router.patch("/intents/{intent_id}/archive")
def archive_intent(intent_id: str) -> dict[str, Any]:
    """Archive one of the caller's intents via `PATCH /intents/:id/archive`."""
    intent_id = _text(intent_id)
    if not intent_id:
        return {"success": False, "error": "An intent id is required."}
    payload = tools._api_request("PATCH", f"/intents/{quote(intent_id, safe='')}/archive")
    if payload.get("success") is False:
        return payload
    return {"success": True}


# ─────────────────────────────────────────────────────────────────────────────
# Conversations / realtime DMs
#
# All endpoints are participant-gated server-side. The list is normalized to a
# dashboard-safe counterpart summary; messages are passed through mostly raw so
# the client normalizes both REST and SSE payloads through one code path.
# ─────────────────────────────────────────────────────────────────────────────

_SSE_READ_TIMEOUT = 60.0


def _message_text(parts: Any) -> str:
    # Message text lives either in a data part (data.message /
    # data.assessment.reasoning) or in a plain text part. Parts use `kind`
    # (agent A2A) or `type` (plain) as the discriminator.
    data_part: dict[str, Any] | None = None
    text_part: str = ""
    for part in _list(parts):
        if not isinstance(part, dict):
            continue
        if data_part is None and (part.get("kind") == "data" or part.get("type") == "data"):
            if isinstance(part.get("data"), dict):
                data_part = part
        if not text_part:
            text = _text(part.get("text"))
            if text:
                text_part = text
    if data_part is not None:
        data = data_part.get("data") or {}
        message = _text(data.get("message"))
        if message:
            return message
        assessment = data.get("assessment") if isinstance(data.get("assessment"), dict) else {}
        reasoning = _text(assessment.get("reasoning"))
        if reasoning:
            return reasoning
    return text_part


def _counterpart_participant(conversation: dict[str, Any], current_user_id: str) -> dict[str, Any]:
    # The caller may appear either as the bare userId (DMs) or as the
    # `agent:<userId>` participant (negotiation/opportunity threads); skip both
    # so agent threads don't pick the user's own agent as the counterpart.
    self_ids = {current_user_id, "agent:" + current_user_id} if current_user_id else set()
    for participant in _list(conversation.get("participants")):
        if isinstance(participant, dict) and _text(participant.get("participantId")) not in self_ids:
            return participant
    return {}


def _is_h2h(conversation: dict[str, Any]) -> bool:
    # Human-to-human, matching the web app's Messages filter (ChatSidebar): a
    # conversation with exactly two participants, both of `participantType`
    # 'user'. Excludes human-to-agent and agent-to-agent (negotiation) threads.
    participants = [p for p in _list(conversation.get("participants")) if isinstance(p, dict)]
    return len(participants) == 2 and all(_text(p.get("participantType")) == "user" for p in participants)


def _conversation_kind(conversation: dict[str, Any]) -> str:
    for participant in _list(conversation.get("participants")):
        if not isinstance(participant, dict):
            continue
        if _text(participant.get("participantType")) == "agent" or _text(participant.get("participantId")).startswith("agent:"):
            return "negotiation"
    return "dm"


def _normalize_conversation(conversation: dict[str, Any], current_user_id: str) -> dict[str, Any]:
    counterpart = _counterpart_participant(conversation, current_user_id)
    metadata = conversation.get("metadata") if isinstance(conversation.get("metadata"), dict) else {}
    # Agent participants expose the human behind them via `ownerName`.
    counterpart_name = _text(counterpart.get("ownerName")) or _text(counterpart.get("name"))
    last_message = conversation.get("lastMessage") if isinstance(conversation.get("lastMessage"), dict) else None
    return {
        "id": _text(conversation.get("id")),
        "title": _text(metadata.get("title")) or counterpart_name or "Conversation",
        "counterpartUserId": _text(counterpart.get("participantId")),
        "counterpartName": counterpart_name,
        "avatar": _avatar_url(counterpart.get("avatar")),
        "kind": _conversation_kind(conversation),
        "lastMessageAt": _text(conversation.get("lastMessageAt")),
        "lastMessagePreview": _truncate(_message_text(last_message.get("parts")), 120) if last_message else "",
    }


@router.get("/conversations")
def list_conversations() -> dict[str, Any]:
    """List the caller's conversations (participant-gated) as counterpart summaries."""
    current_user_id = _resolve_user_id()
    if not current_user_id:
        return {"success": False, "error": "Could not resolve the current user from the configured API key."}
    payload = tools._api_request("GET", "/conversations")
    if payload.get("success") is False:
        return payload
    conversations = [
        _normalize_conversation(row, current_user_id)
        for row in _list(payload.get("conversations"))
        if isinstance(row, dict) and _is_h2h(row)
    ]
    return {"success": True, "conversations": conversations, "currentUserId": current_user_id}


@router.post("/conversations/dm")
def create_dm(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Get or create a direct-message conversation with a peer user."""
    peer_user_id = _text(body.get("peerUserId")) if isinstance(body, dict) else ""
    if not peer_user_id:
        return {"success": False, "error": "peerUserId is required."}
    payload = tools._api_request("POST", "/conversations/dm", {"peerUserId": peer_user_id})
    if payload.get("success") is False:
        return payload
    conversation = payload.get("conversation") if isinstance(payload.get("conversation"), dict) else {}
    current_user_id = _resolve_user_id() or ""
    return {"success": True, "conversation": _normalize_conversation(conversation, current_user_id)}


@router.get("/conversations/{conversation_id}/messages")
def list_messages(conversation_id: str) -> dict[str, Any]:
    """Return a conversation's messages (raw parts) plus the caller's userId for normalization."""
    conversation_id = _text(conversation_id)
    if not conversation_id:
        return {"success": False, "error": "A conversation id is required."}
    current_user_id = _resolve_user_id() or ""
    payload = tools._api_request("GET", f"/conversations/{quote(conversation_id, safe='')}/messages")
    if payload.get("success") is False:
        return payload
    messages = [row for row in _list(payload.get("messages")) if isinstance(row, dict)]
    return {"success": True, "messages": messages, "currentUserId": current_user_id}


@router.post("/conversations/{conversation_id}/messages")
def send_message(conversation_id: str, body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Send a text message into a conversation."""
    conversation_id = _text(conversation_id)
    if not conversation_id:
        return {"success": False, "error": "A conversation id is required."}
    text = _text(body.get("text")) if isinstance(body, dict) else ""
    if not text:
        return {"success": False, "error": "Message text is required."}
    payload = tools._api_request(
        "POST",
        f"/conversations/{quote(conversation_id, safe='')}/messages",
        {"parts": [{"type": "text", "text": text}]},
    )
    if payload.get("success") is False:
        return payload
    message = payload.get("message") if isinstance(payload.get("message"), dict) else payload
    return {"success": True, "message": message}


def _conversation_stream():
    """Relay the upstream conversations SSE stream (Redis pub/sub) to the dashboard tab."""
    api_key = os.environ.get("INDEX_API_KEY", "").strip()
    if not api_key:
        yield b'data: {"type":"error","error":"INDEX_API_KEY is required."}\n\n'
        return
    headers = dict(tools._headers(api_key))
    headers["Accept"] = "text/event-stream"
    base_url = tools._api_url().rstrip("/")
    request = urllib.request.Request(f"{base_url}/conversations/stream", headers=headers, method="GET")
    try:
        response = urllib.request.urlopen(request, timeout=_SSE_READ_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - surface a stream error frame instead of raising.
        message = json.dumps({"type": "error", "error": str(exc)})
        yield f"data: {message}\n\n".encode("utf-8")
        return
    try:
        for line in response:
            if line:
                yield line
    except Exception:  # noqa: BLE001 - client disconnects / read timeouts end the relay.
        return
    finally:
        try:
            response.close()
        except Exception:  # noqa: BLE001
            pass


@router.get("/conversations/stream")
def conversations_stream():
    """SSE proxy for realtime conversation events (new messages)."""
    if StreamingResponse is None:
        return {"success": False, "error": "Streaming is not available in this environment."}
    return StreamingResponse(
        _conversation_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
