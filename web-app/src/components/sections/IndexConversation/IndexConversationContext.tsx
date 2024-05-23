import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { GetItemQueryParams } from "@/services/api-service-new";
import { IndexItem } from "@/types/entity";
import { CancelTokenSource } from "axios";
import {
  createContext,
  useCallback,
  useContext,
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
  fetchIndexItems: (
    id: string,
    {
      cancelSource,
      resetCursor,
      params,
    }: {
      cancelSource?: CancelTokenSource;
      resetCursor?: boolean;
      params?: GetItemQueryParams;
    },
  ) => Promise<void>;
  fetchMoreIndexItems: (
    id: string,
    {
      cancelSource,
      resetCursor,
      params,
    }: {
      cancelSource?: CancelTokenSource;
      resetCursor?: boolean;
      params?: GetItemQueryParams;
    },
  ) => Promise<void>;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  searchLoading: boolean;
  setSearchLoading: (loading: boolean) => void;
  addItemLoading: boolean;
  setAddItemLoading: (loading: boolean) => void;
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
  const [searchLoading, setSearchLoading] = useState(false);
  const [addItemLoading, setAddItemLoading] = useState(false);

  const { api, ready: apiReady } = useApi();
  const { viewedIndex, fetchIndex } = useApp();

  const fetchingIndexItems = useRef(false);

  const fetchIndexItems = useCallback(
    async (
      indexId: string,
      {
        cancelSource,
        resetCursor,
        params,
      }: {
        cancelSource?: CancelTokenSource;
        resetCursor?: boolean;
        params?: GetItemQueryParams;
      } = {},
    ): Promise<void> => {
      if (!apiReady) return;
      if (fetchingIndexItems.current) return;

      fetchingIndexItems.current = true;

      setSearchLoading(true);
      try {
        const itemParams: GetItemQueryParams = {};

        if (!resetCursor && itemsState?.cursor) {
          itemParams.cursor = itemsState.cursor;
        }

        if (params?.query) {
          itemParams.query = params.query;
        }

        // if (viewedIndex.id !== id) return;
        const response = await api!.getItems(indexId, {
          queryParams: itemParams,
          cancelSource,
        });

        if (response) {
          setItemsState({
            items:
              resetCursor || itemParams.query
                ? response.items
                : [...itemsState.items, ...response.items],
            cursor: response.endCursor,
          });
        }
      } catch (err: any) {
        console.error("Error fetching index links", err);
      } finally {
        setSearchLoading(false);
        fetchingIndexItems.current = false;
      }
    },
    [api, apiReady],
  );

  const fetchMoreIndexItems = useCallback(
    async (
      indexId: string,
      {
        cancelSource,
        resetCursor,
        params,
      }: {
        cancelSource?: CancelTokenSource;
        resetCursor?: boolean;
        params?: GetItemQueryParams;
      } = {},
    ): Promise<void> => {
      if (!apiReady) return;
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

        // if (viewedIndex.id !== id) return;
        const response = await api!.getItems(indexId, {
          queryParams: itemParams,
          cancelSource,
        });

        if (response) {
          setItemsState((prevState) => {
            const newState = {
              items:
                resetCursor || itemParams.query
                  ? response.items
                  : [...prevState.items, ...response.items],
              cursor: response.endCursor || prevState.cursor,
            };
            return newState;
          });
        }
      } catch (err: any) {
        console.error("Error fetching index links", err);
      } finally {
        // setLoading(false);
        fetchingIndexItems.current = false;
      }
    },
    [api, apiReady, itemsState],
  );

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
    if (!viewedIndex) return;
    fetchMoreIndexItems(viewedIndex.id);
  }, [fetchMoreIndexItems]);

  return (
    <IndexConversationContext.Provider
      value={{
        itemsState,
        loading,
        setLoading,
        searchLoading,
        setSearchLoading,
        addItemLoading,
        setAddItemLoading,
        addItem,
        removeItem,
        loadMoreItems,
        setItemsState,
        fetchIndexItems,
        fetchMoreIndexItems,
      }}
    >
      {children}
    </IndexConversationContext.Provider>
  );
};
