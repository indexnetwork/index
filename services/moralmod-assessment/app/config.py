"""Service configuration, from the environment only."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    # Bearer Index presents on every request; empty disables auth (local dev only).
    api_token: str
    # OpenRouter model id, e.g. "openai/gpt-5.6-luna".
    model: str
    # "mutual_benefit" skips the moral-rules stage (no severity calibration
    # needed; severity is 0 and value equals welfare). "full" runs MSAModule
    # and needs a populated severity cache for the model/effort pair.
    mode: str
    # Passed through to the pipeline's LM wrapper. "none" is the fast profile.
    reasoning_effort: str
    n_samples: int
    seed: int
    max_concurrent_runs: int
    # Finished runs are kept this long for polling, then dropped.
    run_ttl_seconds: int
    # Only used in "full" mode: the rule-severity cache directory.
    severity_cache_dir: str


def load() -> Config:
    return Config(
        api_token=os.environ.get("ASSESSMENT_API_TOKEN", ""),
        model=os.environ.get("PIPELINE_MODEL", "openai/gpt-5.6-luna"),
        mode=os.environ.get("PIPELINE_MODE", "mutual_benefit"),
        reasoning_effort=os.environ.get("REASONING_EFFORT", "none"),
        n_samples=max(2, int(os.environ.get("N_SAMPLES", "100"))),
        seed=int(os.environ.get("PIPELINE_SEED", "1234")),
        max_concurrent_runs=max(1, int(os.environ.get("MAX_CONCURRENT_RUNS", "4"))),
        run_ttl_seconds=max(60, int(os.environ.get("RUN_TTL_SECONDS", "3600"))),
        severity_cache_dir=os.environ.get("SEVERITY_CACHE_DIR", "data/rule_severities"),
    )
