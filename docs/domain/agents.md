---
title: "Agents"
type: domain
tags: [agents, auth, protocol, opportunity, negotiation]
created: 2025-07-14
updated: 2025-07-14
---

# Agents

An **agent** is an autonomous actor that represents a user within the system. Agents authenticate, receive opportunities, and participate in negotiations on behalf of their owner.

---

## Agent Types

| Type | Description |
|------|-------------|
| `personal` | User-owned agent created during onboarding or experiment-network signup. Connects via the MCP server using an API key. |
| `system` | Platform-owned agents (e.g. `Index Chat Orchestrator`, `Index Negotiator`) seeded with fixed UUIDs during startup. |

An agent always has exactly one owner (`ownerId → users.id`). System agents are owned by the platform user.

---

## Agent Status

| Status | Description |
|--------|-------------|
| `active` | Agent is live and eligible to receive opportunities and negotiations. |
| `inactive` | Agent has been disabled by its owner. Will not receive new deliveries. |

Soft-deletion (`deletedAt`) is supported — a deleted agent is excluded from all queries but its delivery history is preserved.

---

## Agent Transports

Each agent has zero or more **transports** (`agent_transports` table). A transport is a delivery channel through which the agent receives work.

- The only supported channel is `mcp`. An agent on the MCP channel authenticates with an API key that carries a `metadata.agentId` binding, connects to the MCP server, and polls the pickup endpoints to receive opportunities and negotiation turns.
- `priority` — ordering within the same agent if multiple transports exist (unused for single-channel agents; reserved for future channels).
- `failureCount` — incremented on delivery failure; used for liveness monitoring.

---

## Agent Permissions

Permissions (`agent_permissions` table) define what actions an agent may perform on behalf of its owner, and optionally restrict it to a specific scope.

| Field | Values | Description |
|-------|--------|-------------|
| `scope` | `global`, `node`, `network` | Breadth of the permission. |
| `scopeId` | UUID or null | When `scope = 'network'`, this is the network the agent is restricted to. |
| `actions` | string array | e.g. `manage:intents`, `manage:networks`, `manage:negotiations` |

A permission row is per-`(agentId, userId)` pair. An agent with `scope = 'global'` has no resource restriction. An agent with `scope = 'network'` is enforced at the HTTP layer by `AgentScopeGuard` (403 on scope violation) and at the MCP layer by `computeAgentIndexScope` (clamps the agent's accessible networks before any tool call).

System agents have their permissions seeded during onboarding and are never stored with `scope = 'network'`.

---

## Opportunity Delivery Ledger

The `opportunity_deliveries` table tracks every delivery of an opportunity to a user, preventing duplicate delivery across channels and triggers.

### Delivery channels and triggers

| `channel` | `trigger` | Description |
|-----------|-----------|-------------|
| `openclaw` | `pending_pickup` | Agent polled and atomically reserved a pending opportunity (reserve step). |
| `openclaw` | `ambient` | Delivery confirmed via MCP tool — real-time path. |
| `openclaw` | `digest` | Delivery confirmed via MCP tool — daily digest path. |
| `openclaw` | `accepted` | Delivery confirmed via MCP tool — accepted-opportunity notification. |

Email and Telegram notifications are dispatched out-of-band via the notification queue and are not recorded in `opportunity_deliveries`.

### Reservation pattern

Delivery uses a **reserve-then-confirm** protocol to guarantee at-most-once delivery to an agent:

1. `POST /api/agents/:id/opportunities/pickup` — atomically reserves one pending delivery row, writing a `reservationToken` and `reservedAt` timestamp. Returns the opportunity to the agent.
2. The agent processes the opportunity and calls `POST /api/agents/:id/opportunities/:opportunityId/delivered` with the `reservationToken`.
3. The backend writes `deliveredAt`, finalising the row. A unique index on `(userId, opportunityId, channel, delivered_at_status)` prevents duplicate committed records.

If the agent crashes or fails to confirm, the reservation expires and the row becomes eligible for re-delivery after a timeout.

---

## Test Message Delivery

The `agent_test_messages` table provides a mechanism for owners to verify that a personal agent's delivery pipeline is working. It uses the same reserve-then-confirm pattern as opportunity delivery:

1. `POST /api/agents/:id/test-messages` — owner enqueues a test message (session auth only).
2. `POST /api/agents/:id/test-messages/pickup` — agent polls and atomically reserves the message.
3. `POST /api/agents/:id/test-messages/:messageId/delivered` — agent confirms delivery with the `reservationToken`.

---

## Liveness Heartbeat

Every pickup endpoint (`opportunities/pickup`, `test-messages/pickup`, `negotiations/pickup`) calls `agentService.touchLastSeen(agentId)` after verifying ownership. This updates `agents.last_seen_at` and serves as a liveness signal — used by the system to assess whether a personal agent is actively polling.

---

## Experiment Network Provisioning

When a user is invited or signed up through the headless experiment-network flow, the system automatically provisions:

1. A user account.
2. A personal network for that user.
3. A personal agent with `scope = 'network'`, restricted to the experiment network.
4. An API key bound to that agent.

The signup response returns the user, the API key, and a drop-in `mcpServer` config (`name`, `url`, `headers`) ready to paste into any MCP-compatible runtime. No follow-up `agentId` lookup is needed.

---

## Invariants

- An agent is always owned by exactly one user. Deleting a user cascades to their agents.
- `type = 'system'` agents are never created through the API; they are seeded at startup.
- A global-permission agent cannot be downgraded to network scope via a permission update — the constraint is enforced at the HTTP guard layer.
- `deliveredAt` is only written once per `(userId, opportunityId, channel, deliveredAtStatus)` tuple (unique index enforces this; the `deliveredAtStatus` dimension allows separate committed records if an opportunity transitions between statuses).
