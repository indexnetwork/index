import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { GetItemQueryParams } from "@/services/api-service-new";
import { IndexItem } from "@/types/entity";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type IndexItemsState = {
  items: IndexItem[];
  cursor?: string;
};

type IndexConversationContextType = {
  itemsState: IndexItemsState;
  setItemsState: (state: IndexItemsState) => void;
  fetchIndexItems: (resetCursor?: boolean, params?: GetItemQueryParams) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  addItem: (item: IndexItem) => void;
  removeItem: (itemId: string) => void;
  loadMoreItems: () => void;
};

const IndexConversationContext = createContext<
  IndexConversationContextType | undefined
>(undefined);

export const useIndexConversation = () => {
  const context = useContext(IndexConversationContext);
  if (!context) {
    throw new Error(
      "useIndexConversation must be used within a IndexConversationProvider",
    );
  }
  return context;
};

export const IndexConversationProvider = ({ children }: { children: any }) => {
  const [itemsState, setItemsState] = useState<IndexItemsState>({
    items: [],
    cursor: undefined,
  });
  const [loading, setLoading] = useState(false);

  const { api, ready: apiReady } = useApi();
  const { viewedIndex, fetchIndex } = useApp();

  const fetchingIndexItems = useRef(false);

  const fetchIndexItems = useCallback(
    async (resetCursor = false, params: GetItemQueryParams = {}) => {
      if (!apiReady || !viewedIndex) return;
      if (fetchingIndexItems.current) return;

      fetchingIndexItems.current = true;

      // setLoading(true);
      try {
        const itemParams: GetItemQueryParams = {};

        if (!resetCursor && itemsState?.cursor) {
          itemParams.cursor = itemsState.cursor;
        }

        if (params?.query) {
          itemParams.query = params.query;
        }

        const response = await api!.getItems(viewedIndex.id, itemParams);

        if (response) {
          setItemsState((prevState) => ({
            items:
              resetCursor || itemParams.query
                ? response.items
                : [...prevState.items, ...response.items],
            cursor: response.endCursor,
          }));
        }
      } catch (err: any) {
        console.error("Error fetching index links", err);
      } finally {
        // setLoading(false);
        fetchingIndexItems.current = false;
      }
    },
    [api, viewedIndex, itemsState.cursor, apiReady],
  );

  useEffect(() => {
    fetchIndex();
    fetchIndexItems(true);
  }, [viewedIndex?.id, fetchIndex, fetchIndexItems]);

  const addItem = useCallback((item: IndexItem) => {
    setItemsState((prevState) => ({
      ...prevState,
      items: [item, ...prevState.items],
    }));
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setItemsState((prevState) => ({
      ...prevState,
      items: prevState.items.filter((item) => item.node.id !== itemId),
    }));
  }, []);

  const loadMoreItems = useCallback(() => {
    fetchIndexItems();
  }, [fetchIndexItems]);

  return (
    <IndexConversationContext.Provider
      value={{
        itemsState,
        loading,
        addItem,
        removeItem,
        loadMoreItems,
        setItemsState,
        setLoading,
        fetchIndexItems,
      }}
    >
      {children}
    </IndexConversationContext.Provider>
  );
};
