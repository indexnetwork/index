import { useEffect, useRef, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import { useIndexConversation } from "@/components/sections/IndexConversation/IndexConversationContext";
import axios, { CancelTokenSource } from "axios";
import { useApi } from "@/context/APIContext";
import { useRouteParams } from "./useRouteParams";

export const useOrderedFetch = () => {
  const { fetchIndex, fetchIndexWithCreator } = useApp();
  const { fetchIndexItems, setLoading } = useIndexConversation();
  const cancelSourceRef = useRef<CancelTokenSource | null>(null);
  const { ready: apiReady } = useApi();
  const { isConversation, conversationId } = useRouteParams();

  const fetchDataForNewRoute = useCallback(
    async (id: string) => {
      if (cancelSourceRef.current) {
        cancelSourceRef.current.cancel("Operation canceled due to new request");
      }
      if (!apiReady) return;
      cancelSourceRef.current = axios.CancelToken.source();
      const cancelSource = cancelSourceRef.current;

      console.log("66 Fetching data for new route");

      console.log(
        "67 isConversation",
        isConversation,
        "conversationId",
        conversationId,
      );

      try {
        await fetchIndex(id, { cancelSource });
        setLoading(true);
        await fetchIndexItems(id, { cancelSource });
        await fetchIndexWithCreator(id, { cancelSource });
      } catch (err: any) {
        if (axios.isCancel(err)) {
          console.warn("Request was canceled:", err.message);
        } else {
          console.error("Error in ordered fetching:", err);
        }
      } finally {
        setLoading(false);
      }
    },
    [
      fetchIndex,
      fetchIndexWithCreator,
      apiReady,
      fetchIndexItems,
      setLoading,
      isConversation,
      conversationId,
    ],
  );

  useEffect(() => {
    return () => {
      if (cancelSourceRef.current) {
        cancelSourceRef.current.cancel("Component unmounted");
      }
    };
  }, []);

  return {
    fetchDataForNewRoute,
  };
};
