---
name: edge-esmeralda-2026
description: Edge Esmeralda 2026 — a month-long popup village (May 30 – Jun 27, Healdsburg, CA). Carries popup constants (popup id, week dates, themes), attendee directory field semantics, and the curated wiki / website / newsletter knowledge base. Pair with the `edgeos` skill for live API access and the `index-network` skill for discovery.
version: 3.1.0
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
  Pass this as the `popup_id` parameter to `edgeos` skill calls that need it — `GET /events/portal/events?popup_id=...` (required for correct date filtering), `GET /applications/my/directory/{popup_id}`, `GET /event-venues/portal/venues?popup_id=...`, and `POST /event-venues/portal/venues` (body field).
- **`popup_slug`**: `edge-esmeralda-2026` (informational; not used by EdgeOS API calls).
- **`event_base_url`**: `https://edgecity.simplefi.tech/portal/edge-esmeralda-2026/events/`
  Use this as the prefix for event links by appending the `event_id` returned by the EdgeOS API.

### Week dates and themes

Standardized weeks for Edge Esmeralda 2026. Week 1 is extended back to May 30 to cover opening weekend; weeks 2-4 match the published programming preview.

| Week | Range | Published theme | Emphasis |
|---|---|---|---|
| 1 | May 30 – June 7, 2026 | Protocols for Flourishing | Health & Longevity, Consciousness, Wellbeing, Bio |
| 2 | June 8 – June 14, 2026 | Intelligence and Autonomy | AI, Neurotech, Governance & Coordination, Hard Tech, Privacy |
| 3 | June 15 – June 21, 2026 | Emergent Futures & World Building | Art & Culture, Decentralized Tech, Creative AI & Technologies, Spatial Computing |
| 4 | June 22 – June 27, 2026 | Environments of Tomorrow | New Urbanism, Education, Energy & Climate, Food Systems |

Themes are the published programming emphasis for each week, sourced from the Edge Esmeralda programming preview. They are directional: themes overlap and some programs span multiple weeks. A theme describes the week's focus, not a given day's schedule. For the actual events on any day, query the live `edgeos` calendar; do not infer "today's events" or "today's track" from this table, and do not present a theme as the day's schedule. Some EdgeOS tracks run across the whole month and do not map one-to-one to these theme weeks.

When the user says "week 2", convert to `start_after=2026-06-08T07:00:00Z&start_before=2026-06-15T07:00:00Z` (PDT midnight = 07:00 UTC; `start_before` is the start of the day *after* the last day). Week 1 is `start_after=2026-05-30T07:00:00Z&start_before=2026-06-08T07:00:00Z`.

---

## 2. Attendee directory field guide

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

## 3. Event tags (curated for Edge Esmeralda 2026)

When filtering events via the `edgeos` skill's `?tags=...` query, these are the supported values:

Consciousness, Health & Longevity, Wellbeing, Bio & Neuro, AI, Governance & Coordination, Hard Tech, Privacy, d/acc, Art & Culture, Decentralized Tech, Creative AI & Technologies, Spatial Computing, New Urbanism, Education, Energy & Climate, Food Systems.

Tags are case-sensitive and may be combined: `?tags=AI&tags=Privacy` returns events tagged with either.

---

## 4. Reference content (wiki, website, newsletter)

For questions about logistics, the organization, or announcements, use the preprocessed reference files shipped alongside this skill. When the Edge installer copies skills into the workspace, these files land under `skills/edge-esmeralda/references/`. If the `references/` directory is present, read the relevant file directly:

- **`references/wiki-content.md`** — Edge Esmeralda Wiki (tickets, accommodation, travel, venues, health, kids, transport, etc.)
- **`references/website-content.md`** — Edge City Website (mission, leadership, roadmap, ecosystem, media)
- **`references/newsletter-digest.md`** — Edge Esmeralda Newsletter (residencies, fellowships, housing, tickets, programming)

If the `references/` directory is missing (the upstream CI workflow that generates it has not run yet, or the files were not committed), tell the user the reference content is not available yet and point them at the primary sources: the Edge Esmeralda wiki at https://www.notion.so/317d45cdfc5981d2a571f52b024c5141, the newsletter at https://edgeesmeralda2026.substack.com, and https://edgecity.live.

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

## 5. Cross-skill orchestration

When a user asks about Edge Esmeralda, route the work like this:

- **Calendar / RSVP / venue / directory API call** → `edgeos` skill. Pass `popup_id` from §1.
- **Discovery, intent-based matching, "who should I meet?"** → `index-network` skill.
- **Community knowledge** (logistics, organization, announcements, "what is Edge City?") → this skill, §5.
- **Spatial / map / "what's near venue X"** → no Geo skill yet. Until one exists, use the `edgeos` venue endpoint's `geo_lat` / `geo_lng` fields with basic haversine math, plus the wiki (§5) for Healdsburg-area context.

---

## 6. Tips for answering well

- **Default date range** for broad calendar queries: 2026-05-30 to 2026-06-27.
- **Convert relative dates** ("today", "tomorrow", "this Thursday") to ISO-8601 timestamps in `America/Los_Angeles`. Use the local date and UTC offset from your system timestamp — never derive the date from UTC alone.
- **Combine sources** when needed. "What experiments are running this week?" pulls from both the wiki (experiment descriptions) and the `edgeos` calendar (live schedule).
- **For venue questions**, first fetch the wiki for venue names / descriptions, then call the `edgeos` venues endpoint with `popup_id` from §1.
- **For attendee matching**, prefer the `index-network` skill (semantic signal search). The `edgeos` directory is the registration-side fallback when you need a specific person by name / org / role.
