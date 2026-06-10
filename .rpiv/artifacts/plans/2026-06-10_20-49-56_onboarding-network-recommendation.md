---
date: 2026-06-10T20:49:56+0300
author: Yankı Ekin Yüksel
commit: d412679115
branch: feat/onboarding-network-recommendation
repository: index
topic: "Smart onboarding network recommendation"
tags: [plan, onboarding, networks, recommendation, llm, read-networks, chat-prompt, frontend]
status: ready
parent: .rpiv/artifacts/research/2026-06-10_19-00-17_onboarding-network-recommendation.md
phase_count: 5
phases:
  - { n: 1, title: NetworkRecommender agent + model config }
  - { n: 2, title: read_networks tool enhancement }
  - { n: 3, title: Onboarding prompt — location step + networks_panel instruction }
  - { n: 4, title: NetworksPanel sorted rendering }
  - { n: 5, title: Frontend parsers — ChatContent + onboarding page }
unresolved_phase_count: 0
last_updated: 2026-06-10T20:49:56+0300
last_updated_by: Yankı Ekin Yüksel
---

# Smart Onboarding Network Recommendation — Implementation Plan

## Overview

Adds LLM-based network recommendation to the onboarding flow. A new `NetworkRecommender` agent scores public networks against the user's profile (interests, skills, bio, location) inside the `read_networks` tool, guarded by `context.isOnboarding`. The ranked IDs are returned to the LLM, which includes them in the `networks_panel` fenced block as `{"orderedNetworkIds": [...]}`. Frontend parsers and `NetworksPanel` are updated to extract and apply the ordering. A new location-collection step (5.5) is added to the onboarding prompt to ensure location is available for all users.

## Requirements

- LLM-based network recommendation during onboarding step 6 using profile interests/skills/bio + location
- `networks_panel` block extended to carry `{"orderedNetworkIds": [...]}` — sorted list flows end-to-end
- New onboarding step 5.5: asks user for location, persists via `create_user_profile(location="...")`
- `onboarding/page.tsx` fully updated: `networks_panel` added to regex + `orderedNetworkIds` parsing + panel rendering
- Graceful fallback: if `NetworkRecommender` fails, unranked list is returned and onboarding continues
- No schema migration needed (`users.location` column already exists)
- Contacts signal deferred to v2

## Current State Analysis

### Key Discoveries

- `frontend/src/app/onboarding/page.tsx:88` — `parseAllBlocks` regex only matches `opportunity|intent_proposal` — `networks_panel` is missing, panel never renders in onboarding
- `frontend/src/components/ChatContent.tsx:121` — `networks_panel` parsed as zero-payload `{ type: "networks_panel" }` — JSON body `{}` currently ignored
- `frontend/src/components/ChatContent.tsx:327-333` — `NetworksPanel` rendered with no props
- `frontend/src/components/chat/NetworksPanel.tsx:35-39` — fetches from REST `discoverPublicIndexes(1, 50)` independently of LLM tool result
- `packages/protocol/src/chat/chat.prompt.ts:128-138` — step 6 instructs LLM to emit `` ```networks_panel\n{}\n``` `` — already `{}` body, just not parsed
- `packages/protocol/src/network/network.tools.ts:24-87` — `read_networks` handler: calls `graphs.index.invoke()`, enriches `publicNetworks` with `renderedContext` (LLM-ready markdown), returns JSON
- `packages/protocol/src/shared/agent/tool.helpers.ts:64-98` — `ResolvedToolContext` has `context.userProfile` (profile identity/attributes), `context.user.location`, `context.isOnboarding`
- `packages/protocol/src/intent/intent.indexer.ts:27,81` — canonical scoring agent pattern: module-level `createModel`, class with `withStructuredOutput`, `invokeWithAbortSignal`, null-on-error
- `packages/protocol/src/shared/agent/model.config.ts:36-64` — `getModelConfig()` registers all agent model names
- `backend/src/schemas/database.schema.ts:92` — `users.location: text('location')` already exists
- `packages/protocol/src/profile/profile.tools.ts:785,804` — `create_user_profile` accepts `location` param and writes via `updateUser({ location })`

## Desired End State

```ts
// NetworkRecommender — new scoring agent (Slice 1)
const recommender = new NetworkRecommender();
const result = await recommender.invoke({
  profile: { bio: "...", interests: ["AI", "DeSci"], skills: ["TypeScript"], location: "Berlin" },
  networks: [{ networkId: "uuid1", renderedContext: "## DeSci Berlin\n..." }, ...]
});
// result: { rankedNetworkIds: ["uuid1", "uuid2", ...], reasoning: "..." } | null

// read_networks returns orderedNetworkIds (Slice 2)
// → LLM emits in step 6:
// ```networks_panel
// {"orderedNetworkIds": ["uuid1", "uuid2"]}
// ```

// ChatContent.tsx parses orderedNetworkIds (Slice 5)
// → segment: { type: "networks_panel", orderedNetworkIds: ["uuid1", "uuid2"] }
// → <NetworksPanel orderedNetworkIds={["uuid1", "uuid2"]} />

// NetworksPanel sorts by orderedNetworkIds (Slice 4)
// → UUID1 first, UUID2 second, rest appended in original order
```

## What We're NOT Doing

- No contacts overlap signal in v1 (deferred — requires personal-index member fetch)
- No ranking for non-onboarding contexts (`read_networks` in regular chat unaffected)
- No changes to `GET /networks/discovery/public` REST endpoint (client-side sort sufficient)
- No new schema migrations
- Not changing the `NetworksPanel` visual design (only sort logic added)

## Decisions

### NetworkRecommender agent architecture
**Ambiguity**: Where to add LLM scoring — inside a new graph node, or directly in the tool handler as a standalone agent?
**Explored**:
- Option A: New `NetworkScorerAgent` added to `NetworkGraphFactory` — would require new graph state fields and a new node, higher blast radius
- Option B: Standalone class in `network.recommender.ts`, called from tool handler when `context.isOnboarding` — follows `IntentIndexer` pattern exactly, contained, no graph changes
**Decision**: Option B — `NetworkRecommender` class, module-level `createModel("networkRecommender")`, called inside `read_networks` handler gated by `context.isOnboarding && context.userProfile`
**Evidence**: `packages/protocol/src/intent/intent.indexer.ts:27,81`

### Scoring signals (v1)
**Decision**: Profile interests/skills/bio + `context.user.location` only. Contacts deferred to v2.
**Evidence**: developer confirmed in checkpoint; contacts require extra DB call (`deps.database.getNetworkMemberships`)

### networks_panel block format
**Decision**: Extend from `{}` to `{"orderedNetworkIds": [...]}`. LLM prompt instructs to fill from `orderedNetworkIds` in `read_networks` response. Parsers updated to extract.
**Evidence**: `chat.prompt.ts:133` already instructs `{}` body; `ChatContent.tsx:121` currently ignores the body

### Location collection
**Decision**: New step 5.5 in `chat.prompt.ts` between Gmail (step 5) and community discovery (step 6). LLM asks for location and calls `create_user_profile(location="...")` to persist. Uses existing tool support.
**Evidence**: `profile.tools.ts:785,804` — `create_user_profile` already accepts and persists `location`

### onboarding/page.tsx scope
**Decision**: Full fix included in this plan — `networks_panel` added to regex + `orderedNetworkIds` parsing + `NetworksPanel` rendering case + `LocalMessage` segment type update. Supersedes other session's partial fix.

---

## Phase 1: NetworkRecommender agent + model config

### Overview
Creates the scoring agent class and registers its model name. Foundation for all subsequent phases. No cross-phase dependencies.

### Changes Required:

#### 1. packages/protocol/src/network/network.recommender.ts
**File**: packages/protocol/src/network/network.recommender.ts
**Changes**: NEW — LLM scoring agent that ranks public networks against a user's profile

```ts
import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { log } from "../shared/observability/log.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

// ─── Response schema ───────────────────────────────────────────────────────────

export const NetworkRecommenderOutputSchema = z.object({
  rankedNetworkIds: z
    .array(z.string())
    .describe("Network IDs ordered from most to least relevant for this user. Include all provided network IDs."),
  reasoning: z
    .string()
    .describe("One-sentence explanation of the top recommendation."),
});

export type NetworkRecommenderOutput = z.infer<typeof NetworkRecommenderOutputSchema>;

// ─── Input types ──────────────────────────────────────────────────────────────

export interface NetworkRecommenderUserProfile {
  bio: string;
  location: string;
  interests: string[];
  skills: string[];
}

export interface NetworkRecommenderNetwork {
  networkId: string;
  renderedContext: string;
}

export interface NetworkRecommenderInput {
  userProfile: NetworkRecommenderUserProfile;
  networks: NetworkRecommenderNetwork[];
}

// ─── Logger ───────────────────────────────────────────────────────────────────

const logger = log.lib.from("NetworkRecommender");

// ─── System prompt ────────────────────────────────────────────────────────────

const systemPrompt = `
You are a community matching agent for a social discovery network.

TASK:
Given a user's profile and a list of communities, rank the communities from most to least relevant for this user.
Return ALL provided community IDs in ranked order.

INPUTS:
1. User Profile: bio, location, interests, and skills.
2. Communities: a list of communities, each with an ID and a description.

SCORING FACTORS (in priority order):
1. Thematic alignment — do the community's topics match the user's interests and skills?
2. Geographic relevance — does the user's location match the community's focus (if any)?
3. Professional fit — does the community's purpose match the user's professional background?

OUTPUT RULES:
- Return ALL community IDs in your ranked list (no omissions).
- If context is insufficient to differentiate, preserve original order.
- Keep reasoning brief (one sentence about the top recommendation).
`;

// ─── Model ────────────────────────────────────────────────────────────────────

const model = createModel("networkRecommender");

// ─── Agent class ──────────────────────────────────────────────────────────────

/**
 * LLM-based agent that ranks public communities against a user's profile.
 * Used during onboarding step 6 to surface the most relevant communities first.
 *
 * Modeled after IntentIndexer: module-level createModel, withStructuredOutput,
 * invokeWithAbortSignal, null-on-error fallback.
 */
export class NetworkRecommender {
  private model: ReturnType<ChatOpenAI["withStructuredOutput"]>;

  constructor() {
    this.model = model.withStructuredOutput(NetworkRecommenderOutputSchema, {
      name: "network_recommender",
    });
  }

  /**
   * Ranks the provided networks by relevance to the user's profile.
   *
   * @param input - User profile and list of networks with rendered context.
   * @returns Ranked network IDs and one-sentence reasoning, or null on error.
   */
  @Timed()
  public async invoke(input: NetworkRecommenderInput): Promise<NetworkRecommenderOutput | null> {
    if (input.networks.length === 0) return null;

    logger.verbose("[NetworkRecommender.invoke] Ranking communities", {
      networkCount: input.networks.length,
    });

    const networkList = input.networks
      .map((n, i) => `### Community ${i + 1} (ID: ${n.networkId})\n${n.renderedContext}`)
      .join("\n\n");

    const userSection = [
      `**Bio**: ${input.userProfile.bio || "(not provided)"}`,
      `**Location**: ${input.userProfile.location || "(not provided)"}`,
      `**Interests**: ${input.userProfile.interests.join(", ") || "(not provided)"}`,
      `**Skills**: ${input.userProfile.skills.join(", ") || "(not provided)"}`,
    ].join("\n");

    const prompt = `## User Profile\n${userSection}\n\n## Communities to Rank\n${networkList}`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt),
    ];

    try {
      const result = await invokeWithAbortSignal(this.model, messages);
      const parsed = NetworkRecommenderOutputSchema.safeParse(result);
      if (!parsed.success) {
        logger.error("[NetworkRecommender] Schema validation failed", { error: parsed.error });
        return null;
      }
      logger.verbose("[NetworkRecommender.invoke] Ranking complete", {
        top: parsed.data.rankedNetworkIds[0],
      });
      return parsed.data;
    } catch (error) {
      logger.error("[NetworkRecommender] Error during execution", { error });
      return null;
    }
  }
}
```

#### 2. packages/protocol/src/shared/agent/model.config.ts
**File**: packages/protocol/src/shared/agent/model.config.ts
**Changes**: MODIFY — add `networkRecommender` entry to `getModelConfig()`

```ts
    userContextGenerator: { model: "google/gemini-2.5-flash", temperature: 0.3, maxTokens: 512 },
    networkRecommender:   { model: "google/gemini-2.5-flash", temperature: 0.2, maxTokens: 512 },
    chat: {
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors: `cd packages/protocol && bun run build`
- [x] `grep "networkRecommender" packages/protocol/src/shared/agent/model.config.ts` returns a match
- [x] `grep -c "NetworkRecommender" packages/protocol/src/network/network.recommender.ts` returns >= 5 (16)

#### Manual Verification:
- [x] `NetworkRecommender` class in `network.recommender.ts` has `invoke()` returning `NetworkRecommenderOutput | null`
- [x] `createModel("networkRecommender")` resolves without TypeScript error

---

## Phase 2: read_networks tool enhancement

### Overview
Calls `NetworkRecommender` when `context.isOnboarding && context.userProfile` is truthy; adds `orderedNetworkIds` to the tool's return payload. Depends on Phase 1.

### Changes Required:

#### 1. packages/protocol/src/network/network.tools.ts
**File**: packages/protocol/src/network/network.tools.ts
**Changes**: MODIFY — import NetworkRecommender, add module-level instance, call it in read_networks handler when context.isOnboarding

```ts
// 1. ADD after existing imports (top of file):
import { NetworkRecommender } from "./network.recommender.js";

// 2. ADD after import block, before createNetworkTools:
const recommender = new NetworkRecommender();

// 3. MODIFY read_networks tool description — append to the existing "**Note:**" line:
      "**Note:** In index-scoped chats, only the scoped network is returned. During onboarding, `orderedNetworkIds` " +
      "is returned alongside `publicNetworks` \u2014 a ranked array of network IDs ordered by relevance to the user's profile.",

// 4. MODIFY handler — replace the final non-scoped return success line:
// OLD:
        return success({ ...enriched, _graphTimings: [{ name: 'index', durationMs: _readIndexGraphMs, agents: result.agentTimings ?? [] }] });
// NEW:
        // Onboarding-only: rank public networks by profile relevance.
        // Guard: only when isOnboarding, userProfile exists, not scoped, and there are public networks to rank.
        let orderedNetworkIds: string[] | undefined;
        if (
          context.isOnboarding &&
          context.userProfile &&
          Array.isArray(enriched.publicNetworks) &&
          (enriched.publicNetworks as Array<Record<string, unknown>>).length > 0
        ) {
          const publicNetworksForRanking = (enriched.publicNetworks as Array<Record<string, unknown>>).map((n) => ({
            networkId: n.networkId as string,
            renderedContext: (n.renderedContext as string) ?? `## ${n.title as string}`,
          }));
          const rankingResult = await recommender.invoke({
            userProfile: {
              bio: context.userProfile.identity.bio,
              location: context.userProfile.identity.location || context.user.location || "",
              interests: context.userProfile.attributes.interests,
              skills: context.userProfile.attributes.skills,
            },
            networks: publicNetworksForRanking,
          });
          if (rankingResult) {
            orderedNetworkIds = rankingResult.rankedNetworkIds;
          }
        }

        return success({
          ...enriched,
          ...(orderedNetworkIds !== undefined ? { orderedNetworkIds } : {}),
          _graphTimings: [{ name: 'index', durationMs: _readIndexGraphMs, agents: result.agentTimings ?? [] }],
        });
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors: `cd packages/protocol && bun run build`
- [x] `grep "NetworkRecommender" packages/protocol/src/network/network.tools.ts` returns matches for import and instantiation
- [x] `grep "orderedNetworkIds" packages/protocol/src/network/network.tools.ts` returns a match

#### Manual Verification:
- [x] When `context.isOnboarding` is false, `read_networks` response is identical to today (no `orderedNetworkIds` — guard requires `isOnboarding`)
- [x] When `context.isOnboarding` is true and `context.userProfile` is null, no ranking call fires (guard: `&& context.userProfile`)
- [x] When `publicNetworks` is empty, no ranking call fires (guard: `.length > 0`)

---

## Phase 3: Onboarding prompt — location step + networks_panel instruction

### Overview
Adds location-collection step 5.5 and updates step 6 to instruct the LLM to include `orderedNetworkIds` in the `networks_panel` block JSON body. Depends on Phase 2.

### Changes Required:

#### 1. packages/protocol/src/chat/chat.prompt.ts
**File**: packages/protocol/src/chat/chat.prompt.ts
**Changes**: MODIFY — update step 5 forward references, add step 5.5 location collection, update step 6 networks_panel instruction

```ts
// REPLACEMENT 1 — Update the four step 5 forward references from "step 6" to "step 5.5"
// Locate the Gmail step block and replace these four occurrences:

// OLD:
   - The button is how the user says "yes" — clicking it opens OAuth in a new window. When they complete it the app automatically continues — call \`import_gmail_contacts()\` again to finish the import, then proceed to step 6
   - If user says "skip", "skip for now", "no", "later", or any variant → proceed directly to step 6
   - If already connected (tool returns import stats immediately on the first call — user never went through the auth button): **skip to step 6 immediately. Do NOT write any text about Gmail, contacts, or the import. Your next sentence must be the step 6 intro.**
   - If the user just completed OAuth (you called \`import_gmail_contacts()\` a second time after auth): acknowledge the import with a brief summary, then proceed to step 6

// NEW:
   - The button is how the user says "yes" — clicking it opens OAuth in a new window. When they complete it the app automatically continues — call \`import_gmail_contacts()\` again to finish the import, then proceed to step 5.5
   - If user says "skip", "skip for now", "no", "later", or any variant → proceed directly to step 5.5
   - If already connected (tool returns import stats immediately on the first call — user never went through the auth button): **skip to step 5.5 immediately. Do NOT write any text about Gmail, contacts, or the import. Your next sentence must be the step 5.5 intro.**
   - If the user just completed OAuth (you called \`import_gmail_contacts()\` a second time after auth): acknowledge the import with a brief summary, then proceed to step 5.5

// REPLACEMENT 2 — Insert new step 5.5 before the ${ctx.networkId ? ...} conditional
// The blank line before that conditional becomes:

5.5. **Collect location**
   - Ask the user where they are based: "Where are you based? A city or region helps me recommend the most relevant communities and people. (e.g. 'Berlin', 'San Francisco', 'Remote' \u2014 or skip if you'd prefer not to share)"
   - When the user provides a location \u2192 call \`create_user_profile(location="[their answer]")\` to persist it, then proceed to step 6
   - If the user says "skip", "not sure", or any variant indicating they don't want to share \u2192 proceed directly to step 6 without persisting

// REPLACEMENT 3 — Update the networks_panel JSON instruction in step 6 (non-scoped branch only)
// OLD:
   - Then immediately output this block (do not include any JSON data \u2014 just the empty object):
     \`\`\`networks_panel
     {}
     \`\`\`
// NEW:
   - Then immediately output this block. If \`orderedNetworkIds\` was returned by \`read_networks()\`, include those IDs; otherwise use an empty object:
     \`\`\`networks_panel
     {"orderedNetworkIds": ["<paste exact UUIDs from orderedNetworkIds array>"]}
     \`\`\`
     If \`orderedNetworkIds\` was not returned, write instead:
     \`\`\`networks_panel
     {}
     \`\`\`
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors: `cd packages/protocol && bun run build`
- [x] `grep -c "5.5" packages/protocol/src/chat/chat.prompt.ts` returns >= 3 (5)
- [x] `grep "orderedNetworkIds" packages/protocol/src/chat/chat.prompt.ts` returns a match

#### Manual Verification:
- [x] Step 5 now says "proceed to step 5.5" in all four forward references
- [x] Step 5.5 location block appears between step 5 and step 6 in the prompt
- [x] Step 6 `networks_panel` instruction shows the conditional orderedNetworkIds JSON example

---

## Phase 4: NetworksPanel sorted rendering

### Overview
Adds `orderedNetworkIds?: string[]` prop to `NetworksPanel`; sorts the fetched networks by that order (unranked appended at end). Independent of Phases 1-3; can develop in parallel.

### Changes Required:

#### 1. frontend/src/components/chat/NetworksPanel.tsx
**File**: frontend/src/components/chat/NetworksPanel.tsx
**Changes**: MODIFY — add `orderedNetworkIds?: string[]` prop, sort joinable array by that order

```ts
// REPLACEMENT 1 — Update interface:
interface NetworksPanelProps {
  onJoin: (networkId: string, networkTitle: string) => void;
  pendingJoinIds?: Set<string>;
  /** Ranked network IDs from the LLM recommendation. Joinable networks are sorted by this order; unranked appended at end. */
  orderedNetworkIds?: string[];
}

// REPLACEMENT 2 — Update component params:
export default function NetworksPanel({ onJoin, pendingJoinIds = new Set(), orderedNetworkIds }: NetworksPanelProps) {

// REPLACEMENT 3 — Replace joinable assignment with sorted version:
  const joinable = (() => {
    const unfiltered = publicNetworks.filter((n) => !joinedIds.has(n.id));
    if (!orderedNetworkIds || orderedNetworkIds.length === 0) return unfiltered;
    const orderMap = new Map(orderedNetworkIds.map((id, i) => [id, i]));
    return [...unfiltered].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Infinity;
      const bi = orderMap.get(b.id) ?? Infinity;
      return ai - bi;
    });
  })();
```

### Success Criteria:

#### Automated Verification:
- [x] `cd frontend && bun run build` completes without TypeScript errors
- [x] `grep -c "orderedNetworkIds" frontend/src/components/chat/NetworksPanel.tsx` returns >= 3 (4)

#### Manual Verification:
- [x] `<NetworksPanel />` with no `orderedNetworkIds` prop: IIFE returns `unfiltered` unchanged
- [x] Sort IIFE: ranked IDs via `orderMap`, unranked get `Infinity` → appended at end
- [x] Networks not in `orderedNetworkIds` get `Infinity` index → sort to tail

---

## Phase 5: Frontend parsers — ChatContent + onboarding page

### Overview
Updates `ChatContent.tsx` and `onboarding/page.tsx` to parse `orderedNetworkIds` from the `networks_panel` block body and pass it to `NetworksPanel`. Depends on Phase 4.

### Changes Required:

#### 1. frontend/src/components/ChatContent.tsx
**File**: frontend/src/components/ChatContent.tsx
**Changes**: MODIFY — parse orderedNetworkIds from networks_panel block body; pass to NetworksPanel

```ts
// REPLACEMENT 1 — MessageSegment type:
// OLD:   | { type: "networks_panel" }
// NEW:
  | { type: "networks_panel"; orderedNetworkIds?: string[] }

// REPLACEMENT 2 — parseAllBlocks networks_panel branch (replace the one-liner push):
    if (blockType === "networks_panel") {
      try {
        const bodyStr = match[2].trim();
        const body = bodyStr ? (JSON.parse(bodyStr) as Record<string, unknown>) : {};
        const orderedNetworkIds =
          Array.isArray(body.orderedNetworkIds) &&
          (body.orderedNetworkIds as unknown[]).every((id) => typeof id === "string")
            ? (body.orderedNetworkIds as string[])
            : undefined;
        segments.push({ type: "networks_panel", orderedNetworkIds });
      } catch {
        segments.push({ type: "networks_panel" });
      }
    } else {

// REPLACEMENT 3 — render NetworksPanel (add orderedNetworkIds prop):
        } else if (segment.type === "networks_panel") {
          return (
            <div key={`networks-panel-${idx}`} className="my-3">
              <NetworksPanel
                onJoin={onNetworkJoin ?? (() => {})}
                pendingJoinIds={networkPanelPendingJoinIds}
                orderedNetworkIds={segment.orderedNetworkIds}
              />
            </div>
          );
```

#### 2. frontend/src/app/onboarding/page.tsx
**File**: frontend/src/app/onboarding/page.tsx
**Changes**: MODIFY — add networks_panel full support: import, types, parsing, partial detection, rendering, state, handler

```ts
// REPLACEMENT 1 — Merge Loader2 into existing lucide import:
import { ArrowUp, Loader2, Square } from "lucide-react";

// REPLACEMENT 2 — Add NetworksPanel import (after existing imports):
import NetworksPanel from "@/components/chat/NetworksPanel";

// REPLACEMENT 3 — MessageSegment type (add two new members):
type MessageSegment =
  | { type: "text"; content: string }
  | { type: "opportunity"; data: OpportunityCardData }
  | { type: "opportunity_loading" }
  | { type: "intent_proposal"; data: IntentProposalData }
  | { type: "intent_proposal_loading" }
  | { type: "networks_panel"; orderedNetworkIds?: string[] }
  | { type: "networks_panel_loading" };

// REPLACEMENT 4 — parseAllBlocks regex:
  const regex = /```(opportunity|intent_proposal|networks_panel)\s*\n([\s\S]*?)\n```/g;

// REPLACEMENT 5 — add networks_panel case in block-type handler (before the fallthrough):
        if (blockType === "opportunity" && data.opportunityId && data.userId) {
          segments.push({ type: "opportunity", data: data as OpportunityCardData });
        } else if (blockType === "intent_proposal" && data.proposalId) {
          segments.push({ type: "intent_proposal", data: data as IntentProposalData });
        } else if (blockType === "networks_panel") {
          const orderedNetworkIds =
            Array.isArray(data.orderedNetworkIds) &&
            (data.orderedNetworkIds as unknown[]).every((id) => typeof id === "string")
              ? (data.orderedNetworkIds as string[])
              : undefined;
          segments.push({ type: "networks_panel", orderedNetworkIds });
        } else {
          segments.push({ type: "text", content: match[0] });
        }

// REPLACEMENT 6 — partial match detection (add partialNetworks):
  const partialOpp = remaining.match(/```opportunity/);
  const partialIntent = remaining.match(/```intent_proposal/);
  const partialNetworks = remaining.match(/```networks_panel/);

  const candidates = ([partialOpp, partialIntent, partialNetworks] as (RegExpMatchArray | null)[]).filter(
    (c): c is RegExpMatchArray => c !== null,
  );

// REPLACEMENT 7 — partial match type dispatch:
    if (partialMatch === partialOpp) {
      segments.push({ type: "opportunity_loading" });
    } else if (partialMatch === partialNetworks) {
      segments.push({ type: "networks_panel_loading" });
    } else {
      segments.push({ type: "intent_proposal_loading" });
    }

// REPLACEMENT 8 — AssistantMessageContent props (add onNetworkJoin + pendingNetworkJoinIds):
function AssistantMessageContent({
  content,
  isStreaming,
  onOpportunityPrimaryAction,
  onOpportunitySecondaryAction,
  opportunityLoadingMap,
  currentStatusMap,
  onIntentProposalApprove,
  onIntentProposalReject,
  onIntentProposalUndo,
  intentProposalStatusMap,
  OAuthLink,
  onNetworkJoin,
  pendingNetworkJoinIds,
}: {
  content: string;
  isStreaming: boolean;
  onOpportunityPrimaryAction?: (id: string, userId: string, role?: string, name?: string) => void;
  onOpportunitySecondaryAction?: (id: string, userId: string, role?: string, name?: string) => void;
  opportunityLoadingMap?: Record<string, boolean>;
  currentStatusMap?: Record<string, string>;
  onIntentProposalApprove?: (proposalId: string, description: string, networkId?: string) => void;
  onIntentProposalReject?: (proposalId: string) => void;
  onIntentProposalUndo?: (proposalId: string) => void;
  intentProposalStatusMap?: Record<string, "pending" | "created" | "rejected">;
  OAuthLink?: React.ComponentType<React.ComponentPropsWithoutRef<"a">>;
  onNetworkJoin?: (networkId: string, networkTitle: string) => void;
  pendingNetworkJoinIds?: Set<string>;
}) {

// REPLACEMENT 9 — add networks_panel + networks_panel_loading render cases before intent_proposal_loading:
        if (seg.type === "networks_panel") {
          return (
            <div key={`networks-panel-${idx}`} className="my-3">
              <NetworksPanel
                onJoin={onNetworkJoin ?? (() => {})}
                pendingJoinIds={pendingNetworkJoinIds}
                orderedNetworkIds={seg.orderedNetworkIds}
              />
            </div>
          );
        }
        if (seg.type === "networks_panel_loading") {
          return (
            <div key={`networks-panel-loading-${idx}`} className="my-3 flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          );
        }
        // intent_proposal_loading
        return <div key={`intent-load-${idx}`} className="my-3"><IntentProposalSkeleton /></div>;

// REPLACEMENT 10 — OnboardingPage: add state + effect + handler + props
// State (add after existing useState declarations):
  const [pendingNetworkJoinIds, setPendingNetworkJoinIds] = useState<Set<string>>(new Set());

// Effect (add alongside the existing prevLoadingRef effect):
  // Clear pending network join IDs when stream completes
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading && pendingNetworkJoinIds.size > 0) {
      setPendingNetworkJoinIds(new Set());
    }
  }, [isLoading, pendingNetworkJoinIds.size]);

// Handler (add after handleIntentProposalUndo):
  const handleNetworkJoin = useCallback(
    (networkId: string, networkTitle: string) => {
      setPendingNetworkJoinIds((prev) => new Set([...prev, networkId]));
      sendOnboardingMessage(`I'd like to join ${networkTitle}`);
    },
    [sendOnboardingMessage],
  );

// Props (add to AssistantMessageContent call in render):
                          OAuthLink={OAuthLink}
                          onNetworkJoin={handleNetworkJoin}
                          pendingNetworkJoinIds={pendingNetworkJoinIds}
                        />
```

### Success Criteria:

#### Automated Verification:
- [ ] `cd frontend && bun run build` completes without TypeScript errors
- [ ] `grep -c "networks_panel" frontend/src/app/onboarding/page.tsx` returns >= 6
- [ ] `grep -c "orderedNetworkIds" frontend/src/components/ChatContent.tsx` returns >= 3
- [ ] `grep -c "orderedNetworkIds" frontend/src/app/onboarding/page.tsx` returns >= 3

#### Manual Verification:
- [ ] Onboarding chat renders `NetworksPanel` when LLM emits a `networks_panel` block
- [ ] Panel shows ranked order when `orderedNetworkIds` is present in the block JSON body
- [ ] Panel shows unranked order when the block body is `{}` (no orderedNetworkIds)
- [ ] A `Loader2` spinner appears while the `networks_panel` block is streaming in onboarding

---

## Ordering Constraints

- Phase 1 must complete before Phase 2 (NetworkRecommender class needed)
- Phase 2 must complete before Phase 3 (orderedNetworkIds in tool response)
- Phase 4 can run in parallel with Phases 1-3 (NetworksPanel change is independent)
- Phase 5 depends on Phase 4 (uses NetworksPanel's new prop)

## Verification Notes

- `read_networks` with `isOnboarding: false` must return identical output to today — no ranking, no extra fields visible to regular chat
- Fallback path: when `NetworkRecommender.invoke()` returns `null`, `read_networks` returns the original unranked `publicNetworks` without `orderedNetworkIds`
- `networks_panel` block with `{}` body (no `orderedNetworkIds`) must still render the panel (graceful degradation)
- `onboarding/page.tsx` changes must not affect `onboarding/page.tsx:AssistantMessageContent` when no `networks_panel` block is present

## Performance Considerations

- `NetworkRecommender` LLM call adds ~1-2s to onboarding step 6. Acceptable: onboarding is one-time, and the call is guarded by `context.isOnboarding`
- No performance impact on post-onboarding `read_networks` calls

## Migration Notes

No schema migrations needed. `users.location` column exists at `backend/src/schemas/database.schema.ts:92`.

## Pattern References

- `packages/protocol/src/intent/intent.indexer.ts:27-170` — canonical scoring agent pattern (createModel + class + withStructuredOutput + invokeWithAbortSignal + null fallback)
- `packages/protocol/src/shared/agent/model.config.ts:36-64` — model registry pattern
- `frontend/src/components/ChatContent.tsx:95-195` — fenced block parsing pattern (opportunity/intent_proposal)

## Developer Context

**Step 8 code review unavailable; proceeded to developer review without artifact-code-reviewer findings.**
**Step 8 coverage review unavailable; proceeded to developer review without artifact-coverage-reviewer findings.**


**Q (discover: LLM scoring architecture)**: `network.tools.ts:24` — LLM scores inside `read_networks`
A: LLM scores inside `read_networks`

**Q (discover: Recommendation signals)**: Interests/work domain + stated intent + location + Gmail contacts
A: All four signals desired; contacts deferred to v2; intent unavailable at step 6

**Q (discover: Location collection)**: Collect inline during onboarding
A: New step 5.5 in `chat.prompt.ts`, `create_user_profile(location="...")` via existing tool support (`profile.tools.ts:785`)

**Q (agent pattern)**: Follow `IntentIndexer` pattern at `intent.indexer.ts:27,81`?
A: Follow IntentIndexer pattern

**Q (contacts signal scope)**: Include contact names as soft signal in v1?
A: Defer to v2

**Q (onboarding/page.tsx scope)**: Include full `onboarding/page.tsx` changes in this plan?
A: Yes — full fix included, supersedes other session

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents._

_Step 8 code review failed: agent returned no output (session-wide agent failure)._
_Step 8 coverage review failed: agent returned no output (session-wide agent failure)._

---

## Plan History

- Phase 1: NetworkRecommender agent + model config — approved as generated
- Phase 2: read_networks tool enhancement — approved as generated
- Phase 3: Onboarding prompt — location step + networks_panel instruction — approved as generated
- Phase 4: NetworksPanel sorted rendering — approved as generated
- Phase 5: Frontend parsers — ChatContent + onboarding page — approved as generated

## References

- Research artifact: `.rpiv/artifacts/research/2026-06-10_19-00-17_onboarding-network-recommendation.md`
- Discover artifact: `.rpiv/artifacts/discover/2026-06-10_18-43-13_onboarding-network-recommendation.md`
- Pattern: `packages/protocol/src/intent/intent.indexer.ts`
- Worktree: `.worktrees/feat-onboarding-network-recommendation` (branch `feat/onboarding-network-recommendation`)
