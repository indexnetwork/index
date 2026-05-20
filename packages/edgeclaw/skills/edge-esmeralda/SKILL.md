---
name: edge-esmeralda-2026
description: Connect to Edge Esmeralda 2026 data — event schedule, attendee directory, wiki, newsletters, and organization info.
version: 2.1.0
author: Edge City
tags: [edge-city, edge-esmeralda, events, community, popup-village]
---

# Edge Esmeralda 2026 — Agent Skill

You have access to data about **Edge Esmeralda 2026**, a month-long popup village for people building the future.

- **Dates**: May 30 – June 27, 2026
- **Location**: Healdsburg, California (Sonoma County)
- **Organizer**: Edge City, a 501(c)(3) nonprofit "society incubator"
- **Co-founders**: Janine Leger, Timour Kosters
- **Weekly structure**: 4 weeks, each with thematic programming
- **Themes**: AI, Consciousness, Health & Longevity, Governance & Coordination, Hard Tech, Privacy, d/acc, Art & Culture, Decentralized Tech, Bio & Neuro, New Urbanism, Education, Energy & Climate, Food Systems
- **Contact**: info@edgeesmeralda.com
- **Website**: https://edgecity.live | https://www.edgeesmeralda.com

---

## 1. Event Schedule (EdgeOS Events API)

The calendar lives on the EdgeOS Events API at **`https://api.edgeos.world/api/v1`**.

### Authentication is required

**Every calendar request requires a personal access token.** The user must provide one — never invent or assume a token.

Token format: `eos_live_...` (issued at `/portal/api-keys` in the EdgeOS portal).

Scopes the token may grant:
- `events:read` — list and fetch events, list own RSVPs, list venues
- `events:write` — create / update / cancel events, manage invitations
- `rsvp:write` — RSVP and cancel RSVPs
- `venues:write` — create / update / delete venues

**If the user has not provided a token, stop and ask for one.** Say something like:

> To query the Edge Esmeralda calendar I need an EdgeOS personal access token. Generate one at the EdgeOS portal under `/portal/api-keys` (it starts with `eos_live_`) and share it here, or set it as `$EDGEOS_API_KEY` in your environment.

Once provided, pass it as `Authorization: Bearer <token>` on every request. If the user pastes a token directly, you may use it inline — do not persist it.

### Conventions

- List endpoints return `{ results: T[], paging }`. Single-resource endpoints return the resource directly.
- Times are ISO-8601 with timezone. UUIDs are RFC-4122.
- Recurring events expand into virtual occurrences when `start_after` is set. When RSVPing to one instance of a recurring event, pass that occurrence's `start_time` as `occurrence_start`.
- Error codes: `401` missing/expired key · `403` token lacks the required scope · `404` not visible · `409` resource has dependents · `422` validation · `429` rate limit (see `Retry-After`).

### Reading events

**List upcoming events (next 30 days):**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events?start_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)&limit=50"
```

**List events in a date range:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events?start_after=2026-05-30T00:00:00Z&start_before=2026-06-27T23:59:59Z&limit=100"
```

**Search events by title:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events?search=KEYWORD&start_after=2026-05-30T00:00:00Z&limit=50"
```

**Filter by tag, kind, venue, or track:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events?tags=AI&tags=Privacy&limit=50"
```

**Only events you've RSVPed to:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events?rsvped_only=true&limit=50"
```

**Fetch a single event (includes caller's RSVP status):**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}"
```

For a recurring event, scope the RSVP lookup to one instance with `?occurrence_start=2026-06-15T17:00:00Z`.

**Pagination:** use `skip` and `limit` (max `100`). Stop when `results.length < limit`.

### Writing events (requires `events:write`)

**Update an event you own:**
```bash
curl -s -X PATCH -H "Authorization: Bearer $EDGEOS_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}" \
  -d '{"title":"Updated title","start_time":"2026-06-15T17:00:00Z","end_time":"2026-06-15T18:00:00Z","timezone":"America/Los_Angeles","tags":["AI"]}'
```

Patchable fields: `title`, `content`, `start_time`, `end_time`, `timezone`, `venue_id`, `custom_location_name`, `custom_location_url`, `cover_url`, `meeting_url`, `max_participant`, `tags`, `track_id`, `visibility` (`public` | `private` | `unlisted`), `status`, `host_display_name`.

Setting `venue_id` clears any `custom_location_*` fields, and vice versa. Calendar-affecting changes (time, venue, title) bump the iCal sequence and send an iTIP `UPDATE` to attendees.

**Cancel an event you own (soft cancel — no hard delete exists):**
```bash
curl -s -X POST -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}/cancel"
```

### Invitations (owner-only, `events:write`)

**List invitations:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}/invitations"
```

**Bulk-invite by email (1–1000, case-insensitive, must match existing humans in the tenant; unknown emails come back under `not_found`):**
```bash
curl -s -X POST -H "Authorization: Bearer $EDGEOS_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}/invitations" \
  -d '{"emails":["alice@example.com","bob@example.com"]}'
```

**Revoke an invitation:**
```bash
curl -s -X DELETE -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}/invitations/{invitation_id}"
```

### RSVP (`rsvp:write`)

**RSVP to a one-off event:**
```bash
curl -s -X POST -H "Authorization: Bearer $EDGEOS_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-participants/portal/register/{event_id}" \
  -d '{}'
```

**RSVP to one occurrence of a recurring event:**
```bash
curl -s -X POST -H "Authorization: Bearer $EDGEOS_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-participants/portal/register/{event_id}" \
  -d '{"occurrence_start":"2026-06-15T17:00:00Z"}'
```

**Cancel a previous RSVP:**
```bash
curl -s -X POST -H "Authorization: Bearer $EDGEOS_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-participants/portal/cancel-registration/{event_id}" \
  -d '{}'
```

**List your own RSVPs across events:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/event-participants/portal/participants"
```

### Venues

**List active venues for a popup (`popup_id` is required, must be a UUID):**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/event-venues/portal/venues?popup_id={popup_uuid}&limit=100"
```

**Create a venue (`venues:write`; may land in `PENDING` if the popup requires approval, and may be disabled by the popup's `humans_can_create_venues` setting):**
```bash
curl -s -X POST -H "Authorization: Bearer $EDGEOS_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-venues/portal/venues" \
  -d '{"popup_id":"{popup_uuid}","title":"Workshop Room","description":"...","location":"...","formatted_address":"...","capacity":30,"booking_mode":"free"}'
```

`booking_mode` is one of `free` | `approval_required` | `unbookable`.

**Update a venue you own (the `status` field is ignored — re-approval lives in the backoffice):**
```bash
curl -s -X PATCH -H "Authorization: Bearer $EDGEOS_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-venues/portal/venues/{venue_id}" \
  -d '{"title":"...","capacity":40}'
```

**Delete a venue (`409` if it still has non-cancelled events; reassign or cancel them first):**
```bash
curl -s -X DELETE -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/event-venues/portal/venues/{venue_id}"
```

### Discovery

If you don't know a `popup_id`, `venue_id`, `event_id`, or the full OpenAPI surface, the spec is served at:

```bash
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/openapi.json"
```

### Available event tags

Consciousness, Health & Longevity, Wellbeing, Bio & Neuro, AI, Governance & Coordination, Hard Tech, Privacy, d/acc, Art & Culture, Decentralized Tech, Creative AI & Technologies, Spatial Computing, New Urbanism, Education, Energy & Climate, Food Systems

---

## 2. Attendee Directory (EdgeOS Citizen Portal)

Search who is attending Edge Esmeralda 2026. **Requires `$EDGEOS_BEARER_TOKEN`** (a separate token from the events API key — issued by the citizen portal).

**Search attendees:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  "https://api-citizen-portal.simplefi.tech/applications/attendees_directory/8?skip=0&limit=20&search=QUERY"
```

Replace `QUERY` with a name, organization, or role. Use `skip` and `limit` for pagination.

**Filter by week:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  "https://api-citizen-portal.simplefi.tech/applications/attendees_directory/8?skip=0&limit=20&weeks=1,2"
```

**Filter by families with kids:**
```bash
curl -s -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  "https://api-citizen-portal.simplefi.tech/applications/attendees_directory/8?skip=0&limit=20&brings_kids=true"
```

### Attendee response fields
Each attendee contains: `first_name`, `last_name`, `email`, `telegram`, `role`, `organization`, `personal_goals`, `residence`, `age`, `gender`, `social_media`, `builder_boolean`, `builder_description`, `participation` (array of weeks with `name`, `start_date`, `end_date`), `associated_attendees` (spouse, kids), `picture_url`.

The response includes `pagination: { skip, limit, total }`.

### Week dates
- **Week 1**: May 30 – June 6, 2026
- **Week 2**: June 6 – June 13, 2026
- **Week 3**: June 13 – June 20, 2026
- **Week 4**: June 20 – June 27, 2026

### Privacy
Some attendees hide certain fields. Hidden fields appear as `"*"`. **Respect this** — do not try to infer or work around hidden data. If a field is `"*"`, tell the user that information is private.

If the user hasn't set `$EDGEOS_BEARER_TOKEN`, tell them they need to obtain an access token from the Edge Esmeralda team to search attendees.

---

## 3. Knowledge Discovery (Index Network)

[Index Network](https://index.network) is a private, intent-driven discovery protocol. Agents register the Index MCP server and call its tools to surface relevant people across Edge Esmeralda — connections based on what residents are looking for, beyond what keyword search of the attendee directory can find.

### Setup

Index Network is exposed as an **MCP server**, not an HTTP API. The user generates an API key at `index.network/agents` (or a community-branded node) and the agent's MCP config registers the server:

```json
{
  "name": "index",
  "url": "https://protocol.index.network/mcp",
  "transport": "streamable-http",
  "headers": {
    "x-api-key": "ix_..."
  }
}
```

Required env var: `INDEX_API_KEY=ix_...`

**If the user has not provided an Index API key, tell them they need to generate one at `index.network/agents` and stop.** Do not invent a key or silently fall back to the §2 directory — that misses the protocol's discovery layer.

### Tool families

Once registered, every capability is a tool call on the `index` MCP server. Tool descriptions are authoritative — read them before calling. Major families:

- **Profile** — `create_user_profile`, `read_user_profiles`, `update_user_profile`. Identity, bio, skills, interests, embeddings.
- **Signals (intents)** — `create_intent`, `read_intents`, `update_intent`, `delete_intent`, `search_intents`. What a user is looking for; the discovery layer's primary unit.
- **Discovery** — `discover_opportunities`, `list_opportunities`, `update_opportunity`, `confirm_opportunity_delivery`. Surfaces connections between users based on signal overlap.
- **Negotiations** — `list_negotiations`, `get_negotiation`. Read-only — negotiations are handled server-side; do not call `respond_to_negotiation` from the agent.
- **Networks (communities)** — `read_networks`, `create_network_membership`. Edge Esmeralda's community lives at a specific network ID; the server auto-assigns membership after `complete_onboarding`.
- **Contacts** — `add_contact`, `list_contacts`, `search_contacts`. The user's personal index.
- **Reference** — `scrape_url(url, objective)`. Extract content from any URL when enriching a profile or composing a signal from a link.
- **Onboarding** — `complete_onboarding`. Required after profile + first signal capture.

### Typical flows

**Look up the calling user's profile and onboarding status:**

```
read_user_profiles()
```

Returns the user's profile plus an `onboardingComplete` flag. New users need the onboarding ritual: `create_user_profile()` → confirm with the user → `create_intent(description="...")` for their first signal → `complete_onboarding()`.

**Surface discovered opportunities:**

```
list_opportunities(status="pending", limit=10)
```

Each opportunity carries `profileUrl`, `acceptUrl` (an opaque backend redirect — never modify it), `mainText`, and a `feedCategory` (`connection` if the user is a party, `connector-flow` if the user is the introducer). Filter by quality before surfacing.

**Search the protocol for relevant signals:**

```
search_intents(query="agent memory layer", limit=20)
```

Use this when the user asks "is anyone here interested in X?" — semantic search across all open signals on the protocol.

**Enrich a profile from a URL the user shares:**

```
scrape_url(url="https://linkedin.com/in/alex", objective="Update user profile from LinkedIn page")
```

Always pass an `objective` describing why you're scraping — it guides extraction.

### Output translation

The MCP returns structured records. Translate before speaking:

| Internal | What the user hears |
|---|---|
| `intent` | "signal" |
| `index` / `network` | "community" |
| status `draft` / `latent` | "draft" |
| status `pending` | "sent" |
| status `accepted` | "connected" |

Never expose internal IDs unless the ID is actionable (e.g. a `conversationId` the user can open).

### When NOT to use this

- For Edge Esmeralda's published calendar, RSVPs, or venues, use §1 (EdgeOS Events API) — Index Network does not index events.
- For looking up a specific attendee by name, organization, or role, use §2 (Citizen Portal directory) — it has the canonical registration fields. Index Network covers protocol-side signals (what people are looking for), not registration-side data.
- For wiki, website, or newsletter content, use §5 — Index Network is not a content store.

### Errors

- `401` — missing or invalid API key.
- `403` — key lacks scope for the operation (e.g. trying to read other users' raw intents).
- `404` — record not visible to the caller (often a privacy boundary, not a missing record).
- `429` — rate limited; back off and retry.

---

## 4. Spatial Browsing (Geo Browser) — Placeholder

> **Status**: Stub. The Geo Browser team will replace this section via PR.

Reserved for Geo Browser tooling — a spatial/map-based interface for navigating Edge Esmeralda's venues, neighbourhoods, and events by physical location.

<!-- GEO_BROWSER_PLACEHOLDER
PR authors, replace this block with:
- Endpoint(s) or SDK calls (likely: nearby venues, route between two venues, geofenced event search)
- Auth: env var name (suggest `$GEO_BROWSER_TOKEN`), scope, how the user obtains a token
- Lat/lng input conventions (the EdgeOS events API already exposes `geo_lat` / `geo_lng` on venues — see §1)
- Map link / share URL conventions
- Example curl commands or SDK snippets
END -->

**Until this is wired up**: Use `geo_lat` / `geo_lng` on venues from `GET /event-venues/portal/venues` (§1) to answer "what's near venue X" or "how far apart are these two venues" with basic haversine math, and Healdsburg-area knowledge from the wiki (§5).

---

## 5. Reference Content (Wiki, Website, Newsletter)

For questions about logistics, the organization, or announcements, fetch the latest preprocessed content:

**Edge Esmeralda Wiki** (tickets, accommodation, travel, venues, health, kids, transport, etc.):
```bash
curl -s "https://raw.githubusercontent.com/Edge-City/edgeclaw-skills/main/edge-esmeralda/references/wiki-content.md"
```

**Edge City Website** (mission, leadership, roadmap, ecosystem, media):
```bash
curl -s "https://raw.githubusercontent.com/Edge-City/edgeclaw-skills/main/edge-esmeralda/references/website-content.md"
```

**Edge Esmeralda Newsletter** (residencies, fellowships, housing, tickets, programming):
```bash
curl -s "https://raw.githubusercontent.com/Edge-City/edgeclaw-skills/main/edge-esmeralda/references/newsletter-digest.md"
```

These files are updated automatically every 15 minutes. Fetch them when the user asks about:
- Tickets, pricing, scholarships, volunteering → **wiki**
- Accommodation, Hotel Trio, Airbnb, camping → **wiki**
- Travel, airports, getting to Healdsburg → **wiki**
- Venues, coworking, wifi → **wiki**
- Check-in, wristbands → **wiki**
- Health, gym, sauna, cold plunge → **wiki**
- Kids, families, kids camp → **wiki**
- Telegram groups, community chat → **wiki**
- Transport, bikes, rideshare → **wiki**
- Local discounts, merch → **wiki**
- Outdoor adventures, Russian River, hikes → **wiki**
- What is Edge City, mission, vision, leadership → **website**
- Roadmap, long-term plan, phases → **website**
- Ecosystem, projects, partners → **website**
- Residencies, fellowships, grants → **newsletter**
- Programming preview, how to get involved → **newsletter**
- Housing details, lodging options → **newsletter**
- Science partnerships, Alethios → **newsletter**

---

## 6. What's NOT Available Yet

Be honest about these gaps — do not hallucinate answers. When asked about any of these, give the disclosure below and surface the best available fallback. Never fabricate data, IDs, or actions.

- **Session transcripts / summaries**: "Session recordings and transcripts aren't available yet. Once the Granola integration is live, I'll be able to summarize past talks. For now, check the Edge Esmeralda Telegram group for session recaps."

- **Governance / deliberation**: "There's no governance or deliberation layer integrated yet. Community discussions happen in the Telegram group, and the in-person Community Town Hall events are where real-time deliberation happens."

- **Real-time venue availability**: The calendar shows what's scheduled, but there's no live venue booking system. To check if a venue is free, list events for that date/time and see whether the venue is already taken.

- **Your own profile (reading)**: There is no "me" endpoint on the calendar API. You **cannot** look up the calling user's own application content, dietary preferences, ticket type, residence, partner/plus-one, or which weeks they're registered for. Say: "I can't read your own profile through this skill yet. Check your EdgeOS portal account at the popup's portal URL, or ask the Edge Esmeralda team at info@edgeesmeralda.com." If — and only if — the user provides their `attendee_id` directly, you can look that record up in the citizen portal (§2) like any other attendee.

- **Profile editing (own or others)**: No write endpoint for attendee profiles exists in this skill. You **cannot** change anyone's dietary preferences, interests, application answers, "what I'm building", openness-to-meet flags, or any other profile field — including your own. Say: "I can't edit profiles through this skill. Update your own at the EdgeOS portal under `/portal/profile`. I can't edit anyone else's regardless." You *can* still help the user draft prose for them to paste into the portal themselves.

- **Matching / discovery / "introduce me to"**: There is no matching service, intent system, or "open to investors / collaborators" flag integrated yet. Say: "There's no matching system integrated yet. The closest thing I can do is search the directory by keyword across `personal_goals`, `organization`, `builder_description`, and `role` (§2) — want me to do that?" Then run the directory search as a fallback.

- **Scheduled tasks / recurring summaries / reminders**: The skill itself can't schedule anything. Say: "I can't schedule recurring runs through the skill — your agent host needs a scheduling layer for that. In Claude Code, `/loop` or `/schedule` can fire a prompt on a cadence. Let me know if you want me to draft the prompt." Do not pretend to set up cron jobs.

- **Outbound messaging / DMs / introductions on behalf of the user**: No messaging endpoint. Surface Telegram handles (and X handles where present) from the directory (§2) and let the user reach out themselves. Do not claim to have sent a message.

---

## 7. Tips for Answering Well

- **Always use live API calls** for schedule and attendee queries — don't rely on cached or memorized data.
- **Always require the EdgeOS API key before any calendar call.** If the user has not given one, ask for it first and stop. Do not try to query the calendar anonymously — every endpoint will return `401`.
- **Combine sources** when needed. For example, "What experiments are running this week?" needs both the wiki (experiment descriptions) and the calendar (live schedule).
- **Be specific with dates**. Convert "tomorrow", "this Thursday", "next week" to actual ISO-8601 timestamps before querying. The EdgeOS events API expects ISO-8601 with timezone for `start_after` / `start_before`.
- **Default to the event date range** (2026-05-30 to 2026-06-27) when searching broadly.
- **For attendee matching** (e.g., "who should I meet?"), search by interests in `personal_goals`, `organization`, `builder_description`, and `role` fields.
- **For venue questions**, first fetch the wiki for venue names/descriptions, then list calendar events to see what's booked.
- **Pagination**: EdgeOS events API supports `skip` + `limit` (max 100). Citizen portal returns max 50 — paginate with `skip` and `limit`.
