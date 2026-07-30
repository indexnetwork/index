# Direct Chat Discovery Remnants Retirement Design

## Purpose

Complete Release 1’s background-only discovery cutover by removing the direct-chat orchestration branch that remained after public tools/routes/CLI entrypoints were retired.

## Decision

Remove the `orchestrator` trigger and `opportunity_draft_ready` live-stream contract end-to-end. Discovery execution is queue/background-only; opportunity negotiation remains available to the ambient queue path. The runtime will no longer select a short chat timeout, mutate accepted candidates to `draft`, emit live draft cards, or expose an orchestrator provenance value.

## Compatibility boundary

Do **not** remove persisted historical chat-card compatibility. Existing sessions may still contain legacy `discoveries` and `streamingDrafts` metadata. The API session serializers and web hydration/rendering must retain their read-only deserialization and presentation paths so historical messages remain viewable without generating new discovery requests.

## Runtime and contract changes

- Simplify the opportunity graph state and initial-status logic to the ambient default plus explicit caller-provided status; delete the direct-trigger branch and its tests.
- Remove draft-ready event variants from protocol/API chat stream contracts, request context, MCP presentation, and live web streaming state.
- Keep generic graph/agent observability events and background negotiation semantics; remove the retired orchestrator-only `trigger` fields where they exist only to distinguish it from ambient behavior.
- Update the primary chat prompt so it guides users to create/refine signals and review persisted opportunities, never to request an in-chat match run.

## Documentation and regression coverage

Update current architecture/domain documentation to describe intent/enrichment/introducer/maintenance queue triggers and persisted/home delivery rather than direct query-driven or streamed-chat discovery. Preserve clearly historical release records only where they are explicitly archival.

Extend the Release 1 static inventory gate to reject the retired direct-runtime symbols and direct-match prompt language in designated runtime/current-doc surfaces. The gate must not reject legacy session deserialization/rendering that is intentionally retained.

## Non-goals and safety

No Release 2 migration, `opportunity_discovery_runs` removal, destructive database action, or deployment action is included. No database-backed test runs without a proven disposable database and `TEST_DATABASE_SAFE=1`.
