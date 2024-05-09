import { useEffect, useState, useRef, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import { useIndexConversation } from "@/components/sections/IndexConversation/IndexConversationContext";
import axios, { CancelTokenSource } from "axios";

export const useOrderedFetch = () => {
  const { fetchIndex, setViewedIndex, fetchIndexWithCreator } = useApp();
  const { fetchIndexItems } = useIndexConversation();
  const [loading, setLoading] = useState(false);
  const cancelSourceRef = useRef<CancelTokenSource | null>(null);

  const fetchDataForNewRoute = useCallback(
    async (id: string) => {
      if (cancelSourceRef.current) {
        cancelSourceRef.current.cancel("Operation canceled due to new request");
      }
      cancelSourceRef.current = axios.CancelToken.source();
      setLoading(true);

      console.log("77 Fetching data for new route:", id);
      try {
        await fetchIndex(id, { cancelSource: cancelSourceRef.current });

        await fetchIndexItems(id, { cancelSource: cancelSourceRef.current });

        fetchIndexWithCreator(id, {
          cancelSource: cancelSourceRef.current,
        });
      } catch (err: any) {
        console.error("Error in ordered fetching:", err);
        if (err.name !== "AbortError") {
          console.error("Error in ordered fetching:", err);
        }
      } finally {
        setLoading(false);
      }
    },
    [fetchIndex, fetchIndexItems, setViewedIndex],
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
    loading,
  };
};
