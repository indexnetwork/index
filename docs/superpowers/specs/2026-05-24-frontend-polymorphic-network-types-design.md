# Frontend Polymorphic Network Types — Design Spec

**Goal:** Surface the polymorphic network types feature in the frontend — type selection on creation, event metadata editing in settings, Google Calendar integration toggle with sync status, and type badges in display.

**Architecture:** Extend existing frontend services, types, and components. Decompose the 1120-line `NetworkSettingsPanel.tsx` into focused tab components. No new pages, routes, or services — all changes fit into the existing file structure.

**Tech stack:** React 19, Radix UI primitives, Tailwind CSS, Lucide icons, existing service factory pattern.

---

## 1. Service Layer

### 1.1 Type Updates (`backend/src/types/networks.types.ts`)

The `Network`, `CreateNetworkRequest`, and `UpdateNetworkRequest` interfaces need the new fields. These types are shared with the frontend via symlink at `frontend/src/types`.

**`Network` interface** — add:

```typescript
type?: 'community' | 'event';
metadata?: Record<string, unknown>;
```

Both optional with backend defaults (`'community'` and `{}`), so existing consumers are unaffected.

**`CreateNetworkRequest` interface** — add:

```typescript
type?: 'community' | 'event';
metadata?: {
  startDate?: string;
  endDate?: string;
  location?: string;
  timezone?: string;
  themes?: string[];
  description?: string;
};
```

**`UpdateNetworkRequest` interface** — add:

```typescript
metadata?: {
  startDate?: string;
  endDate?: string;
  location?: string;
  timezone?: string;
  themes?: string[];
  description?: string;
};
```

Type is intentionally absent from `UpdateNetworkRequest` — it is immutable after creation.

### 1.2 Integrations Service (`frontend/src/services/integrations.ts`)

**`ComposioConnection` interface** — add optional `syncConfig`:

```typescript
export interface ComposioConnection {
  id: string;
  toolkit: string;
  status: string;
  createdAt: string;
  syncConfig?: {
    status: 'active' | 'paused';
    intervalMs: number;
    lastSyncAt: string | null;
    calendarId: string;
  };
}
```

No new methods needed. The Google Calendar connection flow uses the existing `connect()` → `linkIntegration()` path. The backend activates the sync worker automatically when a `google_calendar` integration is linked to an event network. Disconnecting uses the existing `unlinkIntegration()` path.

### 1.3 Networks Service (`frontend/src/services/networks.ts`)

No changes. `createNetwork()` and `updateNetwork()` already pass through the request body — the new `type` and `metadata` fields flow through automatically once the types are updated.

---

## 2. Component Decomposition

### 2.1 NetworkSettingsPanel Split

`NetworkSettingsPanel.tsx` (1120 lines) is decomposed into:

```
frontend/src/components/
  NetworkSettingsPanel.tsx              → thin shell (~80 lines): tab routing, shared state
  settings/
    SettingsTab.tsx                     → title, description, image, event metadata, danger zone
    AccessTab.tsx                       → members list, search, add, CSV import, permissions
    IntegrationsTab.tsx                 → Gmail, Slack, Google Calendar toggles + sync status
```

**`NetworkSettingsPanel.tsx`** becomes a shell that:
- Holds the `activeTab` prop and routes to the correct tab component
- Passes shared props: `network`, `networkId`, service instances, `refetch` callback, `isExperiment`
- No business logic — pure delegation

**Each tab component** receives:
- `network: Network` — current network data
- `networkId: string`
- `networkService` and `integrationsService` instances
- `refetch: () => void` — to reload network data after mutations
- Any tab-specific props (e.g., `isExperiment` for AccessTab)

This is a pure extraction — no behavior changes to existing functionality. The three existing tabs map 1:1 to three new files.

---

## 3. Creation Modal

### 3.1 Type Selector (`CreateIndexModal.tsx`)

A type selector appears between Purpose and Access fields. Two rows, same visual pattern as the existing Access selector:

- **Community** (Users icon) — "Ongoing group — no time bounds". Pre-selected by default.
- **Event** (Calendar icon) — "Time-bounded gathering with dates and location"

Selection pattern: `border-black bg-gray-50` when selected, `border-gray-200` when not. Matches the existing Public/Private/Experiment selector exactly.

### 3.2 Event Details Section

When Event is selected, an Event Details section expands below the Access selector, separated by a `border-t border-gray-100` divider:

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| Start date | date input | Yes | — | ISO date string |
| End date | date input | Yes | — | Must be ≥ start date |
| Location | text input | No | — | Free text, e.g., "Healdsburg, CA" |
| Timezone | text input | No | Browser timezone | `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| Themes | text input | No | — | Comma-separated, parsed to `string[]` on submit |

**Validation:**
- Submit blocked if type is `event` and either date is empty
- End date must be ≥ start date (inline error)
- Community type requires no additional validation

**Submit payload:**
- Community: `{ title, prompt, imageUrl, joinPolicy, isExperiment }` (unchanged)
- Event: `{ title, prompt, imageUrl, joinPolicy, isExperiment, type: 'event', metadata: { startDate, endDate, location, timezone, themes } }`

### 3.3 New Local State

```typescript
const [type, setType] = useState<'community' | 'event'>('community');
const [startDate, setStartDate] = useState('');
const [endDate, setEndDate] = useState('');
const [location, setLocation] = useState('');
const [timezone, setTimezone] = useState(() =>
  Intl.DateTimeFormat().resolvedOptions().timeZone
);
const [themes, setThemes] = useState('');
```

---

## 4. Settings Tab — Event Metadata Editing

### 4.1 Type Badge

A read-only badge appears below the image field:

```
Type: [Calendar icon] Event
```

Uses the existing badge pattern: `bg-gray-100 text-gray-700 rounded-full text-xs font-medium`. Community networks show `[Users icon] Community` or omit the badge entirely (it's the default).

Type is not editable — it's set at creation.

### 4.2 Event Details Section

Conditional on `network.type === 'event'`. Appears below the type badge, separated by a `border-t border-gray-100` divider. Same fields as creation: dates (required), location, timezone, themes (optional).

**Edit behavior:** Uses the same dirty-state save/cancel pattern as title and description. On mount, event metadata fields are populated from `network.metadata`. The user edits fields, then clicks Save or Cancel.

**Save behavior:** Reads current `network.metadata`, merges the edited fields, and calls `updateNetwork({ metadata: mergedMetadata })`. This follows the PATCH merge semantics the backend already supports — unchanged fields are preserved.

**Community networks:** The Event Details section is not rendered. The settings tab looks identical to today's.

---

## 5. Integrations Tab — Google Calendar

### 5.1 Calendar Toggle

Google Calendar appears as a third integration row below Gmail and Slack, using the identical toggle pattern: icon, label, description, toggle switch.

- **Icon:** Calendar emoji or Lucide Calendar icon
- **Label:** "Google Calendar"
- **Description:** "Sync events into this network's schedule"
- **Visibility:** Only rendered when `network.type === 'event'`. Community networks see only Gmail and Slack.

**Connection flow:** Same OAuth popup flow as Gmail/Slack — `connect('google_calendar')` → popup → `linkIntegration('google_calendar', networkId)`. The backend automatically activates the sync worker on link. Disconnecting calls `unlinkIntegration('google_calendar', networkId)`.

### 5.2 Sync Status Panel

When Google Calendar is connected, a read-only status card appears below the integration toggles:

```
Calendar Sync Status
─────────────────────
Status          ● Active
Calendar        primary
Sync interval   Every 15 minutes
Last synced     2 minutes ago
Events synced   23
```

- Background: `bg-gray-50 border border-gray-200 rounded-sm`
- Status indicator: green dot (`bg-green-600`) for active, gray for paused
- "Last synced" shows relative time (e.g., "2 minutes ago", "Never")
- "Events synced" reads from `network.metadata.events.length`
- Sync config data comes from the connection's `syncConfig` field

No editing of sync configuration in the UI. Calendar ID defaults to "primary" and interval is backend-controlled.

---

## 6. Display Changes

### 6.1 Network Detail Page (`networks/[id]/page.tsx`)

A type badge appears next to the network title for event networks. Same badge style as the settings tab — small pill with icon. Community networks show no badge (it's the default, labeling it adds noise).

### 6.2 Network List Items

Wherever networks appear in lists or cards, event networks get a small type badge next to their name. Community networks show no badge.

---

## 7. Out of Scope

- **Schedule display** — synced events are for LLM context injection, not user-facing display yet
- **Member metadata editing** — `network_members.metadata` JSONB has no UI use case driving it
- **Network type filtering** — no filter by type in search or discovery
- **Sync config editing** — calendar ID and interval are API-only
- **Type mutation** — type is immutable after creation, no conversion UI
