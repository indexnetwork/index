"""Loopback bridge between the Index negotiator and Hermes.

The negotiator is `@indexnetwork/agent` running in a Bun sidecar, so it needs
three things from Hermes that it cannot reach itself: a tool-capable model call,
the owner's conversation, and a session to show submitted turns. `/complete`
runs one completion on the model the owner is already using; `/deliver` hands
the entries the negotiator selected to the bound conversation; `/announce`
writes one turn into an Index platform session. None of those routes decide
anything about a negotiation — scheduling, questions, and turns stay inside
the agent package.

Hermes's public `ctx.llm.complete` cannot return tool calls, so completions go
through the host's `auxiliary_client.call_llm`, which accepts `tools` and keeps
provider routing, auth, and fallback with Hermes.
"""

from __future__ import annotations

import json
import logging
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logger = logging.getLogger(__name__)

# A transcript with tool schemas and a long negotiation log stays well under
# this; it exists so a malformed request cannot exhaust the gateway's memory.
MAX_BODY = 8 * 1024 * 1024


def _field(source, name, default=None):
    """Read one field from a provider response, which may be an object or a dict."""
    if isinstance(source, dict):
        return source.get(name, default)
    return getattr(source, name, default)


def render_delivery(entries):
    """Render the negotiator's selected entries as one owner-facing message.

    A question carries its own reply address so an answer stays scoped to the
    right signal and question across fresh sessions and multiple intents.

    @param entries - Human-facing entries chosen by the negotiator's inbox review.
    @returns The rendered text, or an empty string when nothing was selected.
    """
    from .tools import _app_base_url

    rendered = []
    for entry in entries:
        text = f'Index {entry["intentId"]}:\n{entry["text"]}'
        if entry.get("kind") == "question":
            matches = ", ".join(
                f'[{match["counterparty"].get("name") or match["counterparty"].get("id") or "Match"}]'
                f'({_app_base_url()}/o/{match["opportunityId"]})'
                for match in entry.get("matches") or []
            )
            text += f'\nScope: {entry.get("scope")}. For: {matches}'
            text += "\n" + "\n".join(
                f"{index}. {option}" for index, option in enumerate(entry.get("options") or [], 1)
            )
            text += f'\nReply: Index {entry["intentId"]}/{entry["questionId"]}: <your answer>'
        rendered.append(text)
    return "\n\n".join(rendered)


class HermesBridge:
    """Serve model completions and owner delivery to the negotiator sidecar.

    Bound to loopback on an ephemeral port and authenticated with a per-process
    bearer token, which is handed to the sidecar through its environment.
    """

    def __init__(self, ctx, store):
        self.ctx = ctx
        self.store = store
        self.token = secrets.token_urlsafe(32)
        self._server: ThreadingHTTPServer | None = None
        self._announce = None

    def set_announce(self, announce) -> None:
        """@param announce - The connected Index adapter's session writer, or None."""
        self._announce = announce

    @property
    def url(self) -> str:
        """@returns The loopback origin the sidecar posts to. @throws When not started."""
        if self._server is None:
            raise RuntimeError("The Index bridge is not running.")
        return f"http://127.0.0.1:{self._server.server_address[1]}"

    def start(self) -> None:
        """Bind the loopback server and serve it on a daemon thread."""
        if self._server is not None:
            return
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(self))
        threading.Thread(target=self._server.serve_forever, name="index-bridge", daemon=True).start()
        logger.info("Index bridge listening on %s", self.url)

    def stop(self) -> None:
        """Stop serving and release the port."""
        server, self._server = self._server, None
        if server is not None:
            server.shutdown()
            server.server_close()

    def complete(self, payload):
        """Run one tool-capable completion on the owner's active Hermes model.

        @param payload - `messages` in OpenAI shape, with optional `tools` and `timeout`.
        @returns The assistant reply as `content` plus any `tool_calls`.
        @throws ValueError when the request or the provider response is unusable.
        """
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            raise ValueError("messages must be a nonempty list.")
        from agent.auxiliary_client import call_llm

        response = call_llm(
            task=None, provider=None, model=None,
            messages=messages, tools=payload.get("tools") or None,
            timeout=payload.get("timeout"),
        )
        choices = _field(response, "choices") or []
        if not choices:
            raise ValueError("Hermes returned no completion choice.")
        message = _field(choices[0], "message")
        calls = []
        for call in _field(message, "tool_calls") or []:
            function = _field(call, "function")
            calls.append({
                "id": _field(call, "id") or "",
                "type": "function",
                "function": {
                    "name": _field(function, "name") or "",
                    "arguments": _field(function, "arguments") or "{}",
                },
            })
        return {"content": _field(message, "content"), "tool_calls": calls}

    def deliver(self, payload):
        """Send the negotiator's selected entries to the owner's bound conversation.

        A refusal is reported rather than raised: the sidecar keeps the entries
        undelivered and offers them again, so a closed conversation never
        silently drops a question.

        @param payload - `entries` chosen by the negotiator's inbox review.
        @returns Whether Hermes accepted the message, and why not when it did not.
        """
        entries = payload.get("entries")
        if not isinstance(entries, list) or not entries:
            raise ValueError("entries must be a nonempty list.")
        with self.store.transaction() as db:
            binding = self.store.binding(db)
        if not binding or not binding.get("source"):
            return {"delivered": False, "reason": "No Index owner conversation is configured."}
        platform, chat, _user, thread = json.loads(binding["source"])
        target = ":".join([platform, chat, thread] if thread else [platform, chat])
        result = json.loads(self.ctx.dispatch_tool(
            "send_message", {"target": target, "message": render_delivery(entries)},
        ))
        if result.get("error"):
            return {"delivered": False, "reason": str(result["error"])}
        return {"delivered": True}

    def announce(self, payload):
        """Write one submitted turn into the signal's Index session.

        @param payload - `intentId`, `text`, and optional `title`.
        @returns Whether the adapter accepted the turn.
        """
        intent_id = payload.get("intentId")
        text = payload.get("text")
        title = payload.get("title")
        if not isinstance(intent_id, str) or not intent_id.strip() or not isinstance(text, str) or not text.strip():
            raise ValueError("intentId and text are required.")
        if self._announce is None:
            logger.warning("Index announce dropped: the platform is not connected.")
            return {"delivered": False, "reason": "The Index platform is not connected."}
        self._announce(intent_id.strip(), title.strip() if isinstance(title, str) else "", text.strip())
        return {"delivered": True}


def _handler(bridge: HermesBridge):
    """Build the request handler bound to one bridge instance."""
    routes = {"/complete": bridge.complete, "/deliver": bridge.deliver, "/announce": bridge.announce}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):  # noqa: A003 - quiet the stderr access log
            pass

        def _respond(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler's contract
            route = routes.get(self.path)
            if route is None:
                return self._respond(404, {"error": "Unknown bridge route."})
            if self.headers.get("Authorization") != f"Bearer {bridge.token}":
                return self._respond(401, {"error": "The Index bridge token is required."})
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self._respond(413, {"error": "Request body too large."})
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(payload, dict):
                    raise ValueError("The request body must be an object.")
            except ValueError as exc:
                return self._respond(400, {"error": str(exc)})
            try:
                return self._respond(200, route(payload))
            except Exception as exc:  # noqa: BLE001 - reported to the sidecar as a model failure
                logger.warning("Index bridge %s failed: %s", self.path, exc)
                return self._respond(502, {"error": str(exc)})

    return Handler
