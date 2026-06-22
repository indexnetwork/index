---
title: "Seren's Telegram Message Formatting"
type: spec
tags: [openclaw-plugin, formatting, delivery, prompt, backend]
created: 2026-05-06
updated: 2026-05-06
---

# Seren's Telegram Message Formatting — Design Spec

**Linear issue:** IND-247
**Depends on:** IND-253 (introducer opportunities in pollers — merged), IND-248 (onboarding guard — merged), IND-249 (welcome message — merged)

## Problem

The main-agent prompts in `main-agent.prompt.ts` give the OpenClaw agent generic structural instructions ("render as numbered list", "frame warmly"). Seren's templates define a specific two-section layout that separates direct connections from connector (introducer) opportunities, with distinct CTAs for each. The current prompts don't distinguish between these two types, and there's no URL-based mechanism for introducers to approve introductions via Telegram.

## Solution

1. Restructure `perTypeInstruction` for welcome, daily digest, and ambient to use Seren's structural patterns — two-section layout with "Conversations waiting" + "Help your community," section-aware CTAs, and overflow counts.
2. Add `feedCategory` and `totalPending` to the plugin's prompt payload types, threading them from the pending endpoint through the pollers.
3. Add a new `GET /api/opportunities/:id/approve-introduction?token=...` backend endpoint so introducers can approve introductions via a link click in Telegram.
4. Add deployment-level branding config (`nodeName`, `nodeDescription`, `nodeContext`) to the plugin config, injected into all prompts so the agent can reference the community context.

## Design

### 1. Backend: Approve-Introduction Endpoint

New endpoint in `opportunity.controller.ts`:

**`GET /api/opportunities/:id/approve-introduction?token=...`**

- Verifies connect-token JWT (same `verifyConnectToken` pattern as the existing `/connect` endpoint)
- Validates the token's user is an introducer actor with `approved: false` on the opportunity
- Calls `updateOpportunityStatus(id, 'pending', userId)` — flips `approved: true`, triggers negotiation between the two parties
- Redirects to a success/confirmation page (same redirect pattern as `/connect`)
- Error cases: expired token, already approved, user not an introducer → appropriate error response

### 2. Plugin: Payload Changes

#### `OpportunityCandidate` — add `feedCategory`

```typescript
export interface OpportunityCandidate {
  opportunityId: string;
  counterpartUserId: string;
  feedCategory: 'connection' | 'connector-flow';
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
  profileUrl: string;
  acceptUrl: string; // acceptUrl for 'connection', approveUrl for 'connector-flow'
}
```

The `acceptUrl` field is reused for both types — for `connection` it points to `/connect?token=...`, for `connector-flow` it points to `/approve-introduction?token=...`. The prompt instructions tell the agent which CTA text to use based on `feedCategory`.

#### `MainAgentPayload` — add `totalPending`

Add `totalPending: number` to digest, ambient, and welcome payload variants. This is the total count of pending opportunities (before the limit is applied), sourced from the endpoint's `totalPending` response field.

### 3. Plugin: Poller Changes

All three pollers (ambient-discovery, daily-digest, welcome watcher) need the same update:

1. Read `feedCategory` from each opportunity in the API response
2. Pass it through to `OpportunityCandidate`
3. For `connector-flow` candidates, build the URL using `/approve-introduction?token=...` instead of `/connect?token=...`
4. Pass `totalPending` from the API response into the payload

The connect-token fetch (`fetchConnectToken`) stays the same — same token mechanism, different endpoint path in the URL.

### 4. Prompt: Per-Type Instructions

#### Welcome

```
This is a WELCOME message — the user just finished onboarding and created their first signal.

Present candidates in up to two sections based on their feedCategory field:

SECTION 1 — DIRECT CONNECTIONS (feedCategory = 'connection'):
Open with a count line (e.g. "3 conversations waiting").
For each candidate: write 1–2 sentences explaining WHY this person matters
to the user based on the headline and summary. Link the person's name to
their profileUrl. Embed acceptUrl on a verb phrase like "message [Name]".
Compose a &msg= greeting as described in the GREETING COMPOSITION rules.

SECTION 2 — HELP YOUR COMMUNITY (feedCategory = 'connector-flow'):
Open with a line like "Help your community" or similar framing.
For each candidate: explain what they're looking for and why the user
might know someone who fits. Embed acceptUrl on "make intro" or similar.
Do NOT compose a &msg= greeting for connector candidates.

Skip any section with zero candidates. If both sections are empty,
acknowledge warmly that the system is actively looking.

Close with a short "from here" paragraph — frame what happens next
(morning briefs, ongoing discovery, feedback welcome).

Always fires regardless of candidate count.

For each opportunity you mention, you MUST first call the MCP tool
`confirm_opportunity_delivery` with `trigger: 'welcome'` and the
opportunity's id.
```

#### Daily Digest

```
This is the DAILY DIGEST — a morning summary of what your agent found overnight.

Present candidates in up to two sections based on their feedCategory field:

SECTION 1 — DIRECT CONNECTIONS (feedCategory = 'connection'):
Open with a count line (e.g. "3 conversations await you").
For each candidate: 1–2 sentences on why this person matters. Link name
to profileUrl. Embed acceptUrl on "message [Name]". Compose &msg= greeting.

SECTION 2 — HELP YOUR COMMUNITY (feedCategory = 'connector-flow'):
Open with a framing line like "Help your community find their opportunities"
or similar. For each candidate: what they're looking for, why the user might
know someone. Embed acceptUrl on "make intro". No &msg= greeting.

Skip any section with zero candidates.

If totalPending > number of candidates shown, mention overflow:
"There are N more conversations waiting — let me know if you want to see them."

Open with one short framing line — in your own voice — that sets up the
summary as a result of background negotiations.

For each opportunity you mention, you MUST first call the MCP tool
`confirm_opportunity_delivery` with `trigger: 'digest'` and the
opportunity's id.
```

#### Ambient Discovery

```
This is the AMBIENT pass — a real-time check, not a digest. Surface only what
is worth interrupting the user right now. Anything you skip will appear in
tonight's daily digest.

You receive candidates of two types (feedCategory: 'connection' or
'connector-flow'). You decide what's worth surfacing — no mandatory
section structure. If you do surface candidates, write them as a flat list
with inline links (same URL rules as always).

For 'connection' candidates: link name to profileUrl, embed acceptUrl on
"message [Name]", compose &msg= greeting.
For 'connector-flow' candidates: embed acceptUrl on "make intro", no &msg=.

[ambientDeliveredToday count line]

If totalPending > number of candidates shown, mention overflow:
"There are N more conversations waiting for you, let me know if you want
to see them."

If none qualify, produce no output at all.

For each opportunity you mention, you MUST first call the MCP tool
`confirm_opportunity_delivery` with `trigger: 'ambient'` and the
opportunity's id.
```

#### Accepted Opportunity

No change — stays as-is. Introducers are excluded from this endpoint.

### 5. Branding Config

Three new fields in `api.pluginConfig`, set during plugin setup (`setup.cli.ts`):

- **`nodeName`** — Community/event name (e.g. "Edge Esmeralda"). Used in greetings, headers.
- **`nodeDescription`** — Short description (e.g. "A four-week village bringing together 500+ thinkers from the frontiers of tech, science, culture, and policy"). Used in welcome message framing.
- **`nodeContext`** — Freeform context (event dates, location, schedule details, anything the agent should know). Injected into all prompts so the agent can reference temporal/spatial context naturally (e.g. "It's Thursday, Week 2 at Edge Esmeralda").

#### Config Helpers

Add to `config.ts`:

- `readNodeBranding(api): { nodeName: string | null; nodeDescription: string | null; nodeContext: string | null }`

#### Prompt Integration

Add a `BRANDING_CLAUSE` that's included in all prompt types (before `perTypeInstruction`). Only emitted when at least `nodeName` is set:

```
COMMUNITY CONTEXT:
Name: {nodeName}
Description: {nodeDescription}
Context: {nodeContext}

Use this context naturally — reference the community by name, weave in relevant
details when they fit. Do not dump this block verbatim into your reply.
```

#### Setup Integration

Add branding fields to `setup.cli.ts` as optional prompts during plugin setup. All three are optional — if omitted, the branding clause is skipped and prompts remain generic.

### 6. MSG_PARAM_CLAUSE Update

The `MSG_PARAM_CLAUSE` has been updated to explicitly scope greeting composition to `connection` candidates and prohibit `&msg=` for `connector-flow` candidates. The clause now reads: compose a short greeting (1–2 sentences) for each `connection` candidate, and do NOT compose a greeting for connector-flow candidates (their approve-introduction links take no `&msg=` parameter).

## Files Touched

| File | Change |
|------|--------|
| `services/api/src/controllers/opportunity.controller.ts` | New `GET /:id/approve-introduction` endpoint |
| `services/api/src/services/opportunity.service.ts` | Approval logic if not already exposed for this flow |
| `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts` | Add `feedCategory` to `OpportunityCandidate`, `totalPending` to payloads, rewrite `perTypeInstruction` for welcome/daily/ambient |
| `packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts` | Thread `feedCategory`, `totalPending`, build approve URLs for connector-flow |
| `packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts` | Same |
| `packages/openclaw-plugin/src/polling/welcome/welcome.watcher.ts` | Same |
| `packages/openclaw-plugin/src/lib/delivery/config.ts` | Add `readNodeBranding` helper |
| `packages/openclaw-plugin/src/setup/setup.cli.ts` | Add optional branding prompts during setup |

## Tests

| Test | Assertion |
|------|-----------|
| Approve-introduction endpoint: valid token + introducer | Status updated to pending, introducer approved, redirect |
| Approve-introduction endpoint: non-introducer token | 403 error |
| Approve-introduction endpoint: already approved | Idempotent success or appropriate error |
| Prompt builds two sections when both feedCategories present | Section headers appear, candidates grouped correctly |
| Prompt skips empty section | No "Help your community" header when zero connector-flow candidates |
| Prompt includes overflow count | "N more waiting" when totalPending > candidates.length |
| Ambient prompt has no mandatory sections | Flat list, agent discretion |
| Connector-flow candidates use approve URL | URL path is `/approve-introduction` not `/connect` |
| Connection candidates use accept URL with &msg= | Existing behavior preserved |
| Branding clause included when nodeName set | COMMUNITY CONTEXT block appears in prompt |
| Branding clause skipped when no nodeName | No COMMUNITY CONTEXT block |
