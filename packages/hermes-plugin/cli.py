"""`hermes index` — sign in, sign out, and check the Index credential."""

from __future__ import annotations

import argparse
import sys
import threading
import time

from . import auth_login
from .env_transport import TransportError, _stored_env
from .tools import _open_url, _url_opener_command, ensure_hermes_agent, login_app_base_url
from .transport import get_transport, reset_transport


def register_cli(subparser: argparse.ArgumentParser) -> None:
    """Build the ``hermes index`` argparse tree."""
    subs = subparser.add_subparsers(dest="index_command")
    subs.add_parser("login", help="Sign in with a browser and save this device's session")
    subs.add_parser("logout", help="Revoke this device's session")
    subs.add_parser("status", help="Show whether Index is signed in")


def index_command(args: argparse.Namespace) -> int:
    """Dispatch ``hermes index <login|logout|status>``."""
    sub = args.index_command
    if sub == "login":
        return _login()
    if sub == "logout":
        return _logout()
    if sub == "status":
        return _status()
    print("usage: hermes index {login,logout,status}")
    return 2


def _login() -> int:
    """Print the sign-in URL and wait for the browser or a pasted callback."""
    try:
        auth_url = auth_login.start_login(login_app_base_url())
    except Exception as exc:  # noqa: BLE001 - the command reports the failure and exits.
        print(f"Could not start login: {exc}", file=sys.stderr)
        return 1
    print(auth_url)
    print("Approve in a browser. If it cannot reach this machine, paste the address it lands on and press enter.")
    opener = _url_opener_command(auth_url)
    if opener:
        _open_url(opener)

    def _read_paste() -> None:
        try:
            line = sys.stdin.readline()
        except Exception:  # noqa: BLE001 - a closed stdin still leaves the loopback listener.
            return
        pasted = line.strip()
        if pasted and not auth_login.accept_callback(pasted):
            print("That link did not match this login.")

    threading.Thread(target=_read_paste, name="index-login-paste", daemon=True).start()
    while True:
        result = auth_login.poll_status()
        status = result.get("status")
        if status == "success":
            ensure_hermes_agent()
            print("Signed in.")
            return 0
        if status == "failed":
            print(result.get("error") or "Login failed.", file=sys.stderr)
            return 1
        if status != "pending":
            print("Login is not running.", file=sys.stderr)
            return 1
        time.sleep(1)


def _logout() -> int:
    """Revoke this device's session, then drop it from the Hermes env."""
    token = _stored_env("INDEX_SESSION_TOKEN")
    if token:
        auth_login.revoke_session(token)
    auth_login.clear_session_token()
    reset_transport()
    print("Signed out.")
    return 0


def _status() -> int:
    """Print transport health and whether the session or the API key is in use."""
    session = bool(_stored_env("INDEX_SESSION_TOKEN"))
    key = bool(_stored_env("INDEX_API_KEY"))
    credential = "session" if session else "api key" if key else "none"
    try:
        health = get_transport().status().get("health") or "disconnected"
    except TransportError as exc:
        print("health: disconnected")
        print(f"credential: {credential}")
        print(exc.message, file=sys.stderr)
        return 1
    print(f"health: {health}")
    print(f"credential: {credential}")
    return 0 if health == "active" else 1
