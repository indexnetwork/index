"""One assessment run over the lab's pipeline.

Blocking by design: the caller runs it on a worker thread. JAX must be
imported before DSPy (the lab's adapter does the same), so the pipeline
modules are imported lazily inside the function and cached.

Requires OPENROUTER_API_KEY and TYPESAFE_API_KEY in the environment: the
pipeline's state and utility stages call the TypeSafe "Jev" model on every
run, in both modes. Without the keys a run fails cleanly and Index's hook
falls back to the plain negotiator.
"""

import os
import uuid
from typing import Any

from .config import Config
from .mapping import match_participant, scenario_description, to_result


class PipelineError(RuntimeError):
    """A run that cannot produce a usable assessment."""


_modules: dict[str, Any] = {}


def _load() -> dict[str, Any]:
    if _modules:
        return _modules
    import jax  # noqa: F401  (must precede dspy, per the lab's adapter)
    import jax.random as jrandom
    import dspy
    from flexible_moral_reasoning.construal.base import MSAModule, MutualBenefitModule
    from flexible_moral_reasoning.lm import JSONModeAdapter, RolloutSeededLM, openrouter_extra_body
    from flexible_moral_reasoning.mutual_benefit import estimate_action_values
    from flexible_moral_reasoning.schema import Scenario

    _modules.update(
        jrandom=jrandom,
        dspy=dspy,
        MSAModule=MSAModule,
        MutualBenefitModule=MutualBenefitModule,
        RolloutSeededLM=RolloutSeededLM,
        JSONModeAdapter=JSONModeAdapter,
        openrouter_extra_body=openrouter_extra_body,
        estimate_action_values=estimate_action_values,
        Scenario=Scenario,
    )
    return _modules


def _finite_samples(samples: list[float], n_samples: int, channel: str) -> list[float]:
    if len(samples) != n_samples or any(not _is_finite(sample) for sample in samples):
        raise PipelineError(f"channel {channel} has wrong shape or non-finite samples")
    return samples


def _is_finite(value: float) -> bool:
    return value == value and value not in (float("inf"), float("-inf"))


def run_assessment(packet: dict[str, Any], owner_user_id: str, config: Config) -> dict[str, Any]:
    """Run one assessment and return the moralmod-consult-0 result dict."""
    for key in ("OPENROUTER_API_KEY", "TYPESAFE_API_KEY"):
        if not os.environ.get(key):
            raise PipelineError(f"{key} is not set; the pipeline cannot run")

    m = _load()
    scenario = m["Scenario"](description=scenario_description(packet), metadata={})
    lm = m["RolloutSeededLM"](
        f"openrouter/{config.model}",
        seed=config.seed,
        cache=False,
        extra_body=m["openrouter_extra_body"](config.model, reasoning_effort=config.reasoning_effort),
    )
    keys = m["jrandom"].split(m["jrandom"].PRNGKey(config.seed), 3)
    with m["dspy"].context(lm=lm, adapter=m["JSONModeAdapter"](), num_threads=4):
        if config.mode == "full":
            module = m["MSAModule"]()
            module.rules.severity_cache_dir = config.severity_cache_dir
        else:
            module = m["MutualBenefitModule"]()
        construal = module(key=keys[1], scenario=scenario)
        action_values = m["estimate_action_values"](construal, scenario, keys[2], n_samples=config.n_samples)

    action_descriptions: dict[str, str] = dict(construal.actions.value)
    if not action_descriptions:
        raise PipelineError("the construal produced no actions")
    agent_labels = list(construal.agents.value)

    user = packet.get("user") or {}
    counterpart = (packet.get("opportunity") or {}).get("counterpart")
    participant_map: dict[str, str | None] = {
        owner_user_id: match_participant(user.get("name") or user.get("id"), agent_labels),
    }
    if counterpart:
        participant_map[str(counterpart)] = match_participant(str(counterpart), agent_labels)

    n = config.n_samples
    return to_result(
        f"run-{uuid.uuid4()}",
        action_descriptions=action_descriptions,
        values={a: _finite_samples(action_values.value[a].tolist(), n, f"value[{a}]") for a in action_descriptions},
        welfare={a: _finite_samples(action_values.welfare[a].tolist(), n, f"welfare[{a}]") for a in action_descriptions},
        severity={a: _finite_samples(action_values.severity[a].tolist(), n, f"severity[{a}]") for a in action_descriptions},
        utilities={
            a: {label: _finite_samples(action_values.utilities[a][label].tolist(), n, f"utilities[{a}][{label}]")
                for label in action_values.utilities[a]}
            for a in action_descriptions
        },
        participant_map=participant_map,
        n_samples=n,
    )
