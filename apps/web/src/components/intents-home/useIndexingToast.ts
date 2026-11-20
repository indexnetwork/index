import { useCallback } from "react";
import { useNavigate } from "react-router";

import { useIntents } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";

/**
 * After an intent is created: an INDEXING toast with the intent's words and an undo.
 * Undo archives the intent and goes back to /i/new to write it again.
 */
export function useIndexingToast(onUndone?: () => void) {
  const { addNotification } = useNotifications();
  const intentsService = useIntents();
  const navigate = useNavigate();

  return useCallback((intent: { id: string; text: string }) => {
    addNotification({
      type: "intent_indexing",
      title: "indexing",
      message: intent.text,
      duration: 10_000,
      onAction: async () => {
        await intentsService.archiveIntent(intent.id);
        onUndone?.();
        navigate("/i/new");
      },
    });
  }, [addNotification, intentsService, navigate, onUndone]);
}
