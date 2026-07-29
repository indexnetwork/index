# Introducer Discovery Feature Flag Design

**Date:** 2026-07-29

## Goal

Add a default-off environment flag that disables introducer-flow opportunity finding without disrupting existing introducer opportunities or their lifecycle actions.

## Configuration

`INTRODUCER_DISCOVERY_ENABLED` is enabled only when its value is exactly `true`. Unset, `false`, and malformed values disable the feature.

The feature PR ships dark: it registers the optional boolean in API startup validation and documents a commented-out `INTRODUCER_DISCOVERY_ENABLED=false` entry in `.env.example`. The runtime accessor treats an unset value as disabled.

Do not change root `.env.development` or Railway development service variables in the feature PR. After the dark deployment is verified, a separate, explicitly approved flip sets `INTRODUCER_DISCOVERY_ENABLED=true` on Railway's protocol service and mirrors that value in root `.env.development`. Tests leave the flag unset except when a test explicitly sets `true` or `false` to prove the gate.

## Disabled Behavior

When disabled, the system must not search for new opportunity counterparts on behalf of another user.

The following paths are gated:

1. **Maintenance scheduling:** `MaintenanceGraph` skips automatic connector-flow discovery before contact selection or job enqueueing.
2. **Queued discovery:** `FromIntroducerQueue` exits successfully before the opportunity graph runs. This makes jobs queued before a flag flip harmless.
3. **Interactive discovery:** `discover_opportunities` requests that use introducer-target/on-behalf-of inputs return a clear feature-disabled result before discovery or session persistence. Continuation requests for such sessions are also rejected.
4. **System prompts:** when disabled, system-prompt modules omit introducer-flow instructions, examples, and calls-to-action that would tell the model to find opportunities for another user.

The interactive and queue gates are authoritative backstops for stale model turns, direct callers, and already-created queue jobs. Background gates log a structured skip and remain successful no-ops.

## Preserved Behavior

The flag does not alter existing introduction records. Users can continue to view, approve, send, accept, reject, and otherwise progress opportunities already created with an introducer.

Direct actions that do not require finding a counterparty remain available. Ordinary, non-introducer opportunity discovery is unaffected.

## Structure

Provide one strict, pure feature-gate helper so all call sites share the same default-off semantics. Apply it at the three runtime boundaries—maintenance, queue worker, and interactive discovery—and use it while composing system-prompt modules. Do not rely on prompt omission as enforcement.

## Error Handling and Observability

- Background scheduling and queue paths log the disabled skip without selecting contacts, enqueueing work, or invoking the graph.
- Interactive callers receive a stable, explicit disabled result rather than a misleading empty result.
- The system does not create or continue an introducer discovery cache/session while disabled.

## Verification

Add focused tests proving:

- strict flag semantics for unset, `false`, malformed, and `true` values;
- maintenance performs no introducer contact selection or enqueueing while disabled;
- queued introducer jobs do not invoke the graph while disabled;
- manual introducer-target discovery and continuation return the disabled result before work or caching;
- disabled prompt composition omits introducer-finding content, while enabled composition retains it;
- ordinary discovery and existing-introduction lifecycle behavior remain unchanged.
