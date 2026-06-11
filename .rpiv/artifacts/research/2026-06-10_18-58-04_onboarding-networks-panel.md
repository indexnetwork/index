---
date: 2026-06-10T18:58:04+0300
author: Yankı Ekin Yüksel
commit: 3ab9385916
branch: dev
repository: index
topic: "Onboarding communities panel — fix empty state and remove silent auto-join"
tags: [research, codebase, onboarding, networks, NetworksPanel, IndexesContext, AssistantMessageContent, ChatContent, profile-tools]
status: ready
last_updated: 2026-06-10T18:58:04+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Onboarding communities panel — fix empty state and remove silent auto-join

## Research Question
Why does the `networks_panel` block appear empty during onboarding, and how should the auto-join be removed and the panel restored?

## Summary
Commit `6a2f9a57e1` (2026-03-30, "feat: replace onboarding network selection with auto-join indexes") deliberately stripped `networks_panel` support from the onboarding page and added the `AUTO_JOIN_INDEX_IDS` auto-join. The `onboarding/page.tsx` has its **own local copy** of `parseAllBlocks` and `AssistantMessageContent`; that local copy no longer recognises `networks_panel` blocks (the regex only matches `opportunity|intent_proposal`), so these segments fall through to the catch-all `<IntentProposalSkeleton />` render. Meanwhile the `chat.prompt.ts` step-6 instruction still tells the model to emit the `networks_panel` block — so the block is emitted but silently discarded on the onboarding page. The fix is: remove the auto-join from `complete_onboarding()`, extract the two diverging `AssistantMessageContent` implementations into a single shared component that handles all segment types, add `refreshIndexes()` after a network join or onboarding completion, and add the `communities` step suggestions back.

## Detailed Findings

### 1. Root cause — `onboarding/page.tsx` local `parseAllBlocks` strips `networks_panel`

`onboarding/page.tsx:81-100` defines a **local** `MessageSegment` type union and `parseAllBlocks` function. After commit `6a2f9a57e1` the union no longer includes `networks_panel` or `networks_panel_loading`, and the regex is `/(opportunity|intent_proposal)\s*\n…/g`. When the model emits:
```
```networks_panel
{}
```
```
the block is not matched; it falls into `remainingContent` and is either ignored (if it has no partial match candidate) or rendered as `<IntentProposalSkeleton />` via the catch-all `return` at the end of the `segments.map` (`onboarding/page.tsx:255`).

`ChatContent.tsx` is unaffected — its local `parseAllBlocks` (`ChatContent.tsx:106`) still matches all three block types and renders `<NetworksPanel>` correctly.

### 2. Auto-join is a deliberate past decision now being reversed

`profile.tools.ts:1258-1272` loops over `AUTO_JOIN_INDEX_IDS`, calling `database.addMemberToNetwork(networkId, userId, 'member')` for each. The tool description at `profile.tools.ts:1229` says "May also auto-join the user to preconfigured indexes (communities)…".

`AUTO_JOIN_INDEX_IDS=5afc0751-84df-47ce-b519-88121e8aae38` is set in the Railway `protocol` service env, pointing to "Index Early Birds". The loop fires even when no panel was shown, so every new user who completes onboarding is silently added.

### 3. The two `AssistantMessageContent` implementations have diverged

| Location | Segment types handled | networks_panel? | Source of parseAllBlocks |
|---|---|---|---|
| `ChatContent.tsx:165` | text, opportunity, opportunity_loading, intent_proposal, intent_proposal_loading, **networks_panel**, **networks_panel_loading** | ✅ | local copy in `ChatContent.tsx:104` |
| `onboarding/page.tsx:165` | text, opportunity, opportunity_loading, intent_proposal, intent_proposal_loading | ❌ | local copy in `onboarding/page.tsx:103` |

The `ChatContent.tsx` `AssistantMessageContent` takes two extra props: `onNetworkJoin?: (id, title) => void` and `networkPanelPendingJoinIds?: Set<string>`. The onboarding version lacks these.

### 4. `NetworksPanel` is a pure functional component — ready to reuse

`frontend/src/components/chat/NetworksPanel.tsx` accepts:
```ts
interface NetworksPanelProps {
  onJoin: (networkId: string, networkTitle: string) => void;
  pendingJoinIds?: Set<string>;
}
```
It independently fetches `/networks/discovery/public` (`discoverPublicIndexes(1, 50)`) and merges with `useNetworksState().indexes` to filter already-joined networks. No snapshot prop exists today.

The `joinable` array shown to the user is:
```ts
const joinedNonPersonal = joinedIndexes.filter(i => !i.isPersonal);
const joinedIds = new Set(joinedNonPersonal.map(i => i.id));
const joinable = publicNetworks.filter(n => !joinedIds.has(n.id));
```

For a fresh user during onboarding, `joinedNonPersonal` is empty → `joinedIds` is empty → `joinable` = all public networks (`[Index Early Birds]`).

### 5. `refreshIndexes()` is already called in three sibling patterns

`IndexesContext` fetches once on login (`hasFetchedRef` guard, `IndexesContext.tsx:62`). `refreshIndexes()` is callable externally and is already used:

| Callsite | When |
|---|---|
| `onboarding/page.tsx:380` | After accepting a pending invite (inside the `completedAt` transition effect — gated on `pendingCode` in localStorage) |
| `index/[indexId]/page.tsx:84,141` | After joining a network from the index page |
| `l/[code]/page.tsx:129` | After accepting an invitation code |

There is **no call** to `refreshIndexes()` after the agent processes a `create_network_membership` call in the chat. The "clear pending join IDs" effect at `ChatContent.tsx:523` triggers when `isLoading` transitions to false with `networkPanelPendingJoinIds.size > 0` — but it only clears the set; no refresh.

For the **onboarding page**, the `completedAt` transition effect (`onboarding/page.tsx:370-393`) calls `refreshIndexes()` only when a `pendingInviteCode` is in localStorage. It navigates to `/d/${sessionId}` after 700ms. The auto-join from `complete_onboarding()` is not reflected unless the page reloads.

### 6. `read_networks()` tool response shape

The tool at `network.tools.ts:62` returns:
```json
{
  "memberOf": [...],
  "owns": [...],
  "publicNetworks": [{ "id": "...", "title": "...", "key": "...", "isPersonal": false, ... }]
}
```
`publicNetworks` is an array of full network objects enriched via `enrichWithContext`. For a fresh user, `publicNetworks` contains `[Index Early Birds]`. The model sees this full object.

The prompt at `chat.prompt.ts:128-138` tells the model to call `read_networks()`, check if `publicNetworks` is empty, then write:
```
```networks_panel
{}
```
```
The `{}` payload is literal — the prompt never asks the model to embed the network data.

### 7. Snapshot approach is a separate enhancement

The FRD proposes embedding a snapshot into the block payload to freeze historical panel state. This is a **separate enhancement** from the core fix. The core fix only requires: (a) restore `networks_panel` parsing to the onboarding page's renderer, (b) remove auto-join, (c) add `refreshIndexes()`. The snapshot is additive and can land later.

---

## Code References
- `onboarding/page.tsx:81-83` — local `MessageSegment` type (missing `networks_panel`)
- `onboarding/page.tsx:103` — local `parseAllBlocks` regex: `/(opportunity|intent_proposal)\s*\n…/g`
- `onboarding/page.tsx:165-260` — local `AssistantMessageContent`, no `networks_panel` case
- `onboarding/page.tsx:255` — catch-all `return <IntentProposalSkeleton />` renders for `networks_panel`
- `onboarding/page.tsx:360-365` — `refetchUser()` called after every stream end
- `onboarding/page.tsx:370-393` — `completedAt` transition → `refreshIndexes()` only if `pendingInviteCode`
- `ChatContent.tsx:95-101` — full `MessageSegment` type including `networks_panel`
- `ChatContent.tsx:104-187` — `parseAllBlocks` with 3-type regex
- `ChatContent.tsx:165-355` — `AssistantMessageContent` with `onNetworkJoin`/`networkPanelPendingJoinIds`
- `ChatContent.tsx:327-336` — `networks_panel` segment → renders `<NetworksPanel>`
- `ChatContent.tsx:523-527` — clears `networkPanelPendingJoinIds` on stream end (no `refreshIndexes`)
- `ChatContent.tsx:529-535` — `handleNetworkJoin` → `sendMessage("I'd like to join …")`
- `NetworksPanel.tsx:1-120` — full component, `onJoin`/`pendingJoinIds` props, live fetch
- `NetworksPanel.tsx:35-39` — `useEffect` live-fetches `/networks/discovery/public`
- `NetworksPanel.tsx:42-44` — `joinable` filter using `joinedIds` from `IndexesContext`
- `IndexesContext.tsx:31-47` — `refreshIndexes` implementation; `hasFetchedRef` guard at line 62
- `profile.tools.ts:1225-1229` — `complete_onboarding` description mentioning auto-join
- `profile.tools.ts:1258-1272` — auto-join loop reading `AUTO_JOIN_INDEX_IDS`
- `network.tools.ts:29-62` — `read_networks` tool, `publicNetworks` field
- `chat.prompt.ts:127-138` — step-6 communities prompt, `networks_panel {}` template

## Integration Points

### Inbound References
- `onboarding/page.tsx:602` — calls local `AssistantMessageContent` (no `networks_panel` handling)
- `ChatContent.tsx:1702` — calls `ChatContent.tsx`-local `AssistantMessageContent` (has `networks_panel`)
- `ChatContent.tsx:1744` — passes `onNetworkJoin={handleNetworkJoin}` to the outer component

### Outbound Dependencies
- `NetworksPanel.tsx` → `useNetworks()` (APIContext) → `indexesService.discoverPublicIndexes`
- `NetworksPanel.tsx` → `useNetworksState()` (IndexesContext) for `joinedIndexes`
- `profile.tools.ts` → `database.addMemberToNetwork` (auto-join)
- `onboarding/page.tsx` → `useNetworksState().refreshIndexes` (for post-invite case)

### Infrastructure Wiring
- Railway env: `AUTO_JOIN_INDEX_IDS=5afc0751-84df-47ce-b519-88121e8aae38` → read in `profile.tools.ts:1258`

## Architecture Insights

1. **Two-file duplication is the systemic risk.** The `parseAllBlocks` function and `MessageSegment` type are copy-pasted between `ChatContent.tsx` and `onboarding/page.tsx`. Any future block type addition must be applied to both files. Extracting a shared module eliminates this permanently.

2. **`AssistantMessageContent` is not exported.** Both implementations are local `function` declarations in their respective files. Neither is tested directly. Extraction should include a unit test for segment parsing.

3. **The catch-all render is a silent failure mode.** The `segments.map` catch-all in `onboarding/page.tsx:255` renders `<IntentProposalSkeleton />` for any unrecognised segment. This makes new block types silently broken instead of obviously broken. The extracted component should handle unrecognised segments as `null` or a debug fallback.

4. **`refreshIndexes()` is the right API.** It bypasses `hasFetchedRef` (that ref is only checked in the mount effect, not inside `refreshIndexes` itself), silently handles errors, and sets `hasDataRef`. It is already proven in three sibling callsites.

5. **Snapshot data (FRD requirement 3-4) can land in a follow-up.** Changing the block payload format requires changes to both the prompt and both parsers. The core fix (restore panel + remove auto-join) has zero risk; snapshot adds meaningful scope. Decoupling them de-risks the primary goal.

## Precedents & Lessons

8 relevant commits analyzed.

### Precedent: networks_panel originally added to onboarding
**Commit**: `2c7307507a` — "feat(onboarding): support networks_panel block" (2026-03-12)
**Blast radius**: 1 file (`onboarding/page.tsx`), +72 lines
**Takeaway**: The feature was added, then removed 18 days later. Restoring it is a known-safe change.

### Precedent: auto-join replaced the panel
**Commit**: `6a2f9a57e1` — "feat: replace onboarding network selection with auto-join indexes" (2026-03-30)
**Blast radius**: 5 files — `onboarding/page.tsx`, `protocol/.env.example`, `chat.prompt.ts` (old path), `profile.tools.ts` (old path), `startup.env.ts`
**What changed**: Removed `NetworksPanel` import, stripped `networks_panel` from local parser, removed `communities` step suggestions, added `AUTO_JOIN_INDEX_IDS` loop in `complete_onboarding()`.
**Takeaway**: The reverse operation must touch the same 4-5 surfaces. The `chat.prompt.ts` step-6 instruction was NOT removed in that commit (it was a different file path — suggesting it was added/maintained separately in the current codebase).

### Precedent: refreshIndexes called after join
**Commit**: `8b78551f8d` — "fix(indexes): harden invitation flow" — `l/[code]/page.tsx:129`
**Takeaway**: Pattern is established — call `refreshIndexes()` immediately after any membership mutation that needs to be reflected in the sidebar.

### Composite Lessons
- Block-type parsers in two files always drift apart; extract early (`2c7307507a` → `6a2f9a57e1` showed this in 18 days).
- `refetchUser()` after stream end is already in place in `onboarding/page.tsx:360-365`; the `completedAt` watcher at line 370 fires reliably. `refreshIndexes()` can be added unconditionally inside that watcher (alongside the existing `pendingCode` branch).

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-10_15-52-13_onboarding-networks-panel.md` — FRD covering all three requirements: remove auto-join, restore panel, add sidebar refresh

## Developer Context

**Q (discover: Remove auto-join from complete_onboarding): `profile.tools.ts:1258-1273` loops over `AUTO_JOIN_INDEX_IDS`. Confirmed in interview.**
A: Remove the auto-join loop; joining Early Birds should require explicit user action via the onboarding panel.

**Q (discover: Snapshot panel data in the fenced block): `NetworksPanel` re-fetches live data on every render — post-completion panel shows "Joined" not "Joinable".**
A: Snapshot approach chosen; model embeds network data in block payload, ChatContent.tsx parses + passes as props, NetworksPanel uses props when provided. **Research finding: snapshot is additive and can land after the core fix.**

**Q (discover: Post-join sidebar refresh): `IndexesContext.tsx:62` fetches once on login; agent-triggered joins are invisible until reload.**
A: Trigger `refreshIndexes()` after stream ends with pending join IDs (extend `ChatContent.tsx:523` effect) AND unconditionally in the `onboarding/page.tsx:370` `completedAt` watcher.

**Q (`onboarding/page.tsx:165`): Local `AssistantMessageContent` has no `networks_panel` case — catch-all at line 255 renders `<IntentProposalSkeleton />`.**
A: Extract shared `AssistantMessageContent` component (chosen by developer).

## Open Questions
- Should `requireApproval: true` on "Index Early Birds" be surfaced in the Join button (e.g. "Request to join")? The field is stored but never enforced (`membership.graph.ts:47-55`). Deferred — developer did not add it to scope.
