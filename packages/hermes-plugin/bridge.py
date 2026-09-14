"""Loopback HTTP between the negotiator sidecar and this Hermes process."""

from __future__ import annotations

import json
import logging
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .speaker import run_session

logger = logging.getLogger(__name__)

MAX_BODY = 8 * 1024 * 1024


class HermesBridge:
    def __init__(self, sidecar=None):
        self.sidecar = sidecar
        self.adapter = None
        self.token = secrets.token_urlsafe(32)
        self._server: ThreadingHTTPServer | None = None

    @property
    def url(self) -> str:
        if self._server is None:
            raise RuntimeError("The Index bridge is not running.")
        return f"http://127.0.0.1:{self._server.server_address[1]}"

    def start(self) -> None:
        if self._server is not None:
            return
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(self))
        threading.Thread(target=self._server.serve_forever, name="index-bridge", daemon=True).start()
        logger.info("Index bridge listening on %s", self.url)

    def stop(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.shutdown()
            server.server_close()

    def speak(self, payload: dict) -> dict:
        if self.adapter is None or self.sidecar is None:
            raise RuntimeError("The Index platform is not connected.")
        return run_session(self.adapter, self.sidecar, payload)


def _handler(bridge: HermesBridge):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            del format, args

        def do_POST(self):
            if self.headers.get("Authorization") != f"Bearer {bridge.token}":
                return self._send(401, {"error": "The Index bridge token is required."})
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                return self._send(413, {"error": "Request too large."})
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                return self._send(400, {"error": "The request body must be an object."})
            try:
                if self.path == "/speak":
                    return self._send(200, bridge.speak(payload))
            except Exception as error:  # noqa: BLE001
                logger.warning("Index bridge %s failed: %s", self.path, error)
                return self._send(502, {"error": str(error)})
            return self._send(404, {"error": "Unknown bridge route."})

        def _send(self, status: int, body: dict) -> None:
            encoded = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    return Handler
