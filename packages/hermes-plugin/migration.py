"""Fail-closed plaintext cleanup before native connector authorization."""

from __future__ import annotations

import json
import os
import pathlib
import stat
import tempfile
from contextlib import contextmanager
from typing import Any, Callable

try:
    import fcntl
except ImportError:  # pragma: no cover - production support is macOS.
    fcntl = None  # type: ignore

LEGACY_OWNED_ENV_KEYS = (
    "INDEX_API_KEY",
    "INDEX_API_URL",
    "INDEX_MCP_URL",
    "INDEX_AGENT_ID",
    "INDEX_INSTALLATION_ID",
    "INDEX_PLUGIN_MODE",
)
_NONSECRET_LEGACY_KEY_ID = "INDEX_API_KEY_ID"
_OWNED_NAME = "Index Personal Agent Negotiator"
_OWNED_SCHEDULE = "every 1m"
_OWNED_PROMPTS = {
    "Run one scheduled autonomous Index negotiation pass.",
    'Use skill_view("index-network:index-negotiator") and run one scheduled autonomous Index negotiation pass.',
}
_OWNED_SKILL = "index-network:index-negotiator"
_OWNED_TOOLSET = "index-network"
_IMMUTABLE_MARKERS = (
    "index_app_installation_id",
    "index_app_owner_id",
    "index_app_setup_attempt_id",
)


class MigrationError(RuntimeError):
    pass


def _default_env_path() -> pathlib.Path:
    configured = os.environ.get("HERMES_ENV_PATH", "").strip()
    return pathlib.Path(configured) if configured else pathlib.Path.home() / ".hermes" / ".env"


def _secure_read(path: pathlib.Path) -> bytes | None:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise MigrationError(f"Secure migration could not open {path.name}.") from exc
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise MigrationError(f"Secure migration rejected {path.name}.")
        chunks = []
        while True:
            chunk = os.read(descriptor, 64 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
            if sum(map(len, chunks)) > 8 * 1024 * 1024:
                raise MigrationError(f"Secure migration rejected oversized {path.name}.")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _atomic_replace(path: pathlib.Path, content: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() and path.is_symlink():
        raise MigrationError(f"Secure migration rejected {path.name}.")
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        offset = 0
        while offset < len(content):
            offset += os.write(descriptor, content[offset:])
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _matches_env_key(line: str, key: str) -> bool:
    stripped = line.lstrip()
    return stripped.startswith(key + "=") or stripped.startswith("export " + key + "=")


def _env_value(lines: list[str], key: str) -> str | None:
    for line in lines:
        if _matches_env_key(line, key):
            value = line.split("=", 1)[1].strip()
            return value or None
    return None


def _schedule_value(job: dict[str, Any]) -> str | None:
    schedule = job.get("schedule_display")
    direct = job.get("schedule")
    if isinstance(direct, str):
        schedule = direct
    elif isinstance(direct, dict):
        schedule = direct.get("expr") if isinstance(direct.get("expr"), str) else direct.get("display")
    return schedule.strip() if isinstance(schedule, str) else None


def _is_exact_unmarked_legacy(job: Any) -> bool:
    return (
        isinstance(job, dict)
        and not any(marker in job for marker in _IMMUTABLE_MARKERS)
        and job.get("name") == _OWNED_NAME
        and _schedule_value(job) == _OWNED_SCHEDULE
        and job.get("prompt") in _OWNED_PROMPTS
        and job.get("enabled_toolsets") == [_OWNED_TOOLSET]
        and job.get("skills") == [_OWNED_SKILL]
    )


def _attributable_indices(jobs: list[Any]) -> set[int]:
    marked = {
        index for index, job in enumerate(jobs)
        if isinstance(job, dict) and any(marker in job for marker in _IMMUTABLE_MARKERS)
    }
    legacy = [index for index, job in enumerate(jobs) if _is_exact_unmarked_legacy(job)]
    if len(legacy) > 1:
        raise MigrationError("Legacy owned Hermes scheduling is ambiguous.")
    return marked.union(legacy)


def _job_verification_identities(jobs: list[Any]) -> list[str]:
    identities = []
    for job in jobs:
        if not isinstance(job, dict):
            identities.append(json.dumps(job, sort_keys=True, separators=(",", ":")))
            continue
        stable = {key: value for key, value in job.items() if key not in {"enabled", "state"}}
        identities.append(json.dumps(stable, sort_keys=True, separators=(",", ":")))
    return identities


@contextmanager
def _canonical_jobs_lock(jobs_path: pathlib.Path):
    jobs_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = jobs_path.parent / ".jobs.lock"
    descriptor = os.open(
        lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600
    )
    try:
        if fcntl is not None:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        if fcntl is not None:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def _pause_owned_schedule(
    jobs_path: pathlib.Path,
    installation_id: str | None,
    replace: Callable[[pathlib.Path, bytes], None],
) -> None:
    del installation_id  # Any immutable Index marker is attributable across generations.
    with _canonical_jobs_lock(jobs_path):
        raw = _secure_read(jobs_path)
        if raw is None:
            return
        try:
            document = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise MigrationError("Owned Hermes scheduling could not be verified.") from exc
        jobs = document.get("jobs") if isinstance(document, dict) else None
        if not isinstance(jobs, list):
            raise MigrationError("Owned Hermes scheduling could not be verified.")
        before_identities = _job_verification_identities(jobs)
        attributable = _attributable_indices(jobs)
        changed = False
        for index in attributable:
            job = jobs[index]
            if job.get("enabled") is not False or str(job.get("state", "")).lower() != "paused":
                job["enabled"] = False
                job["state"] = "paused"
                changed = True
        if changed:
            replace(jobs_path, (json.dumps(document, indent=2, sort_keys=True) + "\n").encode("utf-8"))
        verified_raw = _secure_read(jobs_path)
        try:
            verified = json.loads(verified_raw or b"{}")
        except json.JSONDecodeError as exc:
            raise MigrationError("Owned Hermes scheduling pause could not be verified.") from exc
        verified_jobs = verified.get("jobs") if isinstance(verified, dict) else None
        if not isinstance(verified_jobs, list):
            raise MigrationError("Owned Hermes scheduling pause could not be verified.")
        if _job_verification_identities(verified_jobs) != before_identities:
            raise MigrationError("Hermes scheduling changed during the locked migration.")
        verified_attributable = _attributable_indices(verified_jobs)
        if verified_attributable != attributable:
            raise MigrationError("Hermes scheduling identities changed during migration.")
        for index in verified_attributable:
            job = verified_jobs[index]
            if job.get("enabled") is not False or str(job.get("state", "")).lower() != "paused":
                raise MigrationError("Owned Hermes scheduling pause could not be verified.")


@contextmanager
def _migration_lock(env_path: pathlib.Path):
    env_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_path = env_path.parent / ".index-network.migration.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        if fcntl is not None:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield
    finally:
        if fcntl is not None:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def migrate_before_authorization(
    transport,
    *,
    env_path: pathlib.Path | None = None,
    jobs_path: pathlib.Path | None = None,
    state_path: pathlib.Path | None = None,
    replace_env: Callable[[pathlib.Path, bytes], None] = _atomic_replace,
    replace_jobs: Callable[[pathlib.Path, bytes], None] = _atomic_replace,
    observer: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Pause owned work, scrub/verify plaintext, then and only then authorize."""
    notify = observer or (lambda _stage: None)
    resolved_env = pathlib.Path(env_path or _default_env_path())
    resolved_jobs = pathlib.Path(jobs_path or (pathlib.Path.home() / ".hermes" / "cron" / "jobs.json"))
    resolved_state = pathlib.Path(state_path or (pathlib.Path.home() / ".hermes" / "index-network-migration.json"))

    try:
        with _migration_lock(resolved_env):
            # Pause structurally exact owned work before touching any plaintext.
            # An unsafe/unreadable .env therefore cannot leave scheduling active.
            _pause_owned_schedule(
                resolved_jobs, os.environ.get("INDEX_INSTALLATION_ID") or None, replace_jobs
            )
            notify("schedule.verified")

            raw = _secure_read(resolved_env)
            lines = raw.decode("utf-8").splitlines() if raw is not None else []
            installation_id = _env_value(lines, "INDEX_INSTALLATION_ID") or os.environ.get("INDEX_INSTALLATION_ID") or None
            legacy_key_id = _env_value(lines, _NONSECRET_LEGACY_KEY_ID) or os.environ.get(_NONSECRET_LEGACY_KEY_ID) or None

            state: dict[str, str] = {}
            if installation_id:
                state["installationId"] = installation_id
            if legacy_key_id:
                state["legacyKeyId"] = legacy_key_id
            _atomic_replace(resolved_state, (json.dumps(state, sort_keys=True) + "\n").encode("utf-8"))
            verified_state = json.loads((_secure_read(resolved_state) or b"{}").decode("utf-8"))
            if verified_state != state or set(verified_state).difference({"installationId", "legacyKeyId"}):
                raise MigrationError("Non-secret migration state could not be verified.")

            kept = [
                line for line in lines
                if not any(_matches_env_key(line, key) for key in LEGACY_OWNED_ENV_KEYS)
            ]
            content = (("\n".join(kept) + "\n") if kept else "").encode("utf-8")
            if raw is not None:
                replace_env(resolved_env, content)
            verified_lines = (_secure_read(resolved_env) or b"").decode("utf-8").splitlines()
            if any(_matches_env_key(line, key) for line in verified_lines for key in LEGACY_OWNED_ENV_KEYS):
                raise MigrationError("Legacy Index environment cleanup could not be verified.")
            for key in LEGACY_OWNED_ENV_KEYS:
                os.environ.pop(key, None)
            notify("env.verified")
    except MigrationError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise MigrationError("Secure Index migration did not complete; owned scheduling remains paused.") from exc

    return transport.start_authorization()
