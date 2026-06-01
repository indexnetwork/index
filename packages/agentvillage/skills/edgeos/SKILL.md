---
name: edgeos
description: Talk to the EdgeOS popup-village platform — read the event schedule, manage RSVPs and venues, look up the calling user's own profile, and browse the attendee directory for a popup. Backend-generic; the popup id is supplied by whichever popup-specific skill is active (e.g. `edge-esmeralda` for Edge Esmeralda 2026).
version: 1.1.1
author: Edge City
tags: [edgeos, events, directory, popup-village]
required_environment_variables:
  - name: EDGEOS_BEARER_TOKEN
    required_for: directory, own profile
  - name: EDGEOS_API_KEY
    required_for: events, RSVPs, venues
metadata:
  openclaw:
    requires:
      config:
        - env.vars.EDGEOS_BEARER_TOKEN
        - env.vars.EDGEOS_API_KEY
---

# EdgeOS — Agent Skill

You have access to the **EdgeOS** popup-village platform at `https://api.edgeos.world/api/v1`. EdgeOS hosts events, RSVPs, venues, the attendee directory, and per-attendee profile lookup for one or more popups.

This skill is popup-agnostic. The `popup_id` (a UUID) is supplied by whichever popup-specific skill is currently active. For Edge Esmeralda 2026, see the sibling `edge-esmeralda` skill; it carries the constant.

## 0. Safety rules for write operations

**Always obtain explicit user confirmation before executing any mutating or destructive API call.**

This includes every `POST`, `PATCH`, `PUT`, and `DELETE` request — specifically:

| Operation | Endpoint pattern | Risk |
|---|---|---|
| Update event | `PATCH /events/portal/events/{id}` | Changes visible to all attendees; triggers calendar updates |
| Cancel event | `POST /events/portal/events/{id}/cancel` | **Irreversible** — no un-cancel endpoint |
| Bulk invite | `POST /events/.../invitations` | Sends invitations to up to 1 000 email addresses |
| Revoke invitation | `DELETE /events/.../invitations/{id}` | Removes invitee access |
| RSVP / cancel RSVP | `POST /event-participants/portal/register/{id}` | Modifies user's own participation record |
| Create venue | `POST /event-venues/portal/venues` | Creates a new venue, possibly triggering admin approval |
| Update venue | `PATCH /event-venues/portal/venues/{id}` | Changes venue details for all bookings |
| Delete venue | `DELETE /event-venues/portal/venues/{id}` | **Irreversible** if no events are attached |
| Update profile | `PATCH /humans/me` | Overwrites the user's own profile fields |

Before running any of the above, show the user the exact request body and URL you intend to send and wait for an explicit "yes / go ahead / confirm" reply. Do **not** auto-approve based on earlier conversational intent or a paraphrase of the user's request.

## 1. Authentication

You need two tokens, both passed as `Authorization: Bearer <token>`:

- **`$EDGEOS_BEARER_TOKEN`** — human session JWT. Required for: `/humans/me`, `/applications/my/directory/{popup_id}`. Scopes: `portal:self_read`, `portal:directory_read`.
- **`$EDGEOS_API_KEY`** — long-lived `eos_live_...` automation key. Required for events, RSVPs, venues.

In every curl example below, `<EDGEOS_API_KEY>` and `<EDGEOS_BEARER_TOKEN>` are placeholders — substitute the actual token values from your environment before running the command.

## 2. Conventions

- List endpoints return a `results: T[]` array plus a paging object whose key name varies by endpoint (`paging` for events, `pagination` for the directory). Single-resource endpoints return the resource directly. When in doubt, consult the response shape documented in the relevant section, or the OpenAPI spec via §11.
- Times are ISO-8601 with timezone. UUIDs are RFC-4122.
- Recurring events expand into virtual occurrences when `start_after` is set. When RSVPing to one instance of a recurring event, pass that occurrence's `start_time` as `occurrence_start`.
- Error codes: `401` missing/expired token · `403` token lacks the required scope · `404` not visible to caller · `409` resource has dependents · `422` validation · `429` rate limit (see `Retry-After`).

## 3. Reading events

All event-read recipes use `Authorization: Bearer <EDGEOS_API_KEY>`.

**REQUIRED parameters for all event list queries:** `popup_id={popup_id}` and `event_status=published`. Without `popup_id`, the API filters by `created_at` instead of `start_time`, returning wrong results. `{popup_id}` is the popup UUID from the active popup skill (e.g. `edge-esmeralda` §1).

**List upcoming events (next 30 days):**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events?popup_id={popup_id}&event_status=published&start_after={current_iso_timestamp}&limit=50"
```
`{current_iso_timestamp}` must be a literal ISO-8601 UTC string (e.g. `2026-05-26T21:00:00Z`) — compute it in code or via the agent's date tools, not via shell substitution.

**List events in a date range:**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events?popup_id={popup_id}&event_status=published&start_after={start_iso}&start_before={end_iso}&limit=100"
```

**Search events by title:**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events?popup_id={popup_id}&event_status=published&search=KEYWORD&start_after={start_iso}&limit=50"
```

**Filter by tag, kind, venue, or track:**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events?popup_id={popup_id}&event_status=published&tags=AI&tags=Privacy&limit=50"
```

**Only events you've RSVPed to:**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events?popup_id={popup_id}&event_status=published&rsvped_only=true&limit=50"
```

**Fetch a single event (includes caller's RSVP status):**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}"
```

For a recurring event, scope the RSVP lookup to one instance with `?occurrence_start={occurrence_iso}`.

**Pagination:** use `skip` and `limit` (max `100`). Stop when `results.length < limit`.

## 4. Writing events (requires `events:write` scope on `$EDGEOS_API_KEY`)

**Update an event you own:**
```bash
curl -s -X PATCH -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}" \
  -d '{"title":"Updated title","start_time":"{start_iso}","end_time":"{end_iso}","timezone":"{timezone}","tags":["AI"]}'
```

Patchable fields: `title`, `content`, `start_time`, `end_time`, `timezone`, `venue_id`, `custom_location_name`, `custom_location_url`, `cover_url`, `meeting_url`, `max_participant`, `tags`, `track_id`, `visibility` (`public` | `private` | `unlisted`), `status`, `host_display_name`.

Setting `venue_id` clears any `custom_location_*` fields, and vice versa. Calendar-affecting changes (time, venue, title) bump the iCal sequence and send an iTIP `UPDATE` to attendees.

**Cancel an event you own (soft cancel — no hard delete exists):**
```bash
curl -s -X POST -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}/cancel"
```

## 5. Invitations (owner-only, `events:write`)

**List invitations:**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}/invitations"
```

**Bulk-invite by email (1–1000, case-insensitive, must match existing humans in the tenant; unknown emails come back under `not_found`):**
```bash
curl -s -X POST -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}/invitations" \
  -d '{"emails":["alice@example.com","bob@example.com"]}'
```

**Revoke an invitation:**
```bash
curl -s -X DELETE -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/events/portal/events/{event_id}/invitations/{invitation_id}"
```

## 6. RSVP (`rsvp:write`)

**RSVP to a one-off event:**
```bash
curl -s -X POST -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-participants/portal/register/{event_id}" \
  -d '{}'
```

**RSVP to one occurrence of a recurring event:**
```bash
curl -s -X POST -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-participants/portal/register/{event_id}" \
  -d '{"occurrence_start":"{occurrence_iso}"}'
```

**Cancel a previous RSVP:**
```bash
curl -s -X POST -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-participants/portal/cancel-registration/{event_id}" \
  -d '{}'
```

**List your own RSVPs across events:**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/event-participants/portal/participants"
```

## 7. Venues

**List active venues for a popup (`popup_id` is required, must be a UUID — the active popup skill supplies it):**
```bash
curl -s -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/event-venues/portal/venues?popup_id={popup_id}&limit=100"
```

**Create a venue (`venues:write`; may land in `PENDING` if the popup requires approval, and may be disabled by the popup's `humans_can_create_venues` setting):**
```bash
curl -s -X POST -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-venues/portal/venues" \
  -d '{"popup_id":"{popup_id}","title":"Workshop Room","description":"...","location":"...","formatted_address":"...","capacity":30,"booking_mode":"free"}'
```

`booking_mode` is one of `free` | `approval_required` | `unbookable`.

**Update a venue you own (the `status` field is ignored — re-approval lives in the backoffice):**
```bash
curl -s -X PATCH -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/event-venues/portal/venues/{venue_id}" \
  -d '{"title":"...","capacity":40}'
```

**Delete a venue (`409` if it still has non-cancelled events; reassign or cancel them first):**
```bash
curl -s -X DELETE -H "Authorization: Bearer <EDGEOS_API_KEY>" \
  "https://api.edgeos.world/api/v1/event-venues/portal/venues/{venue_id}"
```

## 8. Your own profile (`portal:self_read`)

**Read the calling user's profile** (uses the human bearer, not the API key):
```bash
curl -s -H "Authorization: Bearer <EDGEOS_BEARER_TOKEN>" \
  "https://api.edgeos.world/api/v1/humans/me"
```

Returns the human record for the bearer's owner — your own application content, registered participation, profile fields, and platform handles.

**Update basic profile fields** (uses the human bearer):
```bash
curl -s -X PATCH -H "Authorization: Bearer <EDGEOS_BEARER_TOKEN>" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/humans/me" \
  -d '{"first_name":"...","last_name":"...","telegram":"@handle","residence":"...","picture_url":"https://..."}'
```

Patchable fields: `first_name`, `last_name`, `telegram`, `gender`, `age`, `residence`, `picture_url`. All are optional — include only what you want to change. Application-specific fields (dietary preferences, "what I'm building", application answers) are **not** patchable through this endpoint — those live on the popup application form and must be edited in the EdgeOS portal UI.

## 9. Attendee directory (`portal:directory_read`)

**Search attendees in a popup** (uses the human bearer):
```bash
curl -s -H "Authorization: Bearer <EDGEOS_BEARER_TOKEN>" \
  "https://api.edgeos.world/api/v1/applications/my/directory/{popup_id}?skip=0&limit=20&q=QUERY"
```

`{popup_id}` is the popup UUID supplied by the active operator skill (e.g. `edge-esmeralda` carries Edge Esmeralda's constant). Replace `QUERY` with a name, organization, or role.

**Pagination:** `skip` + `limit` (default 20, check the OpenAPI spec via §11 for the per-popup max). Response shape: `{ results: Attendee[], pagination: { skip, limit, total } }`.

**Filters beyond `search`** depend on the popup's application form (e.g. participation weeks, families-with-kids). The set varies by popup. To discover supported filters for a given popup, fetch the OpenAPI spec (§11) and look up the directory endpoint's query parameters.

**Privacy:** the attendee response shape and which fields are hidden are popup-curated. Look up the field semantics in the active operator skill, not here. As a universal rule: a field whose value is the literal string `"*"` is intentionally hidden by the attendee — do not infer around it, surface the privacy boundary to the user.

## 10. Tips for answering well

- **Always use live API calls** for schedule and attendee queries — do not rely on cached or memorized data.
- **Be specific with dates.** Convert "tomorrow", "this Thursday", "next week" to actual ISO-8601 timestamps with timezone before querying.
- **Pagination:** events endpoints accept `skip` + `limit` (max 100); the directory uses the same pattern. Loop until `results.length < limit`.
- **Recurring events:** when RSVPing to one instance, pass `occurrence_start` matching the virtual occurrence's `start_time`.

## 11. What's NOT available

Be honest about these gaps — do not hallucinate answers.

- **Session transcripts / summaries.** EdgeOS does not record talks. Tell the user: "Session recordings and transcripts aren't available through EdgeOS — check the popup's Telegram group for recaps."
- **Governance / deliberation.** There is no governance layer on EdgeOS itself. Community discussion happens in the popup's external channels.
- **Real-time venue availability.** The calendar shows scheduled events, but there is no live venue booking system. To check if a venue is free, list events for that date/time and see whether the venue is already taken.
- **Application-specific profile fields.** Basic profile fields (`first_name`, `last_name`, `telegram`, `gender`, `age`, `residence`, `picture_url`) are editable via `PATCH /api/v1/humans/me` (see §8). But dietary preferences, application answers, "what I'm building", and popup-specific form fields are **not** patchable through this API — those must be edited in the EdgeOS portal UI under `/portal/profile`. You cannot edit anyone else's profile regardless.
- **Scheduled tasks / recurring summaries / reminders.** The skill itself cannot schedule anything. Use the host agent's scheduling capabilities (`/loop`, `/schedule`, cron). Do not pretend to set up tasks from inside the skill.
- **Outbound messaging / DMs / introductions on behalf of the user.** EdgeOS has no messaging endpoint. Surface contact info (Telegram, X handles) from the directory (§9) and let the user reach out themselves. Do not claim to have sent a message.
