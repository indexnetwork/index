---
date: 2026-06-10T18:43:13+0300
author: Yankı Ekin Yüksel
commit: eb32057756
branch: dev
repository: index
topic: "Onboarding network recommendation"
tags: [intent, frd, onboarding, networks, recommendation, llm]
status: ready
last_updated: 2026-06-10T18:43:13+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Onboarding Network Recommendation

## Summary
During user onboarding, the agent currently presents a flat, unranked list of every public network to the new user — with no consideration of their profile, interests, location, or contacts. The feature goal is to replace this with an LLM-scored recommendation that ranks networks using the user's work domain, stated intent, geographic location (collected inline during onboarding), and Gmail contacts overlap, so the most relevant communities surface first. This FRD documents the current state end-to-end and captures the intended design for a downstream research/design pass.

## Problem & Intent
The developer's framing: "it doesn't even work — we just need to discover what is going on currently and document the state we are currently in correctly." The smart recommendation (LLM-based, considering location, interests, etc.) described in the original feature request is not implemented. Step 6 of onboarding simply dumps every public network onto the screen. The network recommendation as a meaningful onboarding moment is effectively absent.

## Goals
- Accurately document the current onboarding network-recommendation flow, layer by layer.
- Identify the structural gaps between the described feature and what is actually built.
- Define the intended end state (signals, scoring mechanism, location collection) so a research/design skill can proceed with a clear target.

## Non-Goals
- Actually implementing the smart recommendation (a separate session owns that).
- Changing anything in the current flow as part of this FRD.
- Designing the UI for the recommendation panel (considered out of scope; the existing `NetworksPanel` component is reused).

## Functional Requirements

### Current state
1. The system SHALL present step 6 ("Discover communities") during onboarding by calling `read_networks()` and emitting a `networks_panel` fenced block.
2. The `networks_panel` block SHALL trigger the `NetworksPanel` React component, which independently fetches all public joinable networks from `GET /networks/discovery/public`.
3. The backend `GET /networks/discovery/public` endpoint SHALL return all non-deleted, non-experiment networks with `joinPolicy = 'anyone'` that the user has not yet joined, ordered by creation date descending.
4. No user attributes (profile, interests, location, contacts) SHALL be used in the current query or ranking.

### Intended state
5. During onboarding, before the community discovery step, the system SHALL collect the user's location (city/region) as an explicit onboarding sub-step (currently missing from the schema and onboarding flow).
6. When `read_networks()` is called in onboarding context, the tool SHALL pass the user's profile (bio, skills, work domain), stated intent/signal from step 7, collected location, and Gmail contacts list to an LLM call that scores and ranks the available public networks by relevance.
7. The ranked network list SHALL be the output of the `read_networks` tool, replacing the current unranked dump.
8. The `NetworksPanel` component rendering SHALL remain unchanged; ranking is applied upstream in the tool layer.

## Non-Functional Requirements
- **Performance**: The LLM scoring call inside `read_networks` adds latency to onboarding step 6. Acceptable since onboarding is a one-time flow; no strict SLA defined.
- **Security**: Location is PII. It must be stored in the user schema under the same privacy model as other profile fields. No raw location should be logged.
- **UX / Accessibility**: Location collection step follows existing onboarding chat conventions — prompted conversationally by the LLM, not a separate form. The `NetworksPanel` UI is reused as-is.
- **Reliability**: If the LLM scoring call fails, `read_networks` SHALL fall back to returning the unranked list rather than blocking onboarding.

## Constraints & Assumptions
- **Location schema gap**: The `users` table in `backend/src/schemas/database.schema.ts` does not currently have a location field. Collecting it inline during onboarding requires a schema migration and a new onboarding step in `chat.prompt.ts`.
- **Two parallel data flows**: The LLM uses `read_networks()` (indexer graph path) while `NetworksPanel` fetches from the REST API independently. Both paths must serve the same ranked list, or the REST API must also be updated to support a ranked endpoint.
- **Signal timing**: At step 6 of onboarding, the stated intent (step 7) has not been captured yet — the signals available for scoring are profile (steps 1–4), Gmail contacts (step 5), and location (new step). Intent signals can only influence recommendation if the onboarding order changes or the scoring is deferred to after step 7.
- **Assumption**: Network `prompt` fields contain enough semantic content for LLM scoring to work meaningfully. If prompts are empty or low-quality, recommendation quality degrades regardless of user signals.
- **Assumption**: Location is usable for recommendation matching because at least some networks have geographic focus encoded in their `title` or `prompt`.

## Acceptance Criteria
- [ ] A new location field exists on the `users` table (or `onboarding` JSONB) and is populated via a new onboarding step visible in `chat.prompt.ts`.
- [ ] During onboarding step 6, calling `read_networks()` with a user that has a non-empty profile returns a `publicNetworks` array whose order reflects LLM-derived relevance scores, not raw `createdAt` descending.
- [ ] If the LLM scoring call throws or times out, `read_networks()` returns the unranked `publicNetworks` array and does not throw — the onboarding flow continues.
- [ ] The `NetworksPanel` component renders the scored list without UI changes.
- [ ] A user with a clearly scoped profile (e.g., "AI researcher in Berlin") joining onboarding sees AI- or Berlin-relevant communities listed before unrelated ones, as verified by a manual onboarding walkthrough.

## Recommended Approach
Extend `read_networks` in `packages/protocol/src/network/network.tools.ts` with an onboarding-aware LLM scoring pass that ranks the `publicNetworks` array against the user's profile, location, and contacts before returning. Separately, add a location-capture sub-step to the onboarding LLM prompt in `packages/protocol/src/chat/chat.prompt.ts` between Gmail (step 5) and community discovery (step 6).

## Decisions

### Problem framing
**Question**: What problem does a new user hit today during onboarding that this smart recommendation would solve?
**Recommended**: n/a — intent question
**Chosen**: "it doesn't even work but another session is handling that. We just need to discover what is going on currently and document the state we are currently in correctly."
**Rationale**: The intent is documentation + baseline capture, not a live design sprint. The FRD doubles as the intake for a future research/design run.

### Structural facts confirmed
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4
**Recommended**: n/a — confirmation
**Chosen**: All four structural facts confirmed: (1) Step 6 calls `read_networks()` + emits `networks_panel` (`chat.prompt.ts:128`); (2) `NetworksPanel` fetches from REST independently (`NetworksPanel.tsx:35`); (3) backend returns flat unranked list by `createdAt` (`database.adapter.ts:1476`); (4) no profile attributes used anywhere.
**Rationale**: evidence: `packages/protocol/src/chat/chat.prompt.ts:128`, `frontend/src/components/chat/NetworksPanel.tsx:35`, `backend/src/adapters/database.adapter.ts:1457`

### FRD scope
**Question**: What should the FRD capture — current state only, or current state + intended design?
**Recommended**: Current state only
**Chosen**: Current state + intended design
**Rationale**: The FRD should serve as the intake document for a downstream research/design skill, so capturing intended design direction reduces rework.

### Recommendation signals
**Question**: For the intended design, what user signals should drive the smart recommendation?
**Recommended**: Interests/work domain (profile-derived, already captured in onboarding)
**Chosen**: All four — interests/work domain, stated intent/signal, location/geography, Gmail contacts overlap
**Rationale**: Full-signal recommendation gives the best relevance; location gap must be resolved as a prerequisite.

### LLM scoring architecture
**Question**: Where should scoring/ranking happen — inside the `read_networks` tool or a new backend endpoint?
**Recommended**: LLM scores inside `read_networks` (`packages/protocol/src/network/network.tools.ts:24`)
**Chosen**: LLM scores inside `read_networks`
**Rationale**: Keeps scoring in the protocol layer where user context is already available; avoids a new REST endpoint and keeps the `NetworksPanel` component unchanged.

### Location collection
**Question**: Location is not collected anywhere in the current flow or schema. How should the FRD treat it?
**Recommended**: Flag as a prerequisite gap
**Chosen**: Collect it inline during onboarding — add a new conversational step to `chat.prompt.ts` between step 5 (Gmail) and step 6 (communities), and add the field to the user/onboarding schema.
**Rationale**: Location is a stated signal for recommendation quality; without it the feature is incomplete by design.

### Step 7 intent timing
**Question**: Pre-resolved from codebase evidence
**Recommended**: n/a — structural constraint
**Chosen**: At the time step 6 fires, step 7 (intent capture) has not happened yet. Intent signals are unavailable for the initial recommendation. This is a constraint, not a blocker — profile + location + contacts are sufficient for a first-pass.
**Rationale**: evidence: `packages/protocol/src/chat/chat.prompt.ts:144-150` — step 7 intent capture runs after step 6 community discovery.

## Open Questions
- Should the `NetworksPanel` REST fetch (`/networks/discovery/public`) also return a ranked list, or is it acceptable for the REST path to remain unranked while the LLM path is ranked? The two-path architecture creates a risk of inconsistent ordering.
- Are network `prompt` fields populated with enough semantic content across all existing public networks to make LLM scoring useful? If many prompts are empty, a fallback strategy is needed.

## Suggested Follow-ups
- The `read_networks` tool routes through the indexer graph (`network.tools.ts:54`) — the indexer graph may already have hooks for ranking or filtering that could be extended rather than adding an LLM call directly in the tool handler. Worth checking: `packages/protocol/src/network/indexer/indexer.graph.ts`.
- `backend/src/adapters/database.adapter.ts:1476` orders by `desc(networks.createdAt)` — this raw sort is also used in the REST panel fetch. If ranking is added only to the LLM path, the panel may show a different order than what the LLM recommended, which would be confusing to the user.

## References
- Feature input: "How we recommend networks to sign up during onboarding. It should be a smart recommendation (llm-based) considering the location, the interests, etc."
- Onboarding LLM prompt: `packages/protocol/src/chat/chat.prompt.ts:78–163`
- read_networks tool: `packages/protocol/src/network/network.tools.ts:24–87`
- NetworksPanel component: `frontend/src/components/chat/NetworksPanel.tsx`
- Public networks adapter: `backend/src/adapters/database.adapter.ts:1457–1509`
- Public networks controller: `backend/src/controllers/network.controller.ts:856`
- Onboarding page: `frontend/src/app/onboarding/page.tsx`
