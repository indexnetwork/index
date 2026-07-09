import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useOpportunities } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useConversation } from "@/contexts/ConversationContext";
import InviteMessageModal from "@/components/InviteMessageModal";

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

interface InviteModalState {
  userId: string;
  userName: string;
  message: string;
  loading: boolean;
  opportunityId: string;
}

/**
 * Shared accept/reject/start-chat handling for opportunity cards, including the
 * ghost-user invite modal flow. Used by the chat message render and the intent
 * detail view so both surfaces share identical opportunity behavior.
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
  const [inviteModal, setInviteModal] = useState<InviteModalState | null>(null);
  const inviteModalResolveRef = useRef<((msg: string | null) => void) | null>(
    null,
  );

  const handleOpportunityAction = useCallback(
    async (
      opportunityId: string,
      action: "accepted" | "rejected",
      fallbackUserId?: string,
      viewerRole?: string,
      counterpartName?: string,
      isGhost?: boolean,
    ) => {
      const isIntroducer = viewerRole === "introducer";

      // Ghost + accepted + non-introducer: show modal immediately, fetch AI message in background
      if (action === "accepted" && !isIntroducer && isGhost) {
        const name = counterpartName ?? "them";
        const displayUserId = fallbackUserId ?? "";

        setInviteModal({ userId: displayUserId, userName: name, message: "", loading: true, opportunityId });

        opportunitiesService.getInviteMessage(opportunityId)
          .then(({ message }) => {
            setInviteModal((prev) => prev?.opportunityId === opportunityId ? { ...prev, message, loading: false } : prev);
          })
          .catch(() => {
            setInviteModal((prev) => prev?.opportunityId === opportunityId ? { ...prev, loading: false } : prev);
          });

        const finalMessage = await new Promise<string | null>((resolve) => {
          inviteModalResolveRef.current = resolve;
        });

        if (finalMessage === null) {
          throw new Error("user_cancelled");
        }

        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
        try {
          const result = await opportunitiesService.updateStatus(opportunityId, "accepted", scope);
          setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
          onRemove?.(opportunityId);
          const counterpartUserId = result.counterpartUserId ?? fallbackUserId;
          if (counterpartUserId) {
            navigate(`/u/${counterpartUserId}/chat`, { state: { prefill: finalMessage, autoSend: true } });
          }
        } catch (error) {
          showError(error instanceof Error ? error.message : "Failed to update opportunity");
        } finally {
          setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
        }
        return;
      }

      // Non-ghost + accepted + non-introducer: atomically accept the opp and
      // resolve the DM in one round-trip via POST /opportunities/:id/start-chat.
      if (action === "accepted" && !isIntroducer && !isGhost) {
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

  const inviteModalElement = inviteModal ? (
    <InviteMessageModal
      userName={inviteModal.userName}
      message={inviteModal.message}
      loading={inviteModal.loading}
      onMessageChange={(msg) => setInviteModal((prev) => prev ? { ...prev, message: msg } : null)}
      onConfirm={() => {
        const resolve = inviteModalResolveRef.current;
        const msg = inviteModal.message;
        inviteModalResolveRef.current = null;
        setInviteModal(null);
        resolve?.(msg);
      }}
      onCancel={() => {
        const resolve = inviteModalResolveRef.current;
        inviteModalResolveRef.current = null;
        setInviteModal(null);
        resolve?.(null);
      }}
    />
  ) : null;

  return {
    opportunityStatusMap,
    setOpportunityStatusMap,
    opportunityActionLoading,
    handleOpportunityAction,
    handleStreamingDraftStartChat,
    inviteModalElement,
  };
}
