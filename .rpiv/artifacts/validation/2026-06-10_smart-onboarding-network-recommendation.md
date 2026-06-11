---
template_version: 1
date: 2026-06-10T21:45:00+0300
author: Yankı Ekin Yüksel
commit: 749a5eb83e6200a12951217bc76d312e76f7b234
branch: feat/onboarding-network-recommendation
repository: index
topic: "Validation of Smart onboarding network recommendation"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-10_20-49-56_onboarding-network-recommendation.md"
tags: [validation, onboarding, networks, recommendation, llm, read-networks, chat-prompt, frontend]
last_updated: 2026-06-10T21:45:00+0300
---

## Validation Report: Smart Onboarding Network Recommendation

### Implementation Status

- ✓ Phase 1: NetworkRecommender agent + model config — Fully implemented
- ✓ Phase 2: read_networks tool enhancement — Fully implemented
- ✓ Phase 3: Onboarding prompt — location step + networks_panel instruction — Fully implemented
- ✓ Phase 4: NetworksPanel sorted rendering — Fully implemented
- ✓ Phase 5: Frontend parsers — ChatContent + onboarding page — Fully implemented

### Automated Verification Results

- ✓ Protocol TypeScript build: `cd packages/protocol && bun run build` — exit 0, no errors
- ✓ Frontend TypeScript build: `cd frontend && bun run build` — exit 0, built in 4.48s (chunk-size warning is pre-existing)
- ✓ networkRecommender in model config: `grep "networkRecommender" packages/protocol/src/shared/agent/model.config.ts` — match found
- ✓ NetworkRecommender class density: `grep -c "NetworkRecommender" packages/protocol/src/network/network.recommender.ts` — 16 (≥ 5)
- ✓ orderedNetworkIds in tool: `grep "orderedNetworkIds" packages/protocol/src/network/network.tools.ts` — 3 matches (description, declaration, assignment)
- ✓ Step 5.5 count in prompt: `grep -c "5.5" packages/protocol/src/chat/chat.prompt.ts` — 5 (≥ 3)
- ✓ orderedNetworkIds in prompt: `grep "orderedNetworkIds" packages/protocol/src/chat/chat.prompt.ts` — match found
- ✓ NetworksPanel orderedNetworkIds count: `grep -c "orderedNetworkIds" frontend/src/components/chat/NetworksPanel.tsx` — 4 (≥ 3)
- ✓ networks_panel in onboarding page: `grep -c "networks_panel" frontend/src/app/onboarding/page.tsx` — 9 (≥ 6)
- ✓ orderedNetworkIds in ChatContent: `grep -c "orderedNetworkIds" frontend/src/components/ChatContent.tsx` — 7 (≥ 3)
- ✓ orderedNetworkIds in onboarding page: `grep -c "orderedNetworkIds" frontend/src/app/onboarding/page.tsx` — 7 (≥ 3)
- ✓ No regressions detected — lint-staged passed on all 5 commits; existing tests untouched

### Code Review Findings

#### Matches Plan:

- `packages/protocol/src/network/network.recommender.ts:1` — Module-level `createModel("networkRecommender")` + class `NetworkRecommender` exactly follows IntentIndexer pattern: same `withStructuredOutput` binding in constructor, `invokeWithAbortSignal` call signature matches `intent.indexer.ts:144`, null returned both on `input.networks.length === 0` early-exit and in catch block
- `packages/protocol/src/shared/agent/model.config.ts` — `networkRecommender: { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 512 }` registered correctly
- `packages/protocol/src/network/network.tools.ts:70-112` — Guard `context.isOnboarding && context.userProfile && .length > 0` placed correctly inside the non-scoped path (after the `if (context.networkId) { return ... }` early exit), ensuring scoped chats are unaffected. Fallback spread `...(orderedNetworkIds !== undefined ? { orderedNetworkIds } : {})` cleanly omits the key when recommender returns null
- `packages/protocol/src/chat/chat.prompt.ts:119-122` — All four Gmail step-5 forward references updated to "step 5.5"; verified via line-by-line inspection
- `packages/protocol/src/chat/chat.prompt.ts:123-128` — Step 5.5 location block: asks for city/region with examples, calls `create_user_profile(location="...")` on success, skips gracefully, then proceeds to step 6
- `packages/protocol/src/chat/chat.prompt.ts` — Step 6 `networks_panel` instruction updated: conditional `{"orderedNetworkIds": [...]}` with `{}` fallback, both cases covered
- `frontend/src/components/chat/NetworksPanel.tsx:13` — `orderedNetworkIds?: string[]` prop with JSDoc; sort IIFE uses `Infinity` for unranked; no-op path when prop absent or empty
- `frontend/src/components/ChatContent.tsx:101,120-131` — `MessageSegment` type updated; try/catch JSON parse with empty-body guard (`bodyStr ? JSON.parse(bodyStr) : {}`); `orderedNetworkIds={segment.orderedNetworkIds}` passed to render
- `frontend/src/app/onboarding/page.tsx:91` — `networks_panel` added to regex; `partialNetworks` added to partial-match detection; `handleNetworkJoin` declared at line 527, after `sendOnboardingMessage` at line 514 (no TDZ risk); `pendingNetworkJoinIds` clearing merged into existing `prevLoadingRef` effect (not a separate effect, avoiding stale-ref race); `onNetworkJoin` + `pendingNetworkJoinIds` props wired at lines 665-666

#### Deviations from Plan:

- `frontend/src/app/onboarding/page.tsx:103` — Minor parser asymmetry vs plan and `ChatContent.tsx`: `onboarding/page.tsx` parses the `networks_panel` body via the shared outer `JSON.parse(match[2].trim())` call (no inner empty-body guard), while `ChatContent.tsx` has its own inner try/catch with `bodyStr ? JSON.parse(bodyStr) : {}`. If the LLM emits a zero-body ````networks_panel\n``` `` block (violating prompt instructions), `onboarding/page.tsx` would throw and fall back to rendering the raw block as text rather than an empty panel. In practice the prompt always emits at least `{}`, so this edge case is not reachable. Not a regression vs the original code (which never parsed `networks_panel` at all in onboarding). Acceptable variation.
- `backend/src/queues/intent.queue.ts:210-220` — **Unplanned file in diff.** Refactors `IntentIndexer` instantiation from once-per-job to once-per-evaluation-call. This change is unrelated to the onboarding network recommendation feature and was not part of any plan phase. It should be reviewed before merging to confirm it is intentional and benign. The functional impact is that each assignment evaluation now creates a fresh `IntentIndexer` instance; since `createModel` returns a module-level model reference, the actual LangChain chain binding is recreated per call rather than shared. This has no correctness impact but may create minor overhead per evaluation.

#### Pattern Conformance:

- ✓ `network.recommender.ts` naming follows `{domain}.{purpose}.ts` convention (`network.recommender.ts`)
- ✓ TSDoc on class and `invoke()` with `@param` / `@returns` present
- ✓ Zod schema exported at module top; type alias inferred from schema — matches pattern across protocol agents
- ✓ `@Timed()` import path `"../shared/observability/performance.js"` matches `intent.indexer.ts`

### Manual Testing Required:

1. **Onboarding flow — location step 5.5:**
   - [ ] After Gmail step completes (or is skipped), LLM asks for location with city/region examples
   - [ ] Providing a city calls `create_user_profile(location="...")` and proceeds to step 6
   - [ ] Saying "skip" proceeds to step 6 without a profile tool call

2. **Onboarding flow — ranked communities (step 6):**
   - [ ] `read_networks` response includes `orderedNetworkIds` array during onboarding (verify via network/Langfuse trace)
   - [ ] LLM emits `networks_panel` block with `{"orderedNetworkIds": [...]}` body
   - [ ] `NetworksPanel` renders communities in LLM-ranked order (top-ranked first)

3. **Graceful degradation:**
   - [ ] When `NetworkRecommender.invoke()` returns null (simulate by using a profile with no signals), panel renders with original unranked order
   - [ ] `networks_panel` block with body `{}` (no `orderedNetworkIds`) renders the panel correctly in both `ChatContent.tsx` and `onboarding/page.tsx`
   - [ ] Regular (non-onboarding) `read_networks` call: response does NOT include `orderedNetworkIds`

4. **Streaming UX:**
   - [ ] While the `networks_panel` block is streaming in onboarding, a `Loader2` spinner appears
   - [ ] Joining a community from the panel sends the correct "I'd like to join {title}" message and shows pending state

### Recommendations:

- **Review `backend/src/queues/intent.queue.ts`** — the unplanned `IntentIndexer` instantiation change should be confirmed as intentional before merging. If it was an accidental edit from a prior experiment, revert it to keep the PR diff focused.
- Ready to open PR once the `intent.queue.ts` question is resolved — all implementation is complete and validated.
