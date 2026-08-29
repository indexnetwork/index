import type { ComponentType, ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2 } from "lucide-react";
import { parseQuestionMessage } from "@indexnetwork/protocol";
import OpportunityCard, { OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import IntentProposalCard, { IntentProposalSkeleton } from "@/components/chat/IntentProposalCard";
import NetworksPanel from "@/components/chat/NetworksPanel";
import { QuestionSteps } from "@/components/chat/QuestionSteps";
import { parseAllBlocks, type MessageSegment } from "@/components/chat/message-blocks";
import { cn } from "@/lib/utils";
import { mentionsToMarkdownLinks } from "@/lib/mentions";

/**
 * Ensure blockquote lines are always followed by a blank line so that
 * subsequent non-blockquote text isn't absorbed via markdown "lazy continuation".
 */
function normalizeBlockquotes(text: string): string {
  let out = text.replace(/^(>.*?\.\.\.)\s*(\S.+)$/gm, "$1\n\n$2");
  out = out.replace(/^(>.*)\n(?!>|\n)/gm, "$1\n\n");
  return out;
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
  ) => void;
  onOpportunitySecondaryAction?: (
    opportunityId: string,
    userId: string,
    viewerRole?: string,
    counterpartName?: string,
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
  /**
   * Tap-to-quote for question-message steps: prefill the surface's chat input
   * with the question being answered. Answers are plain chat replies.
   */
  onQuestionQuote?: (prompt: string) => void;
}

/**
 * Renders assistant message content by parsing fenced blocks and rendering
 * the appropriate card component for each segment type.
 *
 * Shared with ChatContent.tsx (full chat view).
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
  onQuestionQuote,
}: AssistantMessageContentProps) {
  // Question-message: a body whose terminal section is a valid ```index-questions
  // block renders as prose + steps. parseQuestionMessage fails closed — on any
  // malformed block it returns null and the whole body falls through to the
  // normal rendering path unchanged (the fence shows as a plain code block).
  const parsedQuestions = parseQuestionMessage(content);
  if (parsedQuestions) {
    const prose = normalizeBlockquotes(mentionsToMarkdownLinks(parsedQuestions.prose));
    return (
      <div>
        {prose.trim() && (
          <div className="chat-markdown max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={OAuthLink ? { a: OAuthLink } : undefined}
            >
              {prose}
            </ReactMarkdown>
          </div>
        )}
        <QuestionSteps block={parsedQuestions.block} onQuote={onQuestionQuote} />
      </div>
    );
  }

  const displayedContent = normalizeBlockquotes(mentionsToMarkdownLinks(content));

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
                isStreaming && isLast && "chat-markdown-typing",
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
