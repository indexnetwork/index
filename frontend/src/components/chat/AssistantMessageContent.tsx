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
 * - "> Retrieving…\nHere is…" → "> Retrieving…\n\nHere is…"
 * - "> Updating...Your profile now" (no newline after "...") → "> Updating...\n\nYour profile now"
 */
function normalizeBlockquotes(text: string): string {
  // When a blockquote line ends with "..." and more text follows on the same line (e.g. stream
  // sent no newline), insert a blank line so the following text renders on a new line.
  let out = text.replace(/^(>.*?\.\.\.)\s*(\S.+)$/gm, "$1\n\n$2");
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
          // Broken block (e.g. model wrote intent_proposal without calling create_intent — no proposalId)
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

  // Show cursor while streaming (before content arrives)
  const showCursor = isStreaming;

  // No text yet — render a standalone blinking cursor
  if (!displayedContent && isStreaming) {
    return <span className="inline-block w-2 h-4 bg-current animate-pulse" />;
  }

  // Parse opportunity and intent_proposal blocks from the displayed content; dedupe
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
