"""moralmod-consult-0: POST /runs starts an assessment, GET /runs/{id} polls it.

Single-process, in-memory run store: identical keys join the same run, and
finished runs age out. One instance comfortably covers edgecity-goa's volume;
scaling out needs a shared store and is a deliberate later step.
"""

import asyncio
import hmac
import logging
import time
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .config import load
from .pipeline import PipelineError, run_assessment

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("moralmod-assessment")

config = load()
app = FastAPI(title="moralmod-assessment", version="0.1.0")

# run_id -> {status, result?, error?, key, finished_at?}
runs: dict[str, dict[str, Any]] = {}
# dedupe key -> run_id, for runs still worth joining
by_key: dict[str, str] = {}
semaphore = asyncio.Semaphore(config.max_concurrent_runs)


def authorized(request: Request) -> bool:
    if not config.api_token:
        return True
    presented = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    return hmac.compare_digest(presented, config.api_token)


def sweep() -> None:
    now = time.monotonic()
    for run_id, run in list(runs.items()):
        finished = run.get("finished_at")
        if finished is not None and now - finished > config.run_ttl_seconds:
            runs.pop(run_id, None)
            if by_key.get(run["key"]) == run_id:
                by_key.pop(run["key"], None)


async def execute(run_id: str, packet: dict[str, Any], owner_user_id: str) -> None:
    run = runs[run_id]
    try:
        async with semaphore:
            result = await asyncio.to_thread(run_assessment, packet, owner_user_id, config)
        run.update(status="ready", result=result, finished_at=time.monotonic())
    except PipelineError as error:
        logger.warning("run %s unavailable: %s", run_id, error)
        run.update(status="unavailable", error=str(error), finished_at=time.monotonic())
    except Exception:
        logger.exception("run %s failed", run_id)
        run.update(status="unavailable", error="internal error", finished_at=time.monotonic())
    finally:
        if by_key.get(run["key"]) == run_id and run["status"] != "ready":
            # A failed run should not swallow a fresh retry of the same turn.
            by_key.pop(run["key"], None)


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"ok": True, "mode": config.mode, "model": config.model, "active": sum(1 for r in runs.values() if r["status"] == "running")}


@app.post("/runs", status_code=202)
async def start_run(request: Request) -> JSONResponse:
    if not authorized(request):
        raise HTTPException(status_code=401, detail="unauthorized")
    body = await request.json()
    key = body.get("key")
    packet = body.get("packet")
    owner_user_id = body.get("owner_user_id")
    if not isinstance(key, str) or not key or not isinstance(packet, dict) or not isinstance(owner_user_id, str) or not owner_user_id:
        raise HTTPException(status_code=400, detail="key, packet and owner_user_id are required")
    sweep()
    existing = by_key.get(key)
    if existing and existing in runs:
        return JSONResponse({"run_id": existing}, status_code=202)
    run_id = f"run-{uuid.uuid4()}"
    runs[run_id] = {"status": "running", "key": key}
    by_key[key] = run_id
    asyncio.get_running_loop().create_task(execute(run_id, packet, owner_user_id))
    logger.info("run %s started (key=%s)", run_id, key)
    return JSONResponse({"run_id": run_id}, status_code=202)


@app.get("/runs/{run_id}")
async def read_run(run_id: str, request: Request) -> dict[str, Any]:
    if not authorized(request):
        raise HTTPException(status_code=401, detail="unauthorized")
    run = runs.get(run_id)
    if not run:
        return {"status": "unavailable", "error": "unknown run"}
    if run["status"] == "ready":
        # The result's run_id is the service's; align it with the polled id.
        result = dict(run["result"])
        result["run_id"] = run_id
        return {"status": "ready", "result": result}
    if run["status"] == "running":
        return {"status": "running"}
    return {"status": "unavailable", "error": run.get("error", "unavailable")}
