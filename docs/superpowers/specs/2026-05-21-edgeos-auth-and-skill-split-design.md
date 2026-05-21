# EdgeClaw — EdgeOS Auth Migration and Skill Split Design

**Date:** 2026-05-21
**Status:** Draft, awaiting review
**Owner:** Yankı

## Context

Tule's EdgeOS team has consolidated the EdgeOS API surface onto `api.edgeos.world/api/v1/...` and replaced the prior token-acquisition path with a two-step OTP flow:

1. `POST /api/v1/auth/human/third-party/login` (gated by a tenant-wide `X-Third-Party-Api-Key` header) emails the attendee a 6-digit code.
2. `POST /api/v1/auth/human/third-party/authenticate` exchanges email + code for an `access_token` with scopes `portal:self_read`, `portal:directory_read`, `portal:api_keys_manage`.

The resulting bearer can mint long-lived API keys via `POST /api/v1/api-keys`, but those minted keys are gated to event-automation routes only (the directory and `/humans/me` still require the human bearer).

This breaks two existing assumptions in `packages/edgeclaw/`:

- The current `skills/edge-esmeralda/SKILL.md` references the old citizen portal at `api-citizen-portal.simplefi.tech/applications/attendees_directory/8`, which is being decommissioned. The new directory lives at `GET /api/v1/applications/my/directory/{popup_id}` with popup id `43746fd0-bce2-472b-93e4-a438177b2dff` (UUID, not the legacy `8`).
- The `install_edgeos.ts` flow assumes attendees can pre-issue both tokens (`eos_live_...` for events, citizen-portal JWT for directory) before running the installer. Under the new flow, neither token exists until the attendee completes OTP.

Alongside the auth change, the skill bundle has also grown sections that don't belong in an EdgeOS-API skill. The current `skills/edge-esmeralda/SKILL.md` contains:

- §1 EdgeOS API recipes (events, RSVPs, venues) — **belongs in an EdgeOS-generic skill.**
- §2 Attendee directory — **belongs in the EdgeOS-generic skill.**
- §3 Index Network — already covered by `skills/index-network/SKILL.md` (added by the [2026-05-15 extraction](2026-05-15-edgeclaw-skills-extraction-design.md)); duplicating it here is redundant.
- §4 Geo Browser stub — will live in `skills/geo/SKILL.md` when that backend ships.
- §5 Wiki / website / newsletter references — **belongs in an Edge-Esmeralda-popup skill.**
- §6 / §7 — mixed; need to be partitioned.

We use this auth migration as the moment to split the skill into backend-generic and popup-specific layers, matching the per-backend pattern established by `packages/edgeclaw/skills/index-network/`.

### Boundaries (what this spec is *not*)

EdgeOS is owned by a separate team (Tule's). EdgeClaw is a **client-side consumer** of EdgeOS tokens — skills + installer + onboarding scripts. We do not:

- Hold the EdgeOS tenant key.
- Run OTP on attendees' behalf.
- Operate any attendee-facing token-issuance UI.

Where the operator-facing OTP page lives, what URL it sits at, and whether it is part of the EdgeOS portal, `edgecity.live`, the InstaClaw provisioner, or somewhere else entirely is **EdgeCity's decision and is out of scope for this monorepo.** This spec assumes such a page exists (or will exist by the time we ship) and surfaces tokens to attendees through whatever channel EdgeCity chooses; EdgeClaw consumes them via env vars from there.

## Decisions

1. **Skill split:** `packages/edgeclaw/skills/edge-esmeralda/` is divided into two bundles:
   - `skills/edgeos/` — backend-generic. Teaches the agent the EdgeOS API surface. Reads `$EDGEOS_BEARER_TOKEN` and `$EDGEOS_API_KEY` from env. Knows no popup-specific constants.
   - `skills/edge-esmeralda/` (kept, narrowed) — popup-specific knowledge layer. Owns popup constants (popup id, week dates, themes, attendee field guide), the curated event-tag list, the wiki/website/newsletter references, and the "where to obtain tokens" pointer for this popup.

2. **EdgeClaw remains a token consumer.** The installer and skill keep their existing env-var-based shape; no OTP code is added to either. The two installer flags (`--edgeos-bearer-token`, `--edgeos-api-key`) stay as-is.

3. **No invented persistence layer.** Tokens live in whatever env-var mechanism the agent host already exposes — OpenClaw `env.vars.*`, Claude Code MCP config, Cursor settings, etc. EdgeClaw does not introduce a sidecar JSON file or any other host-specific store.

4. **EdgeOS tenant key is operator-side.** It never appears in this monorepo. The Index Network master-key pattern (operator holds it, attendee never sees it) is the analogue for EdgeCity's side, but the actual implementation is theirs to design.

## File layout

```
packages/edgeclaw/skills/
  edgeos/                      [NEW — backend-generic]
    SKILL.md
    .env.example
  edge-esmeralda/              [KEPT — popup-specific, narrowed]
    SKILL.md                   (rewritten)
    scripts/index.ts           (unchanged)
    references/                (unchanged; auto-regenerated upstream every 15 min)
    .env.example               (deleted — no env vars are scoped to this skill)
  index-network/               (unchanged)
```

The upstream CI workflow in `Edge-City/edgeclaw-skills` continues to regenerate `edge-esmeralda/references/*.md` every 15 minutes. No CI change is required; only the SKILL.md alongside is rewritten.

## `skills/edgeos/SKILL.md` — backend-generic

### Frontmatter

```yaml
---
name: edgeos
description: Talk to the EdgeOS popup-village platform — read the event schedule, manage RSVPs and venues, look up the calling user's profile, and browse the attendee directory for a popup. Used by EdgeOS-hosted popups; popup id is supplied by the active popup skill.
version: 1.0.0
author: Edge City
tags: [edgeos, events, directory, popup-village]
metadata:
  openclaw:
    requires:
      config:
        - env.vars.EDGEOS_BEARER_TOKEN
---
```

The schema (YAML list of keypaths) matches the existing `skills/index-network/SKILL.md`. The `requires.config` block lets OpenClaw auto-gate the skill: if the bearer is not in `env.vars`, the skill is silently absent — no conditional logic to maintain. Non-OpenClaw hosts ignore this block and discover the skill via the usual SKILL.md mechanism.

We gate on `EDGEOS_BEARER_TOKEN` only (not also `EDGEOS_API_KEY`) because the bearer is the broader-scoped of the two tokens — every route the skill exposes can be reached with the bearer (`portal:self_read`, `portal:directory_read`, `portal:api_keys_manage` cover profile, directory, and minting). The `eos_live_...` API key is *additional* — it broadens what events-write recipes the agent can run without bumping into bearer expiry — but the skill is partially useful with bearer alone. Gating on both would exclude attendees who haven't minted an API key yet; gating on neither would let the skill load with no tokens at all. The asymmetry is intentional.

### Sections

1. **Overview.** One paragraph: "You can talk to EdgeOS's events, directory, and self-profile APIs at `https://api.edgeos.world/api/v1`. This skill is popup-agnostic; the active popup skill supplies the `popup_id`."

2. **Authentication.** Reads `$EDGEOS_BEARER_TOKEN` (human session, for `/humans/me`, directory, OpenAPI spec) and `$EDGEOS_API_KEY` (long-lived automation key, for events / RSVPs / venues). If either is missing, instructs the agent: "ask the user to follow the operator skill's onboarding flow to obtain these — for example, the `edge-esmeralda` skill links to its onboarding page. This skill does not initiate OTP itself." Lists scope expectations per route.

3. **Conventions.** List endpoints return `{ results, paging }`; single-resource endpoints return the resource directly. ISO-8601 with timezone for times, RFC-4122 UUIDs, recurring events expand into virtual occurrences when `start_after` is set, `occurrence_start` is required when RSVPing to one instance, error codes 401/403/404/409/422/429 with semantics.

4. **Reading events** (`Authorization: Bearer $EDGEOS_API_KEY`): list-by-date-range, list-by-tag, list-rsvped-only, fetch-single, recurring-occurrence lookup, pagination via `skip` + `limit`.

5. **Writing events** (`events:write` scope): PATCH event, cancel event, patchable fields list, calendar-update side effects (iCal sequence bump, iTIP UPDATE).

6. **Invitations** (owner-only, `events:write`): list, bulk-invite by email (1–1000), revoke.

7. **RSVP** (`rsvp:write`): one-off register, occurrence register, cancel, list own.

8. **Venues**: list-by-popup, create (`venues:write`, may land `PENDING`), update (status field ignored), delete (409 if non-cancelled events present).

9. **My profile** (`portal:self_read`): `GET /api/v1/humans/me`. (New — closes the "can't read your own profile" gap from the old §6.)

10. **Attendee directory** (`portal:directory_read`): `GET /api/v1/applications/my/directory/{popup_id}` with `Authorization: Bearer $EDGEOS_BEARER_TOKEN`. **`popup_id` is a UUID parameter the agent receives from the active popup skill — do not hardcode it here.** Supports `skip`, `limit`, `search`, and other documented filters. Returns the documented attendee shape; field-level semantics live in the popup skill (since some popups hide more fields than others).

11. **API keys** (`portal:api_keys_manage`): `POST /api/v1/api-keys` to mint a long-lived events-automation key. Brief note that bearers are short(er)-lived than minted keys; refresh flow is the operator's onboarding page, not the skill.

12. **Discovery**: `GET /api/v1/openapi.json` (with bearer) when an endpoint isn't documented here.

13. **What's NOT available.** EdgeOS-specific gaps only: session transcripts, governance / deliberation, real-time venue availability beyond the calendar, profile editing (own or others), scheduled tasks / recurring summaries, outbound messaging. The old "matching/discovery → use Index Network" bullet is dropped — that's not this skill's concern.

### `.env.example`

```bash
EDGEOS_API_KEY=
EDGEOS_BEARER_TOKEN=
```

No `INDEX_API_KEY` (lives in `skills/index-network/` already). No popup constants.

## `skills/edge-esmeralda/SKILL.md` — popup-specific

### Frontmatter

```yaml
---
name: edge-esmeralda-2026
description: Edge Esmeralda 2026 — a month-long popup village (May 30 – Jun 27, Healdsburg, CA). Provides popup constants (popup id, week dates, themes), attendee directory field semantics, the curated wiki / website / newsletter knowledge base, and the onboarding pointer for obtaining EdgeOS tokens. Pair with the `edgeos` skill for live API access and the `index-network` skill for discovery.
version: 3.0.0
author: Edge City
tags: [edge-city, edge-esmeralda, popup-village, community]
---
```

Version bumped to `3.0.0` to mark the split as a breaking change vs. today's `2.1.0`.

### Sections

1. **About Edge Esmeralda 2026.** Header prose currently at the top of the file: dates, location, organizer, co-founders, weekly structure, themes, contact, website.

2. **Popup constants.** Single source of truth for cross-skill references:
   - `popup_id = 43746fd0-bce2-472b-93e4-a438177b2dff`. Tells the agent: "when the `edgeos` skill needs a `popup_id`, use this."
   - `popup_slug = edge-esmeralda-2026` (informational).
   - Week-date table (Week 1 May 30 – Jun 6, etc.).

3. **How to obtain EdgeOS tokens.** Two-paragraph pointer: "Visit `<URL-TBD-pending-EdgeCity>` and complete the email OTP flow. The page will hand you two tokens — paste them into your agent's env per its host conventions:
   - OpenClaw: `openclaw config set env.vars.EDGEOS_BEARER_TOKEN <bearer>` and `openclaw config set env.vars.EDGEOS_API_KEY <key>` (or pass them as installer flags during EdgeClaw install).
   - Claude Code: configure them via MCP env vars in your config.
   - Cursor / other MCP hosts: per host docs."
   The URL is left as a placeholder until EdgeCity publishes the page.

4. **Attendee directory field guide.** The full field shape currently at lines ~135–145 of the old SKILL: `first_name`, `last_name`, `email`, `telegram`, `role`, `organization`, `personal_goals`, `residence`, `age`, `gender`, `social_media`, `builder_boolean`, `builder_description`, `participation`, `associated_attendees`, `picture_url`. Plus the pagination shape.

5. **Privacy convention.** Hidden fields appear as `"*"`; do not infer around them, surface the privacy boundary to the user.

6. **Event tags.** The 17-tag Esmeralda-curated list: Consciousness, Health & Longevity, Wellbeing, Bio & Neuro, AI, Governance & Coordination, Hard Tech, Privacy, d/acc, Art & Culture, Decentralized Tech, Creative AI & Technologies, Spatial Computing, New Urbanism, Education, Energy & Climate, Food Systems.

7. **Reference content** (the old §5). Three `curl` recipes against `raw.githubusercontent.com/Edge-City/edgeclaw-skills/main/edge-esmeralda/references/{wiki-content,website-content,newsletter-digest}.md`, with the same "fetch when the user asks about" topic mapping (tickets, accommodation, travel, venues, kids, etc.).

8. **Cross-skill orchestration.** "For live calendar / directory API calls → `edgeos` skill (it picks up `popup_id` from this skill's constants). For discovery and intent-based matching → `index-network` skill. For community knowledge (wiki / website / newsletter) → this skill."

9. **Tips for answering well.** Date-range default 2026-05-30 → 2026-06-27, ISO-8601 conversion of relative dates, combine sources, pagination max 100.

The skill **does not** describe API recipes — those live in `edgeos`. It is content-shaped, not API-shaped.

## `install/install_edgeos.ts` — minimal change

**No shape change.** Flags remain `--edgeos-api-key` and `--edgeos-bearer-token`, both optional, both write to `env.vars.EDGEOS_API_KEY` / `env.vars.EDGEOS_BEARER_TOKEN`. The installer is OpenClaw-specific; non-OpenClaw hosts inject env vars through their own mechanisms.

**Docstring updates only:**

- Drop the dead reference to `/portal/api-keys` in the EdgeOS portal.
- Add: "to obtain these, see the EdgeCity onboarding flow linked from `skills/edge-esmeralda/SKILL.md` (URL TBD pending EdgeCity publishing the page)."
- Add: "the bearer token is short(er)-lived than the minted API key; refresh by re-running the onboarding flow. Exact TTL TBD pending Tule's confirmation."

**No new flags.** OTP-driving flags (`--edgeos-email`, `--edgeos-otp`) were considered and rejected in design discussion — running OTP inside the installer would duplicate logic that lives on the EdgeCity onboarding page, and would not help BYO (non-OpenClaw) hosts that don't run this installer.

## `packages/edgeclaw/README.md` — small update

The **"Getting an agent connected"** section gets a paragraph pointing at the EdgeCity onboarding page for EdgeOS tokens, replacing any remaining reference to the dead `/portal/api-keys` path. The **Integration API** section (Index Network master key + `/api/networks/:id/signup`) is unrelated and does not change.

## Out of scope (Tule / EdgeCity deliverables)

These are dependencies, not deliverables in this monorepo:

- **Operator-facing OTP onboarding page.** Where attendees obtain `EDGEOS_BEARER_TOKEN` + `EDGEOS_API_KEY`. EdgeCity decides location, UI, and how it interoperates with the InstaClaw provisioner (e.g. whether the page can directly write `env.vars` for hosted agents).
- **`directory:read`-scope on minted API keys.** Optional EdgeOS-side feature. If added, agents could run off a single long-lived `eos_live_...` and would never need a bearer; the operator onboarding page could omit the human-bearer hand-off. Until then, two tokens are required.
- **Bearer refresh UX.** Whether the onboarding page supports session refresh (vs. always re-running full OTP) is EdgeCity's decision and shapes the practical UX for the event.

## Open questions

1. **Bearer TTL.** Tule has not confirmed how long bearers from `/authenticate` live. Esmeralda runs May 30 – Jun 27 (29 days). If TTL < event duration, attendees re-run onboarding mid-event. Decision: ship the design as written, ask Tule, adjust the `skills/edge-esmeralda/SKILL.md` "How to obtain tokens" section's framing once we know.

2. **`env.vars.<NAME>` predicate support.** `skills/index-network/SKILL.md` lists `mcp.servers.index` as a `requires.config` keypath — confirmed to work. Whether the same list-of-keypaths form also matches against `env.vars.<NAME>` keypaths (rather than just `mcp.servers.<NAME>`) is unconfirmed. Verify against OpenClaw skill-manifest docs during implementation; if `env.vars` keypaths don't match, fall back to running the skill ungated and relying on the in-skill missing-token error path.

3. **EdgeCity onboarding URL.** Placeholder in `skills/edge-esmeralda/SKILL.md` until EdgeCity publishes the page. The implementation plan should flag the spot to update and the package-version bump to ship with the URL substitution.

## Verification plan

1. **Smoke test against live EdgeOS.** With Tule's test tenant key and a real attendee email, manually walk OTP outside the skill, then:
   - Set `EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY` in a local OpenClaw install (or directly in a shell for testing).
   - Hit each of the new recipes:
     - `GET /api/v1/humans/me`
     - `GET /api/v1/applications/my/directory/43746fd0-bce2-472b-93e4-a438177b2dff?limit=5`
     - `GET /api/v1/events/portal/events?limit=5`
   - Confirm responses match what the skill's recipes claim.

2. **Reference regeneration.** `bun run scripts/index.ts` in `skills/edge-esmeralda/` should regenerate `references/*.md` unchanged. The narrowing only touched `SKILL.md`; the indexer is untouched.

3. **Cross-skill agent test.** With both `edgeos` and `edge-esmeralda` skills loaded, ask an OpenClaw agent: "who's coming to Edge Esmeralda from Berlin?" The agent should:
   - Recognize the popup context (from `edge-esmeralda`'s constants).
   - Call the directory endpoint in `edgeos` with `popup_id = 43746fd0-...`.
   - Filter results by `residence`.

4. **Missing-token path.** With `EDGEOS_BEARER_TOKEN` unset, the same query should produce a graceful "please complete the EdgeOS onboarding at `<URL-TBD>`" message, not a raw `401` from the API.

## Package version bump

`packages/edgeclaw/package.json` bumps from `0.9.0` to **`0.10.0`** (minor: new `edgeos` skill, breaking rearrangement of `edge-esmeralda` SKILL.md). The skill `edgeos/SKILL.md` ships at `1.0.0` (frontmatter version). `edge-esmeralda/SKILL.md` bumps from `2.1.0` to `3.0.0` (frontmatter version) to mark the split as breaking for downstream consumers that read it as a single bundle.

The previous extraction spec ([2026-05-15](2026-05-15-edgeclaw-skills-extraction-design.md)) established the per-backend skill bundle pattern; this spec applies it to EdgeOS and partitions the over-broad Esmeralda bundle.
