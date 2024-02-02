import { useApi } from "@/components/site/context/APIContext";
import { useApp } from "@/components/site/context/AppContext";
import { IndexItem } from "@/types/entity";
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";

export type IndexItemsState = {
  items: IndexItem[];
  cursor?: string;
};

type IndexConversationContextType = {
  itemsState: IndexItemsState;
  setItemsState: (state: IndexItemsState) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: any;
  addItem: (item: IndexItem) => void;
  removeItem: (itemId: string) => void;
  loadMoreItems: () => void; // Function to load more items
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

export const IndexConversationProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [itemsState, setItemsState] = useState<IndexItemsState>({
    items: [],
    cursor: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const lastFetchedIndexId = useRef<string | undefined>(undefined);

  const { apiService: api } = useApi();
  const { viewedIndex } = useApp();

  const fetchIndexItems = useCallback(async () => {
    if (
      !api ||
      !viewedIndex ||
      loading ||
      viewedIndex.id === lastFetchedIndexId.current
    )
      return;

    setLoading(true);
    lastFetchedIndexId.current = viewedIndex.id; // Update the last fetched ID
    try {
      const body = itemsState.cursor ? { cursor: itemsState.cursor } : {};
      const response = await api.getItems(viewedIndex.id, body);

      if (response) {
        setItemsState((prevState) => ({
          items:
            lastFetchedIndexId.current === viewedIndex.id
              ? [...prevState.items, ...response.items]
              : response.items,
          cursor: response.endCursor,
        }));
      }
    } catch (error) {
      console.error("Error fetching index links", error);
      setError(error);
    } finally {
      setLoading(false);
    }
  }, [api, viewedIndex, loading]);

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

  // Effect for initial fetch and re-fetch on viewedIndex.id change
  useEffect(() => {
    fetchIndexItems();
  }, [fetchIndexItems]);

  return (
    <IndexConversationContext.Provider
      value={{
        itemsState,
        loading,
        error,
        addItem,
        removeItem,
        loadMoreItems,
        setItemsState,
        setLoading,
      }}
    >
      {children}
    </IndexConversationContext.Provider>
  );
};
