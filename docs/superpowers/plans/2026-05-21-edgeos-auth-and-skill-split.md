# EdgeOS Auth Migration and Skill Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `packages/edgeclaw/skills/edge-esmeralda/` into a backend-generic `edgeos/` skill (EdgeOS API surface, env-var consumer) and a narrowed `edge-esmeralda/` skill (popup constants, references, where-to-obtain-tokens pointer), with API recipes migrated to the new `api.edgeos.world/api/v1/...` surface.

**Architecture:** Two skill bundles in `packages/edgeclaw/skills/` following the per-backend pattern established by `skills/index-network/`. `skills/edgeos/` is a single-file `SKILL.md` (matching the existing `edge-esmeralda` shape; can be re-split into AgentSkills sibling files later if it grows). The installer stays an OpenClaw-specific helper writing tokens to `env.vars.*`; OTP itself is EdgeCity's deliverable and out of scope.

**Tech Stack:** OpenClaw AgentSkills (YAML frontmatter + markdown body), Bun for the installer, `curl` recipes for HTTP examples. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-21-edgeos-auth-and-skill-split-design.md`](../specs/2026-05-21-edgeos-auth-and-skill-split-design.md).

---

## Pre-existing state (do not redo)

The following changes are already on `dev` as of `c57e3eb4` and **must not be repeated**:

- `packages/edgeclaw/package.json` version bumped from `0.9.0` to `0.10.0`.
- `packages/edgeclaw/install/install.ts` docstring usage examples updated to `bun install/install.ts ...`.
- `packages/edgeclaw/install/install_edgeos.ts` docstring updated to reference `skills/edgeos/SKILL.md` (the file does not yet exist; this plan creates it).
- `packages/edgeclaw/install/args.ts` hardened against `--flag --other-flag` (refuses to consume another flag as a value).
- `packages/edgeclaw/README.md` line 31 already references `skills/edgeos/` instead of `skills/edge-esmeralda/`, but the prose on that line is now **inaccurate** — it still claims `edgeos/` contains "curated wiki/website/newsletter references" (those move to `edge-esmeralda/`). Task 5 fixes this.

## File structure

```
packages/edgeclaw/skills/
  edgeos/                          [Tasks 1, 2 — NEW]
    SKILL.md
    .env.example
  edge-esmeralda/
    SKILL.md                       [Task 3 — REWRITTEN]
    .env.example                   [Task 4 — DELETED]
    scripts/index.ts               (unchanged)
    references/*.md                (unchanged; upstream CI regenerates)
    bun.lock                       (unchanged)
    tsconfig.json                  (unchanged)
    CLAUDE.md                      (unchanged)
    README.md                      (unchanged)
  index-network/                   (unchanged)

packages/edgeclaw/
  README.md                        [Task 5 — small update]

docs/superpowers/specs/
  2026-05-21-edgeos-auth-and-skill-split-design.md  (committed, reference only)
```

## Background a new engineer needs

**The auth model:** EdgeOS exposes two tokens per attendee:

- `EDGEOS_BEARER_TOKEN` — short(er)-lived human session JWT, obtained via OTP. Scopes: `portal:self_read`, `portal:directory_read`, `portal:api_keys_manage`. Required for `/humans/me`, `/applications/my/directory/{popup_id}`, `/api-keys` (for minting), and `/openapi.json`.
- `EDGEOS_API_KEY` — long-lived `eos_live_...` automation key, minted via `POST /api/v1/api-keys`. Required for events / RSVPs / venues. Gated to event-automation routes; does **not** work on directory or `/humans/me`.

Both tokens are passed as `Authorization: Bearer <token>` (not `X-Third-Party-Api-Key` — that header is only used by the OTP flow itself, which is out of scope for EdgeClaw).

**Bearer TTL is unknown** — Tule has not confirmed. If short-lived, the operator-side onboarding flow will re-issue. The skill writes recipes that surface a clear "your bearer expired, re-run onboarding" path on 401, but does not implement refresh.

**Popup id (Edge Esmeralda 2026):** `43746fd0-bce2-472b-93e4-a438177b2dff`. This is a UUID; the prior `8` integer id was the legacy citizen-portal id and is no longer used.

**OpenClaw `requires.config` frontmatter** is a YAML list of keypath strings. The existing `skills/index-network/SKILL.md` uses `- mcp.servers.index`. The plan uses `- env.vars.EDGEOS_BEARER_TOKEN`. If this keypath form turns out not to gate on env-var presence in OpenClaw's actual schema, the skill will simply load ungated and the in-skill missing-token branch handles the rest — non-blocking.

**No tests for skill markdown.** These are content files. "Test" here means three things: (a) frontmatter is valid YAML; (b) the installer copies the files into `~/.openclaw/workspace/skills/` correctly; (c) the documented recipes actually work against live EdgeOS. Tasks 6 and 7 cover these.

---

## Task 1: Create `skills/edgeos/SKILL.md`

**Files:**
- Create: `packages/edgeclaw/skills/edgeos/SKILL.md`

This is one logical commit: a single new file containing the complete backend-generic EdgeOS skill.

- [ ] **Step 1: Create directory and write the file**

Run: `mkdir -p packages/edgeclaw/skills/edgeos`

Then create `packages/edgeclaw/skills/edgeos/SKILL.md` with exactly this content:

````markdown
---
name: edgeos
description: Talk to the EdgeOS popup-village platform — read the event schedule, manage RSVPs and venues, look up the calling user's own profile, and browse the attendee directory for a popup. Backend-generic; the popup id is supplied by whichever popup-specific skill is active (e.g. `edge-esmeralda` for Edge Esmeralda 2026).
version: 1.0.0
author: Edge City
tags: [edgeos, events, directory, popup-village]
metadata:
  openclaw:
    requires:
      config:
        - env.vars.EDGEOS_BEARER_TOKEN
---

# EdgeOS — Agent Skill

You have access to the **EdgeOS** popup-village platform at `https://api.edgeos.world/api/v1`. EdgeOS hosts events, RSVPs, venues, the attendee directory, and per-attendee profile lookup for one or more popups.

This skill is popup-agnostic. The `popup_id` (a UUID) is supplied by whichever popup-specific skill is currently active. For Edge Esmeralda 2026, see the sibling `edge-esmeralda` skill; it carries the constant.

## 1. Authentication

You need two tokens, both passed as `Authorization: Bearer <token>` (never as the `X-Third-Party-Api-Key` header — that header is only used by EdgeOS's own OTP flow, which this skill does not initiate):

- **`$EDGEOS_BEARER_TOKEN`** — human session JWT. Required for: `/humans/me`, `/applications/my/directory/{popup_id}`, `/api-keys`, `/openapi.json`. Scopes: `portal:self_read`, `portal:directory_read`, `portal:api_keys_manage`.
- **`$EDGEOS_API_KEY`** — long-lived `eos_live_...` automation key. Required for events, RSVPs, venues. Gated by EdgeOS to event-automation routes only.

If either env var is missing, **stop and ask the user to follow the operator skill's onboarding flow**. For Edge Esmeralda 2026, the `edge-esmeralda` skill carries the onboarding URL. Say something like:

> To talk to EdgeOS I need `$EDGEOS_BEARER_TOKEN` and `$EDGEOS_API_KEY` in your environment. The active operator skill (e.g. `edge-esmeralda`) explains how to obtain them. Once you have them, set them in your host's env config and try again.

Do not attempt to drive OTP from chat — that flow lives on the operator's onboarding page, not in this skill.

**On `401` with the bearer:** the bearer has likely expired. Tell the user to re-run the operator skill's onboarding flow to obtain a fresh one. Do not retry silently.

## 2. Conventions

- List endpoints return `{ results: T[], paging }`. Single-resource endpoints return the resource directly.
- Times are ISO-8601 with timezone. UUIDs are RFC-4122.
- Recurring events expand into virtual occurrences when `start_after` is set. When RSVPing to one instance of a recurring event, pass that occurrence's `start_time` as `occurrence_start`.
- Error codes: `401` missing/expired token · `403` token lacks the required scope · `404` not visible to caller · `409` resource has dependents · `422` validation · `429` rate limit (see `Retry-After`).

## 3. Reading events

All event-read recipes use `Authorization: Bearer $EDGEOS_API_KEY`.

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

## 4. Writing events (requires `events:write` scope on `$EDGEOS_API_KEY`)

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

## 5. Invitations (owner-only, `events:write`)

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

## 6. RSVP (`rsvp:write`)

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

## 7. Venues

**List active venues for a popup (`popup_id` is required, must be a UUID — the active popup skill supplies it):**
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

## 8. Your own profile (`portal:self_read`)

**Read the calling user's profile** (uses the human bearer, not the API key):
```bash
curl -s -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  "https://api.edgeos.world/api/v1/humans/me"
```

Returns the human record for the bearer's owner — your own application content, registered participation, profile fields, and platform handles. **There is no edit endpoint** — see §13.

## 9. Attendee directory (`portal:directory_read`)

**Search attendees in a popup** (uses the human bearer):
```bash
curl -s -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  "https://api.edgeos.world/api/v1/applications/my/directory/{popup_id}?skip=0&limit=20&search=QUERY"
```

`{popup_id}` is the popup UUID supplied by the active operator skill (e.g. `edge-esmeralda` carries Edge Esmeralda's constant). Replace `QUERY` with a name, organization, or role.

**Pagination:** `skip` + `limit` (default 20, check the OpenAPI spec via §11 for the per-popup max). Response shape: `{ results: Attendee[], pagination: { skip, limit, total } }`.

**Filters beyond `search`** depend on the popup's application form (e.g. participation weeks, families-with-kids). The set varies by popup. To discover supported filters for a given popup, fetch the OpenAPI spec (§11) and look up the directory endpoint's query parameters.

**Privacy:** the attendee response shape and which fields are hidden are popup-curated. Look up the field semantics in the active operator skill, not here. As a universal rule: a field whose value is the literal string `"*"` is intentionally hidden by the attendee — do not infer around it, surface the privacy boundary to the user.

## 10. API keys (`portal:api_keys_manage`)

**Mint a long-lived events-automation API key** (uses the human bearer):
```bash
curl -s -X POST -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/api-keys" \
  -d '{"name":"my-agent","scopes":["events:read","events:write","rsvp:write","venues:write"]}'
```

The minted key is an `eos_live_...` string. EdgeOS gates it to event-automation routes — it does **not** unlock `/humans/me` or the directory (those continue to require the human bearer).

This is typically done once during the operator's onboarding flow; the skill provides the recipe so the agent can re-mint if a key is lost or revoked.

## 11. Discovery

If you don't know an `event_id`, `venue_id`, or the full OpenAPI surface for a popup-specific filter, the spec is served at:

```bash
curl -s -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  "https://api.edgeos.world/api/v1/openapi.json"
```

## 12. Tips for answering well

- **Always use live API calls** for schedule and attendee queries — do not rely on cached or memorized data.
- **Always check `$EDGEOS_BEARER_TOKEN` and `$EDGEOS_API_KEY` are set before any request.** If either is missing, stop and follow the §1 fallback.
- **Be specific with dates.** Convert "tomorrow", "this Thursday", "next week" to actual ISO-8601 timestamps with timezone before querying.
- **Pagination:** events endpoints accept `skip` + `limit` (max 100); the directory uses the same pattern. Loop until `results.length < limit`.
- **Recurring events:** when RSVPing to one instance, pass `occurrence_start` matching the virtual occurrence's `start_time`.

## 13. What's NOT available

Be honest about these gaps — do not hallucinate answers.

- **Session transcripts / summaries.** EdgeOS does not record talks. Tell the user: "Session recordings and transcripts aren't available through EdgeOS — check the popup's Telegram group for recaps."
- **Governance / deliberation.** There is no governance layer on EdgeOS itself. Community discussion happens in the popup's external channels.
- **Real-time venue availability.** The calendar shows scheduled events, but there is no live venue booking system. To check if a venue is free, list events for that date/time and see whether the venue is already taken.
- **Profile editing (own or others).** EdgeOS exposes `GET /humans/me` (read-only). There is no `PATCH` for your own profile, dietary preferences, application answers, or "what I'm building" fields through this skill. Tell the user: "I can't edit profiles through this skill. Update yours at the EdgeOS portal under `/portal/profile`. I can't edit anyone else's regardless." You *can* still help the user draft prose for them to paste into the portal themselves.
- **Scheduled tasks / recurring summaries / reminders.** The skill itself cannot schedule anything. In OpenClaw, `openclaw cron` is the scheduler. In Claude Code, `/loop` or `/schedule`. Do not pretend to set up cron jobs from inside the skill.
- **Outbound messaging / DMs / introductions on behalf of the user.** EdgeOS has no messaging endpoint. Surface contact info (Telegram, X handles) from the directory (§9) and let the user reach out themselves. Do not claim to have sent a message.
````

- [ ] **Step 2: Verify the file's frontmatter parses as YAML**

Run:
```bash
bun -e "import { parse } from 'yaml'; const text = await Bun.file('packages/edgeclaw/skills/edgeos/SKILL.md').text(); const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1]; console.log(parse(fm))"
```

Expected: prints an object with `name: 'edgeos'`, `version: '1.0.0'`, `metadata.openclaw.requires.config` containing `'env.vars.EDGEOS_BEARER_TOKEN'`. No syntax errors.

- [ ] **Step 3: Verify file length is reasonable**

Run: `wc -l packages/edgeclaw/skills/edgeos/SKILL.md`

Expected: 250–350 lines. If it's under 100 or over 500, you've made a copy mistake.

- [ ] **Step 4: Commit**

```bash
git add packages/edgeclaw/skills/edgeos/SKILL.md
git commit -m "feat(edgeclaw): add backend-generic edgeos skill"
```

---

## Task 2: Create `skills/edgeos/.env.example`

**Files:**
- Create: `packages/edgeclaw/skills/edgeos/.env.example`

- [ ] **Step 1: Write the file**

Create `packages/edgeclaw/skills/edgeos/.env.example` with exactly this content:

```bash
# Required for events, RSVPs, venues, and minting additional API keys.
# Long-lived `eos_live_...` automation key, minted via the EdgeOS portal's
# onboarding flow after OTP. See the active operator skill (e.g.
# `edge-esmeralda`) for the onboarding URL.
EDGEOS_API_KEY=

# Required for directory lookups, your own profile, and the OpenAPI spec.
# Human session JWT obtained via OTP. Short(er)-lived than EDGEOS_API_KEY;
# re-run the operator skill's onboarding to refresh.
EDGEOS_BEARER_TOKEN=
```

- [ ] **Step 2: Commit**

```bash
git add packages/edgeclaw/skills/edgeos/.env.example
git commit -m "feat(edgeclaw): add env.example for edgeos skill"
```

---

## Task 3: Rewrite `skills/edge-esmeralda/SKILL.md` (popup-only)

**Files:**
- Modify (full rewrite): `packages/edgeclaw/skills/edge-esmeralda/SKILL.md`

The old file is ~440 lines covering EdgeOS APIs (§1, §2), Index Network (§3), Geo (§4 stub), Esmeralda references (§5), gaps (§6), and tips (§7). The rewrite keeps only popup-specific content; API recipes move to `skills/edgeos/SKILL.md`, the Index section is dropped (lives in `skills/index-network/`), and the Geo stub is dropped (will live in its own skill folder when built).

- [ ] **Step 1: Overwrite the file**

Replace the entire contents of `packages/edgeclaw/skills/edge-esmeralda/SKILL.md` with:

````markdown
---
name: edge-esmeralda-2026
description: Edge Esmeralda 2026 — a month-long popup village (May 30 – Jun 27, Healdsburg, CA). Carries popup constants (popup id, week dates, themes), attendee directory field semantics, the curated wiki / website / newsletter knowledge base, and the onboarding pointer for obtaining EdgeOS tokens. Pair with the `edgeos` skill for live API access and the `index-network` skill for discovery.
version: 3.0.0
author: Edge City
tags: [edge-city, edge-esmeralda, popup-village, community]
---

# Edge Esmeralda 2026 — Agent Skill

You have access to data about **Edge Esmeralda 2026**, a month-long popup village hosted on the EdgeOS platform.

- **Dates**: May 30 – June 27, 2026
- **Location**: Healdsburg, California (Sonoma County)
- **Organizer**: Edge City, a 501(c)(3) nonprofit "society incubator"
- **Co-founders**: Janine Leger, Timour Kosters
- **Weekly structure**: 4 weeks, each with thematic programming
- **Themes**: AI, Consciousness, Health & Longevity, Governance & Coordination, Hard Tech, Privacy, d/acc, Art & Culture, Decentralized Tech, Bio & Neuro, New Urbanism, Education, Energy & Climate, Food Systems
- **Contact**: info@edgeesmeralda.com
- **Website**: https://edgecity.live | https://www.edgeesmeralda.com

This skill is a **knowledge layer** about the popup itself. For live calendar, RSVP, venue, and directory API calls, use the sibling `edgeos` skill (it picks up the popup id from this skill's constants). For discovery and intent-based matching, use the `index-network` skill.

---

## 1. Popup constants (use these with the `edgeos` skill)

- **`popup_id`**: `43746fd0-bce2-472b-93e4-a438177b2dff`
  Pass this as the `popup_id` parameter to `edgeos` skill calls that need it — `GET /applications/my/directory/{popup_id}`, `GET /event-venues/portal/venues?popup_id=...`, and `POST /event-venues/portal/venues` (body field).
- **`popup_slug`**: `edge-esmeralda-2026` (informational; not used by EdgeOS API calls).

### Week dates

| Week | Range |
|---|---|
| 1 | May 30 – June 6, 2026 |
| 2 | June 6 – June 13, 2026 |
| 3 | June 13 – June 20, 2026 |
| 4 | June 20 – June 27, 2026 |

When the user says "week 2", convert to `start_after=2026-06-06T00:00:00Z&start_before=2026-06-13T23:59:59Z`.

---

## 2. How to obtain EdgeOS tokens

To use the `edgeos` skill you need `$EDGEOS_BEARER_TOKEN` and `$EDGEOS_API_KEY` set in your environment.

**Visit `<EDGECITY-ONBOARDING-URL>` and complete the email OTP flow.** The onboarding page will issue both tokens. Then set them in your agent's host:

- **OpenClaw**: re-run the EdgeClaw installer with the tokens as flags —
  `bun install/install.ts --index-api-key <ix_...> --edgeos-api-key <eos_live_...> --edgeos-bearer-token <jwt>`
  Or set each individually:
  `openclaw config set env.vars.EDGEOS_API_KEY <eos_live_...>` and `openclaw config set env.vars.EDGEOS_BEARER_TOKEN <jwt>`. Restart the gateway.
- **Claude Code / Cursor / other MCP hosts**: set them in your host's env-var or MCP server config per host conventions.

If either token is missing when the `edgeos` skill is invoked, the agent will stop and ask you to follow this flow.

> **TODO:** Replace `<EDGECITY-ONBOARDING-URL>` with the actual onboarding URL once EdgeCity publishes it. Update this section's prose and bump this skill's `version` patch number when done.

---

## 3. Attendee directory field guide

The `edgeos` skill exposes `GET /applications/my/directory/{popup_id}`. Pass the `popup_id` from §1. Each attendee record in `results[]` contains:

- `first_name`, `last_name`, `email`, `telegram`
- `role`, `organization`
- `personal_goals` — free-form prose
- `residence`, `age`, `gender`
- `social_media` — handles per platform
- `builder_boolean`, `builder_description` — self-identified "builder" flag and prose
- `participation` — array of `{ name, start_date, end_date }` for each week the attendee is registered for
- `associated_attendees` — spouse, kids, plus-ones
- `picture_url`

Response wrapper: `{ results: Attendee[], pagination: { skip, limit, total } }`.

### Privacy

Some attendees hide certain fields; hidden values appear as the literal string `"*"`. **Respect this** — do not try to infer or work around hidden data. If a field is `"*"`, tell the user that information is private.

### Useful query patterns (via the `edgeos` skill's directory recipe)

- Search by name / organization / role: `?search=QUERY`
- Pagination: `?skip=0&limit=20` (loop until `results.length < limit`)
- Filter by participation week, families with kids, etc.: parameter names vary; consult the OpenAPI spec via the `edgeos` skill's §11 if you need a filter beyond `search`.

---

## 4. Event tags (curated for Edge Esmeralda 2026)

When filtering events via the `edgeos` skill's `?tags=...` query, these are the supported values:

Consciousness, Health & Longevity, Wellbeing, Bio & Neuro, AI, Governance & Coordination, Hard Tech, Privacy, d/acc, Art & Culture, Decentralized Tech, Creative AI & Technologies, Spatial Computing, New Urbanism, Education, Energy & Climate, Food Systems.

Tags are case-sensitive and may be combined: `?tags=AI&tags=Privacy` returns events tagged with either.

---

## 5. Reference content (wiki, website, newsletter)

For questions about logistics, the organization, or announcements, fetch the latest preprocessed content. These files are updated automatically every 15 minutes by upstream CI.

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

### When to fetch which

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

## 6. Cross-skill orchestration

When a user asks about Edge Esmeralda, route the work like this:

- **Calendar / RSVP / venue / directory API call** → `edgeos` skill. Pass `popup_id` from §1.
- **Discovery, intent-based matching, "who should I meet?"** → `index-network` skill.
- **Community knowledge** (logistics, organization, announcements, "what is Edge City?") → this skill, §5.
- **Spatial / map / "what's near venue X"** → no Geo skill yet. Until one exists, use the `edgeos` venue endpoint's `geo_lat` / `geo_lng` fields with basic haversine math, plus the wiki (§5) for Healdsburg-area context.

---

## 7. Tips for answering well

- **Default date range** for broad calendar queries: 2026-05-30 to 2026-06-27.
- **Convert relative dates** ("tomorrow", "this Thursday") to ISO-8601 timestamps with the `America/Los_Angeles` timezone before passing them to the `edgeos` skill's event recipes.
- **Combine sources** when needed. "What experiments are running this week?" pulls from both the wiki (experiment descriptions) and the `edgeos` calendar (live schedule).
- **For venue questions**, first fetch the wiki for venue names / descriptions, then call the `edgeos` venues endpoint with `popup_id` from §1.
- **For attendee matching**, prefer the `index-network` skill (semantic signal search). The `edgeos` directory is the registration-side fallback when you need a specific person by name / org / role.
````

- [ ] **Step 2: Verify the file's frontmatter parses as YAML**

Run:
```bash
bun -e "import { parse } from 'yaml'; const text = await Bun.file('packages/edgeclaw/skills/edge-esmeralda/SKILL.md').text(); const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1]; console.log(parse(fm))"
```

Expected: prints an object with `name: 'edge-esmeralda-2026'`, `version: '3.0.0'`. No syntax errors.

- [ ] **Step 3: Verify file shrank**

Run: `wc -l packages/edgeclaw/skills/edge-esmeralda/SKILL.md`

Expected: 130–180 lines (down from ~440). If still above 250, you didn't delete the EdgeOS API recipes.

- [ ] **Step 4: Confirm no leftover Index Network or Geo references**

Run: `grep -E '(Index Network|index\.network|Geo Browser|index_intent|create_intent|protocol\.index)' packages/edgeclaw/skills/edge-esmeralda/SKILL.md`

Expected: only the single line in §6 that points readers at the `index-network` skill ("Discovery, intent-based matching → `index-network` skill"). If grep returns any other matches, you've kept content that belongs in `skills/index-network/`.

- [ ] **Step 5: Confirm no leftover EdgeOS API recipes**

Run: `grep -E '(api\.edgeos\.world|curl -s.*authorization: bearer)' packages/edgeclaw/skills/edge-esmeralda/SKILL.md`

Expected: no matches. All EdgeOS recipes should now live in `skills/edgeos/SKILL.md`. The references to the `edgeos` skill in prose are fine (and expected); raw `curl` recipes against `api.edgeos.world` are not.

- [ ] **Step 6: Commit**

```bash
git add packages/edgeclaw/skills/edge-esmeralda/SKILL.md
git commit -m "refactor(edgeclaw): narrow edge-esmeralda skill to popup-specific content"
```

---

## Task 4: Delete `skills/edge-esmeralda/.env.example`

**Files:**
- Delete: `packages/edgeclaw/skills/edge-esmeralda/.env.example`

The new `edge-esmeralda` skill is content-only; no env vars are scoped to it. The two EdgeOS tokens live in `skills/edgeos/.env.example` (created in Task 2), and `INDEX_API_KEY` lives in the root EdgeClaw setup.

- [ ] **Step 1: Delete the file**

```bash
git rm packages/edgeclaw/skills/edge-esmeralda/.env.example
```

- [ ] **Step 2: Confirm the deletion**

Run: `ls packages/edgeclaw/skills/edge-esmeralda/.env.example 2>&1`

Expected: `ls: ... No such file or directory`.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(edgeclaw): drop env.example from edge-esmeralda (no env vars scoped here)"
```

---

## Task 5: Update `packages/edgeclaw/README.md`

**Files:**
- Modify: `packages/edgeclaw/README.md`

Two changes:
1. Fix the inaccurate "What's here" bullet (line 31): the `skills/edgeos/` description currently still says "EdgeOS calendar + attendee directory + curated wiki/website/newsletter references (vendored from `Edge-City/edgeclaw-skills`; refreshed by upstream CI)". The wiki/newsletter references are no longer in `edgeos/` — they're in `edge-esmeralda/`. Update to reflect the split.
2. Update the "Getting an agent connected" section to mention that EdgeOS tokens are obtained via EdgeCity's onboarding flow, with the same `<EDGECITY-ONBOARDING-URL>` placeholder used in `skills/edge-esmeralda/SKILL.md` §2.

- [ ] **Step 1: Fix the "What's here" bullet for `skills/edgeos/`**

Find the bullet on line 31 (which currently reads `skills/edgeos/` followed by the old wiki description) and replace it with two bullets — one for `edgeos/`, one for the kept `edge-esmeralda/`:

Old:
```markdown
  - `skills/edgeos/` — EdgeOS calendar + attendee directory + curated wiki/website/newsletter references (vendored from `Edge-City/edgeclaw-skills`; refreshed by upstream CI)
```

New:
```markdown
  - `skills/edgeos/` — backend-generic EdgeOS API recipes (events, RSVPs, venues, attendee directory, own profile). Reads `EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY` from env; popup id is supplied by the active operator skill.
  - `skills/edge-esmeralda/` — Edge Esmeralda 2026 popup knowledge: popup constants (popup id, week dates, themes), attendee field semantics, the curated wiki/website/newsletter references (vendored from `Edge-City/edgeclaw-skills`; refreshed by upstream CI every 15 min), and the onboarding pointer for obtaining EdgeOS tokens.
```

Use Edit with `old_string` = the exact line above (including leading whitespace) and `new_string` = the two new bullets.

- [ ] **Step 2: Add EdgeOS token pointer in "Getting an agent connected"**

Find the "Getting an agent connected" section (starts at the `## Getting an agent connected` heading). After the "Two paths:" block, before the `## Integration API` heading, insert a new subsection.

Old (anchor — find this end-of-section text):
```markdown
**2. I'm self-hosting OpenClaw.** Set up a clean OpenClaw installation, then run the EdgeClaw installer from a clone of this repo.

## Integration API
```

New:
```markdown
**2. I'm self-hosting OpenClaw.** Set up a clean OpenClaw installation, then run the EdgeClaw installer from a clone of this repo.

### EdgeOS tokens

Both paths need EdgeOS tokens (`EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY`) before the `edgeos` skill can talk to the calendar, directory, or your own profile. Obtain them by completing the email-OTP flow at `<EDGECITY-ONBOARDING-URL>`, then pass them to the installer (`--edgeos-bearer-token`, `--edgeos-api-key`) or, for non-OpenClaw hosts, set them in your host's env config per its conventions. EdgeClaw does not run OTP itself.

> **TODO:** Replace `<EDGECITY-ONBOARDING-URL>` with the actual URL once EdgeCity publishes it. Bump `package.json` patch version when done.

## Integration API
```

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/README.md
git commit -m "docs(edgeclaw): split edgeos/edge-esmeralda in README and document token onboarding"
```

---

## Task 6: Verify installer end-to-end

The installer (`install/install.ts`) copies every `.md` file under `skills/` into `~/.openclaw/workspace/skills/` via `copyMarkdownTree`. Confirm the new layout is staged correctly.

- [ ] **Step 1: Dry-run check that both skill files are present in source**

Run:
```bash
ls packages/edgeclaw/skills/edgeos/SKILL.md packages/edgeclaw/skills/edge-esmeralda/SKILL.md packages/edgeclaw/skills/index-network/SKILL.md
```

Expected: all three paths print, no errors.

- [ ] **Step 2: Run the installer's skill-staging step in isolation**

If you have OpenClaw installed locally, do a full installer dry-run (note: this writes to `~/.openclaw/workspace/`):

```bash
cd packages/edgeclaw
bun install/install.ts --index-api-key fake-key-for-staging-test
```

Expected: log includes `→ staged N skill files into ~/.openclaw/workspace/skills` where `N >= 3` (the three SKILL.md files plus any sibling `.md` files in `skills/index-network/`).

If you do **not** have OpenClaw locally, skip the full installer and just run the `copyMarkdownTree` portion mentally / via a Bun one-liner:

```bash
bun -e "
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk('packages/edgeclaw/skills');
console.log('would copy', files.length, 'files');
for (const f of files) console.log(' ', f);
"
```

Expected output includes:
- `packages/edgeclaw/skills/edgeos/SKILL.md`
- `packages/edgeclaw/skills/edge-esmeralda/SKILL.md`
- `packages/edgeclaw/skills/index-network/SKILL.md`
- Sibling Index Network files (`bootstrap.md`, `exemplars.md`, `heartbeat.md`, `tools.md`, `prompts/*.md`).

If `edgeos/SKILL.md` or `edge-esmeralda/SKILL.md` is missing from this list, the previous tasks did not commit the file correctly.

- [ ] **Step 3: Confirm the `install_edgeos.ts` docstring agrees with the new file**

Run: `grep -n 'skills/edgeos/SKILL.md' packages/edgeclaw/install/install_edgeos.ts`

Expected: matches line ~5 (the docstring update that already landed in `c57e3eb4`).

If no match, the docstring drift mentioned in the pre-existing-state section has reverted; restore it. Otherwise, no action needed.

- [ ] **Step 4: No commit for this task** (verification only). If the installer staged correctly and no fixes were needed, move on.

---

## Task 7: Smoke-test recipes against live EdgeOS API

This is a manual verification step requiring real EdgeOS credentials. Skip if you do not have access to a test tenant key + email; flag in the final summary that the smoke-test was not run.

- [ ] **Step 1: Obtain tokens via OTP** (outside the skill, manually)

Tule provided test credentials (see the conversation thread). Walk OTP outside the skill:

```bash
TENANT_KEY='<provided-by-tule>'  # nFrMSSPjeWLFOlBxZ2HJbqVSjuURq2JGRKpCYVDaDzs
EMAIL='your-test-email@example.com'

# Request OTP
curl -s -X POST -H "X-Third-Party-Api-Key: $TENANT_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/auth/human/third-party/login" \
  -d "{\"email\":\"$EMAIL\"}"

# Check email, get the 6-digit code, then:
CODE='123456'
TOKENS=$(curl -s -X POST -H "X-Third-Party-Api-Key: $TENANT_KEY" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/auth/human/third-party/authenticate" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}")
echo "$TOKENS"

export EDGEOS_BEARER_TOKEN=$(echo "$TOKENS" | jq -r .access_token)

# Mint an events API key
KEY_RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.edgeos.world/api/v1/api-keys" \
  -d '{"name":"edgeclaw-smoke-test","scopes":["events:read"]}')
echo "$KEY_RESPONSE"

export EDGEOS_API_KEY=$(echo "$KEY_RESPONSE" | jq -r .api_key)
```

Expected: both `EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY` are populated; neither is `null`.

- [ ] **Step 2: Test the three recipes the skill claims work**

Run each curl exactly as the new `skills/edgeos/SKILL.md` documents it:

```bash
# My profile (uses bearer)
curl -s -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  "https://api.edgeos.world/api/v1/humans/me" | jq '.email, .first_name'

# Directory for Edge Esmeralda 2026 (uses bearer + popup id from edge-esmeralda skill §1)
curl -s -H "Authorization: Bearer $EDGEOS_BEARER_TOKEN" \
  "https://api.edgeos.world/api/v1/applications/my/directory/43746fd0-bce2-472b-93e4-a438177b2dff?skip=0&limit=5" | jq '.pagination, (.results | length)'

# Upcoming events (uses API key)
curl -s -H "Authorization: Bearer $EDGEOS_API_KEY" \
  "https://api.edgeos.world/api/v1/events/portal/events?start_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)&limit=5" | jq '.paging, (.results | length)'
```

Expected: each call returns a 200 with sensible JSON. `/humans/me` returns your email. The directory returns `pagination.total > 0` (Esmeralda has ~236 attendees per Tule). Events returns a `results` array (may be empty if no upcoming events are scheduled in the test window — substitute a known-event date range if needed).

- [ ] **Step 3: Verify the failure mode for a missing bearer**

```bash
unset EDGEOS_BEARER_TOKEN
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer " \
  "https://api.edgeos.world/api/v1/humans/me"
```

Expected: `401`. The skill's §1 fallback prose triggers here in an agent context.

- [ ] **Step 4: Document the smoke-test result**

If all three recipes worked: leave a one-line note in the PR description ("smoke-tested against live EdgeOS with Tule's test tenant key on YYYY-MM-DD"). If any recipe failed, file an issue (or message Tule) before merging — the skill is wrong if its documented recipes don't return what they claim.

---

## Self-review (run after writing all task content above)

Now look at the plan against the spec:

1. **Spec coverage** — every spec section has a task:
   - File layout → Task 1 (`edgeos/SKILL.md`), Task 2 (`edgeos/.env.example`), Task 3 (`edge-esmeralda/SKILL.md`), Task 4 (`edge-esmeralda/.env.example` delete), Task 5 (README).
   - `edgeos/SKILL.md` sections (Overview / Auth / Conventions / Reading events / Writing events / Invitations / RSVP / Venues / My profile / Directory / API keys / Discovery / What's NOT available) → all present in Task 1's file content.
   - `edge-esmeralda/SKILL.md` sections (About / Popup constants / How to obtain tokens / Directory field guide / Privacy / Event tags / Reference content / Cross-skill orchestration / Tips) → all present in Task 3's file content.
   - Installer docstring updates → already done in `c57e3eb4`; Task 6 step 3 verifies non-reversion.
   - README updates → Task 5.
   - Verification (smoke-test, installer roundtrip, reference regeneration) → Task 6, Task 7. **Reference regeneration**: covered implicitly — `scripts/index.ts` was not touched by any task, so `bun run scripts/index.ts` (mentioned in spec verification #2) still works unchanged. Not promoted to its own task because the spec's claim is "unchanged" — there is nothing to *do*, only nothing to break.
   - Package version bump → already done in `c57e3eb4`.

2. **Placeholder scan** — the plan contains two intentional `<EDGECITY-ONBOARDING-URL>` placeholders in the file contents written by Task 3 and Task 5. Both are accompanied by an inline `> **TODO:**` note explaining why and what to do later. These are **content-layer placeholders that will exist in the shipped files**, not plan-step placeholders — they're documented and intentional, and removing them requires information EdgeCity has not yet published. The plan itself contains no "TBD" or "implement later" in task steps.

3. **Type/path consistency** — file paths used in `edgeos/SKILL.md` (e.g. `popup_id` parameter) match how `edge-esmeralda/SKILL.md` describes them (§1 popup constants). The `popup_id` UUID `43746fd0-bce2-472b-93e4-a438177b2dff` is consistent across the plan, the spec, and both new SKILL.md files. The version bump to `0.10.0` is consistent with the spec.

---

## When this plan is done

- `git log` shows ~5 small commits on a feature branch.
- `packages/edgeclaw/skills/edgeos/SKILL.md` is the canonical source for EdgeOS API recipes.
- `packages/edgeclaw/skills/edge-esmeralda/SKILL.md` is popup-only content; no `curl` recipes against `api.edgeos.world` live in this file.
- `packages/edgeclaw/skills/index-network/` is unchanged.
- `packages/edgeclaw/README.md` accurately describes both new skills.
- The smoke-test in Task 7 confirms the documented recipes work end-to-end against live EdgeOS (or, if Tule's credentials are unavailable, this is flagged in the PR description).
- Two `<EDGECITY-ONBOARDING-URL>` placeholders remain in `edge-esmeralda/SKILL.md` and `README.md`, both flagged with `> **TODO:**` notes — these become a follow-up patch bump (`0.10.1`) once EdgeCity publishes the URL.

## Open questions tracked outside this plan

- **Bearer TTL.** Pending Tule's answer. Send him the draft message from the spec's "Open questions" section.
- **`directory:read` scope on minted API keys.** Optional EdgeOS-side feature. If added, the operator onboarding could omit the bearer hand-off entirely and the skill would become single-token.
- **`requires.config` schema for `env.vars.*` keypaths.** If OpenClaw's manifest schema doesn't gate on env-var presence the way it gates on `mcp.servers.*`, Task 1's frontmatter will simply have no effect (the skill loads ungated and the in-skill missing-token branch handles things). Non-blocking; verify when running the installer in Task 6.
