"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, CheckCircle2, Clock, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import UserAvatar from "@/components/UserAvatar";
import { cn } from "@/lib/utils";

/**
 * Shared opportunity card data structure.
 * Compatible with both HomeViewCardItem and OpportunityCard from chat context.
 * Keep in sync with OpportunityCardPayload in protocol/src/types/chat-streaming.types.ts.
 */
export interface OpportunityCardData {
  opportunityId: string;
  userId: string;
  name?: string;
  avatar?: string | null;
  /** Main body text (personalizedSummary from presenter). */
  mainText: string;
  /** Call-to-action line (suggestedAction from presenter). */
  cta?: string;
  /** Short headline hook. */
  headline?: string;
  /** Label for primary action button (e.g. "Start Chat"). */
  primaryActionLabel?: string;
  /** Label for secondary action button (e.g. "Skip"). */
  secondaryActionLabel?: string;
  /** Subtitle under the other party name (e.g. "1 mutual intent"). */
  mutualIntentsLabel?: string;
  /** Narrator chip (Index or introducer). */
  narratorChip?: {
    name: string;
    text: string;
    avatar?: string | null;
    userId?: string;
  };
  /** Viewer's role in this opportunity (e.g. 'party', 'agent', 'introducer'). */
  viewerRole?: string;
  /** Match confidence score (0-1). */
  score?: number;
  /** Opportunity status at the time the card was created. */
  status?: string;
}

/** Status values that allow user actions (accept/reject). Matches DB opportunity_status enum. */
const ACTIONABLE_STATUSES = new Set(["latent", "draft", "pending", "viewed"]);

/** Determine if a status allows actions. */
function isActionableStatus(status?: string): boolean {
  if (!status) return true; // Default to actionable if unknown
  return ACTIONABLE_STATUSES.has(status);
}

/** Get human-readable message for resolved statuses (icon shown separately for accepted). */
function getStatusMessage(status?: string): string | null {
  switch (status) {
    case "accepted":
      return "This connection has been accepted";
    case "rejected":
      return "This opportunity was declined";
    case "expired":
      return "This opportunity has expired";
    default:
      return null;
  }
}

/** Tailwind classes for the card wrapper based on opportunity status. */
function getCardWrapperClass(status?: string): string {
  switch (status) {
    case "rejected":
      return "bg-red-50/60 border border-red-200";
    case "expired":
      return "bg-amber-50/80 border border-amber-200";
    default:
      return "bg-[#F8F8F8]";
  }
}

/** Tailwind classes for the narrator chip based on opportunity status. */
function getNarratorChipClass(status?: string): string {
  switch (status) {
    case "rejected":
      return "bg-red-100/60 border border-red-200";
    case "expired":
      return "bg-amber-100/80 border border-amber-200";
    default:
      return "bg-[#F0F0F0] border border-gray-200";
  }
}

/** Hover class for the narrator chip when clickable (by status). */
function getNarratorHoverClass(status?: string): string {
  switch (status) {
    case "rejected":
      return "hover:bg-red-200/40";
    case "expired":
      return "hover:bg-amber-200/50";
    default:
      return "hover:bg-[#E8E8E8]";
  }
}

interface OpportunityCardProps {
  card: OpportunityCardData;
  /** Handler for primary action (accept/start chat). If not provided, card is display-only. */
  onPrimaryAction?: (
    opportunityId: string,
    userId: string,
    viewerRole?: string,
    counterpartName?: string,
  ) => void | Promise<void>;
  /** Handler for secondary action (reject/skip). */
  onSecondaryAction?: (
    opportunityId: string,
    userId: string,
    viewerRole?: string,
    counterpartName?: string,
  ) => void | Promise<void>;
  /** Whether an action is currently loading for this card. */
  isLoading?: boolean;
  /** Show match score indicator. */
  showScore?: boolean;
  /** Current status fetched from server (overrides card.status if provided). */
  currentStatus?: string;
}

/**
 * Skeleton loader for opportunity cards.
 * Used during streaming or initial loading.
 */
export function OpportunitySkeleton() {
  return (
    <div className="bg-[#F8F8F8] rounded-md p-4 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gray-200 shrink-0" />
          <div className="space-y-1.5">
            <div className="h-4 w-24 bg-gray-200 rounded-sm" />
            <div className="h-3 w-32 bg-gray-200 rounded-sm" />
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <div className="h-7 w-20 bg-gray-200 rounded-sm" />
          <div className="h-7 w-12 bg-gray-200 rounded-sm" />
        </div>
      </div>

      {/* Body Skeleton */}
      <div className="space-y-2">
        <div className="h-4 w-full bg-gray-200 rounded-sm" />
        <div className="h-4 w-[90%] bg-gray-200 rounded-sm" />
        <div className="h-4 w-[40%] bg-gray-200 rounded-sm" />
      </div>

      {/* Narrator Skeleton */}
      <div className="mt-4 h-8 w-48 bg-gray-200 rounded-md" />
    </div>
  );
}

/**
 * Shared opportunity card component for home page and chat messages.
 * Renders the same format with:
 * - Avatar, name, and mutual intents label
 * - Primary and secondary action buttons
 * - Main text (personalized summary)
 * - Narrator chip (Index or introducer)
 */
export default function OpportunityCard({
  card,
  onPrimaryAction,
  onSecondaryAction,
  isLoading = false,
  showScore = false,
  currentStatus,
}: OpportunityCardProps) {
  const router = useRouter();
  const [actionTaken, setActionTaken] = useState<
    "accepted" | "rejected" | null
  >(null);
  const [actionError, setActionError] = useState(false);

  // Use currentStatus if provided (fetched from server), otherwise fall back to card.status
  const effectiveStatus = currentStatus ?? card.status;

  // Check if the opportunity status allows actions
  const canTakeAction = isActionableStatus(effectiveStatus);
  const statusMessage = getStatusMessage(effectiveStatus);


  const handlePrimaryAction = async () => {
    if (onPrimaryAction) {
      setActionError(false);
      try {
        await onPrimaryAction(
          card.opportunityId,
          card.userId,
          card.viewerRole,
          card.name,
        );
        setActionTaken("accepted");
      } catch {
        setActionError(true);
      }
    }
  };

  const handleSecondaryAction = async () => {
    if (onSecondaryAction) {
      setActionError(false);
      try {
        await onSecondaryAction(
          card.opportunityId,
          card.userId,
          card.viewerRole,
          card.name,
        );
        setActionTaken("rejected");
      } catch {
        setActionError(true);
      }
    }
  };

  const handleProfileClick = () => {
    router.push(`/u/${card.userId}`);
  };

  const handleNarratorClick = () => {
    if (card.narratorChip?.userId) {
      router.push(`/u/${card.narratorChip.userId}`);
    }
  };

  // If primary action failed, show error and retry
  if (actionError) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 my-2 text-center text-sm">
        <p className="text-red-600 mb-2">Something went wrong. Please try again.</p>
        <button
          type="button"
          onClick={() => setActionError(false)}
          className="text-[#041729] font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const hasActions = !actionTaken && canTakeAction && (onPrimaryAction || onSecondaryAction);
  const showResolvedStatus = !canTakeAction && statusMessage;

  return (
    <div className={cn("rounded-md p-4", getCardWrapperClass(effectiveStatus))}>
      {/* Header: Avatar, Name, Mutual Intents, Actions */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div
          className="flex items-center gap-2 min-w-0 cursor-pointer"
          role="link"
          tabIndex={0}
          onClick={handleProfileClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleProfileClick();
            }
          }}
          aria-label={`View profile of ${card.name || "Someone"}`}
        >
          <UserAvatar
            id={card.userId}
            name={card.name || "User"}
            avatar={card.avatar || null}
            size={32}
            className="shrink-0"
          />
          <div className="min-w-0">
            <h4 className="font-bold text-gray-900 text-sm hover:underline">
              {card.viewerRole === "introducer" && card.headline
                ? card.headline
                : card.name || "Someone"}
            </h4>
            <p className="text-[11px] text-[#3D3D3D]">
              {card.mutualIntentsLabel || "Potential connection"}
            </p>
          </div>
        </div>
        {hasActions && (
          <div className="flex gap-1.5 shrink-0">
            {onPrimaryAction && (
              <button
                type="button"
                disabled={isLoading}
                className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handlePrimaryAction}
              >
                {isLoading
                  ? "On it..."
                  : card.primaryActionLabel || "Start Chat"}
              </button>
            )}
            {onSecondaryAction && (
              <button
                type="button"
                disabled={isLoading}
                className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleSecondaryAction}
              >
                {card.secondaryActionLabel || "Skip"}
              </button>
            )}
          </div>
        )}
        {actionTaken && (
          <div className="flex items-center gap-1.5 shrink-0 text-sm text-gray-500">
            <Check className="w-4 h-4 text-green-600 shrink-0" />
            <span>{actionTaken === "accepted" ? "Sent" : "Dismissed"}</span>
          </div>
        )}
        {!actionTaken && showResolvedStatus && (
          <div className="shrink-0">
            {effectiveStatus === "accepted" && (
              <span className="inline-flex items-center gap-1.5 text-green-600 text-xs font-semibold font-mono">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Connected
              </span>
            )}
            {effectiveStatus === "rejected" && (
              <span className="inline-flex items-center gap-1 text-red-500 text-xs font-medium">
                <X className="w-3 h-3" />
                Declined
              </span>
            )}
            {effectiveStatus === "expired" && (
              <span className="inline-flex items-center gap-1 text-amber-500 text-xs font-medium">
                <Clock className="w-3 h-3" />
                Expired
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main Text (Personalized Summary) */}
      <div className="text-[14px] text-[#3D3D3D] leading-relaxed [&_a]:text-[#4091BB] [&_a]:underline [&_a]:underline-offset-1">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {card.mainText}
        </ReactMarkdown>
      </div>

      {/* Narrator Chip */}
      {card.narratorChip && (
        <div className="mt-3">
          <div
            className={cn(
              "inline-flex items-center gap-2.5 px-3 py-1 rounded-md",
              getNarratorChipClass(effectiveStatus),
              card.narratorChip.userId && "cursor-pointer transition-colors",
              card.narratorChip.userId && getNarratorHoverClass(effectiveStatus),
            )}
            {...(card.narratorChip.userId
              ? {
                  role: "link" as const,
                  tabIndex: 0,
                  onClick: handleNarratorClick,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleNarratorClick();
                    }
                  },
                  "aria-label": `View profile of ${card.narratorChip.name}`,
                }
              : {})}
          >
            <div className="relative shrink-0">
              {card.narratorChip.name === "Index" ? (
                <Bot className="w-7 h-7 text-[#3D3D3D]" />
              ) : (
                <UserAvatar
                  name={card.narratorChip.name}
                  avatar={card.narratorChip.avatar ?? null}
                  size={28}
                />
              )}
            </div>
            <span className="text-[13px] text-[#3D3D3D]">
              <span
                className={cn(
                  "font-semibold",
                  card.narratorChip.userId && "hover:underline",
                )}
              >
                {card.narratorChip.name}:
              </span>{" "}
              {card.narratorChip.text}
            </span>
          </div>
        </div>
      )}

      {/* Match score (subtle indicator, optional) */}
      {showScore && typeof card.score === "number" && card.score > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          {Math.round(card.score * 100)}% match
        </div>
      )}
    </div>
  );
}
