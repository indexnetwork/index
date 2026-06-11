---
date: 2026-06-11T06:34:30+0300
author: Yankı Ekin Yüksel
commit: 9291ec3595
branch: dev
repository: index
topic: "Onboarding networks panel — fix empty state and remove silent auto-join"
tags: [plan, onboarding, networks, NetworksPanel, AssistantMessageContent, IndexesContext, profile-tools]
status: ready
parent: .rpiv/artifacts/research/2026-06-10_18-58-04_onboarding-networks-panel.md
phase_count: 4
phases:
  - { n: 1, title: "Remove auto-join from complete_onboarding" }
  - { n: 2, title: "Extract shared AssistantMessageContent component" }
  - { n: 3, title: "Wire ChatContent.tsx to shared component + refreshIndexes" }
  - { n: 4, title: "Restore onboarding/page.tsx join flow + refreshIndexes" }
unresolved_phase_count: 0
last_updated: 2026-06-11T06:34:30+0300
last_updated_by: Yankı Ekin Yüksel
---

# Onboarding networks panel — fix empty state and remove silent auto-join

## Overview
Commit `6a2f9a57e1` stripped `networks_panel` support from the onboarding page and replaced it with silent auto-join via `AUTO_JOIN_INDEX_IDS`. This plan reverses that: removes the auto-join loop from `complete_onboarding()`, extracts a shared `AssistantMessageContent` component that handles all segment types (including `networks_panel`), wires both `ChatContent.tsx` and `onboarding/page.tsx` to use it, and adds `refreshIndexes()` calls so newly joined networks appear immediately in the sidebar.

## Requirements
- Remove `AUTO_JOIN_INDEX_IDS` auto-join loop from `complete_onboarding()` in `profile.tools.ts`
- Extract shared `AssistantMessageContent` + `parseAllBlocks` + `MessageSegment` from `ChatContent.tsx` into `components/chat/AssistantMessageContent.tsx`
- `onboarding/page.tsx` uses shared component — restoring `networks_panel` rendering during onboarding
- Restore `communities` step suggestions to onboarding step-suggestion map
- Add `refreshIndexes()` after agent-triggered network join in `ChatContent.tsx` stream-end effect
- Add `refreshIndexes()` unconditionally in `onboarding/page.tsx` `completedAt` watcher (not just for `pendingInviteCode`)

## Current State Analysis
### Key Discoveries
- `profile.tools.ts:1258-1272` — auto-join loop reads `AUTO_JOIN_INDEX_IDS` env var, calls `database.addMemberToNetwork` for each; fires every time `complete_onboarding()` is called regardless of panel interaction
- `profile.tools.ts:1229` — description says "May also auto-join the user to preconfigured indexes"
- `onboarding/page.tsx:81-83` — local `MessageSegment` type missing `networks_panel`/`networks_panel_loading`
- `onboarding/page.tsx:103` — local regex only matches `opportunity|intent_proposal`, not `networks_panel`
- `onboarding/page.tsx:165-260` — local `AssistantMessageContent` has no `networks_panel` case; catch-all at line 255 renders `<IntentProposalSkeleton />` for it
- `onboarding/page.tsx:370-393` — `completedAt` watcher calls `refreshIndexes()` only inside `if (pendingCode)` branch
- `ChatContent.tsx:523-527` — stream-end effect clears `networkPanelPendingJoinIds` but never calls `refreshIndexes()`
- `ChatContent.tsx:48` — already imports `useNetworksState` from `@/contexts/IndexesContext`; `refreshIndexes` not destructured
- `ChatContent.tsx:590` — `useNetworksState()` used but only destructures `indexes`, not `refreshIndexes`

## Desired End State
After this plan:
```tsx
// onboarding/page.tsx — networks_panel block renders NetworksPanel with Join button
<AssistantMessageContent
  content={msg.content}
  isStreaming={msg.isStreaming ?? false}
  onNetworkJoin={handleNetworkJoin}
  networkPanelPendingJoinIds={networkPanelPendingJoinIds}
  // ...other props
/>

// complete_onboarding() — no auto-join, just sets completedAt
return success({ message: "Onboarding complete." }); // no addMemberToNetwork calls

// ChatContent.tsx — refreshes sidebar after agent-processed join
useEffect(() => {
  if (prevIsLoadingRef.current && !isLoading && networkPanelPendingJoinIds.size > 0) {
    setNetworkPanelPendingJoinIds(new Set());
    refreshIndexes();
  }
}, [isLoading, networkPanelPendingJoinIds.size]);

// onboarding/page.tsx — refreshes sidebar on onboarding completion regardless of invite code
useEffect(() => {
  if (!user?.onboarding?.completedAt) return;
  refreshIndexes(); // always, not just when pendingCode
  // ... existing invite + redirect logic
}, [...]);
```

## What We're NOT Doing
- Snapshot payload approach (embedding `publicNetworks` into the `networks_panel` block body) — deferred to follow-up
- Enforcing `requireApproval: true` on "Index Early Birds" in the membership graph
- Changing `chat.prompt.ts` step-6 instruction (it already correctly tells the model to output `networks_panel`)
- Removing `AUTO_JOIN_INDEX_IDS` env var from Railway (env stays inert after code change)
- Adding unit tests for `parseAllBlocks` (extraction is value enough; tests deferred)

## Decisions

### Remove auto-join loop
**Evidence**: `profile.tools.ts:1258-1272` unconditionally calls `addMemberToNetwork` for every id in `AUTO_JOIN_INDEX_IDS`
**Decision**: Remove the entire loop + update description. Logger call updated to remove `autoJoinedNetworks: autoJoinIds.length` counter.

### Extract parseAllBlocks + MessageSegment as named exports
**Evidence**: `ChatContent.tsx:422` and `ChatContent.tsx:542` call `parseAllBlocks` inside `useMemo` hooks outside of `AssistantMessageContent` — these callers need the function to remain accessible after extraction
**Decision**: Export `parseAllBlocks` and `MessageSegment` as named exports; `dedupeSegments` and `normalizeBlockquotes` stay private.

### Shared component superset of ChatContent.tsx version
**Evidence**: `ChatContent.tsx:165-355` handles all 7 segment types; `onboarding/page.tsx:165-260` handles 5. The ChatContent.tsx version is the canonical superset.
**Decision**: New shared file is a verbatim lift of `ChatContent.tsx:165-355` with no functional changes.

### refreshIndexes after join — extend existing stream-end effect
**Evidence**: `ChatContent.tsx:523-527` already triggers when `isLoading` transitions false with pending join IDs — the correct semantic hook
**Decision**: Add `refreshIndexes()` call inside that existing effect body.

### refreshIndexes after onboarding — unconditional in completedAt watcher
**Evidence**: `onboarding/page.tsx:370-393` fires reliably when `completedAt` becomes non-null; `refreshIndexes()` currently only called inside `if (pendingCode)` at line 380
**Decision**: Call `refreshIndexes()` at the top of the effect body, before the `pendingCode` branch.

## Phase 1: Remove auto-join from complete_onboarding

### Overview
Strip the `AUTO_JOIN_INDEX_IDS` loop from `complete_onboarding()` in `profile.tools.ts` and update the tool description. Standalone protocol change — no frontend deps.

### Changes Required:

#### 1. packages/protocol/src/profile/profile.tools.ts

**File**: packages/protocol/src/profile/profile.tools.ts
**Changes**: MODIFY — remove auto-join loop at lines 1258-1272; update description at 1225; update logger.info call; remove `database` from deps destructure at line 38 (only used in the removed loop)

```typescript
// CHANGE 0 (reviewer finding): Remove `database` from the deps destructure at line 38.
// The only use of `database` in completeOnboarding was the auto-join loop below.
// Before: const { userDb, systemDb, database, graphs, enricher, grantDefaultSystemPermissions, reportToolError } = deps;
// After:
// const { userDb, systemDb, graphs, enricher, grantDefaultSystemPermissions, reportToolError } = deps;

    description:
      "Marks the user's onboarding as complete, unlocking full platform access. This is the final step in the new-user setup flow.\n\n" +
      "**Prerequisites:** The user must have a profile (created via create_user_profile) AND must have explicitly confirmed it " +
      "(said 'yes', 'looks good', 'that's right', or similar). Do NOT call this until the user confirms.\n\n" +
      "**What happens:** Sets completedAt timestamp on the user's onboarding record.\n\n" +
      "**Workflow:** create_user_profile() -> user confirms preview -> create_user_profile(confirm=true) -> user confirms saved profile -> complete_onboarding()\n\n" +
      "**Returns:** Confirmation that onboarding is complete. No parameters needed.",
    querySchema: z.object({}),
    handler: async ({ context }) => {
      const currentOnboarding = context.user.onboarding ?? {};
      if (currentOnboarding.completedAt) {
        logger.verbose("Onboarding already completed, skipping", { userId: context.userId });
        return success({ message: "Onboarding already completed." });
      }
      await userDb.updateUser({
        onboarding: {
          ...currentOnboarding,
          completedAt: new Date().toISOString(),
        },
      });

      if (grantDefaultSystemPermissions) {
        try {
          await grantDefaultSystemPermissions(context.userId);
        } catch (err) {
          logger.warn('Default system agent permission grant failed (non-fatal)', {
            userId: context.userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info("Onboarding completed", { userId: context.userId });
      return success({ message: "Onboarding complete." });
    },
```

### Success Criteria:

#### Automated Verification:
- [x] `cd packages/protocol && bun run build` passes
- [x] `grep -n "AUTO_JOIN_INDEX_IDS\|addMemberToNetwork" packages/protocol/src/profile/profile.tools.ts` returns 0 lines
- [x] `grep "auto-join\|auto_join" packages/protocol/src/profile/profile.tools.ts` returns 0 lines
- [x] `cd packages/protocol && bun test` passes with no regressions (1180 pass / 176 fail / 15 errors — identical to clean dev baseline; failures pre-existing and env-dependent)

#### Manual Verification:
- [ ] `complete_onboarding()` tool description no longer mentions auto-join or preconfigured indexes

## Phase 2: Extract shared AssistantMessageContent component

### Overview
Create `frontend/src/components/chat/AssistantMessageContent.tsx` as a verbatim lift of the 7-segment-type implementation from `ChatContent.tsx:83-355`. Depends on Phase 1 (independent); can run in parallel with Phase 1 since they touch different packages.

### Changes Required:

#### 1. frontend/src/components/chat/AssistantMessageContent.tsx

**File**: frontend/src/components/chat/AssistantMessageContent.tsx
**Changes**: NEW — shared parser + component with all segment types

```typescript
import type { ComponentType, ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";
import OpportunityCard, {
  type OpportunityCardData,
  OpportunitySkeleton,
} from "@/components/chat/OpportunityCardInChat";
import IntentProposalCard, {
  type IntentProposalData,
  IntentProposalSkeleton,
} from "@/components/chat/IntentProposalCard";
import NetworksPanel from "@/components/chat/NetworksPanel";
import { cn } from "@/lib/utils";
import { mentionsToMarkdownLinks } from "@/lib/mentions";

/**
 * Ensure blockquote lines are always followed by a blank line so that
 * subsequent non-blockquote text isn't absorbed via markdown "lazy continuation".
 */
function normalizeBlockquotes(text: string): string {
  let out = text.replace(/^(>.*?\.\.\.)\ *(\S.+)$/gm, "$1\n\n$2");
  out = out.replace(/^(>.*)\n(?!>|\n)/gm, "$1\n\n");
  return out;
}

/**
 * Segment union for all block types the chat agent can emit.
 * Exported so consumers (e.g. ChatContent.tsx useMemo hooks) can type
 * the result of parseAllBlocks without importing via deep paths.
 */
export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "opportunity"; data: OpportunityCardData }
  | { type: "opportunity_loading" }
  | { type: "intent_proposal"; data: IntentProposalData }
  | { type: "intent_proposal_loading" }
  | { type: "networks_panel" }
  | { type: "networks_panel_loading" };

/**
 * Parse agent message content, extracting fenced blocks as typed segments.
 * Exported so ChatContent.tsx can call it outside AssistantMessageContent
 * (for opportunity/proposal ID extraction in useMemo hooks).
 */
export function parseAllBlocks(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /```(opportunity|intent_proposal|networks_panel)\s*\n([\s\S]*?)\n```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    const blockType = match[1];

    if (blockType === "networks_panel") {
      segments.push({ type: "networks_panel" });
    } else {
      try {
        const jsonStr = match[2].trim();
        const data = JSON.parse(jsonStr);

        if (blockType === "opportunity" && data.opportunityId && data.userId) {
          segments.push({ type: "opportunity", data: data as OpportunityCardData });
        } else if (
          blockType === "intent_proposal" &&
          data.proposalId &&
          (typeof data.description === "string" || !("description" in data))
        ) {
          segments.push({ type: "intent_proposal", data: data as IntentProposalData });
        } else if (blockType === "intent_proposal") {
          segments.push({
            type: "text",
            content: "This proposal couldn't be loaded as a card. Ask again to add this as a signal.",
          });
        } else {
          segments.push({ type: "text", content: match[0] });
        }
      } catch {
        segments.push({ type: "text", content: match[0] });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  const remainingContent = content.slice(lastIndex);
  const partialOpp = remainingContent.match(/```opportunity/);
  const partialIntent = remainingContent.match(/```intent_proposal/);
  const partialNetworks = remainingContent.match(/```networks_panel/);

  const candidates = ([partialOpp, partialIntent, partialNetworks] as (RegExpMatchArray | null)[]).filter(
    (c): c is RegExpMatchArray => c !== null,
  );
  const partialMatch =
    candidates.length > 0
      ? candidates.reduce((earliest, c) => (c.index! < earliest.index! ? c : earliest))
      : null;

  if (partialMatch) {
    const partialIndex = partialMatch.index!;
    const textBefore = remainingContent.slice(0, partialIndex);
    if (textBefore.trim()) {
      segments.push({ type: "text", content: textBefore });
    }
    if (partialMatch === partialOpp) {
      segments.push({ type: "opportunity_loading" });
    } else if (partialMatch === partialIntent) {
      segments.push({ type: "intent_proposal_loading" });
    } else {
      segments.push({ type: "networks_panel_loading" });
    }
  } else if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      segments.push({ type: "text", content: remaining });
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}

function dedupeSegments(segments: MessageSegment[]): MessageSegment[] {
  const seenOpps = new Set<string>();
  const seenProposals = new Set<string>();
  return segments.filter((seg) => {
    if (seg.type === "opportunity") {
      if (seenOpps.has(seg.data.opportunityId)) return false;
      seenOpps.add(seg.data.opportunityId);
      return true;
    }
    if (seg.type === "intent_proposal") {
      if (seenProposals.has(seg.data.proposalId)) return false;
      seenProposals.add(seg.data.proposalId);
      return true;
    }
    return true;
  });
}

export interface AssistantMessageContentProps {
  content: string;
  isStreaming: boolean;
  onOpportunityPrimaryAction?: (
    opportunityId: string,
    userId: string,
    viewerRole?: string,
    counterpartName?: string,
    isGhost?: boolean,
  ) => void;
  onOpportunitySecondaryAction?: (
    opportunityId: string,
    userId: string,
    viewerRole?: string,
    counterpartName?: string,
    isGhost?: boolean,
  ) => void;
  opportunityLoadingMap?: Record<string, boolean>;
  /** Map of opportunityId -> current status from server */
  currentStatusMap?: Record<string, string>;
  onIntentProposalApprove?: (proposalId: string, description: string, networkId?: string) => void;
  onIntentProposalReject?: (proposalId: string) => void;
  onIntentProposalUndo?: (proposalId: string) => void;
  intentProposalStatusMap?: Record<string, "pending" | "created" | "rejected">;
  OAuthLink?: ComponentType<ComponentPropsWithoutRef<"a">>;
  onNetworkJoin?: (networkId: string, networkTitle: string) => void;
  networkPanelPendingJoinIds?: Set<string>;
}

/**
 * Renders assistant message content by parsing fenced blocks and rendering
 * the appropriate card component for each segment type.
 *
 * Shared between ChatContent.tsx (full chat view) and onboarding/page.tsx.
 */
export default function AssistantMessageContent({
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
  networkPanelPendingJoinIds,
}: AssistantMessageContentProps) {
  const displayedContent = normalizeBlockquotes(mentionsToMarkdownLinks(content));

  const showCursor = isStreaming;

  if (!displayedContent && isStreaming) {
    return <span className="inline-block w-2 h-4 bg-current animate-pulse" />;
  }

  const segments = dedupeSegments(parseAllBlocks(displayedContent));

  return (
    <div>
      {segments.map((segment, idx) => {
        if (segment.type === "text") {
          const isLast = idx === segments.length - 1;
          return (
            <div
              key={`text-${idx}`}
              className={cn(
                "chat-markdown max-w-none",
                isStreaming && "chat-markdown-streaming",
                showCursor && isLast && "chat-markdown-typing",
              )}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={OAuthLink ? { a: OAuthLink } : undefined}
              >
                {segment.content}
              </ReactMarkdown>
            </div>
          );
        } else if (segment.type === "opportunity") {
          return (
            <div key={segment.data.opportunityId} className="my-3">
              <OpportunityCard
                card={segment.data}
                onPrimaryAction={onOpportunityPrimaryAction}
                onSecondaryAction={onOpportunitySecondaryAction}
                isLoading={opportunityLoadingMap?.[segment.data.opportunityId] ?? false}
                currentStatus={currentStatusMap?.[segment.data.opportunityId]}
              />
            </div>
          );
        } else if (segment.type === "opportunity_loading") {
          return (
            <div key={`loading-${idx}`} className="my-3">
              <OpportunitySkeleton />
            </div>
          );
        } else if (segment.type === "intent_proposal") {
          return (
            <div key={segment.data.proposalId} className="my-3">
              <IntentProposalCard
                card={segment.data}
                onApprove={onIntentProposalApprove}
                onReject={onIntentProposalReject}
                onUndo={onIntentProposalUndo}
                currentStatus={intentProposalStatusMap?.[segment.data.proposalId]}
              />
            </div>
          );
        } else if (segment.type === "intent_proposal_loading") {
          return (
            <div key={`intent-loading-${idx}`} className="my-3">
              <IntentProposalSkeleton />
            </div>
          );
        } else if (segment.type === "networks_panel") {
          return (
            <div key={`networks-panel-${idx}`} className="my-3">
              <NetworksPanel
                onJoin={onNetworkJoin ?? (() => {})}
                pendingJoinIds={networkPanelPendingJoinIds}
              />
            </div>
          );
        } else {
          // networks_panel_loading
          return (
            <div key={`networks-panel-loading-${idx}`} className="my-3 flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          );
        }
      })}
    </div>
  );
}
```

### Success Criteria:

#### Automated Verification:
- [x] `cd frontend && bun run build` passes — new file compiles with no type errors (also verified via `bunx tsc --noEmit`: zero errors in the new file; remaining errors are pre-existing in tests/)
- [x] `grep -c "export" frontend/src/components/chat/AssistantMessageContent.tsx` returns >= 4 (MessageSegment, parseAllBlocks, AssistantMessageContentProps, default export) — returns 4

#### Manual Verification:
- [ ] New file exists at `frontend/src/components/chat/AssistantMessageContent.tsx`
- [ ] File exports: `MessageSegment` (type), `parseAllBlocks` (function), `AssistantMessageContentProps` (interface), `AssistantMessageContent` (default)
- [ ] File handles all 7 segment types including `networks_panel` and `networks_panel_loading`

## Phase 3: Wire ChatContent.tsx to shared component + refreshIndexes

### Overview
Remove the 5 local definitions from `ChatContent.tsx` (normalizeBlockquotes, MessageSegment, parseAllBlocks, dedupeSegments, AssistantMessageContent), import from the new shared file, destructure `refreshIndexes` from `useNetworksState()`, and add `refreshIndexes()` to the stream-end effect. Depends on Phase 2.

### Changes Required:

#### 1. frontend/src/components/ChatContent.tsx

**File**: frontend/src/components/ChatContent.tsx
**Changes**: MODIFY — remove local defs (lines 83-355); remove stale imports (NetworksPanel, IntentProposalCard, Loader2); add shared-component import; move useNetworksState() destructure before stream-end effect; add refreshIndexes() to stream-end effect

```typescript
// ─── CHANGE 1: Remove stale imports; add shared AssistantMessageContent import ───
// REMOVE line 39: import NetworksPanel from "@/components/chat/NetworksPanel";
// REMOVE lines 35-38: import IntentProposalCard, { type IntentProposalData, IntentProposalSkeleton } from "@/components/chat/IntentProposalCard";
// REMOVE Loader2 from lucide-react import list (line 17) — only used in local AssistantMessageContent being deleted
// ADD (after ToolCallsDisplay import, e.g. line 42):
import AssistantMessageContent, {
  parseAllBlocks,
  type MessageSegment,
} from "@/components/chat/AssistantMessageContent";

// ─── CHANGE 2: Remove local definitions entirely (lines 83-355) ───
// DELETE: function normalizeBlockquotes(...)
// DELETE: type MessageSegment = ...
// DELETE: function parseAllBlocks(...)
// DELETE: function dedupeSegments(...)
// DELETE: function AssistantMessageContent(...)

// ─── CHANGE 3: Move useNetworksState() destructure BEFORE prevIsLoadingRef ───
// Current line ~590: const { indexes } = useNetworksState();
// Move to just BEFORE the prevIsLoadingRef const (~line 519) so refreshIndexes
// is in scope for the stream-end effect that immediately follows.
// New position (replaces the original line 590):
const { indexes, refreshIndexes } = useNetworksState();

// ─── CHANGE 4: Remove old useNetworksState line at original position (~590) ───
// DELETE the original: const { indexes } = useNetworksState();
// (it is now declared earlier as part of CHANGE 3)

// ─── CHANGE 5: Add refreshIndexes() to stream-end effect ───
// This useEffect immediately follows the prevIsLoadingRef declaration:
useEffect(() => {
  if (prevIsLoadingRef.current && !isLoading && networkPanelPendingJoinIds.size > 0) {
    setNetworkPanelPendingJoinIds(new Set());
    void refreshIndexes();
  }
  prevIsLoadingRef.current = isLoading;
}, [isLoading, networkPanelPendingJoinIds.size, refreshIndexes]);
```

### Success Criteria:

#### Automated Verification:
- [x] `cd frontend && bun run build` passes with no type errors
- [x] `grep -n "^import NetworksPanel\|^function normalizeBlockquotes\|^function parseAllBlocks\|^function dedupeSegments" frontend/src/components/ChatContent.tsx` returns 0 lines
- [x] `grep "refreshIndexes" frontend/src/components/ChatContent.tsx | wc -l` returns >= 2 (destructure + call) — returns 3
- [x] `grep "from \"@/components/chat/AssistantMessageContent\"" frontend/src/components/ChatContent.tsx` returns 1 line

#### Manual Verification:
- [ ] Regular chat page (/d/:id) renders opportunity cards, intent proposals, and networks panel correctly
- [ ] Network sidebar updates after clicking Join in the networks panel (no hard reload needed)

## Phase 4: Restore onboarding/page.tsx join flow + refreshIndexes

### Overview
Remove local defs from `onboarding/page.tsx`; import shared `AssistantMessageContent`; restore communities suggestions + step detection; add `networkPanelPendingJoinIds` state, `handleNetworkJoin` callback, and stream-end effect; add unconditional `refreshIndexes()` in the `completedAt` watcher; wire props. Note: `NetworksPanel` and `Loader2` are NOT re-added — they are internal to `AssistantMessageContent.tsx`. Depends on Phases 2 and 3.

### Changes Required:

#### 1. frontend/src/app/onboarding/page.tsx

**File**: frontend/src/app/onboarding/page.tsx
**Changes**: MODIFY — remove local defs; remove card imports; add shared AssistantMessageContent import; restore communities suggestions + step detection; add join state/handler/effect; add unconditional refreshIndexes in completedAt watcher; wire props

```typescript
// ─── CHANGE 1: Remove card imports; add shared component import ───
// REMOVE:
//   import OpportunityCard, { type OpportunityCardData, OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
//   import IntentProposalCard, { type IntentProposalData, IntentProposalSkeleton } from "@/components/chat/IntentProposalCard";
// NOTE: NetworksPanel and Loader2 are NOT needed — they are internal to AssistantMessageContent.tsx
// ADD (after existing ToolCallsDisplay import, around line 24):
import AssistantMessageContent from "@/components/chat/AssistantMessageContent";

// ─── CHANGE 2: Remove local definitions (lines 73-260) ───
// DELETE: function normalizeBlockquotes(...)
// DELETE: type MessageSegment = ...
// DELETE: function parseAllBlocks(...)
// DELETE: function dedupeSegments(...)
// DELETE: local function AssistantMessageContent(...)
// DELETE: the "// --- AssistantMessage (simplified for onboarding...) ---" comment block

// ─── CHANGE 3: Restore communities step suggestions ───
// In ONBOARDING_STEP_SUGGESTIONS (around line 46), add after the `gmail` entry:
  communities: [
    { label: "Continue", type: "direct", followupText: "I'll skip joining networks for now, let's continue" },
  ],

// ─── CHANGE 4: Add communities detection to onboardingStep useMemo ───
// In the onboardingStep useMemo, add BEFORE the `intent` check:
    if (content.includes("communities you might find relevant")) return "communities";

// ─── CHANGE 5a: Add networkPanelPendingJoinIds state ───
// Near other useState declarations:
  const [networkPanelPendingJoinIds, setNetworkPanelPendingJoinIds] = useState<Set<string>>(new Set());

// ─── CHANGE 5b: Add handleNetworkJoin callback ───
// AFTER the sendOnboardingMessage useCallback definition (which ends around line 484):
  const handleNetworkJoin = useCallback(
    (networkId: string, networkTitle: string) => {
      setNetworkPanelPendingJoinIds((prev) => new Set([...prev, networkId]));
      sendOnboardingMessage(`I'd like to join ${networkTitle}`);
    },
    [sendOnboardingMessage],
  );

// ─── CHANGE 6: Add stream-end effect for pending network join IDs ───
// After the existing prevLoadingRef + refetchUser effect (around line 363):
  const prevNetworkJoinLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevNetworkJoinLoadingRef.current && !isLoading && networkPanelPendingJoinIds.size > 0) {
      setNetworkPanelPendingJoinIds(new Set());
      void refreshIndexes();
    }
    prevNetworkJoinLoadingRef.current = isLoading;
  }, [isLoading, networkPanelPendingJoinIds.size, refreshIndexes]);

// ─── CHANGE 7: Add unconditional refreshIndexes() at top of completedAt watcher ───
  useEffect(() => {
    if (!user?.onboarding?.completedAt || hasTriggeredRedirect.current) return;
    hasTriggeredRedirect.current = true;

    // Always refresh so any new memberships appear in the sidebar immediately
    void refreshIndexes();

    const pendingCode = localStorage.getItem('pendingInviteCode');
    if (pendingCode) {
      indexesService
        .acceptInvitation(pendingCode)
        .then(async () => {
          localStorage.removeItem('pendingInviteCode');
          await refreshIndexes();
        })
        .catch((err) => {
          console.error('Failed to accept deferred invitation:', err);
          showError('Could not join the network from your invitation link. Please try the link again.');
        });
    }

    setIsTransitioning(true);
    const target = sessionId ? `/d/${sessionId}` : "/";
    const timer = setTimeout(() => navigate(target, { replace: true }), 700);
    return () => clearTimeout(timer);
  }, [user?.onboarding?.completedAt, sessionId, navigate, indexesService, refreshIndexes, showError]);

// ─── CHANGE 8: Add onNetworkJoin + networkPanelPendingJoinIds props ───
// Replace existing <AssistantMessageContent .../> JSX (~line 602):
                      <AssistantMessageContent
                        content={msg.content}
                        isStreaming={msg.isStreaming ?? false}
                        onOpportunityPrimaryAction={(id, userId, role, name) =>
                          handleOpportunityAction(id, "accepted", userId, role, name)
                        }
                        onOpportunitySecondaryAction={(id, userId, role, name) =>
                          handleOpportunityAction(id, "rejected", userId, role, name)
                        }
                        opportunityLoadingMap={opportunityActionLoading}
                        currentStatusMap={opportunityStatusMap}
                        onIntentProposalApprove={handleIntentProposalApprove}
                        onIntentProposalReject={handleIntentProposalReject}
                        onIntentProposalUndo={handleIntentProposalUndo}
                        intentProposalStatusMap={intentProposalStatusMap}
                        OAuthLink={OAuthLink}
                        onNetworkJoin={handleNetworkJoin}
                        networkPanelPendingJoinIds={networkPanelPendingJoinIds}
                      />
```

### Success Criteria:

#### Automated Verification:
- [x] `cd frontend && bun run build` passes with no TypeScript errors
- [x] `grep -n "^import OpportunityCard\|^import IntentProposalCard\|^function normalizeBlockquotes\|^function parseAllBlocks\|^function dedupeSegments" frontend/src/app/onboarding/page.tsx` returns 0 lines
- [x] `grep "networkPanelPendingJoinIds\|handleNetworkJoin\|void refreshIndexes" frontend/src/app/onboarding/page.tsx | wc -l` returns >= 5 lines (returns 8)
- [x] `grep "communities" frontend/src/app/onboarding/page.tsx | wc -l` returns >= 2 (suggestions + detection)

#### Manual Verification:
- [ ] Going through onboarding shows "Index Early Birds" with a Join button at step 6
- [ ] Completing onboarding WITHOUT clicking Join does NOT add user to "Index Early Birds" (verify: `SELECT * FROM network_members WHERE user_id='<id>' AND network_id='5afc0751-84df-47ce-b519-88121e8aae38'` returns 0 rows)
- [ ] Clicking Join → sidebar shows "Index Early Birds" immediately without page reload
- [ ] "Continue" suggestion chip appears at the communities step
- [ ] `cd packages/protocol && bun test` passes with no regressions on complete_onboarding

## Ordering Constraints
- Phase 1 and Phase 2 can run in parallel (different packages)
- Phase 3 depends on Phase 2 (imports from new file)
- Phase 4 depends on Phase 2 and Phase 3 (follows the same patterns established in Phase 3)

## Verification Notes
- `cd frontend && bun run build` must pass — TypeScript compilation is the primary gate
- After the change, going through onboarding should show "Index Early Birds" with a Join button in the panel
- Completing onboarding WITHOUT clicking Join should NOT add the user to "Index Early Birds" (check `network_members` table)
- Clicking Join during the panel → sidebar should show "Index Early Birds" immediately without page reload
- `cd packages/protocol && bun test` should pass with no regressions on `complete_onboarding` tests

## Performance Considerations
One extra `GET /networks` call fires when the stream ends with pending join IDs in `ChatContent.tsx`, and another when onboarding completes. Both are acceptable — the endpoint is fast and the calls are user-action-gated (not hot paths).

## Migration Notes
No schema changes. `AUTO_JOIN_INDEX_IDS` Railway env var stays set but becomes inert after the code change.

## Pattern References
- `frontend/src/app/l/[code]/page.tsx:129` — `refreshIndexes()` after membership mutation
- `frontend/src/components/chat/NetworksPanel.tsx` — existing component being reused unchanged
- `frontend/src/contexts/IndexesContext.tsx:31-47` — `refreshIndexes` implementation
- `frontend/src/components/ChatContent.tsx:165-355` — canonical `AssistantMessageContent` to extract

## Developer Context
**Q (discover: Remove auto-join): `profile.tools.ts:1258-1273` loops over `AUTO_JOIN_INDEX_IDS`.**
A: Remove the auto-join loop; joining Early Birds should require explicit user action.

**Q (discover: Snapshot panel data): `NetworksPanel` re-fetches live data on every render.**
A: Snapshot approach deferred — research finding 7 confirmed it's additive.

**Q (discover: Post-join sidebar refresh): `IndexesContext.tsx:62` fetches once on login.**
A: `refreshIndexes()` in `ChatContent.tsx:523` stream-end effect + unconditionally in `onboarding/page.tsx:370`.

**Q (`onboarding/page.tsx:165`): Local `AssistantMessageContent` catch-all at line 255.**
A: Extract shared component (developer confirmed).

**Q (decomposition checkpoint): 4 slices approved.**
A: Phase 1 = protocol; Phase 2 = new shared file; Phase 3 = ChatContent.tsx; Phase 4 = onboarding/page.tsx.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §1 (profile.tools.ts) | packages/protocol/src/profile/profile.tools.ts:38 | suggestion | codebase-fit | Removing the AUTO_JOIN_INDEX_IDS loop leaves `database` destructured from `deps` with no remaining use in profile.tools.ts | Remove `database` from the `deps` destructure when deleting the auto-join loop | applied: added CHANGE 0 to Phase 1 code fence removing `database` from destructure |
| code | Phase 3 §1 (ChatContent.tsx) | frontend/src/components/ChatContent.tsx:35 | suggestion | codebase-fit | After deleting the local AssistantMessageContent, IntentProposalCard/Data/Skeleton imports are no longer used in ChatContent.tsx | Remove the IntentProposalCard, IntentProposalData, and IntentProposalSkeleton imports during Phase 3 | applied: added to Phase 3 CHANGE 1 |
| code | Phase 3 §1 (ChatContent.tsx) | frontend/src/components/ChatContent.tsx:17 | suggestion | codebase-fit | After deleting the networks_panel_loading renderer, Loader2 from lucide is no longer used in ChatContent.tsx | Remove Loader2 from the lucide-react import list during Phase 3 | applied: added to Phase 3 CHANGE 1 |

## Plan History
- Phase 1: Remove auto-join from complete_onboarding — approved as generated
- Phase 2: Extract shared AssistantMessageContent component — approved as generated
- Phase 3: Wire ChatContent.tsx to shared component + refreshIndexes — approved as generated
- Phase 4: Restore onboarding/page.tsx join flow + refreshIndexes — approved as generated

## References
- Research: `.rpiv/artifacts/research/2026-06-10_18-58-04_onboarding-networks-panel.md`
- Discover: `.rpiv/artifacts/discover/2026-06-10_15-52-13_onboarding-networks-panel.md`
- Precedent commit: `6a2f9a57e1` — stripped networks_panel (2026-03-30)
- Precedent commit: `2c7307507a` — originally added networks_panel (2026-03-12)
