# Changelog

## 0.3.0

### Breaking changes

- Require an explicit query and active source intent for each `Discovery.discover()` call. Return hydrated candidates instead of evaluated opportunities or potential pairs; perform one embedding and one search across authorized assignments.
- Remove automatic broadening, model clients, explanations, strategy bonuses, and automatic pair selection. Recent rejection is evidence returned to the agent, rather than a ranking penalty.
- The host injects `discover_counterparties` and `open_negotiation` into the personal agent, which owns planning, repeat searches, evaluation, and selection.

## 0.2.0

### Breaking changes

- Remove lens inference, HyDE generation/validation, and the `Artifacts` pipeline.
  `Discovery` now embeds the caller's query once and searches real intent vectors.
  Hosts supply `embedder` instead of `prepareArtifacts`.
