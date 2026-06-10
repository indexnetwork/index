---
date: 2026-06-10T19:00:17+0300
author: Yankı Ekin Yüksel
commit: 3ab9385916
branch: dev
repository: index
topic: "Onboarding network recommendation"
tags: [research, codebase, onboarding, networks, recommendation, llm, read-networks, chat-prompt]
status: ready
last_updated: 2026-06-10T19:00:17+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Onboarding Network Recommendation

## Research Question

Extend `read_networks` in `packages/protocol/src/network/network.tools.ts` with an onboarding-aware LLM scoring pass that ranks the `publicNetworks` array against the user's profile, location, and contacts before returning. Separately, add a location-capture sub-step to the onboarding LLM prompt in `packages/protocol/src/chat/chat.prompt.ts` between Gmail (step 5) and community discovery (step 6). Also: root-cause why the network panel never renders in onboarding today.

## Summary

The feature has three distinct layers of work: (1) **a frontend bug** — the onboarding page has its own `parseAllBlocks` that excludes `networks_panel`, so the panel is never rendered in onboarding today; (2) **an architectural gap** — the `networks_panel` fenced block is a zero-payload signal and `NetworksPanel` independently re-fetches from REST, meaning LLM ranking currently has no path to influence what the panel shows; (3) **the scoring implementation** — all user context needed for ranking (`profile.identity.location/bio/skills/interests`, `user.location`) is already in `ResolvedToolContext`, the location schema column already exists, and the `IntentIndexer` pattern gives a clean model for a standalone `NetworkRecommender` agent. The primary design choice is to extend the `networks_panel` fenced block to carry `{"orderedNetworkIds": [...]}` payload, update the frontend parser and `NetworksPanel` to sort by it, and add an LLM ranking pass in the `read_networks` tool guarded by `context.isOnboarding`.

---

## Detailed Findings

### 1. Root cause: networks_panel never renders in onboarding

`frontend/src/app/onboarding/page.tsx` has its own `parseAllBlocks` function (not shared with `ChatContent.tsx`) whose regex only handles two block types:

```
packages/protocol/src/chat/chat.prompt.ts:88
const regex = /```(opportunity|intent_proposal)\s*\n([\s\S]*?)\n```/g;
```

`networks_panel` is absent from this regex. When the LLM emits the fenced block during step 6, the onboarding renderer falls through to `{ type: "text" }` and `ReactMarkdown` renders it as a literal code block. The panel component is never mounted in the onboarding page.

`ChatContent.tsx:106` (used in regular post-onboarding chat) correctly handles all three:
```
const regex = /```(opportunity|intent_proposal|networks_panel)\s*\n([\s\S]*?)\n```/g;
```

**Fix owned by another session.** Add `networks_panel` to the onboarding `parseAllBlocks` regex and add the `NetworksPanel` rendering case to `AssistantMessageContent`.

### 2. networks_panel is a zero-payload signal — ranking cannot flow through it today

`ChatContent.tsx:121` — when a `networks_panel` block is parsed, it pushes `{ type: "networks_panel" }` (no data). At render time (`ChatContent.tsx:327`) the segment type maps directly to `<NetworksPanel onJoin={...} />` with no props carrying ranked IDs.

`NetworksPanel.tsx:35-39` then independently fetches:
```ts
indexesService.discoverPublicIndexes(1, 50)  // → GET /networks/discovery/public
```

This REST call is completely decoupled from whatever `read_networks` returned to the LLM. Even if the LLM tool ranks networks perfectly, the panel ignores that ranking.

**Design decision (confirmed):** Extend the `networks_panel` fenced block to carry a JSON payload:
```
```networks_panel
{"orderedNetworkIds": ["uuid1", "uuid2", ...]}
```
```

Update `ChatContent.tsx` and `onboarding/page.tsx` parsers to extract `orderedNetworkIds`. Pass it to `NetworksPanel` as a prop. `NetworksPanel` sorts its fetched list by that order (with unranked networks appended at the end).

### 3. User context available in the read_networks tool handler

`ResolvedToolContext` (`packages/protocol/src/shared/agent/tool.helpers.ts:64`) is the `context` argument injected into every tool handler. At step 6 of onboarding, it contains:

| Field | Type | Value at step 6 |
|---|---|---|
| `context.isOnboarding` | `boolean` | `true` (user not yet completed) |
| `context.user` | `UserRecord` | Has `location?: string \| null`, `name`, `intro` |
| `context.user.location` | `string \| null` | Populated if enriched from LinkedIn; otherwise null |
| `context.userProfile` | `ProfileDocument \| null` | Non-null — profile created at steps 2–4 |
| `context.userProfile.identity` | `{ name, bio, location }` | Location mirrors `users.location` |
| `context.userProfile.attributes` | `{ skills: string[], interests: string[] }` | Rich signal |
| `context.userNetworks` | `NetworkMembership[]` | Includes personal index (`isPersonal: true`) |

`ProfileDocument` schema (`packages/protocol/src/shared/schemas/profile.schema.ts:9-30`):
```ts
identity: { name: string, bio: string, location: string }
narrative: { context: string }
attributes: { interests: string[], skills: string[] }
```

`UserRecord` (`packages/protocol/src/shared/interfaces/database.interface.ts:109-122`):
```ts
{ id, name, email, intro?, avatar?, location?: string | null, socials, onboarding?, isGhost? }
```

Both `context.user.location` and `context.userProfile.identity.location` are available without additional DB calls. The profile is confirmed at step 4 (`create_user_profile(confirm=true)`), so `context.userProfile` is reliably non-null by step 6.

The outer `createNetworkTools(defineTool, deps)` function (`network.tools.ts:9`) captures `deps: ToolDeps`, which includes `deps.userDb: UserDatabase` for contact lookups if needed.

### 4. network graph returns prompt field — LLM-ready content exists

`network.graph.ts:readNode` (`packages/protocol/src/network/network.graph.ts:35-42`) calls `getPublicIndexesNotJoined(userId)` whose interface contract (`database.interface.ts:934-942`) returns:
```ts
{ networks: Array<{ id, title, prompt: string | null, memberCount, owner }> }
```

The `prompt` field is the network's purpose/description. It IS included in the result and mapped to the `publicNetworks` array at `network.graph.ts:108-116`.

`network.tools.ts:11-22` then calls `enrichWithContext()` which adds `renderedContext` via `renderNetworkContext()`:
- For community networks: `"## {title}\n\n{prompt}"` — clean LLM-ready markdown
- For event networks: includes dates, location, themes, upcoming events table

These `renderedContext` strings are what a `NetworkRecommender` LLM agent would use to score each network against the user's profile.

### 5. location schema already exists — collection step is the only gap

`backend/src/schemas/database.schema.ts:92`:
```ts
location: text('location'),
```

This column exists. No migration is needed for the storage. The interface `database.interface.ts:565` already includes `location` in `updateUser()`:
```ts
updateUser(userId, data: { name?, intro?, location?, onboarding? })
```

`profile.tools.ts:167` writes to it via `updateUser({ location: profile.identity.location })` when the profile is confirmed. However this only fires when enrichment found a location (e.g., from LinkedIn). For name-only users, `user.location` is null at step 6.

**Decision (confirmed):** Add a new onboarding sub-step between step 5 (Gmail) and step 6 (communities) in `chat.prompt.ts` that asks for city/region. The LLM writes it via an existing tool — likely `update_user_profile` or a direct `updateUser` call through a new or extended tool.

Check whether `profile.tools.ts` already has an update path that accepts explicit location: `profile.tools.ts:579` shows `location: z.string().optional()` in the `create_user_profile` querySchema — **the LLM can pass `location` directly to `create_user_profile`** even after profile confirmation. This may be the simplest collection mechanism: the LLM calls `create_user_profile(location="Berlin, Germany")` and the `updateUser` write fires.

### 6. Canonical pattern for a standalone LLM scoring agent

`packages/protocol/src/intent/intent.indexer.ts` is the closest model:

```ts
// Module-level model init (intent.indexer.ts:27)
const model = createModel("intentIndexer");

// Class with structured output (intent.indexer.ts:81-118)
export class IntentIndexer {
  private model = createModel("intentIndexer").withStructuredOutput(OutputSchema, { name: "intent_indexer" });

  async invoke(input): Promise<IntentIndexerOutput | null> {
    const raw = await invokeWithAbortSignal(this.model, [
      new SystemMessage(systemPrompt),
      new HumanMessage(renderInput(input)),
    ]);
    return OutputSchema.safeParse(raw).data ?? null;
  }
}
```

A `NetworkRecommender` class in `packages/protocol/src/network/network.recommender.ts` would follow this pattern exactly:
- `createModel("networkRecommender")` — add entry to `model.config.ts:getModelConfig()`
- `OutputSchema = z.object({ rankedNetworkIds: z.array(z.string()), reasoning: z.string() })`
- Input: user profile + interests + location + contact names, plus array of `{ networkId, renderedContext }` for each public network
- Called from the `read_networks` handler when `context.isOnboarding && context.userProfile` is truthy
- Fallback: if the call fails/throws, return the original unranked list

The `IntentIndexer` is NOT injected via `ToolDeps` — it's instantiated at module level or inside the graph. For a tool-level call, the `NetworkRecommender` can be instantiated inside the `read_networks` handler directly (stateless pattern, same as `IntentIndexer`).

### 7. Contact overlap signal — requires an extra DB call

Contacts are members of the user's personal index (`isPersonal: true` in `context.userNetworks`). To get contact IDs for network overlap scoring:
1. Find `personalNetwork = context.userNetworks.find(n => n.isPersonal)`
2. Call `deps.database.getNetworkMemberships(personalNetwork.networkId)` — returns all contact `userId`s
3. For each candidate public network, check if any contact `userId` is a member

Step 3 requires a separate query per public network (or a batch query). This is non-trivial and may add noticeable latency. The `NetworkRecommender` can receive a pre-fetched contact summary instead of requiring the tool to resolve all network memberships inline.

**Pragmatic approach:** Pass contacts only as names/identifiers into the LLM prompt for qualitative scoring ("user knows people in the Web3 space"), rather than doing exact member-overlap counting. The LLM uses this as a soft signal, not a hard filter.

---

## Code References

- `frontend/src/app/onboarding/page.tsx:88` — onboarding `parseAllBlocks` regex — MISSING `networks_panel`
- `frontend/src/components/ChatContent.tsx:106` — correct regex with `networks_panel`
- `frontend/src/components/ChatContent.tsx:121` — `networks_panel` pushed as `{ type: "networks_panel" }` — no data
- `frontend/src/components/ChatContent.tsx:327-333` — `NetworksPanel` rendered with no props from the block
- `frontend/src/components/chat/NetworksPanel.tsx:35-39` — independent REST fetch `discoverPublicIndexes(1, 50)`
- `packages/protocol/src/chat/chat.prompt.ts:128-138` — step 6 onboarding: calls `read_networks()`, emits `networks_panel`
- `packages/protocol/src/chat/chat.prompt.ts:144-152` — step 7 intent capture (after step 6 — intent not yet available at ranking time)
- `packages/protocol/src/network/network.tools.ts:24-87` — `read_networks` tool handler
- `packages/protocol/src/network/network.tools.ts:11-22` — `enrichWithContext` adds `renderedContext` via `renderNetworkContext`
- `packages/protocol/src/network/network.graph.ts:35-42` — `readNode` calls `getPublicIndexesNotJoined`
- `packages/protocol/src/network/network.graph.ts:108-116` — maps to `publicNetworks` array with `prompt` field
- `packages/protocol/src/network/network.state.ts` — `NetworkGraphState` — no scoring fields today
- `packages/protocol/src/shared/agent/tool.helpers.ts:64-98` — `ResolvedToolContext` interface
- `packages/protocol/src/shared/agent/tool.helpers.ts:420-530` — `ToolDeps` interface
- `packages/protocol/src/shared/schemas/profile.schema.ts:9-30` — `ProfileDocument` shape
- `packages/protocol/src/shared/interfaces/database.interface.ts:109-122` — `UserRecord` with `location`
- `packages/protocol/src/shared/interfaces/database.interface.ts:934-942` — `getPublicIndexesNotJoined` return shape
- `packages/protocol/src/shared/interfaces/database.interface.ts:565` — `updateUser` with `location` param
- `packages/protocol/src/shared/agent/model.config.ts:36-64` — `getModelConfig` — add `networkRecommender` entry here
- `packages/protocol/src/intent/intent.indexer.ts:1-90` — canonical scoring agent pattern to model after
- `packages/protocol/src/shared/network/metadata.renderer.ts` — `renderNetworkContext` — LLM-ready markdown per network
- `backend/src/schemas/database.schema.ts:92` — `users.location: text('location')` — column exists, no migration needed
- `backend/src/controllers/network.controller.ts:856` — `GET /networks/discovery/public` — same unranked data
- `backend/src/adapters/database.adapter.ts:1457-1538` — `getPublicIndexesNotJoined` — flat query, no ranking
- `packages/protocol/src/profile/profile.tools.ts:167` — `updateUser({ location })` write on profile confirm
- `packages/protocol/src/profile/profile.tools.ts:579` — `location: z.string().optional()` in `create_user_profile` query schema

---

## Integration Points

### Inbound References
- `packages/protocol/src/chat/chat.prompt.ts:128` — LLM calls `read_networks()` during step 6; receives ranked `publicNetworks` in return
- `packages/protocol/src/chat/chat.prompt.modules.ts:293` — `read_networks` is in the networks module trigger list
- `frontend/src/app/onboarding/page.tsx:88` — needs `networks_panel` added to regex + render case
- `frontend/src/components/ChatContent.tsx:106,121,327` — needs `networks_panel` block payload parsing + `orderedNetworkIds` prop forwarding
- `frontend/src/components/chat/NetworksPanel.tsx:35` — needs `orderedNetworkIds?: string[]` prop + sort logic

### Outbound Dependencies
- `packages/protocol/src/network/network.tools.ts:44` → `graphs.index.invoke()` → `NetworkGraphFactory.readNode`
- `packages/protocol/src/network/network.graph.ts:38` → `database.getPublicIndexesNotJoined(userId)`
- New: `NetworkRecommender.invoke()` — new class to add at `packages/protocol/src/network/network.recommender.ts`
- New: `model.config.ts:getModelConfig()` — add `networkRecommender` entry

### Infrastructure Wiring
- `packages/protocol/src/shared/agent/tool.helpers.ts:420` — `ToolDeps.graphs.index` is the compiled `NetworkGraphFactory` graph
- `packages/protocol/src/shared/agent/model.config.ts:36` — `getModelConfig()` — central model registry
- `backend/src/controllers/network.controller.ts:856` — REST path for `NetworksPanel` — can remain unranked for now (panel sorted client-side by `orderedNetworkIds`)

---

## Architecture Insights

1. **Onboarding page has a shadow copy of `parseAllBlocks`** — the onboarding page duplicates the message-parsing logic from `ChatContent` rather than importing it. Any new block types added to `ChatContent.tsx` must also be added to `onboarding/page.tsx` manually. This is an existing duplication risk.

2. **`networks_panel` block is a stateless signal today** — unlike `opportunity` and `intent_proposal` blocks which carry full JSON payloads, `networks_panel` carries no data. Extending it to carry `orderedNetworkIds` follows the same JSON-in-fenced-block pattern as the other two types.

3. **`read_networks` tool has all needed context without extra DB calls** — `ResolvedToolContext.userProfile` (profile bio, skills, interests, location) and `ResolvedToolContext.user.location` are both pre-loaded. The scoring agent doesn't need to call `userDb` for the core profile/interest/location signals. Contact names require one extra call to get personal-index members.

4. **`IntentIndexer` is the canonical scoring agent pattern** — module-level `createModel()`, class with `withStructuredOutput`, `invokeWithAbortSignal`. A `NetworkRecommender` replicates this exactly. The new model name entry in `model.config.ts` is the only wiring addition needed.

5. **location column exists, only explicit collection step is missing** — no schema migration needed. The `create_user_profile` query schema already accepts `location?: string` (profile.tools.ts:579), so the LLM can capture and write location as part of its existing tool set without a new tool.

6. **Signal timing constraint is real but bounded** — at step 6, intent (step 7) is not yet captured. The available signals are: profile interests/skills/bio, user location, and contacts. These are sufficient for a meaningful first-pass recommendation. Intent signals can improve follow-up suggestions post-onboarding.

7. **`renderNetworkContext` produces LLM-ready markdown** — the `renderedContext` field already on each `publicNetwork` in the tool result is a well-formatted description of the network's title, prompt, and (for events) dates/location/themes. The recommender can use this directly without formatting work.

---

## Precedents & Lessons

No similar precedents found via git history sweep (agents failed to return results). Composite lessons from code structure:

### Composite Lessons
- The `IntentIndexer` scoring agent pattern (module-level model, withStructuredOutput, invokeWithAbortSignal) is used in 10+ places. Always follow this pattern for new standalone LLM scorers.
- Any new block type added to `ChatContent.tsx:106` MUST be simultaneously added to `onboarding/page.tsx:88`. The pages share a conceptual contract but not the code.
- Tools that fire during onboarding can use `context.isOnboarding` to gate onboarding-specific behavior cleanly without branching the tool's general behavior.

---

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-10_18-43-13_onboarding-network-recommendation.md` — FRD covering current state documentation and initial design decisions for this feature

---

## Developer Context

**Q (discover: Structural facts confirmed)**: `chat.prompt.ts:128` + `NetworksPanel.tsx:35` + `database.adapter.ts:1457` — all confirmed.
A: All four structural facts confirmed.

**Q (discover: LLM scoring architecture)**: `network.tools.ts:24` — LLM scores inside `read_networks`
A: LLM scores inside `read_networks`

**Q (discover: Recommendation signals)**: Interests/work domain + stated intent + location + Gmail contacts overlap
A: All four signals confirmed; intent timing constraint means intent is unavailable at step 6.

**Q (discover: Location collection)**: Collect inline during onboarding — new `chat.prompt.ts` step + field
A: Confirmed. Schema column exists. `create_user_profile` query schema accepts `location` parameter (profile.tools.ts:579) — no new tool needed.

**Q (discover: Step 7 intent timing)**: At step 6, intent (step 7) not yet captured.
A: Confirmed structural constraint. Profile + location + contacts are the available signals.

**Q (`onboarding/page.tsx:88`)**: `networks_panel` is missing from the onboarding `parseAllBlocks` regex — is this the bug the other session is fixing?
A: Yes. Other session owns the fix. This research documents it as a known dependency.

**Q (`ChatContent.tsx:121`)**: `networks_panel` carries no payload — ranking cannot flow to the panel today. Which path should fix this?
A: Extend the fenced block with `{"orderedNetworkIds": [...]}` payload. Update parsers and `NetworksPanel` to sort by it. REST endpoint can remain unranked (sort applied client-side).

**Q (`database.schema.ts:92`)**: `users.location` column already exists. Only explicit collection step is needed. Add it?
A: Yes. Add location collection sub-step to onboarding prompt between step 5 and step 6. Use existing `create_user_profile(location="...")` call.

---

## Related Research
- `.rpiv/artifacts/discover/2026-06-10_18-43-13_onboarding-network-recommendation.md`

---

## Open Questions

1. Should the `NetworksPanel` REST fetch (`/networks/discovery/public`) also return a ranked list for non-onboarding contexts, or is client-side sorting by `orderedNetworkIds` sufficient long-term?

2. Are network `prompt` fields populated with enough semantic content across all existing public networks to make LLM scoring useful? If many prompts are empty/null (`prompt: string | null` at `database.interface.ts:937`), the recommender needs a graceful degradation — e.g., rank by member count when prompt is empty.

3. Contact overlap via personal-index member lookup adds a DB call. Should contacts be included in the first version of the recommender, or deferred to v2 once the core location + interests scoring is stable?
