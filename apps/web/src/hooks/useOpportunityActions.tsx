import { useCallback, useState } from "react";
import { useNavigate } from "react-router";

import { useOpportunities, useQuestionsService } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useConversation } from "@/contexts/ConversationContext";
import UptakeQuestionsModal from "@/components/UptakeQuestionsModal";
import { APIError } from "@/lib/api";
import type { UptakeAcceptanceAdvisory, UptakeAcceptanceErrorBody } from "@/services/opportunities";

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

interface UptakeModalState {
  advisory: UptakeAcceptanceAdvisory;
  retry: (questionIds: string[]) => Promise<void>;
}

function getUptakeAdvisory(error: unknown): UptakeAcceptanceAdvisory | null {
  if (!(error instanceof APIError) || error.status !== 409) return null;
  const body = error.response as Partial<UptakeAcceptanceErrorBody> | undefined;
  return body?.advisory?.code === "unresolved_uptake_questions" ? body.advisory : null;
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
  const questionsService = useQuestionsService();
  const { error: showError, success: showSuccess } = useNotifications();
  const { refreshConversations } = useConversation();

  const [opportunityStatusMap, setOpportunityStatusMap] = useState<
    Record<string, string>
  >({});
  const [opportunityActionLoading, setOpportunityActionLoading] = useState<
    Record<string, boolean>
  >({});
  const [uptakeModal, setUptakeModal] = useState<UptakeModalState | null>(null);

  const runWithUptakePreflight = useCallback(async (
    action: (acknowledgedIds?: string[]) => Promise<void>,
  ) => {
    try {
      await action();
    } catch (error) {
      const advisory = getUptakeAdvisory(error);
      if (!advisory) throw error;
      setUptakeModal({
        advisory,
        retry: async (questionIds) => {
          try {
            await action(questionIds);
            setUptakeModal(null);
          } catch (retryError) {
            const refreshed = getUptakeAdvisory(retryError);
            if (refreshed) {
              setUptakeModal((current) => current ? { ...current, advisory: refreshed } : current);
            }
            throw retryError;
          }
        },
      });
    }
  }, []);

  const handleOpportunityAction = useCallback(
    async (
      opportunityId: string,
      action: "accepted" | "rejected",
      fallbackUserId?: string,
      viewerRole?: string,
      counterpartName?: string,
      _isGhost?: boolean,
    ) => {
      const isIntroducer = viewerRole === "introducer";

      // Accepted + non-introducer: atomically accept the opp and resolve the DM
      // in one round-trip via POST /opportunities/:id/start-chat.
      if (action === "accepted" && !isIntroducer) {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: true }));
        try {
          await runWithUptakePreflight(async (acknowledgedIds) => {
            const result = await opportunitiesService.startChat(opportunityId, scope, acknowledgedIds);
            setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
            onRemove?.(opportunityId);
            refreshConversations();
            // Always route to the h2h chat page (`/u/:peer/chat` renders `ChatView`).
            // `/chat/:id` routes to the A2A NegotiationDetailPage and does not show
            // the in-chat opportunity context.
            navigate(`/u/${result.counterpartUserId ?? fallbackUserId ?? ""}/chat`);
          });
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
    [opportunitiesService, navigate, showError, showSuccess, refreshConversations, onRemove, runWithUptakePreflight, scope],
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
        await runWithUptakePreflight(async (acknowledgedIds) => {
          const result = await opportunitiesService.startChat(opportunityId, scope, acknowledgedIds);
          setOpportunityStatusMap((prev) => ({ ...prev, [opportunityId]: "accepted" }));
          refreshConversations();
          navigate(`/u/${result.counterpartUserId ?? counterpartUserId}/chat`);
        });
      } catch (error) {
        showError(error instanceof Error ? error.message : "Failed to start chat");
      } finally {
        setOpportunityActionLoading((prev) => ({ ...prev, [opportunityId]: false }));
      }
    },
    [opportunitiesService, navigate, showError, refreshConversations, runWithUptakePreflight, scope],
  );

  const uptakeModalElement = uptakeModal ? (
    <UptakeQuestionsModal
      advisory={uptakeModal.advisory}
      onAnswer={(questionId, body) => questionsService.answer(questionId, body).then(() => undefined)}
      onDismiss={(questionId) => questionsService.dismiss(questionId)}
      onContinue={uptakeModal.retry}
      onCancel={() => setUptakeModal(null)}
    />
  ) : null;

  const opportunityModalElement = uptakeModalElement;

  return {
    opportunityStatusMap,
    setOpportunityStatusMap,
    opportunityActionLoading,
    handleOpportunityAction,
    handleStreamingDraftStartChat,
    opportunityModalElement,
  };
}
