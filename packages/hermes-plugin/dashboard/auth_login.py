"""Dashboard authentication endpoints backed by the environment transport."""

from __future__ import annotations

from typing import Any


def start_login(transport) -> dict[str, Any]:
    return transport.start_authorization()


def poll_status(transport) -> dict[str, Any]:
    return transport.poll_authorization()


def disconnect(transport) -> dict[str, Any]:
    return transport.disconnect()
