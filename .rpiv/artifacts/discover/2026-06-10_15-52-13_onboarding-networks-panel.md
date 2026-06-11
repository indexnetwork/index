---
date: 2026-06-10T15:52:13.524Z
author: Yankı Ekin Yüksel
commit: 3ab938591695528a00b38c5d71a737a65290c7c1
branch: dev
repository: index
topic: "Onboarding communities panel — fix empty state and remove silent auto-join"
tags: [intent, frd, onboarding, networks, NetworksPanel, IndexesContext, complete_onboarding]
status: ready
last_updated: 2026-06-10T15:52:13.524Z
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Onboarding communities panel — fix empty state and remove silent auto-join

## Summary
During onboarding step 6 the agent presents a `networks_panel` block and says "here are some networks you might be interested in", but users see nothing they can join. The root cause is twofold: (1) `NetworksPanel` re-fetches live data on every render, so the historical step-6 message shows "Joined" for Early Birds after `complete_onboarding()` fires later in the same conversation; (2) `complete_onboarding()` silently force-joins the user to "Index Early Birds" via the `AUTO_JOIN_INDEX_IDS` env var, making the choice meaningless. The fix is to remove the auto-join from `complete_onboarding()`, snapshot the panel's network data so the historical message preserves the live-interaction state, and refresh `IndexesContext` after any agent-triggered membership change so the sidebar updates immediately.

## Problem & Intent
New users going through onboarding (the case of Yusuf Akçakaya on 2026-06-10 was the trigger) end up in "Index Early Birds" without ever being offered a real choice to join. The `networks_panel {}` block in the chat — intentionally an empty-object signal — renders `NetworksPanel` which re-fetches `/networks/discovery/public` live; by the time anyone reviews the historical message the user is already a member, so the panel shows "Joined" and nothing joinable. Meanwhile, users who don't review their chat history miss that they were silently added. The intent is: show real joinable networks during onboarding, let the user consciously choose, and reflect that choice immediately in the UI.

## Goals
- Remove the `AUTO_JOIN_INDEX_IDS` / auto-join side-effect from `complete_onboarding()` so joining Early Birds requires an explicit user action.
- During the live onboarding step 6 interaction, show "Index Early Birds" (and any future public networks) with a visible Join button.
- After a user joins a network via the agent (either from the panel click or by message), the sidebar reflects the new membership immediately without a hard reload.
- The historical `networks_panel` message preserves the snapshot of what was joinable at the time, so future renders don't retroactively show "Joined".

## Non-Goals
- Adding new public networks to prod (that's a content decision, not a code change).
- Enforcing the `requireApproval: true` flag in the membership graph (it is stored but not checked; leaving it for a separate decision).
- Changing the onboarding prompt / agent flow steps other than removing references to auto-join.
- General network discovery beyond the onboarding panel.

## Functional Requirements
1. The `complete_onboarding()` tool SHALL NOT call `addMemberToNetwork` for any `AUTO_JOIN_INDEX_IDS` entry; the auto-join loop (`profile.tools.ts:1258-1273`) shall be removed.
2. After `complete_onboarding()` fires (or after the agent calls `create_network_membership`), `IndexesContext.refreshIndexes()` SHALL be triggered in the frontend so the sidebar updates without a page reload.
3. The `networks_panel {}` block in the chat SHALL encode the snapshot of joinable network IDs at the time of rendering, so historical re-renders do not re-fetch live membership data and retroactively show "Joined".
4. The `NetworksPanel` component SHALL use the snapshot IDs (if present in the block payload) as the source of truth for which networks to display, falling back to the live API fetch only when no snapshot is provided (e.g., older historical messages).
5. The onboarding prompt (`chat.prompt.ts`) SHALL remove any description or reference that implies users will be auto-joined; the `complete_onboarding` tool description (`profile.tools.ts:1229`) SHALL be updated to remove "May also auto-join the user to preconfigured indexes."

## Non-Functional Requirements
- **Performance**: The snapshot encoding adds a small amount of JSON to the fenced block; it must remain < 1 KB to stay within typical SSE chunk budgets.
- **Security**: No new auth surface; `refreshIndexes` calls the same guarded `GET /networks` endpoint already in use.
- **UX / Accessibility**: The Join button in the panel must remain reachable and keyboard-navigable; no layout change required.
- **Reliability**: If `refreshIndexes` fails after membership change it should fail silently (already the case in existing error handling in `IndexesContext`).

## Constraints & Assumptions
- Only "Index Early Birds" (`5afc0751-84df-47ce-b519-88121e8aae38`) is currently public (`joinPolicy: "anyone"`) on prod; the fix must work for zero or many public networks.
- `NetworkGraphDatabase.getPublicIndexesNotJoined` (used by both `read_networks` tool and `GET /networks/discovery/public`) correctly excludes already-joined networks — verified against prod DB.
- The `{}` placeholder in the `networks_panel` fenced block is consumed/discarded by `ChatContent.tsx:120` — it can be replaced with a JSON payload without breaking the existing regex.
- `IndexesContext` uses `hasFetchedRef` to prevent duplicate fetches on mount — calling `refreshIndexes()` externally bypasses that guard correctly (`refreshIndexes` sets `hasDataRef` but does not reset `hasFetchedRef`).
- The `AUTO_JOIN_INDEX_IDS` Railway env var will remain set but be inert after the code change; it does not need to be removed from Railway config.

## Acceptance Criteria
- [ ] A fresh user account going through onboarding sees "Index Early Birds" listed with a Join button in the `networks_panel` UI card during the live step-6 interaction.
- [ ] Completing onboarding WITHOUT clicking Join does NOT result in the user being added to "Index Early Birds" (verify in prod DB: `SELECT * FROM network_members WHERE user_id = '<new_user_id>' AND network_id = '5afc0751-84df-47ce-b519-88121e8aae38'` returns 0 rows).
- [ ] Clicking Join during the panel and confirming with the agent results in the sidebar showing "Index Early Birds" immediately — no hard reload required.
- [ ] Viewing the historical step-6 message after completing onboarding still shows "Index Early Birds" with a Join button (snapshot preserved), not a "Joined" badge.
- [ ] `cd backend && bun test` and `cd packages/protocol && bun test` pass with no regressions on `complete_onboarding` or membership tests.

## Recommended Approach
Remove the `AUTO_JOIN_INDEX_IDS` loop from `complete_onboarding()` in `packages/protocol/src/profile/profile.tools.ts`. Change the `networks_panel` fenced-block payload from a static `{}` to a JSON snapshot of the `publicNetworks` array returned by `read_networks()` (emitted by the model via the prompt, serialised into the block). Update `ChatContent.tsx` to parse that payload and pass it as props to `NetworksPanel`, which uses it instead of re-fetching. Finally, expose `refreshIndexes` via a context event or a direct call from `ChatContent.tsx` after the agent stream ends when an onboarding-completing or membership-creating tool call was detected.

## Decisions

### Remove auto-join from complete_onboarding
**Question**: Pre-resolved from codebase evidence — `profile.tools.ts:1258-1273` loops over `AUTO_JOIN_INDEX_IDS` and calls `addMemberToNetwork` inside `complete_onboarding()`. Confirmed in interview.
**Recommended**: Remove the auto-join loop entirely.
**Chosen**: Remove the auto-join loop; joining Early Birds should require explicit user action via the onboarding panel.
**Rationale**: evidence: `packages/protocol/src/profile/profile.tools.ts:1258` + confirmed by developer ("it shouldn't auto-join")

### Snapshot panel data in the fenced block
**Question**: `NetworksPanel` re-fetches `/networks/discovery/public` on every render — including historical chat messages — so post-completion membership makes the panel appear "Joined"/empty retrospectively. How should this be addressed?
**Recommended**: Embed the `publicNetworks` snapshot as JSON in the `networks_panel` fenced block so historical renders use immutable data.
**Chosen**: Snapshot approach — the model outputs the network IDs/titles it received from `read_networks()` into the block payload; `ChatContent.tsx` parses and passes them as props; `NetworksPanel` uses props when provided, falls back to live fetch for old messages.
**Rationale**: Preserves historical accuracy without a new API, stays within the existing `ChatContent.tsx` parsing pattern (`frontend/src/components/ChatContent.tsx:106`)

### Post-join sidebar refresh
**Question**: Pre-resolved from codebase evidence — `IndexesContext` fetches once on login and never re-fetches (`IndexesContext.tsx:62`). After agent-triggered membership changes the sidebar is stale.
**Recommended**: Call `refreshIndexes()` from `ChatContent.tsx` after detecting a tool call that changes membership (e.g. `create_network_membership` or `complete_onboarding`).
**Chosen**: Trigger `refreshIndexes()` after the agent stream ends when a membership-mutating tool was called in that turn.
**Rationale**: evidence: `frontend/src/contexts/IndexesContext.tsx:62` + confirmed in interview

## Open Questions
- Should `requireApproval: true` on "Index Early Birds" be surfaced in the Join button (e.g. "Request to join")? The field is stored but never enforced (`membership.graph.ts:47-55`). Deferred — developer did not add it to scope.

## Suggested Follow-ups
- `requireApproval` is stored in `networks.permissions` but never checked in `membership.graph.ts:47-55` — if approval gating is intended, it needs a separate implementation.
- The `AUTO_JOIN_INDEX_IDS` Railway env var will be inert after this fix; it can be removed from the Railway `protocol` service config at any time.
- `getPublicIndexesNotJoined` in `database.adapter.ts:1457` fetches all membership rows without filtering `deleted_at` — soft-deleted membership rows would ghost-exclude a network. No prod impact today (0 such rows) but worth cleaning up.

## References
- Triggered by: Yusuf Akçakaya onboarding session, 2026-06-10 15:22–15:26 UTC
- Prod DB evidence: `network_members` for user `b8062af9-13d1-4751-8f30-922ab5bcc6f6`
- `packages/protocol/src/profile/profile.tools.ts` — `complete_onboarding` handler
- `packages/protocol/src/network/network.graph.ts` — `readNode` / `getPublicIndexesNotJoined`
- `frontend/src/components/chat/NetworksPanel.tsx` — panel component
- `frontend/src/components/ChatContent.tsx` — block parser
- `frontend/src/contexts/IndexesContext.tsx` — stale network state
- `backend/src/adapters/database.adapter.ts:1457` — `getPublicIndexesNotJoined`
