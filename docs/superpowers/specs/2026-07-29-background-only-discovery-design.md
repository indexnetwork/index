# Background-Only Opportunity Discovery Design

## Goal

Make opportunity discovery an ambient, background-only capability. Users can review and act on persisted opportunities, but no client or chat surface can request a new discovery run directly.

## Decisions

- Keep background discovery triggered by intent lifecycle, enrichment, introducer maintenance, pool-answer reruns, and maintenance jobs.
- Remove all interactive/direct discovery interfaces: protocol/MCP tools, generic Tool API exposure, the legacy REST endpoint, CLI command, and legacy-chat orchestration/prompt behavior.
- Keep all persisted-opportunity read and action interfaces: Radar/home, detail, list, delivery polling/digest, accept/reject/send, and start-chat.
- Fully remove the MCP-only discovery-run queue and persistence. Historical run records are transient execution state and will not be retained.
- Direct callers receive ordinary missing-surface behavior, not a compatibility error response.

## Architecture

### Retained background pipeline

Background producers continue to invoke `OpportunityGraphFactory` through the API queue layer:

- `FromIntentQueue` after intent assignment/HyDE, resume, and pool-answer reruns.
- `FromEnrichmentQueue` after enrichment completion.
- `FromIntroducerQueue` from maintenance-selected contacts.
- Maintenance and lifecycle hooks that enqueue those queues.

These flows persist latent opportunities. Existing feed, Radar, delivery, and action paths continue to read and transition those records.

### Removed direct pipeline

Remove the direct-discovery capability from every public and foreground composition surface:

- `discover_opportunities`, `get_discovery_run`, and `cancel_discovery_run` registrations and tool contracts.
- MCP authorization and MCP guidance for direct discovery or polling.
- Generic `POST /api/tools/:toolName` access by removing the tool from its registry.
- `POST /api/opportunities/discover` and `OpportunityService.discoverOpportunities`.
- `index opportunity discover` and its CLI documentation/tests.
- Legacy chat agent callbacks, hallucinated-card recovery, prompts, prompt modules, result normalization, and snapshots that direct a model to invoke discovery.
- MCP discovery-run composition, queue worker, adapter, interfaces/ports, schema, and tests.

The opportunity graph remains because background queues depend on it. `list_opportunities` and `update_opportunity` remain available for reading and acting on background-produced records.

## Data and rollout

`opportunity_discovery_runs` is only the MCP async-run lifecycle store. It has no role in background queue discovery and no replacement is needed.

Use a two-release removal:

1. **Code cutover:** remove all direct entry points and all runtime consumers of discovery-run persistence, but retain the dormant table. This prevents a rolling older API instance from trying to write a table dropped by a newer deployment.
2. **Schema cleanup:** after the code cutover is fully deployed, drop `opportunity_discovery_runs` and its database artifacts in a dedicated destructive migration. Follow production-release destructive-migration checks; no data backfill is required because records are transient.

This is a breaking public-contract change. Protocol, API, and CLI versions must be bumped according to repository release policy, and public docs must no longer advertise direct discovery.

## Error behavior

No disabled compatibility endpoint/tool will be retained:

- Tool/MCP callers see the ordinary absent/unknown-tool behavior because discovery tools are no longer registered or listed.
- `POST /api/opportunities/discover` is absent and receives the router's normal 404 response.
- The CLI no longer recognizes the `discover` subcommand.

Existing persisted opportunities remain readable and actionable. No presentation fallback policy changes, and no raw evaluator reasoning may be exposed during the cleanup.

## Verification

Use test-driven development. Before deleting each direct interface, add or update a focused test that fails under the current implementation and demonstrates the intended absence or retained background behavior.

Required coverage:

- MCP and generic tool registry no longer list/register the three discovery tools.
- Direct Tool API invocation rejects the removed tool.
- MCP authorization/guidance has no discovery permission or polling instructions.
- The direct REST endpoint and CLI subcommand are unavailable.
- Legacy chat personas, prompt modules, callback paths, hallucinated-card recovery, and snapshots no longer reference or invoke direct discovery.
- Background `from-intent`, enrichment, introducer, pool-answer, and maintenance paths still invoke the graph and create persisted opportunities.
- Radar/home, list, update, start-chat, delivery polling, and digest tests remain green.
- The code-cutover release leaves no runtime write/read dependency on the discovery-run table; the later migration drops it and passes the destructive-release verification procedure.

## Non-goals

- Changing candidate matching, evaluation, persistence, negotiation, Radar presentation, or delivery policies.
- Altering background scheduling or adding a new manual trigger.
- Preserving historical MCP discovery-run records.
- Retaining a feature flag or an error-only compatibility implementation for direct discovery.
