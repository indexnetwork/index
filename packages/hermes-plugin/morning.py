"""The Hermes cron that runs the Index morning wake.

The job is created and removed with the negotiator. Its script lives in the
Hermes scripts folder, because that is the only place a cron script may run,
and it calls back into this file.
"""

from __future__ import annotations

import json
import logging
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

JOB_NAME = "Index morning"
SCHEDULE = "0 8 * * *"
STATE_FILE = "index-negotiator.json"
LAUNCHER = "index-morning.py"
WAKE_SECONDS = 300.0


def morning_brief_wanted(user: dict | None) -> bool:
    """The user's morning wake. Missing means on."""
    if not isinstance(user, dict):
        return True
    prefs = user.get("notificationPreferences")
    if not isinstance(prefs, dict):
        return True
    return prefs.get("morningBrief") is not False


def sync_morning_cron(home: Path, wanted: bool) -> None:
    """Keep one `Index morning` job, or remove it.

    @param home - The Hermes home whose cron store and scripts folder to use.
    @param wanted - Hermes is selected and the negotiator is not paused. The script reads the account's morning brief.
    """
    try:
        from cron.jobs import create_job, list_jobs, remove_job
    except Exception as error:  # noqa: BLE001 - the gateway is the only process that has this module.
        logger.warning("Index morning cron unavailable: %s", error)
        return
    jobs = [job for job in list_jobs(include_disabled=True) if job.get("name") == JOB_NAME]
    if not wanted:
        for job in jobs:
            remove_job(job["id"])
        return
    _write_launcher(home)
    if jobs:
        return
    try:
        create_job(
            "",
            SCHEDULE,
            name=JOB_NAME,
            script=str(home / "scripts" / LAUNCHER),
            no_agent=True,
            deliver="local",
        )
    except Exception as error:  # noqa: BLE001
        logger.warning("Index morning cron was not created: %s", error)


def _write_launcher(home: Path) -> None:
    scripts = home / "scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    target = Path(__file__).resolve()
    (scripts / LAUNCHER).write_text(
        "import runpy\n"
        f"runpy.run_path({str(target)!r}, run_name='__main__')\n",
        encoding="utf-8",
    )


def _home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:  # noqa: BLE001
        return Path.home() / ".hermes"


def _transport():
    root = Path(__file__).resolve().parent
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from transport import get_transport
    return get_transport()


def _active(intent: dict) -> bool:
    if intent.get("archivedAt"):
        return False
    return intent.get("status") in (None, "active")


def run() -> None:
    """Morning-wake each active signal that belongs to a community. Prints nothing."""
    try:
        state = json.loads((_home() / STATE_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    url = state.get("url") or ""
    token = state.get("token") or ""
    if not url or not token:
        return
    try:
        me = _transport().request_rest("GET", "/auth/me")
    except Exception:  # noqa: BLE001
        me = None
    account = me.get("user") if isinstance(me, dict) else None
    if not morning_brief_wanted(account if isinstance(account, dict) else None):
        return
    try:
        listed = _transport().request_rest("POST", "/intents/list", {"limit": 100})
    except Exception:  # noqa: BLE001
        return
    for intent in listed.get("intents") or []:
        intent_id = intent.get("id")
        if not isinstance(intent_id, str) or not _active(intent):
            continue
        try:
            networks = _transport().request_rest("GET", f"/intents/{urllib.parse.quote(intent_id)}/networks")
        except Exception:  # noqa: BLE001
            continue
        if not networks.get("networkIds"):
            continue
        _wake(url, token, intent_id)


def _wake(url: str, token: str, intent_id: str) -> None:
    request = urllib.request.Request(
        url.rstrip("/") + "/morning",
        data=json.dumps({"intentId": intent_id}).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=WAKE_SECONDS):
            return
    except (urllib.error.URLError, TimeoutError, OSError):
        return


if __name__ == "__main__":
    run()
