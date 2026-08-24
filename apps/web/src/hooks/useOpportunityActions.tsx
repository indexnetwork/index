import { useCallback, useState } from "react";
import { useNavigate } from "react-router";

import { useOpportunities } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useConversation } from "@/contexts/ConversationContext";

/** Intent scope threaded into opportunity status/start-chat calls, if any. */
export type OpportunityActionScope =
  | { scopeType: "intent"; scopeId: string }
  | undefined;

interface UseOpportunityActionsOptions {
  /** Optional intent scope applied to accept/reject/start-chat calls. */
  scope?: OpportunityActionScope;
  /** Called after an opportunity resolves so callers can drop it from their local list. */
  onRemove?: (opportunityId: string) => void;
}

/**
 * Shared accept/reject/start-chat handling for opportunity cards. Used by the
 * chat message render and the intent detail view so both surfaces share
 * identical opportunity behavior. (The uptake-preflight modal flow is retired
 * with the pre-accept uptake questions.)
 */
export function useOpportunityActions({
  scope,
  onRemove,
}: UseOpportunityActionsOptions = {}) {
  const navigate = useNavigate();
  const opportunitiesService = useOpportunities();
  const { error: showError, success: showSuccess } = useNotifications();
  const { refreshConversations } = useConversation();

  const [opportunityStatusMap, setOpportunityStatusMap] = useState<
    Record<string, string>
  >({});
  const [opportunityActionLoading, setOpportunityActionLoading] = useState<
    Record<string, boolean>
  >({});
  const handleOpportunityAction = useCallback(
    async (
      opportunityId: string,
      action: "accepted" | "rejected",
      fallbackUserId?: string,
      viewerRole?: string,
      counterpartName?: string,
    ) => {
      const isIntroducer = viewerRole === "introducer";

      // Accepted + non-introducer: atomically accept the opp and resolve the DM
      // in one round-trip via POST /opportunities/:id/start-chat.
      if (action === "accepted" && !isIntroducer) {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
        try {
          const result = await opportunitiesService.startChat(opportunityId, scope);
          setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
          onRemove?.(opportunityId);
          refreshConversations();
          // Always route to the h2h chat page (`/u/:peer/chat` renders `ChatView`).
          // `/chat/:id` routes to the A2A NegotiationDetailPage and does not show
          // the in-chat opportunity context.
          navigate(`/u/${result.counterpartUserId ?? fallbackUserId ?? ""}/chat`);
        } catch (error) {
          showError(error instanceof Error ? error.message : "Failed to start chat");
        } finally {
          setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
        }
        return;
      }

      // For rejected or introducer accepted: proceed immediately without modal
      setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
      try {
        const effectiveStatus = isIntroducer && action === "accepted" ? "pending" : action;
        const result = await opportunitiesService.updateStatus(opportunityId, effectiveStatus, scope);
        setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: effectiveStatus }));

        if (action === "accepted" && isIntroducer) {
          showSuccess(
            "Introduction sent",
            `${counterpartName || "They"} will be notified and can accept to start the conversation.`,
          );
        }

        onRemove?.(opportunityId);

        // For rejected accepted non-introducer (shouldn't happen but just in case)
        const counterpartUserId = result.counterpartUserId ?? fallbackUserId;
        if (action === "accepted" && !isIntroducer && counterpartUserId) {
          navigate(`/u/${counterpartUserId}/chat`);
        }
      } catch (error) {
        showError(error instanceof Error ? error.message : "Failed to update opportunity");
      } finally {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, navigate, showError, showSuccess, refreshConversations, onRemove, scope],
  );

  /**
   * Start Chat handler for an orchestrator-streamed draft card. Uses the
   * atomic POST /opportunities/:id/start-chat endpoint to flip the opp to
   * `accepted` and resolve the pair's conversation in one round-trip, then
   * navigates to the h2h chat.
   */
  const handleStreamingDraftStartChat = useCallback(
    async (opportunityId: string, counterpartUserId: string) => {
      setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
      try {
        const result = await opportunitiesService.startChat(opportunityId, scope);
        setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
        refreshConversations();
        navigate(`/u/${result.counterpartUserId ?? counterpartUserId}/chat`);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Failed to start chat");
      } finally {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, navigate, showError, refreshConversations, scope],
  );

  // The uptake-preflight modal is retired; nothing renders here any more.
  const opportunityModalElement = null;

  return {
    opportunityStatusMap,
    setOpportunityStatusMap,
    opportunityActionLoading,
    handleOpportunityAction,
    handleStreamingDraftStartChat,
    opportunityModalElement,
  };
}
