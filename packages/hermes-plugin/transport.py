"""Single credential-free transport seam for every Index plugin surface."""

from __future__ import annotations

import importlib.util
import os
import pathlib
import sys
import threading
from abc import ABC, abstractmethod
from typing import Any, Iterator

_PLUGIN_ROOT = pathlib.Path(__file__).resolve().parent
_DEVELOPMENT_MARKER = ".index-plugin-development"
_transport_lock = threading.Lock()
_transport: "IndexTransport | None" = None


class IndexTransport(ABC):
    """Structured Index operations exposed to tools and the dashboard."""

    @abstractmethod
    def status(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def start_authorization(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def poll_authorization(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def request_rest(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        hermes_run: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def call_mcp(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def disconnect(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def upload(
        self,
        path: str,
        field: str,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def stream_sse(self, path: str) -> Iterator[bytes]:
        raise NotImplementedError


def _load_sibling(module_name: str):
    package = __package__
    if package:
        return __import__(f"{package}.{module_name}", fromlist=[module_name])
    loaded_name = f"index_network_hermes_{module_name}"
    existing = sys.modules.get(loaded_name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(loaded_name, _PLUGIN_ROOT / f"{module_name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {module_name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[loaded_name] = module
    spec.loader.exec_module(module)
    return module


def build_transport(
    *, platform: str | None = None, plugin_root: pathlib.Path | None = None
) -> IndexTransport:
    """Build the only authorized transport for this package/runtime.

    The environment credential path is source-checkout-only and requires two
    independent gates. All other configurations select the native connector and
    do not inspect credential environment variables.
    """
    root = pathlib.Path(plugin_root or _PLUGIN_ROOT)
    development_requested = os.environ.get("INDEX_PLUGIN_DEVELOPMENT_TRANSPORT") == "1"
    if development_requested:
        marker = root / _DEVELOPMENT_MARKER
        if not marker.is_file() or marker.is_symlink() or marker.read_text(encoding="utf-8") != "source-checkout-only\n":
            connector_module = _load_sibling("connector_transport")
            raise connector_module.TransportError(
                "development_transport_denied",
                "Development credential transport is unavailable in this package.",
            )
        environment_module = _load_sibling("env_transport")
        return environment_module.EnvironmentCredentialTransport()

    connector_module = _load_sibling("connector_transport")
    return connector_module.ConnectorTransport(plugin_root=root, platform=platform)


def get_transport() -> IndexTransport:
    global _transport
    with _transport_lock:
        if _transport is None:
            _transport = build_transport()
        return _transport


def set_transport_for_tests(transport: IndexTransport | None) -> None:
    """Inject a fake transport. Never registered as a Hermes tool."""
    global _transport
    with _transport_lock:
        _transport = transport
