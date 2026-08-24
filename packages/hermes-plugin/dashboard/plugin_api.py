"""Index Network Hermes dashboard plugin backend.

Mounted at /api/plugins/index-network/ by Hermes dashboard only in full mode. The routes reuse
the plugin's native Index tool handlers so dashboard visibility and
question-answer writes stay scoped to the API-key-authenticated principal.

The dashboard is intent-centric: each intent carries its own pending and
answered questions (server-scoped per intent, the Mac app's queries) and its
own opportunities ("radar"). Opportunities not tied to an intent land in a
"general" bucket. Networks are returned separately for the Networks view.
"""

from __future__ import annotations

import asyncio
import base64
import importlib.util
import json
import os
import re
import sys
import threading
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

_DASHBOARD_DIR = Path(__file__).resolve().parent
_PLUGIN_ROOT = _DASHBOARD_DIR.parent
_MODE_PATH = _PLUGIN_ROOT / "_mode.py"
_TOOLS_PATH = _PLUGIN_ROOT / "tools.py"

try:
    from fastapi import APIRouter, Body, WebSocket, WebSocketDisconnect
    from fastapi.responses import StreamingResponse
except Exception:  # Allows local smoke tests without dashboard dependencies.
    StreamingResponse = None  # type: ignore

    def Body(default=None, **_kwargs):  # type: ignore
        return default

    class WebSocket:  # type: ignore
        pass

    class WebSocketDisconnect(Exception):  # type: ignore
        pass

    class _FallbackRoute:
        def __init__(self, path: str, method: str):
            self.path = path
            self.methods = {method}

    class APIRouter:  # type: ignore
        def __init__(self):
            self.routes = []

        def _route(self, method, path):
            def decorate(fn):
                self.routes.append(_FallbackRoute(path, method))
                return fn
            return decorate

        def get(self, path, **_kwargs):
            return self._route("GET", path)

        def post(self, path, **_kwargs):
            return self._route("POST", path)

        def put(self, path, **_kwargs):
            return self._route("PUT", path)

        def patch(self, path, **_kwargs):
            return self._route("PATCH", path)

        def delete(self, path, **_kwargs):
            return self._route("DELETE", path)

        def websocket(self, path, **_kwargs):
            return self._route("WEBSOCKET", path)

        def include_router(self, included):
            self.routes.extend(included.routes)


# All broad decorators attach to an internal router. The exported router stays
# empty unless the independently discovered dashboard process authorizes full.
full_router = APIRouter()
router = APIRouter()
_INTENT_PAGE_SIZE = 100
_MAX_INTENT_PAGES = 10
_QUESTION_LIMIT = 10
_PREVIEW_CHARS = 240

# Maps raw opportunity status values to the radar status strip buckets.
# latent/draft (pre-send) fold into "pending"; stalled (a stalled negotiation)
# folds into "negotiating". Rejected opportunities are hidden entirely
# (mac-app parity): those are mostly agent-side filtering decisions, and
# listing them reads as if the user (or the other person) did the rejecting.
_STATUS_BUCKET = {
    "latent": "pending",
    "draft": "pending",
    "pending": "pending",
    "negotiating": "negotiating",
    "stalled": "negotiating",
    "accepted": "accepted",
    "expired": "expired",
}

# Raw statuses surfaced in the flat Negotiations view (decoupled from the
# split pending/negotiating display buckets above).
_NEGOTIATION_STATUSES = {"pending", "negotiating", "stalled"}

# Lifecycle statuses the web intent radar requests (rejected hidden client-side).
_RADAR_STATUSES = "latent,pending,negotiating,stalled,accepted,expired"

# Static images the DESKTOP plugin fetches as base64 (its REST bridge cannot
# address the dashboard's static file mount by URL). Allow-list only.
_DESKTOP_ASSETS = {
    "loading-white.webp": "image/webp",
    "loading-black.webp": "image/webp",
    "eye-white.webp": "image/webp",
    "eye-black.webp": "image/webp",
    "loading2-white.webp": "image/webp",
    "loading2.png": "image/png",
}


def _load_mode_module():
    spec = importlib.util.spec_from_file_location("index_network_hermes_dashboard_mode", _MODE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load Index Network mode parser")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@full_router.get("/mode")
def dashboard_mode() -> dict[str, Any]:
    """Confirm that the independently mounted dashboard runtime is full-only."""
    return {"success": True, "mode": "full"}


@full_router.get("/assets/{name}")
async def desktop_asset(name: str) -> dict[str, Any]:
    mime = _DESKTOP_ASSETS.get(name)
    if mime is None:
        return {"success": False, "error": "Unknown asset."}
    try:
        raw = (_DASHBOARD_DIR / "dist" / name).read_bytes()
    except OSError:
        return {"success": False, "error": "Asset unavailable."}
    return {"success": True, "mime": mime, "data": base64.b64encode(raw).decode("ascii")}


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_tools_module():
    package_name = "index_network_hermes_dashboard_runtime"
    package = sys.modules.get(package_name)
    if package is None:
        package = types.ModuleType(package_name)
        package.__path__ = [str(_PLUGIN_ROOT)]
        package.__package__ = package_name
        sys.modules[package_name] = package
    return _load_module(f"{package_name}.tools", _TOOLS_PATH)


tools = _load_tools_module()
auth_login = _load_module("index_network_hermes_dashboard_auth_login", _DASHBOARD_DIR / "auth_login.py")
agent_bootstrap = _load_module(
    "index_network_hermes_dashboard_agent_bootstrap",
    _DASHBOARD_DIR / "agent_bootstrap.py",
)


def _promote_cli_key(cli_key: str, cli_key_id: str | None) -> dict[str, Any]:
    """Swap the CLI owner key for a Hermes agent token, then rebuild transport."""
    tools.reset_transport()
    try:
        return agent_bootstrap.promote(
            tools.get_transport(),
            auth_login.persist_api_key,
            cli_key,
            cli_key_id,
        )
    finally:
        tools.reset_transport()


auth_login.set_post_login(_promote_cli_key)


def _call_read_intents() -> dict[str, Any]:
    """Fetch all of the caller's non-archived intents across pages over REST `POST /intents/list`.

    This is the Mac app's intent source: unlike MCP `read_intents` it includes PAUSED intents
    and carries each intent's lifecycle `status`, which the pause/resume control needs.
    """
    all_intents: list[dict[str, Any]] = []
    last_error: dict[str, Any] | None = None
    page = 1
    while page <= _MAX_INTENT_PAGES:
        payload = tools._api_request("POST", "/intents/list", {"limit": _INTENT_PAGE_SIZE, "page": page, "archived": False})
        if payload.get("success") is False:
            last_error = payload
            break
        intents = _list(payload.get("intents"))
        all_intents.extend(intent for intent in intents if isinstance(intent, dict))
        pagination = payload.get("pagination") if isinstance(payload.get("pagination"), dict) else {}
        total_pages = pagination.get("total")
        if isinstance(total_pages, int):
            if page >= total_pages:
                break
        elif len(intents) < _INTENT_PAGE_SIZE:
            break
        page += 1
    if not all_intents and last_error is not None:
        return last_error
    return {"success": True, "data": {"intents": all_intents, "count": len(all_intents)}}


def _call_tool(tool_name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Invoke an Index tool through the REST tool surface (`POST /tools/:toolName`).

    This is the Mac app's tool path: it accepts the browser-login CLI credential,
    whereas the MCP surface resolves that key to the enrollment-only principal and
    denies identity tools such as research_profile.
    """
    return tools._api_request("POST", f"/tools/{quote(tool_name, safe='')}", {"query": args or {}})


def _flatten_rest_question(question: dict[str, Any]) -> dict[str, Any] | None:
    """Flatten a REST `GET /questions` row (detection/payload nesting) into the flat
    shape `_question_item` expects."""
    question_id = _text(question.get("id"))
    if not question_id:
        return None
    detection = question.get("detection") if isinstance(question.get("detection"), dict) else {}
    payload = question.get("payload") if isinstance(question.get("payload"), dict) else {}
    flat: dict[str, Any] = {
        "id": question_id,
        "title": payload.get("title"),
        "prompt": payload.get("prompt"),
        "options": payload.get("options"),
        "multiSelect": payload.get("multiSelect"),
        "mode": detection.get("mode"),
        "sourceType": detection.get("sourceType"),
        "sourceId": detection.get("sourceId"),
    }
    if question.get("createdAt"):
        flat["createdAt"] = question.get("createdAt")
    if question.get("expiresAt"):
        flat["expiresAt"] = question.get("expiresAt")
    answer = question.get("answer") if isinstance(question.get("answer"), dict) else {}
    if answer:
        chosen = [option.strip() for option in _list(answer.get("selectedOptions")) if isinstance(option, str) and option.strip()]
        flat["answerText"] = ", ".join(chosen) or _text(answer.get("freeText"))
        if answer.get("answeredAt"):
            flat["answeredAt"] = _text(answer.get("answeredAt"))
    return flat


def _call_questions_by_intent(
    status: str, intent_ids: list[str]
) -> tuple[dict[str, list[dict[str, Any]]], str | None]:
    """Fetch each intent's questions with the server's intent scope
    (`GET /questions?status=...&scopeType=intent&scopeId=...`).

    This is the same canonical query the Mac app issues — the server resolves
    triggeredBy, opportunity, and negotiation linkage that client-side grouping
    cannot replicate — so both surfaces show identical questions. Pending keeps
    server order; answered records sort oldest-first (Mac feed order)."""

    def fetch(intent_id: str) -> tuple[list[dict[str, Any]], str | None]:
        payload = tools._api_request(
            "GET", f"/questions?status={status}&scopeType=intent&scopeId={quote(intent_id, safe='')}"
        )
        error = _section_error(payload)
        if error:
            return [], error
        records: list[dict[str, Any]] = []
        for question in _list(payload.get("questions")):
            if not isinstance(question, dict):
                continue
            flat = _flatten_rest_question(question)
            item = _question_item(flat) if flat is not None else None
            if item is None:
                continue
            if flat.get("answerText") is not None:
                item["answerText"] = _text(flat.get("answerText"))
            if flat.get("answeredAt"):
                item["answeredAt"] = _text(flat.get("answeredAt"))
            records.append(item)
        if status == "answered":
            records.sort(key=lambda record: record.get("answeredAt", ""))
        return records, None

    if not intent_ids:
        return {}, None
    with ThreadPoolExecutor(max_workers=min(4, len(intent_ids))) as pool:
        results = list(pool.map(fetch, intent_ids))
    error = next((err for _records, err in results if err), None)
    return {intent_id: records for intent_id, (records, _err) in zip(intent_ids, results)}, error


def _web_url() -> str:
    """Return the credential-free public Index origin for outbound links."""
    return tools._app_base_url()


def _update_opportunity(
    opportunity_id: str,
    status: str,
    scope_id: str | None = None,
    acknowledged_uptake_question_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Accept/skip an opportunity over REST (`PATCH /opportunities/:id/status`), matching the Mac app."""
    body: dict[str, Any] = {"status": status}
    if scope_id:
        body["scopeType"] = "intent"
        body["scopeId"] = scope_id
    if acknowledged_uptake_question_ids:
        body["acknowledgedUptakeQuestionIds"] = acknowledged_uptake_question_ids
    return tools._api_request("PATCH", f"/opportunities/{quote(opportunity_id, safe='')}/status", body)


def _start_chat(opportunity_id: str, scope_id: str | None = None) -> dict[str, Any]:
    """Open (or resolve) the DM for an opportunity over REST (`POST /opportunities/:id/start-chat`)."""
    body: dict[str, Any] = {}
    if scope_id:
        body["scopeType"] = "intent"
        body["scopeId"] = scope_id
    return tools._api_request("POST", f"/opportunities/{quote(opportunity_id, safe='')}/start-chat", body)


def _uptake_advisory(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Surface the `unresolved_uptake_questions` advisory the UI needs for a continue-anyway retry.

    The REST status route returns it as HTTP 409 `{error, advisory}`, so it arrives under
    `details.advisory` from `_api_request`.
    """
    for candidate in (
        payload.get("advisory"),
        payload.get("details", {}).get("advisory") if isinstance(payload.get("details"), dict) else None,
    ):
        if isinstance(candidate, dict) and candidate.get("code") == "unresolved_uptake_questions":
            return candidate
    return None


def _call_answer_question(question_id: str, answer: dict[str, Any]) -> dict[str, Any]:
    return tools._api_request("POST", f"/questions/{quote(question_id, safe='')}/answer", answer)


def _call_dismiss_question(question_id: str) -> dict[str, Any]:
    return tools._api_request("POST", f"/questions/{quote(question_id, safe='')}/dismiss")


def _resolve_user_id() -> str | None:
    """Resolve the current API-key principal's userId via REST `GET /auth/me` (the Mac app's identity source)."""
    user_id = _text(_fetch_me().get("id"))
    return user_id or None


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


def _onboarding_gate(me: dict[str, Any] | None = None) -> dict[str, Any]:
    """Mac-parity first-run gate: missing `profileConfirmedAt` means review is required."""
    row = me if isinstance(me, dict) else _fetch_me()
    onboarding = row.get("onboarding") if isinstance(row.get("onboarding"), dict) else {}
    confirmed_at = _text(onboarding.get("profileConfirmedAt"))
    return {
        "profileConfirmedAt": confirmed_at or None,
        "needsProfileConfirm": bool(row.get("id")) and not bool(confirmed_at),
    }


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
    """Upload through the transport's bounded start/chunk/finish protocol."""
    try:
        return tools.get_transport().upload(path, field, filename, content, content_type)
    except tools.TransportError as exc:
        return exc.as_payload()
    except Exception as exc:  # noqa: BLE001 - handlers must not raise.
        return {"success": False, "error": f"Avatar upload could not be processed: {exc}"}


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


def _count(value: Any) -> int:
    return value if isinstance(value, int) and value > 0 else 0


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
    origin = "https://protocol.index.network"
    path = raw.lstrip("/")
    if not path.startswith("api/storage/"):
        path = "api/storage/" + path
    return f"{origin}/{path}"


def _normalize_member(member: dict[str, Any]) -> dict[str, Any]:
    """Absolutize member avatar keys so the Access-tab list can render them."""
    out = dict(member)
    avatar = _avatar_url(member.get("avatar"))
    if avatar:
        out["avatar"] = avatar
    else:
        out.pop("avatar", None)
    return out


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
    for query in ("", "?status=expired"):
        opportunities, _ = _fetch_opportunities(query)
        for opp in opportunities:
            status = _text(opp.get("status"))
            if status in {"latent", "pending"} and not _is_actionable_for_viewer(opp, current_user_id):
                continue
            counterpart_id = _counterpart_user_id(opp, current_user_id)
            if counterpart_id:
                visible.add(counterpart_id)
    return visible


def _opportunity_item(opp: dict[str, Any], current_user_id: str | None = None) -> dict[str, Any]:
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
    counterpart_id = _counterpart_user_id(opp, current_user_id)
    if counterpart_id:
        item["counterpartUserId"] = counterpart_id
    return item


def _is_actionable_for_viewer(opp: dict[str, Any], current_user_id: str | None) -> bool:
    """Mirror RadarGraph isActionableForViewer for live radar statuses."""
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


def _rest_networks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the raw network rows from a REST `{networks: [...]}` response."""
    rows = payload.get("networks") if isinstance(payload, dict) else None
    return [network for network in _list(rows) if isinstance(network, dict)]


def _network_title_map(networks_payload: dict[str, Any]) -> dict[str, str]:
    """Map of network id -> title from REST `GET /networks`, for labeling opportunities."""
    titles: dict[str, str] = {}
    for network in _rest_networks(networks_payload):
        network_id = _text(network.get("id") or network.get("networkId"))
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


def _normalize_networks(payload: dict[str, Any], discover_payload: dict[str, Any], current_user_id: str | None) -> dict[str, Any]:
    """Normalize the caller's joined networks from REST `GET /networks` for the Networks view."""
    seen: set[str] = set()
    items = []
    for network in _rest_networks(payload):
        network_id = _text(network.get("id") or network.get("networkId"))
        key = network_id or _text(network.get("title"))
        if not key or key in seen:
            continue
        seen.add(key)
        title = _text(network.get("title") or network.get("name"), "Untitled network")
        detail = _truncate(network.get("prompt") or network.get("description"))
        owner = network.get("user") if isinstance(network.get("user"), dict) else {}
        # Prefer viewer membership role from GET /networks; owner-id compare
        # fails when a network has multiple owners.
        api_role = _text(network.get("role"))
        if api_role in ("owner", "member"):
            is_owner = api_role == "owner"
        else:
            is_owner = bool(current_user_id) and _text(owner.get("id")) == current_user_id
        item: dict[str, Any] = {"title": title}
        if network_id:
            item["id"] = network_id
        image_url = _avatar_url(network.get("imageUrl"))
        if image_url:
            item["imageUrl"] = image_url
        member_count = _member_count(network)
        if member_count is not None:
            item["memberCount"] = member_count
        item["role"] = "owner" if is_owner else "member"
        if network.get("hasMasterKey") is True:
            item["hasMasterKey"] = True
        # Access-tab share links need joinPolicy + invitation code (web AccessTab).
        perms = network.get("permissions") if isinstance(network.get("permissions"), dict) else {}
        join_policy = _text(perms.get("joinPolicy") or network.get("joinPolicy"))
        if join_policy in ("anyone", "invite_only"):
            item["joinPolicy"] = join_policy
        invite = perms.get("invitationLink") if isinstance(perms, dict) else None
        if not isinstance(invite, dict):
            invite = network.get("invitationLink") if isinstance(network.get("invitationLink"), dict) else None
        invite_code = _text(invite.get("code")) if isinstance(invite, dict) else ""
        if invite_code:
            item["invitationLink"] = {"code": invite_code}
        net_type = _text(network.get("type"))
        if net_type:
            item["type"] = net_type
        if detail:
            item["detail"] = detail
        items.append(item)
    items.sort(key=lambda n: n.get("title", "").lower())
    return {
        "items": items,
        "count": len(items),
        "discover": _normalize_public_networks(discover_payload),
        "error": _section_error(payload),
    }


def _normalize_public_networks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Joinable public communities from REST `GET /networks/discovery/public` for the Discover tab."""
    seen: set[str] = set()
    items = []
    for network in _rest_networks(payload):
        network_id = _text(network.get("id") or network.get("networkId"))
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
        detail = _truncate(network.get("prompt") or network.get("description"))
        if detail:
            item["detail"] = detail
        items.append(item)
    items.sort(key=lambda n: n.get("title", "").lower())
    return items


def _empty_status_counts() -> dict[str, int]:
    return {"pending": 0, "negotiating": 0, "accepted": 0, "expired": 0}


def _normalize_intent_list_row(intent: dict[str, Any]) -> dict[str, Any]:
    """Shape one REST intents/list row for the dashboard home view (web DiscoverHome parity)."""
    intent_id = _text(intent.get("id"))
    title = (
        _text(intent.get("description"))
        or _text(intent.get("payload"))
        or _text(intent.get("summary"))
        or "Untitled intent"
    )
    lifecycle = _text(intent.get("status"), "ACTIVE").upper()
    return {
        "id": intent_id,
        "title": title,
        "lifecycleStatus": lifecycle,
        "status": "paused" if lifecycle == "PAUSED" else "live",
        "pendingCount": _count(intent.get("pendingQuestionCount")) + _count(intent.get("waitingOpportunityCount")),
    }


def _radar_item(card: dict[str, Any], intent_id: str | None = None) -> dict[str, Any]:
    """Map a presenter radar card to the Hermes opportunity card shape."""
    item: dict[str, Any] = {
        "opportunityId": _text(card.get("opportunityId")),
        "name": _text(card.get("name"), "New match"),
        "subtitle": "Suggested connection",
        "mainText": _truncate(card.get("mainText") or card.get("headline")),
    }
    avatar = _avatar_url(card.get("avatar"))
    if avatar:
        item["avatar"] = avatar
    status = _text(card.get("status"))
    if status:
        item["status"] = status
    user_id = _text(card.get("userId"))
    if user_id:
        item["counterpartUserId"] = user_id
    if intent_id:
        item["intentScopeId"] = intent_id
    if card.get("presentationPending") is True:
        item["presentationPending"] = True
    return item


def _fetch_scoped_questions(intent_id: str, status: str) -> tuple[list[dict[str, Any]], str | None]:
    """Fetch one intent's questions via the web/Mac scoped query."""
    payload = tools._api_request(
        "GET", f"/questions?status={status}&scopeType=intent&scopeId={quote(intent_id, safe='')}"
    )
    error = _section_error(payload)
    if error:
        return [], error
    records: list[dict[str, Any]] = []
    for question in _list(payload.get("questions")):
        if not isinstance(question, dict):
            continue
        flat = _flatten_rest_question(question)
        item = _question_item(flat) if flat is not None else None
        if item is None:
            continue
        if flat.get("answerText") is not None:
            item["answerText"] = _text(flat.get("answerText"))
        if flat.get("answeredAt"):
            item["answeredAt"] = _text(flat.get("answeredAt"))
        records.append(item)
    if status == "answered":
        records.sort(key=lambda record: record.get("answeredAt", ""))
    return records, None


def _bootstrap_payload() -> dict[str, Any]:
    """Fast home boot: auth metadata + intents list only (web DiscoverHome parity)."""
    me = _fetch_me()
    current_user_id = _text(me.get("id"))
    onboarding = _onboarding_gate(me)
    intents_payload = _call_read_intents()
    intents_data = _data(intents_payload)
    raw_intents = _list(intents_data.get("intents") if isinstance(intents_data, dict) else None)
    intents = [
        _normalize_intent_list_row(intent)
        for intent in raw_intents
        if isinstance(intent, dict) and _text(intent.get("id"))
    ]
    intents.sort(key=lambda item: item["lifecycleStatus"] == "PAUSED")
    errors: dict[str, str] = {}
    intents_error = _section_error(intents_payload)
    if intents_error:
        errors["intents"] = intents_error
    return {
        "success": True,
        "webUrl": _web_url(),
        "apiUrl": None,
        "currentUserId": current_user_id or None,
        "onboarding": onboarding,
        "intents": intents,
        "errors": errors,
    }


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
    pending_by_intent: dict[str, list[dict[str, Any]]],
    answered_by_intent: dict[str, list[dict[str, Any]]],
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
                "answeredQuestions": [],
                "opportunities": [],
                "networks": [],
                "statusCounts": _empty_status_counts(),
                "lifecycleStatus": "ACTIVE",
                "pendingCount": 0,
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
        obj = ensure(intent_id, title)
        obj["lifecycleStatus"] = _text(intent.get("status"), "ACTIVE").upper()
        # Consolidated row badge: pending questions + awaiting opportunities,
        # taken verbatim from the server list counts so every surface (Hermes
        # web/desktop, mac app, web app) shows the same number.
        obj["pendingCount"] = _count(intent.get("pendingQuestionCount")) + _count(intent.get("waitingOpportunityCount"))

    known_ids = set(intents.keys())
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
        status = _text(opp.get("status"))
        if status == "rejected":
            return  # hidden — see _STATUS_BUCKET comment
        if status in {"latent", "pending"} and not _is_actionable_for_viewer(opp, current_user_id):
            return
        bucket = _STATUS_BUCKET.get(status, "pending")
        item = _opportunity_item(opp, current_user_id)
        if intent is None:
            general_status_counts[bucket] = general_status_counts.get(bucket, 0) + 1
            general_opportunities.append(item)
            if status in _NEGOTIATION_STATUSES:
                nego = dict(item)
                nego["subtitle"] = "General"
                negotiations.append(nego)
            return
        item["intentScopeId"] = intent_id
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

    # Questions are server-scoped per intent (see _call_questions_by_intent),
    # identical to the Mac app's queries: pending render as answer forms,
    # answered as settled records that survive reloads. There is no client-side
    # grouping, so the general questions bucket is always empty.
    general: list[dict[str, Any]] = []
    for intent_id, records in pending_by_intent.items():
        if intent_id in intents:
            intents[intent_id]["questions"] = records
    for intent_id, records in answered_by_intent.items():
        if intent_id in intents:
            intents[intent_id]["answeredQuestions"] = records

    general_total_opportunity_count = sum(general_status_counts.values())
    general_actionable_opportunity_count = general_status_counts.get("pending", 0)
    totals = {
        "intents": 0,
        "questions": len(general),
        # Sidebar/header opportunity counts represent cards the viewer can act on now,
        # matching RadarGraph rather than historical radar totals.
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
        # Row status mirrors the mac app's real-data behavior: its mapper
        # (apps/mac/api/mappers.mjs) hardcodes matches/pipeline to zero, so the
        # "matched"/"negotiating" branches of signalStatus never fire outside
        # demo data — real rows are only ever paused or live.
        intent["status"] = "paused" if intent["lifecycleStatus"] == "PAUSED" else "live"
        totals["intents"] += 1
        totals["questions"] += question_count
        totals["opportunities"] += actionable_opportunity_count
        totals["totalOpportunities"] += total_opportunity_count
        for bucket, value in counts.items():
            totals["statusCounts"][bucket] += value
        ordered_intents.append(intent)

    # Mac-app shelf order: active signals first, paused sink to the bottom
    # (stable, so server order is kept within each group).
    ordered_intents.sort(key=lambda item: item["lifecycleStatus"] == "PAUSED")

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


@full_router.get("/auth/status")
def auth_status() -> dict[str, Any]:
    """Report transport health from the configured API key."""
    try:
        status = tools.get_transport().status()
    except tools.TransportError as exc:
        payload = exc.as_payload()
        payload.update({"authenticated": False, "needsLogin": True})
        return payload
    connected = status.get("connected") is True and not status.get("reconnectRequired")
    return {
        "success": True,
        "authenticated": connected,
        "needsLogin": not connected,
        "accountLabel": status.get("accountLabel"),
        "installationId": status.get("installationId"),
        "expiresAt": status.get("expiresAt"),
        "health": status.get("health"),
        "reconnectSoon": status.get("reconnectSoon") is True,
        "reconnectRequired": status.get("reconnectRequired") is True,
        "revocationPending": status.get("revocationPending") is True,
    }


def _login_app_base_url() -> str:
    """Web origin that serves `/cli-auth`, paired with the active API environment.

    An explicit `INDEX_APP_BASE_URL` wins (it also drives deep links). Otherwise
    the origin is derived from `INDEX_API_URL` by dropping a leading `protocol.`
    host label (`protocol.dev.index.network` -> `dev.index.network`), so a plugin
    pointed at dev/staging signs in against the matching web app instead of prod.
    Without this pairing a dev-configured plugin would mint a prod key that then
    401s against the dev API.
    """
    if os.environ.get("INDEX_APP_BASE_URL", "").strip():
        return tools._app_base_url()
    api_url = os.environ.get("INDEX_API_URL", "").strip()
    if not api_url:
        return tools.INDEX_APP_BASE_URL
    try:
        parts = urlsplit(api_url)
    except ValueError:
        return tools.INDEX_APP_BASE_URL
    if parts.scheme in ("http", "https") and parts.netloc:
        host = parts.netloc
        if host.startswith("protocol."):
            host = host[len("protocol."):]
        return f"{parts.scheme}://{host}"
    return tools.INDEX_APP_BASE_URL


@full_router.post("/auth/login/start")
def auth_login_start(_body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Start the Mac/CLI `/cli-auth` handshake and open the browser to sign in.

    Returns `authUrl` so the UI can offer a manual link when the plugin runs on
    a headless/remote agent host where opening a browser is not possible.
    """
    try:
        auth_url = auth_login.start_login(_login_app_base_url())
    except Exception as exc:  # noqa: BLE001 - handlers must not raise.
        return {"success": False, "error": f"Could not start login: {exc}"}
    opener = tools._url_opener_command(auth_url)
    open_error = tools._open_url(opener) if opener else "No URL opener is available on this host."
    return {"success": True, "started": True, "opened": open_error is None, "authUrl": auth_url, "openError": open_error}


@full_router.get("/auth/login/status")
def auth_login_status() -> dict[str, Any]:
    """Poll the pending login; on success the Hermes agent key is persisted."""
    result = auth_login.poll_status()
    payload: dict[str, Any] = {"success": result.get("status") != "failed", "status": result.get("status")}
    if result.get("error"):
        payload["error"] = result.get("error")
    if "negotiatorReady" in result:
        payload["negotiatorReady"] = result["negotiatorReady"]
    return payload


@full_router.post("/auth/logout")
def auth_logout(_body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Best-effort revoke the CLI key, then clear it from `~/.hermes/.env` + process."""
    api_key = os.environ.get("INDEX_API_KEY", "").strip()
    key_id = os.environ.get("INDEX_API_KEY_ID", "").strip()
    if api_key and key_id:
        try:
            tools._api_request("POST", "/auth/cli-credential/revoke", {"keyId": key_id, "targetKey": api_key})
        except Exception:  # noqa: BLE001 - revoke is best-effort; local cleanup still runs.
            pass
    auth_login.clear_api_key()
    tools.reset_transport()
    return {"success": True, "needsLogin": True}


@full_router.get("/bootstrap")
def bootstrap() -> dict[str, Any]:
    """Fast home boot: auth metadata + intents list (web DiscoverHome parity)."""
    return _bootstrap_payload()


@full_router.get("/summary")
def summary() -> dict[str, Any]:
    """Deprecated alias for `/bootstrap` (kept for older clients)."""
    return _bootstrap_payload()


@full_router.get("/intents/{intent_id}/questions")
def intent_questions(intent_id: str, status: str = "") -> dict[str, Any]:
    """Pending and/or answered questions for one intent (web intent page parity).

    Without ``status``, returns both lists in one response (parallel upstream fetches).
    With ``status=pending|answered``, returns a single ``questions`` list (legacy).
    """
    intent_id = _text(intent_id)
    if not intent_id:
        return {"success": False, "error": "An intent id is required."}
    normalized = _text(status).lower()
    if not normalized:
        with ThreadPoolExecutor(max_workers=2) as pool:
            pending_future = pool.submit(_fetch_scoped_questions, intent_id, "pending")
            answered_future = pool.submit(_fetch_scoped_questions, intent_id, "answered")
            pending_records, pending_error = pending_future.result()
            answered_records, answered_error = answered_future.result()
        if pending_error:
            return {"success": False, "error": pending_error}
        if answered_error:
            return {"success": False, "error": answered_error}
        return {"success": True, "pending": pending_records, "answered": answered_records}
    if normalized not in ("pending", "answered"):
        return {"success": False, "error": "status must be pending or answered."}
    records, error = _fetch_scoped_questions(intent_id, normalized)
    if error:
        return {"success": False, "error": error}
    return {"success": True, "questions": records}


@full_router.get("/intents/{intent_id}/radar")
def intent_radar(intent_id: str, presentation: str = "") -> dict[str, Any]:
    """Intent-scoped radar cards via GET /opportunities/radar (web intent page parity)."""
    intent_id = _text(intent_id)
    if not intent_id:
        return {"success": False, "error": "An intent id is required."}
    query = (
        f"/opportunities/radar?scopeType=intent&scopeId={quote(intent_id, safe='')}"
        f"&statuses={_RADAR_STATUSES}"
    )
    if _text(presentation) == "skeleton":
        query += "&presentation=skeleton"
    payload = tools._api_request("GET", query)
    if payload.get("success") is False:
        return payload
    items = [
        _radar_item(card, intent_id)
        for card in _list(payload.get("items"))
        if isinstance(card, dict) and _text(card.get("opportunityId"))
    ]
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    return {"success": True, "items": items, "meta": meta}


@full_router.get("/networks/home")
def networks_home() -> dict[str, Any]:
    """Joined networks + public discover list (lazy Networks column)."""
    me = _fetch_me()
    current_user_id = _text(me.get("id"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        networks_future = pool.submit(tools._api_request, "GET", "/networks")
        discover_future = pool.submit(tools._api_request, "GET", "/networks/discovery/public")
        networks_payload = networks_future.result()
        discover_payload = discover_future.result()
    return {
        "success": True,
        "networks": _normalize_networks(networks_payload, discover_payload, current_user_id or None),
    }


@full_router.post("/questions/{question_id}/answer")
def answer_question(question_id: str, body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Submit an answer for a pending Index question owned by this API-key principal."""
    answer, validation_error = _sanitize_answer_payload(body)
    if validation_error:
        return {"success": False, "error": validation_error}
    payload = _call_answer_question(question_id, answer or {})
    if payload.get("success") is False:
        return payload
    return {"success": True}


@full_router.post("/questions/{question_id}/dismiss")
def dismiss_question(question_id: str) -> dict[str, Any]:
    """Skip (dismiss) a pending Index question owned by this API-key principal."""
    payload = _call_dismiss_question(question_id)
    if payload.get("success") is False:
        return payload
    return {"success": True}


@full_router.post("/networks/{network_id}/join")
def join_network(network_id: str) -> dict[str, Any]:
    """Self-join an open (joinPolicy 'anyone') community via REST `POST /networks/:id/join`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload = tools._api_request("POST", f"/networks/{quote(network_id, safe='')}/join")
    if payload.get("success") is False:
        return payload
    return {"success": True}


@full_router.post("/networks/{network_id}/leave")
def leave_network(network_id: str) -> dict[str, Any]:
    """Leave a network — REST `POST /networks/:id/leave`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload = tools._api_request("POST", f"/networks/{quote(network_id, safe='')}/leave")
    if payload.get("success") is False:
        return payload
    return {"success": True}


@full_router.get("/networks/{network_id}/overview")
def network_overview(network_id: str) -> dict[str, Any]:
    """Caller overview for a network — REST `GET /networks/:id/overview`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload = tools._api_request("GET", f"/networks/{quote(network_id, safe='')}/overview")
    if payload.get("success") is False:
        return payload
    intents = payload.get("intents") if isinstance(payload, dict) else None
    return {
        "success": True,
        "intents": [row for row in _list(intents) if isinstance(row, dict)],
    }


@full_router.put("/networks/{network_id}")
def update_network(network_id: str, body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Update network settings — REST `PUT /networks/:id`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload_in = body if isinstance(body, dict) else {}
    forward: dict[str, Any] = {}
    if "title" in payload_in:
        title = _text(payload_in.get("title"))
        if not title:
            return {"success": False, "error": "Title cannot be empty."}
        forward["title"] = title[:200]
    if "prompt" in payload_in:
        prompt = payload_in.get("prompt")
        forward["prompt"] = None if prompt is None else _text(prompt)[:2000] or None
    if "imageUrl" in payload_in:
        image_url = payload_in.get("imageUrl")
        forward["imageUrl"] = None if image_url is None else _text(image_url) or None
    if not forward:
        return {"success": False, "error": "No updatable fields provided."}
    payload = tools._api_request("PUT", f"/networks/{quote(network_id, safe='')}", forward)
    if payload.get("success") is False:
        return payload
    network = payload.get("network") if isinstance(payload.get("network"), dict) else payload
    if not isinstance(network, dict):
        return {"success": True, "id": network_id}
    out: dict[str, Any] = {
        "success": True,
        "id": _text(network.get("id") or network_id),
        "title": _text(network.get("title"), "Untitled network"),
        "detail": _truncate(network.get("prompt") or network.get("description")) or "",
    }
    image_url = _text(network.get("imageUrl"))
    if image_url:
        out["imageUrl"] = _avatar_url(image_url) or image_url
    elif "imageUrl" in forward and forward.get("imageUrl") is None:
        out["imageUrl"] = None
    return out


@full_router.delete("/networks/{network_id}")
def delete_network(network_id: str) -> dict[str, Any]:
    """Delete a network — REST `DELETE /networks/:id`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload = tools._api_request("DELETE", f"/networks/{quote(network_id, safe='')}")
    if payload.get("success") is False:
        return payload
    return {"success": True}


@full_router.get("/networks/{network_id}/members")
def list_network_members(network_id: str) -> dict[str, Any]:
    """List members — REST `GET /networks/:id/members`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload = tools._api_request("GET", f"/networks/{quote(network_id, safe='')}/members")
    if payload.get("success") is False:
        return payload
    members = payload.get("members") if isinstance(payload, dict) else None
    return {
        "success": True,
        "members": [_normalize_member(row) for row in _list(members) if isinstance(row, dict)],
    }


@full_router.post("/networks/{network_id}/members")
def add_network_member(network_id: str, body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Add a member — REST `POST /networks/:id/members`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload_in = body if isinstance(body, dict) else {}
    user_id = _text(payload_in.get("userId"))
    if not user_id:
        return {"success": False, "error": "A userId is required."}
    permissions = payload_in.get("permissions")
    if not isinstance(permissions, list) or not permissions:
        permissions = ["member"]
    payload = tools._api_request(
        "POST",
        f"/networks/{quote(network_id, safe='')}/members",
        {"userId": user_id, "permissions": permissions},
    )
    if payload.get("success") is False:
        return payload
    member = payload.get("member") if isinstance(payload, dict) else None
    return {
        "success": True,
        "member": _normalize_member(member) if isinstance(member, dict) else None,
    }


@full_router.patch("/networks/{network_id}/members/{member_id}")
def update_network_member(
    network_id: str, member_id: str, body: dict[str, Any] | None = Body(default=None)
) -> dict[str, Any]:
    """Update member role — REST `PATCH /networks/:id/members/:memberId`."""
    network_id = _text(network_id)
    member_id = _text(member_id)
    if not network_id or not member_id:
        return {"success": False, "error": "Network id and member id are required."}
    payload_in = body if isinstance(body, dict) else {}
    permissions = payload_in.get("permissions")
    if not isinstance(permissions, list) or not permissions:
        return {"success": False, "error": "permissions must be a non-empty list."}
    payload = tools._api_request(
        "PATCH",
        f"/networks/{quote(network_id, safe='')}/members/{quote(member_id, safe='')}",
        {"permissions": permissions},
    )
    if payload.get("success") is False:
        return payload
    member = payload.get("member") if isinstance(payload, dict) else None
    return {
        "success": True,
        "member": _normalize_member(member) if isinstance(member, dict) else None,
    }


@full_router.delete("/networks/{network_id}/members/{member_id}")
def remove_network_member(network_id: str, member_id: str) -> dict[str, Any]:
    """Remove a member — REST `DELETE /networks/:id/members/:memberId`."""
    network_id = _text(network_id)
    member_id = _text(member_id)
    if not network_id or not member_id:
        return {"success": False, "error": "Network id and member id are required."}
    payload = tools._api_request(
        "DELETE",
        f"/networks/{quote(network_id, safe='')}/members/{quote(member_id, safe='')}",
    )
    if payload.get("success") is False:
        return payload
    return {"success": True}


@full_router.post("/networks/{network_id}/members/invite")
def invite_network_member(network_id: str, body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Invite by email — REST `POST /networks/:id/members/invite`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload_in = body if isinstance(body, dict) else {}
    email = _text(payload_in.get("email"))
    if not email or "@" not in email:
        return {"success": False, "error": "A valid email is required."}
    forward: dict[str, Any] = {"email": email}
    name = _text(payload_in.get("name"))
    if name:
        forward["name"] = name[:200]
    payload = tools._api_request(
        "POST",
        f"/networks/{quote(network_id, safe='')}/members/invite",
        forward,
    )
    if payload.get("success") is False:
        return payload
    out = dict(payload) if isinstance(payload, dict) else {}
    out.setdefault("success", True)
    return out


@full_router.get("/networks/search-users")
def search_network_users(q: str = "", networkId: str = "") -> dict[str, Any]:
    """Search users to add — REST `GET /networks/search-users`."""
    query = _text(q)
    if not query:
        return {"success": True, "users": []}
    path = f"/networks/search-users?q={quote(query)}"
    network_id = _text(networkId)
    if network_id:
        path += f"&networkId={quote(network_id, safe='')}"
    payload = tools._api_request("GET", path)
    if payload.get("success") is False:
        return payload
    users = payload.get("users") if isinstance(payload, dict) else None
    return {
        "success": True,
        "users": [_normalize_member(row) for row in _list(users) if isinstance(row, dict)],
    }


@full_router.patch("/networks/{network_id}/permissions")
def update_network_permissions(network_id: str, body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Owner visibility toggle — REST `PATCH /networks/:id/permissions` (web Access tab)."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload_in = body if isinstance(body, dict) else {}
    join_policy = _text(payload_in.get("joinPolicy"))
    if join_policy not in ("anyone", "invite_only"):
        return {"success": False, "error": "joinPolicy must be 'anyone' or 'invite_only'."}
    payload = tools._api_request(
        "PATCH",
        f"/networks/{quote(network_id, safe='')}/permissions",
        {"joinPolicy": join_policy},
    )
    if payload.get("success") is False:
        return payload
    network = payload.get("network") if isinstance(payload.get("network"), dict) else payload
    if not isinstance(network, dict):
        return {"success": True}
    perms = network.get("permissions") if isinstance(network.get("permissions"), dict) else {}
    out: dict[str, Any] = {"success": True, "id": _text(network.get("id") or network_id)}
    jp = _text(perms.get("joinPolicy") or join_policy)
    if jp in ("anyone", "invite_only"):
        out["joinPolicy"] = jp
    invite = perms.get("invitationLink") if isinstance(perms, dict) else None
    code = _text(invite.get("code")) if isinstance(invite, dict) else ""
    if code:
        out["invitationLink"] = {"code": code}
    return out


@full_router.patch("/networks/{network_id}/regenerate-invitation")
def regenerate_network_invitation(network_id: str) -> dict[str, Any]:
    """Rotate the owner share link — REST `PATCH /networks/:id/regenerate-invitation`."""
    network_id = _text(network_id)
    if not network_id:
        return {"success": False, "error": "A network id is required."}
    payload = tools._api_request(
        "PATCH",
        f"/networks/{quote(network_id, safe='')}/regenerate-invitation",
        {},
    )
    if payload.get("success") is False:
        return payload
    network = payload.get("network") if isinstance(payload.get("network"), dict) else payload
    if not isinstance(network, dict):
        return {"success": True}
    perms = network.get("permissions") if isinstance(network.get("permissions"), dict) else {}
    out: dict[str, Any] = {"success": True, "id": _text(network.get("id") or network_id)}
    invite = perms.get("invitationLink") if isinstance(perms, dict) else None
    code = _text(invite.get("code")) if isinstance(invite, dict) else ""
    if code:
        out["invitationLink"] = {"code": code}
    return out


def _sanitize_network_request_input(body: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Validate/normalize the early-access request form fields before forwarding.

    Same create fields as Mac/create-network (name, purpose/description, imageUrl,
    joinPolicy) plus expectedSize. `notes` remains accepted for older clients.
    """
    if not isinstance(body, dict):
        return None, "Request body must be an object."
    name = _text(body.get("name"))
    if not name:
        return None, "A network name is required."
    payload: dict[str, Any] = {"name": name[:200]}
    for key in ("purpose", "expectedSize", "notes"):
        value = _text(body.get(key))
        if value:
            payload[key] = value[:2000]
    join_policy = _text(body.get("joinPolicy"))
    if join_policy in ("anyone", "invite_only"):
        payload["joinPolicy"] = join_policy
    if "imageUrl" in body:
        image_url = body.get("imageUrl")
        if image_url is None:
            payload["imageUrl"] = None
        else:
            value = _text(image_url)
            if value:
                payload["imageUrl"] = value[:2000]
    return payload, None


def _normalize_network_request(request: Any) -> dict[str, Any]:
    """Shape a NetworkRequest DTO into the fields the dashboard renders."""
    if not isinstance(request, dict):
        return {}
    item: dict[str, Any] = {
        "id": _text(request.get("id")),
        "title": _text(request.get("title") or request.get("name"), "Untitled network"),
        "status": _text(request.get("status"), "pending"),
    }
    for key in ("purpose", "expectedSize", "notes", "reviewNote", "submittedAt", "joinPolicy"):
        value = _text(request.get(key))
        if value:
            item[key] = value
    image_url = _avatar_url(request.get("imageUrl"))
    if image_url:
        item["imageUrl"] = image_url
    return item


@full_router.get("/network-requests")
def list_network_requests() -> dict[str, Any]:
    """The caller's own early-access network requests, plus the staff `canReview` flag."""
    payload = tools._api_request("GET", "/network-requests")
    if payload.get("success") is False:
        return payload
    raw = payload.get("requests")
    items = [_normalize_network_request(r) for r in raw] if isinstance(raw, list) else []
    return {
        "success": True,
        "requests": [r for r in items if r.get("id")],
        "canReview": payload.get("canReview") is True,
    }


@full_router.post("/network-requests")
def create_network_request(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Submit a reviewed "create a network" request via REST `POST /network-requests`."""
    request_body, validation_error = _sanitize_network_request_input(body)
    if validation_error:
        return {"success": False, "error": validation_error}
    payload = tools._api_request("POST", "/network-requests", request_body)
    if payload.get("success") is False:
        return payload
    return {"success": True, "request": _normalize_network_request(payload.get("request"))}


@full_router.patch("/network-requests/{request_id}")
def update_network_request(
    request_id: str,
    body: dict[str, Any] | None = Body(default=None),
) -> dict[str, Any]:
    """Update and resubmit the caller's own request via REST `PATCH /network-requests/:id`."""
    request_id = _text(request_id)
    if not request_id:
        return {"success": False, "error": "A request id is required."}
    request_body, validation_error = _sanitize_network_request_input(body)
    if validation_error:
        return {"success": False, "error": validation_error}
    payload = tools._api_request("PATCH", f"/network-requests/{quote(request_id, safe='')}", request_body)
    if payload.get("success") is False:
        return payload
    return {"success": True, "request": _normalize_network_request(payload.get("request"))}


@full_router.delete("/network-requests/{request_id}")
def dismiss_network_request(request_id: str) -> dict[str, Any]:
    """Dismiss (withdraw) the caller's own request via REST `DELETE /network-requests/:id`."""
    request_id = _text(request_id)
    if not request_id:
        return {"success": False, "error": "A request id is required."}
    payload = tools._api_request("DELETE", f"/network-requests/{quote(request_id, safe='')}")
    if payload.get("success") is False:
        return payload
    return {"success": True}


@full_router.post("/opportunities/{opportunity_id}/accept")
def accept_opportunity(
    opportunity_id: str,
    body: dict[str, Any] | None = Body(default=None),
) -> dict[str, Any]:
    """Accept an opportunity via REST `PATCH /opportunities/:id/status` → status=accepted.

    Preserves the `unresolved_uptake_questions` advisory so the dashboard can offer a
    continue-anyway retry with acknowledged question IDs.
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
    scope_id = _text(body.get("scopeId")) if isinstance(body, dict) else ""
    payload = _update_opportunity(opportunity_id, "accepted", scope_id or None, acknowledged_ids)
    if payload.get("success") is False:
        advisory = _uptake_advisory(payload)
        if advisory is not None:
            return {
                "success": False,
                "error": _text(payload.get("error")) or "Resolve pending uptake questions.",
                "advisory": advisory,
            }
        return payload
    return {"success": True, "status": "accepted"}


@full_router.post("/opportunities/{opportunity_id}/skip")
def skip_opportunity(
    opportunity_id: str,
    body: dict[str, Any] | None = Body(default=None),
) -> dict[str, Any]:
    """Skip (decline) an opportunity via REST `PATCH /opportunities/:id/status` → status=rejected."""
    opportunity_id = _text(opportunity_id)
    if not opportunity_id:
        return {"success": False, "error": "An opportunity id is required."}
    scope_id = _text(body.get("scopeId")) if isinstance(body, dict) else ""
    payload = _update_opportunity(opportunity_id, "rejected", scope_id or None)
    if payload.get("success") is False:
        return payload
    return {"success": True, "status": "rejected"}


@full_router.post("/opportunities/{opportunity_id}/start-chat")
def start_chat(
    opportunity_id: str,
    body: dict[str, Any] | None = Body(default=None),
) -> dict[str, Any]:
    """Open (or resolve) the DM for an opportunity via REST `POST /opportunities/:id/start-chat`.

    Returns the conversation id so the dashboard can open the Messages panel.
    """
    opportunity_id = _text(opportunity_id)
    if not opportunity_id:
        return {"success": False, "error": "An opportunity id is required."}
    scope_id = _text(body.get("scopeId")) if isinstance(body, dict) else ""
    payload = _start_chat(opportunity_id, scope_id or None)
    if payload.get("success") is False:
        return payload
    conversation_id = _text(payload.get("conversationId"))
    if not conversation_id:
        return {"success": False, "error": "Start chat did not return a conversation.", "response": payload}
    result: dict[str, Any] = {"success": True, "conversationId": conversation_id}
    counterpart_id = _text(payload.get("counterpartUserId"))
    if counterpart_id:
        result["counterpartUserId"] = counterpart_id
    result["chatUrl"] = f"{_web_url()}/chat/{quote(conversation_id, safe='')}"
    return result


_INTENT_STATUSES = {"ACTIVE", "PAUSED"}


@full_router.post("/intents/{intent_id}/status")
def set_intent_status(
    intent_id: str,
    body: dict[str, Any] | None = Body(default=None),
) -> dict[str, Any]:
    """Pause/resume one of the caller's intents via REST `PATCH /intents/:id/status`."""
    intent_id = _text(intent_id)
    if not intent_id:
        return {"success": False, "error": "An intent id is required."}
    status = _text(body.get("status")).upper() if isinstance(body, dict) else ""
    if status not in _INTENT_STATUSES:
        return {"success": False, "error": "status must be one of: ACTIVE, PAUSED."}
    payload = tools._api_request("PATCH", f"/intents/{quote(intent_id, safe='')}/status", {"status": status})
    if payload.get("success") is False:
        return payload
    return {"success": True, "status": status}


@full_router.get("/profile")
def profile() -> dict[str, Any]:
    """Return the current user's profile.

    Identity (name, intro, location), avatar, and socials come from the public
    `GET /users/:id` — identity lives on the user row, there is no separate
    context record to overlay. Email, timezone, and notification preferences
    are sourced from the API-key-capable `GET /auth/me` (email stays read-only
    — see `_MOCKED_PROFILE_FIELDS`).
    """
    me = _fetch_me()
    user_id = _text(me.get("id"))
    if not user_id:
        return {"success": False, "error": "Could not resolve the current user from the configured API key."}

    user = _fetch_user(user_id)

    profile_obj: dict[str, Any] = {
        "id": user_id,
        "name": _text(user.get("name")),
        "intro": _text(user.get("intro")),
        "location": _text(user.get("location")),
        "avatar": _avatar_url(user.get("avatar")),
        "socials": _profile_socials(user),
        "email": _text(me.get("email")),
        "timezone": _text(me.get("timezone")),
        "notificationPreferences": _notification_preferences(me.get("notificationPreferences")),
    }
    return {
        "success": True,
        "profile": profile_obj,
        "onboarding": _onboarding_gate(me),
        "mockedFields": _MOCKED_PROFILE_FIELDS,
    }


@full_router.get("/profile/{user_id}")
def public_profile(user_id: str) -> dict[str, Any]:
    """Return another user's public, read-only profile (web `/u/:id` equivalent).

    Backed entirely by the public `GET /users/:id` (avatar, socials, name, intro,
    location) — identity lives on the user row, there is no separate context
    record to overlay.
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

    profile_obj: dict[str, Any] = {
        "id": user_id,
        "name": _text(user.get("name")),
        "intro": _text(user.get("intro")),
        "location": _text(user.get("location")),
        "avatar": _avatar_url(user.get("avatar")),
        "socials": _profile_socials(user),
    }
    return {"success": True, "profile": profile_obj, "readOnly": True}


@full_router.patch("/profile")
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


@full_router.post("/profile/avatar")
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


@full_router.post("/network-images")
def upload_network_image(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Upload a network picture (data URL) to `POST /storage/index-images`.

    Same data-URL → multipart pattern as `/profile/avatar`, field name `image`.
    """
    data_url = _text(body.get("dataUrl")) if isinstance(body, dict) else ""
    content, content_type, decode_error = _decode_data_url(data_url)
    if decode_error:
        return {"success": False, "error": decode_error}
    filename = f"network.{_AVATAR_EXTENSIONS.get(content_type, 'png')}"
    payload = _api_multipart("/storage/index-images", "image", filename, content, content_type)
    if payload.get("success") is False:
        return payload
    image_url = _text(payload.get("imageUrl"))
    if not image_url:
        return {"success": False, "error": "Network image upload did not return a URL.", "response": payload}
    return {"success": True, "imageUrl": _avatar_url(image_url)}


@full_router.post("/profile/intro")
def generate_intro(_body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Research public profile data via `POST /enrichment/enrich` and return intro."""
    payload = tools._api_request("POST", "/enrichment/enrich")
    if payload.get("success") is False:
        return payload
    profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
    intro = _text(profile.get("intro") or payload.get("intro"))
    return {"success": True, "intro": intro}


@full_router.post("/onboarding/enrich")
def onboarding_enrich(_body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Run Mac-parity sync public research (`POST /enrichment/enrich`) for first-run review."""
    payload = tools._api_request("POST", "/enrichment/enrich")
    if payload.get("success") is False:
        return payload
    profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
    socials = [
        {"label": _text(s.get("label")), "value": _text(s.get("value"))}
        for s in _list(profile.get("socials"))
        if isinstance(s, dict) and _text(s.get("label")) and _text(s.get("value"))
    ]
    return {
        "success": True,
        "enriched": bool(payload.get("enriched", True)),
        "profile": {
            "name": _text(profile.get("name")) or None,
            "intro": _text(profile.get("intro")) or None,
            "location": _text(profile.get("location")) or None,
            "avatar": _avatar_url(profile.get("avatar")) or None,
            "socials": socials,
        },
    }


@full_router.post("/onboarding/confirm")
def onboarding_confirm(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Confirm the first-run profile review (Mac settings `enrich` path).

    Writes name/intro/location/socials via `PATCH /auth/profile/update`, then
    confirms the profile via `POST /auth/onboarding/confirm-profile` (sets
    `onboarding.profileConfirmedAt`).
    """
    if not isinstance(body, dict):
        return {"success": False, "error": "Confirm body must be an object."}
    update, validation_error = _sanitize_profile_update(body)
    if validation_error:
        return {"success": False, "error": validation_error}
    if not update:
        return {"success": False, "error": "Name, intro, location, or socials are required."}

    payload = tools._api_request("PATCH", "/auth/profile/update", update)
    if payload.get("success") is False:
        return payload

    confirm = tools._api_request("POST", "/auth/onboarding/confirm-profile")
    if confirm.get("success") is False:
        return confirm

    return {"success": True, "onboarding": _onboarding_gate(), "applied": update}


@full_router.patch("/intents/{intent_id}/archive")
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


def parse_sse_data_line(line: bytes) -> dict[str, Any] | None:
    """Parse one complete dictionary-valued SSE ``data:`` line.

    Comments, other SSE fields, partial EOF data, malformed UTF-8/JSON, and
    non-object JSON values are deliberately ignored.
    """
    if not isinstance(line, bytes) or not line.endswith(b"\n"):
        return None
    content = line[:-1]
    if content.endswith(b"\r"):
        content = content[:-1]
    if not content.startswith(b"data:"):
        return None
    payload = content[len(b"data:"):]
    if payload.startswith(b" "):
        payload = payload[1:]
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


async def _watch_websocket_disconnect(websocket: WebSocket) -> None:
    """Return when the Hermes client disconnects, independent of relay writes."""
    try:
        while True:
            message = await websocket.receive()
            if not isinstance(message, dict) or message.get("type") == "websocket.disconnect":
                return
    except WebSocketDisconnect:
        return


async def _relay_sse_to_websocket(websocket: WebSocket, path: str) -> None:
    """Relay transport-owned SSE frames to a dashboard WebSocket."""
    await websocket.accept()
    iterator = tools.get_transport().stream_sse(path)
    relay_task: asyncio.Task[None] | None = None
    disconnect_task: asyncio.Task[None] | None = None

    def next_frame() -> bytes | None:
        try:
            return next(iterator)
        except StopIteration:
            return None

    async def relay_upstream() -> None:
        while True:
            line = await asyncio.to_thread(next_frame)
            if line is None:
                return
            event = parse_sse_data_line(line)
            if event is not None:
                await websocket.send_json(event)

    try:
        relay_task = asyncio.create_task(relay_upstream())
        disconnect_task = asyncio.create_task(_watch_websocket_disconnect(websocket))
        done, _pending = await asyncio.wait(
            {relay_task, disconnect_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if relay_task in done:
            await relay_task
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001
        try:
            await websocket.send_json({"type": "error", "error": str(exc)})
        except Exception:  # noqa: BLE001
            pass
    finally:
        for task in (relay_task, disconnect_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (relay_task, disconnect_task) if task is not None),
            return_exceptions=True,
        )
        close = getattr(iterator, "close", None)
        if callable(close):
            await asyncio.to_thread(close)

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


@full_router.get("/conversations")
def list_conversations() -> dict[str, Any]:
    """List the caller's conversations (participant-gated) as counterpart summaries."""
    # Negotiation-graph rewrite (#1494): this used to also fire an off-thread
    # negotiation_wake tick here (piggy-backing desktop's 15s poll as a cheap
    # pickup heartbeat, since the REST bridge buffers SSE). Pickup is gone,
    # and so is negotiation_wake.py itself (#1494 round-3, Option A) --
    # external-agent negotiation dispatch is offline, so there is no
    # server-side signal left to tick or wake on at all.
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


@full_router.post("/conversations/dm")
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


@full_router.get("/conversations/{conversation_id}/messages")
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


@full_router.post("/conversations/{conversation_id}/messages")
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
    """Relay transport-owned, bounded SSE polling to the dashboard tab."""
    try:
        yield from tools.get_transport().stream_sse("/conversations/stream")
    except Exception as exc:  # noqa: BLE001 - surface a sanitized stream frame.
        message = json.dumps({"type": "error", "error": str(exc)})
        yield f"data: {message}\n\n".encode("utf-8")


@full_router.get("/conversations/stream")
def conversations_stream():
    """SSE proxy for realtime conversation events (new messages)."""
    if StreamingResponse is None:
        return {"success": False, "error": "Streaming is not available in this environment."}
    return StreamingResponse(
        _conversation_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@full_router.websocket("/conversations/socket")
async def conversations_socket(websocket: WebSocket) -> None:
    """Authenticated Hermes WebSocket relay for realtime conversation events."""
    await _relay_sse_to_websocket(websocket, "/conversations/stream")


def _notification_stream():
    """Relay transport-owned notification SSE to Hermes clients."""
    try:
        yield from tools.get_transport().stream_sse("/notifications/stream")
    except Exception as exc:  # noqa: BLE001
        message = json.dumps({"type": "error", "error": str(exc)})
        yield f"data: {message}\n\n".encode("utf-8")


@full_router.get("/notifications/stream")
def notifications_stream():
    """SSE proxy for realtime notification events (questions, opportunities)."""
    if StreamingResponse is None:
        return {"success": False, "error": "Streaming is not available in this environment."}
    return StreamingResponse(
        _notification_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@full_router.websocket("/notifications/socket")
async def notifications_socket(websocket: WebSocket) -> None:
    """Authenticated Hermes WebSocket relay for realtime notification events."""
    await _relay_sse_to_websocket(websocket, "/notifications/stream")


def _notification_snapshot_request() -> Any:
    """Fetch persisted notifications through the credential-free transport."""
    return tools.get_transport().request_rest("GET", "/notifications/snapshot")


@full_router.get("/notifications/snapshot")
async def notifications_snapshot() -> Any:
    """Proxy persisted actionable notifications without rewriting upstream JSON."""
    return await asyncio.to_thread(_notification_snapshot_request)


try:
    _dashboard_runtime_mode = _load_mode_module().resolve_plugin_mode()
except Exception:  # noqa: BLE001 - parser/load failures must not mount broad routes.
    _dashboard_runtime_mode = "negotiator"

if _dashboard_runtime_mode == "full":
    router.include_router(full_router)
