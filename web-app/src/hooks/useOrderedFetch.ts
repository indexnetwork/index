import { useCallback } from "react";
import { useIndexConversation } from "@/components/sections/IndexConversation/IndexConversationContext";
import axios from "axios";
import { useApi } from "@/context/APIContext";
import { fetchIndex } from "@/store/api";
import { useAppDispatch } from "@/store/store";

export const useOrderedFetch = () => {
  const { setLoading } = useIndexConversation();
  const dispatch = useAppDispatch();
  const { api, ready: apiReady } = useApi();

  const fetchDataForNewRoute = useCallback(
    async (id: string) => {
      if (!apiReady || !api) return;

      try {
        dispatch(fetchIndex({ indexID: id, api }));
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
    [dispatch, api, apiReady, setLoading],
  );

  return {
    fetchDataForNewRoute,
  };
};
