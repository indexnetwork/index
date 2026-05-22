# Polymorphic Network Types & Network-Level Integrations

**Date:** 2026-05-22
**Status:** Draft
**Scope:** Schema extension, integration sync worker, LLM context injection

## Motivation

Index Network depends on EdgeOS for event-network features (schedule, attendee directory, venues, RSVPs) via the EdgeClaw skills. EdgeOS readiness is uncertain. This design absorbs the core value — temporal community context and calendar-aware discovery — into Index Network's own model, without building a full event platform. Index stays focused on discovery and matching; calendar and venue infrastructure remain external via integrations.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `isExperiment` relationship to `type` | Orthogonal | `isExperiment` gates auth/isolation (headless signup, master keys). Any network type can be experimental. |
| Core protocol entities | Unchanged | No modifications to intents, opportunities, or the discovery pipeline. MVP scope. |
| Network type values | `community`, `event` | Explicit type on every network. Existing rows backfill to `community`. |
| Sync model | Periodic BullMQ worker | Repeatable job polls Google Calendar on a configurable interval. No webhooks. |
| Event storage | `networks.metadata` JSONB | Synced calendar events stored in the network's own metadata. No new tables. |
| Per-member extra fields | `network_members.metadata` JSONB | Flat bag for network-specific attendee data (participation weeks, dietary, etc.). |
| Discovery injection toggle | `networks.permissions` JSONB | Policy/config lives in `permissions`; content/data lives in `metadata`. |
| Auto-archive | Manual only | `endDate` is informational. Network owner archives explicitly. |
| Context renderer | Type-aware, per-type functions | Curated markdown per network type. Event networks get date ranges, event tables, tag lists. |

## Schema Changes

### `networks` table — two new columns

```sql
-- New enum
CREATE TYPE network_type AS ENUM ('community', 'event');

-- New columns
ALTER TABLE networks
  ADD COLUMN type network_type NOT NULL DEFAULT 'community',
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
```

Existing rows automatically receive `type = 'community'` and `metadata = '{}'` via the defaults.

### `network_members` table — one new column

```sql
ALTER TABLE network_members
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
```

### `network_integrations` table — one new column

```sql
ALTER TABLE network_integrations
  ADD COLUMN sync_config jsonb NOT NULL DEFAULT '{}';
```

### Metadata shapes

**`networks.metadata` for `type = 'community'`:**

```json
{}
```

Communities have no required metadata today. The JSONB is available for future extensions.

**`networks.metadata` for `type = 'event'`:**

```json
{
  "startDate": "2026-05-30T00:00:00Z",
  "endDate": "2026-06-27T23:59:59Z",
  "timezone": "America/Los_Angeles",
  "location": "Healdsburg, California",
  "themes": ["AI", "Governance & Coordination", "Health & Longevity"],
  "events": [
    {
      "externalId": "google-cal-event-abc123",
      "title": "AI Governance Panel",
      "startTime": "2026-06-10T14:00:00-07:00",
      "endTime": "2026-06-10T15:30:00-07:00",
      "location": "Main Hall",
      "description": "Panel discussion on AI governance frameworks",
      "tags": ["AI", "Governance"],
      "syncedAt": "2026-06-09T10:00:00Z"
    }
  ]
}
```

Service-layer validation: if `type === 'event'`, then `metadata.startDate` and `metadata.endDate` are required. All other fields are optional.

**`network_members.metadata` (any network type):**

```json
{
  "participationWeeks": [1, 2],
  "dietaryPreferences": "vegetarian",
  "builderDescription": "Working on decentralized identity",
  "personalGoals": "Connect with governance researchers"
}
```

Flat bag — no formal schema. Content varies by network. The network owner or import process defines what goes here.

**`networks.permissions` — extended shape:**

```json
{
  "joinPolicy": "invite_only",
  "invitationLink": true,
  "allowGuestVibeCheck": false,
  "contextInjection": {
    "discovery": true
  }
}
```

`contextInjection.discovery` (default `true`) controls whether the network's rendered metadata is included in the opportunity discovery evaluator's context.

**`network_integrations.sync_config`:**

```json
{
  "intervalMs": 900000,
  "lastSyncAt": "2026-06-09T10:00:00Z",
  "calendarId": "primary",
  "status": "active"
}
```

`status`: `'active' | 'paused' | 'error'`. The sync worker reads this to decide what to pull and when.

### Zod validation schemas

Service-layer validation uses Zod schemas for metadata shapes. Define in the network service (or a shared validation module):

- `EventNetworkMetadataSchema` — validates `startDate` (required), `endDate` (required), `timezone`, `location`, `themes`, `events[]`
- `NetworkMemberMetadataSchema` — passthrough (no required fields, accepts any JSON object)
- `SyncConfigSchema` — validates `intervalMs`, `lastSyncAt`, `calendarId`, `status`

On network create/update: if `type === 'event'`, parse `metadata` through `EventNetworkMetadataSchema`. If `type === 'community'`, no metadata validation (empty object accepted).

## Integration Sync Worker

### New toolkit

Extend the `Toolkit` type to include `'google_calendar'`:

```typescript
type Toolkit = 'gmail' | 'slack' | 'google_calendar';
```

The Composio action slug is `GOOGLESUPER_GOOGLE_CALENDAR_LIST_EVENTS` (from the `googlesuper` toolkit). The Index Network toolkit identifier stays `'google_calendar'`.

### Connection flow

1. Network owner calls the existing `linkToIndex(userId, 'google_calendar', networkId)` flow
2. Composio OAuth resolves the user's Google account; `connectedAccountId` is stored in `network_integrations`
3. The owner (or an API call) sets `sync_config` with `calendarId`, `intervalMs`, and `status: 'active'`
4. The sync worker picks it up on next tick

### Sync worker (new BullMQ repeatable job)

Job name: `integration-sync`. A single BullMQ repeatable job that ticks on a fixed global interval (default 5 min). Each tick scans for integrations whose per-row `intervalMs` has elapsed:

1. Query `network_integrations` rows where `sync_config->>'status' = 'active'` and the time since `sync_config->>'lastSyncAt'` exceeds the row's `sync_config->'intervalMs'` (default 900000 ms / 15 min)
2. For each row, read the parent network's `metadata.startDate` and `metadata.endDate` to scope the time window
3. Execute `composio.tools.execute('GOOGLESUPER_GOOGLE_CALENDAR_LIST_EVENTS', { connectedAccountId, arguments: { time_min: startDate, time_max: endDate, single_events: true, calendar_id: calendarId } })`
4. Paginate via `nextPageToken` until all events are fetched
5. Map response items to the `metadata.events[]` shape:
   - `externalId` ← Google event `id`
   - `title` ← `summary`
   - `startTime` ← `start.dateTime`
   - `endTime` ← `end.dateTime`
   - `location` ← `location`
   - `description` ← `description` (truncated to 500 chars)
   - `tags` ← empty (no Google Calendar equivalent; can be enriched later)
   - `syncedAt` ← current timestamp
6. Upsert into `networks.metadata.events[]` by `externalId`: add new, update changed, remove events no longer in the calendar response
7. Update `sync_config.lastSyncAt`
8. On error: set `sync_config.status = 'error'`, log the error. The owner can re-activate manually.

### What stays the same

User-level integrations (Gmail contacts, Slack contacts) are unchanged. The sync worker only processes `network_integrations` rows that have a non-empty `sync_config` with `status = 'active'`.

## LLM Context Injection

### Renderer

A type-aware utility in the protocol package:

**Location:** `packages/protocol/src/shared/network/metadata.renderer.ts`

**Interface:**

```typescript
function renderNetworkContext(network: {
  type: string;
  title: string;
  prompt?: string;
  metadata: Record<string, unknown>;
}): string
```

Dispatches by `type` to type-specific renderers. Returns a markdown string.

**`community` renderer:** Returns `title` + `prompt` (existing behavior, no metadata rendering).

**`event` renderer:** Produces structured markdown:

```markdown
## Edge Esmeralda 2026

A month-long popup village exploring AI, consciousness, governance, and emerging technology.

- **Type:** Event
- **Dates:** May 30 – June 27, 2026
- **Location:** Healdsburg, California
- **Timezone:** America/Los_Angeles
- **Themes:** AI, Governance & Coordination, Health & Longevity, Privacy, d/acc

### Upcoming Events (next 7 days)
| Time | Event | Location |
|------|-------|----------|
| Jun 10, 2:00 PM | AI Governance Panel | Main Hall |
| Jun 10, 4:00 PM | Cold Plunge & Conversations | River Deck |
| Jun 11, 10:00 AM | Builder Demo Day | Workshop Room |
```

The event table is time-windowed: "next 7 days" relative to the current time. This keeps token count manageable. The full `metadata.events[]` array is available for direct queries.

### Injection points

**1. Chat orchestrator**

The chat graph assembles network context before the LLM call. Add `renderNetworkContext(network)` to that assembly step. The agent sees the rendered markdown as part of its system context when a user asks about a specific network.

**2. MCP tool responses**

When `read_networks` returns network data, include a `renderedContext` field with the markdown alongside the raw data. Agents consuming MCP tool responses get human-readable context without parsing JSON.

**3. Opportunity discovery**

The opportunity evaluator receives network context when scoring cross-network connections. Append `renderNetworkContext(network)` to the evaluator's network context string. Gated by `permissions.contextInjection.discovery` — if `false`, the evaluator receives only `title` + `prompt` (existing behavior).

## Migration Plan

1. Add `network_type` pgEnum
2. Add `type` column to `networks` (default `'community'`)
3. Add `metadata` JSONB column to `networks` (default `'{}'`)
4. Add `metadata` JSONB column to `network_members` (default `'{}'`)
5. Add `sync_config` JSONB column to `network_integrations` (default `'{}'`)

All additive. No data migration beyond the defaults. Existing networks become `type = 'community'` with empty metadata automatically.

## Out of Scope

- **Venue management** — physical venue CRUD, capacity, booking modes stay external (EdgeOS or future integration)
- **RSVP system** — formal event registration/cancellation is not part of this design
- **iCal export** — calendar export lives in Google Calendar; Index mirrors, not replaces
- **Auto-archive** — no lifecycle jobs; `endDate` is informational, archive is manual
- **Intent/opportunity schema changes** — the core discovery pipeline is unchanged
- **Webhook-driven sync** — periodic polling only; webhooks are a future optimization
- **Additional network types** — `project`, `cohort`, etc. can be added later by extending the enum and adding type-specific renderers
