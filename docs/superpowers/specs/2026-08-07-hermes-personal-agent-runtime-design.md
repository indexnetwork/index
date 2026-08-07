# Hermes as the Personal Agent Negotiation Runtime

**Date:** 2026-08-07
**Status:** Approved design
**Scope:** Index macOS app, Hermes plugin/runtime, agent registry, and personal-agent negotiation dispatch

## Summary

Index presents one stable Personal Agent, called the Negotiator Agent in the macOS UI. The user may choose which runtime carries that agent: the built-in Index runtime or a local Hermes installation. Changing the runtime must not create a second visible persona or reset the agent's appearance, memory, policy, or history.

When Hermes is selected, it handles negotiations only. Index macOS remains the owner control surface, Hermes provides the local reasoning runtime, and the Index backend remains the authority for identity, permissions, turn state, deadlines, memory, and fallback. If Hermes is unavailable, Index takes over using the same user context, memory, and policy.

## Goals

- Make the existing **Negotiator Agent** runtime selector durable and functional.
- Let a local Hermes installation autonomously handle negotiations within server-enforced bounds.
- Preserve one Personal Agent identity across Index, Hermes, and fallback execution.
- Restrict a Mac-provisioned Hermes executor to negotiation capabilities.
- Surface owner consultations in Index macOS when Hermes lacks authority or required facts.
- Make setup, fallback, switching, and disconnect behavior observable and recoverable.

## Non-goals

- Making Hermes a second full Index client.
- Giving Hermes control over signals, profile, networks, contacts, or ordinary opportunity actions.
- Creating a second persona, memory store, or negotiation history for Hermes.
- Keeping local Hermes available while the Mac is asleep or offline.
- Removing the built-in Index negotiator fallback.
- Supporting multiple simultaneously active Hermes installations in the first version.

## Existing State

The repository already contains most low-level pieces:

- The macOS Agents screen detects local agent CLIs and presents a Negotiator Agent runtime selector (`apps/mac/IndexApp/src/index-amiga/agents.jsx`).
- Selecting a detected Hermes row registers an agent, mints an agent-bound key, writes `INDEX_API_KEY`, `INDEX_API_URL`, and `INDEX_MCP_URL` to `~/.hermes/.env`, installs/enables `indexnetwork/hermes-plugin`, and restarts a running gateway (`apps/mac/IndexApp/Sources/main.swift`).
- The Hermes plugin provides Index MCP wrappers, personal-agent negotiation pickup/respond handlers, skills, and a Desktop dashboard (`packages/hermes-plugin/`).
- The backend agent registry supports agent-bound authentication, `manage:negotiations`, `handleNegotiations`, heartbeat timestamps, atomic turn pickup, response submission, and system fallback (`services/api/src/controllers/agent.controller.ts`, `services/api/src/services/agent.service.ts`).
- Negotiator memory is already owner-scoped and included in polling pickup payloads (`docs/domain/negotiation.md`).
- The protocol already has a safe, 24-hour owner-consultation pipeline for in-process `ask_user` turns.

The product flow is incomplete:

- The macOS runtime selector and displayed permission controls currently update local React state rather than durable server state.
- Hermes installation does not ensure a recurring negotiation pass.
- The broad Hermes plugin surface does not express a negotiation-only Mac-provisioned mode.
- External polling agents cannot currently enter the server's `ask_user` consultation path.
- Runtime identity is inferred by a display name, which cannot safely distinguish installations.

## Product Model

### Stable Personal Agent

The visible Negotiator Agent is the stable product identity. It owns:

- name and appearance;
- owner-scoped negotiator memory;
- negotiation policy and escalation preferences;
- negotiation history and activity;
- the user's expectation of continuity.

This identity does not change when the runtime selector changes.

### Runtime Binding

Index and Hermes are execution runtimes for the same Personal Agent:

- **Index · system default** means no external executor is preferred.
- **Hermes · on this Mac** means one registered Hermes installation is preferred for eligible negotiation turns.

The backend retains a personal-agent registry record and agent-bound credential for Hermes. That record is an executor binding and security principal, not a second visible persona.

For the first version, the durable binding can continue to use the existing `handleNegotiations` field, with a new enforced invariant that at most one owned external agent has it set to `true`. Selecting Index means no external agent has that field enabled. A separate persona table is not required.

### Shared policy

"Policy-bounded" means Hermes and Index fallback receive the same server-authoritative policy envelope. It consists of:

- protocol version, seat, allowed actions, deadlines, and turn limits;
- fixed negotiation safety and disclosure rules;
- owner-authored standing rules from owner-scoped negotiator memory;
- server-computed eligibility for one owner consultation;
- the conservative default when consultation is unavailable or rejected.

The Hermes prompt or skill is not the authority for these rules. The backend validates every submitted action, and the same policy inputs are injected into the built-in Index fallback. This version does not add a second arbitrary policy document or Hermes-local policy editor.

### Responsibilities

#### Index backend

- Stores the executor binding and installation identity.
- Grants and checks exact negotiation permissions.
- Authenticates the Hermes executor.
- Persists turn state, claims, deadlines, responses, consultations, memory, and audit history.
- Selects external dispatch versus system fallback.
- Guarantees that a turn can be completed only once.

#### Hermes

- Runs the LLM reasoning loop for claimed negotiation turns.
- Uses only the context, memory, policy, allowed actions, and deadline supplied by Index.
- Submits one response or one owner-consultation request for a claimed turn.
- Polls locally while its gateway and schedule are running.
- Does not become a second Index management surface.

#### Index macOS

- Detects the local Hermes installation.
- Connects, configures, selects, monitors, pauses, and disconnects the runtime.
- Owns Personal Agent appearance, policy, history, health, and escalation UI.
- Continues to handle all non-negotiation Personal Agent experiences.

## Runtime Selection and Setup

Selecting Hermes is a reconciled setup operation, not an optimistic dropdown change.

1. Index macOS enters a `connecting` state.
2. The backend creates or reuses the Hermes executor for this installation without making it active.
3. Index macOS mints or rotates an agent-bound credential.
4. The native shell configures Hermes with the Index endpoints and credential.
5. It installs/enables the Index plugin in negotiator mode.
6. It creates or reconciles a disabled one-minute scheduled negotiation pass.
7. It verifies the bound executor through `GET /api/agents/me`; this check does not require negotiation authority or claim work.
8. One owner-control backend operation atomically disables any previous external executor, grants this executor exactly `manage:negotiations`, and sets `handleNegotiations=true`. It accepts a Better Auth session or the Mac app's unbound owner credential, and rejects every agent-bound key.
9. The native shell enables the schedule and starts or restarts the Hermes gateway.
10. Index macOS waits for a server-observed pickup heartbeat. A heartbeat within the dispatcher's existing 90-second freshness threshold commits the selector to `Hermes · active`.

The activation sequence is a saga across the backend and local Mac, not a cross-process transaction. If steps 8–10 fail, the app immediately clears the external binding and permission, disables the schedule, and restores Index. The built-in runtime covers any turn that arrives during this bounded activation window.

Setup must be idempotent. Repeating it must update the same installation binding rather than create duplicate agent records, keys, plugin copies, or schedules. Server-side activation must enforce the single-executor invariant atomically; the current separate field/permission updates are not sufficient for this operation.

If an earlier step fails, Index remains selected. The UI reports the failed stage and offers retry. Server and local state are either rolled back or retained as explicitly incomplete state that the next reconciliation can safely finish.

### Installation identity

A Hermes installation receives a stable, non-secret installation ID stored locally and on its executor record. The app must not match an installation only by agent name. The first version binds only the local installation detected by the current Mac.

## Negotiation Flow

1. A negotiation reaches a turn owned by a user whose preferred external executor is Hermes.
2. The dispatcher checks the executor's server-observed heartbeat. If it is older than the existing 90-second freshness threshold, the built-in Index negotiator runs inline and no turn is parked.
3. If Hermes is fresh, the backend parks the turn through the existing `waiting_for_agent` flow and arms the existing response-window budget.
4. The Hermes one-minute scheduled pass calls pickup with its agent-bound key.
5. Pickup atomically claims one turn and returns:
   - absolute own/counterparty context;
   - negotiation and opportunity context;
   - persisted history;
   - owner-scoped negotiator memory;
   - protocol version, seat, and allowed actions;
   - deadline and claim identifiers;
   - the applicable Personal Agent policy;
   - `canConsultOwner`, computed by the server.
6. Hermes chooses one policy-compliant action.
7. Hermes submits exactly one response or one consultation request.
8. The backend validates the seat-specific action, atomically consumes the claim, persists the turn, and advances or finalizes the negotiation.
9. History is presented as activity of the stable Personal Agent, with runtime attribution available as secondary diagnostic metadata.

Hermes must not fetch broad Index state to reconstruct the turn. Pickup is the bounded context envelope for negotiation reasoning.

## Owner Consultation

Policy-bounded autonomy requires a safe path for facts or authority only the owner can supply.

Pickup returns a server-computed `canConsultOwner` boolean. When true, Hermes may call `POST /api/agents/:id/negotiations/:negotiationId/consult` for its current claim with only `disclosureSubject` and `draftQuestion`. The endpoint must not accept raw counterparty context, evaluator reasoning, private memory, or arbitrary internal metadata as user-visible question content.

On admission:

1. The backend validates ownership, exact claim identity, protocol eligibility, consultation cardinality, `canConsultOwner`, and structured content.
2. It moves the exact task into the existing `input_required` lifecycle.
3. It uses the existing Questioner safety, binding, persistence, timer, and continuation pipeline.
4. The question appears in the Index macOS Personal Agent surface.
5. Answer, dismissal, or expiry settles the exact consultation and resumes the exact negotiation.

The existing one-consultation-per-side limit and 24-hour answer window remain authoritative. A rejected consultation leaves the exact claim intact for a legal response within its original remaining deadline. The external executor cannot invent a parallel question store or wait synchronously for the owner.

## Fallback

Hermes is local and best-effort. The built-in Index negotiator remains mandatory.

- If Hermes is already stale when dispatch begins, Index takes the turn inline without parking it.
- If Hermes was fresh at dispatch but does not claim the parked turn before the response window expires, Index takes the turn.
- If Hermes claims but does not submit before the remaining budget expires, Index takes the expired claim through the existing fallback path.
- Atomic claim/state transitions prevent Hermes and Index from both completing the same turn.
- Fallback receives the same owner-scoped memory and policy available to Hermes.
- The macOS activity UI records that Index covered the turn because Hermes was unavailable.

Selecting Hermes does not promise always-on availability. It promises preference while healthy, with bounded fallback.

## Hermes Negotiator Mode

A Mac-provisioned installation configures the plugin in a negotiation-only mode.

That mode exposes only the capabilities required to:

- resolve the authenticated executor identity;
- pick up one negotiation turn;
- submit one response;
- request one owner consultation.

The generated negotiation skill remains available. Broad Index MCP wrappers, orchestration hints, and the full Index dashboard are not registered in this mode. Server authorization remains the primary boundary even if plugin configuration is tampered with: the key holds only `manage:negotiations`.

Hermes Desktop does not present a duplicate Index experience in the first version. Negotiator mode registers no Index dashboard; connection, heartbeat, activity, policy editing, owner questions, and opportunity review remain in Index macOS.

## macOS States and Controls

The selector reflects durable server and observed runtime state:

- `Index · system default`
- `Hermes · connecting`
- `Hermes · active`
- `Hermes · unavailable — Index is covering`
- `Hermes · needs attention`

The explanatory line under the selector becomes live status, for example:

> Hermes handled the last turn 3m ago. Index takes over when Hermes is unavailable.

Two operations remain distinct:

### Select Index

- Disable Hermes as the preferred executor.
- Remove its active negotiation authority.
- Disable its negotiation schedule.
- Keep the installation connected so it can be selected again quickly.
- Preserve all Personal Agent identity, memory, policy, and history.

### Disconnect Hermes

- Select Index immediately.
- Disable/remove the schedule.
- Revoke all credentials for the installation.
- Remove Index variables and plugin wiring from the local Hermes installation.
- Mark the executor record inactive after revocation so installation reconciliation and runtime attribution remain durable.
- Preserve the stable Personal Agent identity, memory, policy, and history.

## Security and Invariants

- An owner has at most one preferred external negotiation executor.
- Runtime-binding changes require a Better Auth session or the Mac app's unbound owner credential; every agent-bound key is rejected.
- An agent-bound key cannot select itself, grant permissions, mint successor keys, or manage another executor.
- The Hermes executor has exactly `manage:negotiations` in this mode.
- Credentials may cross the WKWebView-to-native bridge only transiently during bootstrap; they are never rendered, logged, or persisted in web storage.
- Reconnect rotates credentials; disconnect revokes them.
- Health uses the dispatcher's server-observed 90-second heartbeat threshold, not process detection alone.
- Claims and consultation settlement use exact task/claim identifiers and atomic state transitions.
- Memory, policy, appearance, and product history are keyed to the owner/stable Personal Agent, not the executor record.
- User-visible consultation content passes the existing safe Questioner boundary.
- Setup and teardown are resumable and do not create duplicate principals or schedules.

## Failure Handling

| Failure | Required behavior |
| --- | --- |
| Hermes binary missing | Keep Index selected; explain that Hermes must be installed. |
| Agent registration or permission update fails | Keep Index selected; do not write a usable local credential. |
| Credential/config write fails | Revoke the new credential or retain explicit incomplete reconciliation state. |
| Plugin install/enable fails | Keep Index selected; report the Hermes command stage and allow retry. |
| Schedule creation fails | Keep Index selected; an installed but unscheduled plugin is not considered active. |
| Gateway restart fails | Clear the external binding, disable the schedule, and restore Index. |
| Heartbeat becomes stale | Show unavailable state; dispatch falls back inline until heartbeat is fresh again. |
| Hermes returns an invalid action | Leave the claim available for a bounded retry; fallback remains armed. |
| Owner consultation is unsafe/ineligible | Reject it without creating a question; Hermes must choose a conservative legal action within its remaining deadline. |
| Disconnect is partially successful | Select Index first, revoke server authority, then retry best-effort local cleanup. |

## Testing

### Backend

- Selecting Hermes leaves exactly one active `handleNegotiations=true` executor.
- Selecting Index leaves no active external negotiation executor.
- Enabling Hermes grants only `manage:negotiations`; disabling it removes active negotiation authority.
- Agent credentials cannot alter runtime binding or permissions.
- Concurrent Hermes/fallback completion attempts commit one turn only.
- Owner consultation binds and resumes the exact task and enforces existing cardinality and safety rules.
- Revoked, stale, wrong-installation, and wrong-owner credentials fail closed.

### Hermes plugin

- Negotiator mode registers only the four required capability groups.
- The scheduled pass is idempotent and submits at most one result per claim.
- No pending turn produces the exact silent outcome.
- Seat-specific allowed actions are honored for v1 and v2.
- Consultation emits only the structured safe fields.
- Broad tools and the full dashboard are absent in negotiator mode.

### Index macOS

- Setup is idempotent across repeated selection and app relaunch.
- Each setup-stage failure preserves or restores Index selection.
- Local/server reconciliation repairs partial setup without duplicate agents, keys, or schedules.
- The selector renders connecting, active, unavailable/fallback, and needs-attention states from durable data.
- Selecting Index differs from disconnecting Hermes.
- Health comes from server timestamps rather than local binary detection.

### End-to-end

1. Select Hermes, observe heartbeat, and complete a negotiation turn through Hermes.
2. Stop Hermes before dispatch and verify immediate inline fallback; separately stop it after a fresh dispatch and verify response-window fallback completes the turn once.
3. Have Hermes request owner input, answer in Index macOS, and resume the exact negotiation.
4. Select Index and verify Hermes can no longer claim new turns.
5. Disconnect Hermes and verify credential revocation plus local cleanup.
6. Relaunch during each partial setup stage and verify deterministic reconciliation.

## Rollout

1. Persist installation identity and enforce the single preferred-executor invariant while preserving existing `handleNegotiations` semantics.
2. Add external owner consultation through the existing `ask_user` safety and continuation pipeline.
3. Add Hermes negotiator mode and idempotent schedule management.
4. Wire the existing macOS selector to the real setup, binding, health, and reconciliation flow.
5. Enable for internal users first.
6. Measure setup success, heartbeat freshness, Hermes completion rate, fallback frequency, invalid/duplicate submission attempts, consultation creation, and consultation completion.
7. Keep Index fallback enabled throughout rollout and rollback.

## Acceptance Criteria

- Choosing Hermes in Index macOS durably activates one negotiation-only local executor.
- The same Personal Agent name, appearance, memory, policy, and history remain visible before, during, and after runtime changes.
- Hermes autonomously handles turns while healthy and can safely consult the owner through Index macOS.
- Index takes over immediately when Hermes is stale at dispatch, or within the existing response window when Hermes becomes unavailable after a fresh dispatch.
- Choosing Index stops Hermes negotiation dispatch without disconnecting it.
- Disconnecting Hermes revokes authority and removes local wiring.
- Broad Index capabilities are unavailable to a Mac-provisioned Hermes negotiator both in plugin registration and server authorization.
- Setup, retry, relaunch, fallback, switching, and disconnect paths pass the specified tests without duplicate turns, agents, keys, or schedules.
