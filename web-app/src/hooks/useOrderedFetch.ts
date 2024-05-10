import { useEffect, useRef, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import { useIndexConversation } from "@/components/sections/IndexConversation/IndexConversationContext";
import axios, { CancelTokenSource } from "axios";
import { useApi } from "@/context/APIContext";

export const useOrderedFetch = () => {
  const { fetchIndex, fetchIndexWithCreator } = useApp();
  const { fetchIndexItems, setLoading } = useIndexConversation();
  const cancelSourceRef = useRef<CancelTokenSource | null>(null);
  const { ready: apiReady } = useApi();

  const fetchDataForNewRoute = useCallback(
    async (id: string) => {
      if (cancelSourceRef.current) {
        cancelSourceRef.current.cancel("Operation canceled due to new request");
      }
      if (!apiReady) return;
      cancelSourceRef.current = axios.CancelToken.source();
      const cancelSource = cancelSourceRef.current;

      setLoading(true);
      try {
        await fetchIndex(id, { cancelSource });
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
    [fetchIndex, fetchIndexWithCreator, fetchIndexItems, setLoading],
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
