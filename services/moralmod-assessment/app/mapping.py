"""Turn-packet → pipeline input, and pipeline output → moralmod-consult-0 result.

The input rendering follows the lab's own conventions (decision-studio
custom-negotiator src/intervention/input.ts and moralmod_adapter/render.py,
commit 196153c): the "vignette" is sorted-key JSON under fixed section names,
no prose template, and no candidate-action menu — the model infers the
scientific actions from the situation, exactly as their production runs do.
"""

import json
import re
import unicodedata
from typing import Any


def canonical(value: Any) -> str:
    """Sorted-key JSON, matching the TypeScript `canonical` the lab uses."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def scenario_description(packet: dict[str, Any]) -> str:
    """Render the turn packet as the pipeline's scenario text."""
    user = packet.get("user") or {}
    intent = packet.get("intent") or {}
    opportunity = packet.get("opportunity") or {}
    content = {
        "situation": "Evaluate this networking opportunity using the visible record.\n"
        + canonical({"intent": intent, "opportunity": opportunity}),
        "participants": [
            {"name": user.get("name") or user.get("id"), "role": "principal (the person this agent negotiates for)"},
            {"name": opportunity.get("counterpart"), "role": "counterpart"},
        ],
        "decision_evidence": [
            {"kind": "agent-brief", "text": packet.get("brief") or ""},
        ],
    }
    return json.dumps(content, ensure_ascii=False, sort_keys=True)


def _fold(name: str) -> str:
    """Case- and space-folded participant label, as the lab's matcher folds them."""
    text = unicodedata.normalize("NFKC", name).casefold()
    return re.sub(r"\s+", " ", text).strip()


def match_participant(name: str | None, agent_labels: list[str]) -> str | None:
    """Match one person to exactly one extracted agent label, or nobody.

    A label matches on equality after folding, or as `Name (qualifier)`.
    Ambiguity is no match: a wrong binding is worse than a fallback.
    """
    if not name:
        return None
    wanted = _fold(name)
    hits = [
        label
        for label in agent_labels
        if _fold(label) == wanted or _fold(label).startswith(wanted + " (")
    ]
    return hits[0] if len(hits) == 1 else None


def to_result(
    run_id: str,
    *,
    action_descriptions: dict[str, str],
    values: dict[str, list[float]],
    welfare: dict[str, list[float]],
    severity: dict[str, list[float]],
    utilities: dict[str, dict[str, list[float]]],
    participant_map: dict[str, str | None],
    n_samples: int,
) -> dict[str, Any]:
    """Assemble the moralmod-consult-0 DecisionRunResult.

    `action_descriptions` maps native action id → description; utilities are
    keyed by native agent label and re-keyed here by participant.
    """
    ordered = list(action_descriptions.keys())
    bound = {person: label for person, label in participant_map.items() if label}
    actions = []
    for action_id in ordered:
        actions.append(
            {
                "action_id": action_id,
                "description": action_descriptions[action_id],
                "value": values[action_id],
                "welfare": welfare[action_id],
                "severity": severity[action_id],
                "utilities": {person: utilities[action_id][label] for person, label in bound.items()},
            }
        )
    return {
        "run_id": run_id,
        "assessment": {
            "ordered_action_ids": ordered,
            "participant_map": participant_map,
            "settings": {"n_samples": n_samples},
            "actions": actions,
        },
    }
