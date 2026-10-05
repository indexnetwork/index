import { useCallback, useState } from "react";

import { useOpportunities } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useConversation } from "@/contexts/ConversationContext";
import type { OpportunityLifecycleStatus } from "@/services/opportunities";

/** Intent scope threaded into opportunity status/start-chat calls, if any. */
export type OpportunityActionScope =
  | { intentId: string }
  | undefined;

/** Local radar update after this viewer accepts, so the open signal can show the chat. */
export type AcceptedOpportunityUpdate = {
  opportunityId: string;
  status: OpportunityLifecycleStatus;
  viewerCommitted?: boolean;
};

interface UseOpportunityActionsOptions {
  /** Optional intent scope applied to accept/reject/start-chat calls. */
  scope?: OpportunityActionScope;
  /** Called after an opportunity resolves so callers can drop it from their local list. */
  onRemove?: (opportunityId: string) => void;
  /** Called after accept opens a conversation. Stays on the current view. */
  onAccepted?: (update: AcceptedOpportunityUpdate) => void;
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
  onAccepted,
}: UseOpportunityActionsOptions = {}) {
  const opportunitiesService = useOpportunities();
  const { error: showError } = useNotifications();
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
      _fallbackUserId?: string,
    ) => {
      // Accept: atomically accept the opp and resolve the DM in one round-trip
      // via POST /opportunities/:id/start-chat.
      if (action === "accepted") {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
        try {
          const result = await opportunitiesService.startChat(opportunityId, scope);
          // Local "accepted" keeps the chat column up while the row is still
          // pending on the other person. A radar refresh cannot put it back.
          setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
          onRemove?.(opportunityId);
          if (result.conversationId) {
            refreshConversations();
            onAccepted?.({
              opportunityId,
              status: result.opportunity.status,
              viewerCommitted: result.opportunity.viewerCommitted ?? true,
            });
          }
        } catch (error) {
          showError(error instanceof Error ? error.message : "Failed to start chat");
        } finally {
          setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
        }
        return;
      }

      // Reject: proceed immediately, no modal.
      setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
      try {
        await opportunitiesService.updateStatus(opportunityId, action, scope);
        setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: action }));
        onRemove?.(opportunityId);
      } catch (error) {
        showError(error instanceof Error ? error.message : "Failed to update opportunity");
      } finally {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, showError, refreshConversations, onRemove, onAccepted, scope],
  );

  /**
   * Start Chat handler. Uses the atomic POST /opportunities/:id/start-chat
   * endpoint to record this viewer's accept and resolve the pair's conversation
   * in one round-trip, then opens that chat in the current view.
   */
  const handleStreamingDraftStartChat = useCallback(
    async (opportunityId: string, _counterpartUserId: string) => {
      setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
      try {
        const result = await opportunitiesService.startChat(opportunityId, scope);
        setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
        if (result.conversationId) {
          refreshConversations();
          onAccepted?.({
            opportunityId,
            status: result.opportunity.status,
            viewerCommitted: result.opportunity.viewerCommitted ?? true,
          });
        }
      } catch (error) {
        showError(error instanceof Error ? error.message : "Failed to start chat");
      } finally {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, showError, refreshConversations, onAccepted, scope],
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
