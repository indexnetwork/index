import { useApi } from "@/context/APIContext";
import { useAuth } from "@/context/AuthContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { INDEX_CREATED, trackEvent } from "@/services/tracker";
import { createIndex, fetchIndex } from "@/store/api";
import { fetchDID } from "@/store/api/did";
import { fetchConversation } from "@/store/api/conversation";
import { useAppDispatch } from "@/store/store";
import { CancelTokenSource } from "axios";
import { useRouter } from "next/navigation";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import {
  AccessControlCondition,
  Conversation,
  Indexes,
  Users,
} from "types/entity";
import { DEFAULT_CREATE_INDEX_TITLE } from "utils/constants";

type AppContextProviderProps = {
  children: ReactNode;
};

export enum IndexListTabKey {
  ALL = "all",
  OWNED = "owned",
  STARRED = "starred",
}

export interface AppContextValue {
  indexes: Indexes[];
  leftSectionIndexes: Indexes[];
  loading: boolean;
  setIndexes: (indexes: Indexes[]) => void;
  fetchIndexes: (did: string) => void;
  setTransactionApprovalWaiting: (visible: boolean) => void;
  leftTabKey: IndexListTabKey;
  setLeftTabKey: (key: IndexListTabKey) => void;
  rightTabKey: string;
  setRightTabKey: (key: string) => void;
  leftSidebarOpen: boolean;
  setLeftSidebarOpen: (visible: boolean) => void;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: (visible: boolean) => void;
  editProfileModalVisible: boolean;
  setEditProfileModalVisible: (visible: boolean) => void;
  updateIndex: (index: Indexes) => void;
  updateUserIndexState: (index: Indexes, value: boolean) => void;
  userProfile: Users | undefined;
  setUserProfile: (profile: Users | undefined) => void;
  viewedIndex: Indexes | undefined;
  setViewedIndex: (index: Indexes | undefined) => void;
  viewedConversation: Conversation | undefined;
  setViewedConversation: (conversation: Conversation | undefined) => void;
  fetchProfile: (did: string) => void;
  fetchIndexWithCreator: (
    indexId: string,
    {
      cancelSource,
    }: {
      cancelSource?: CancelTokenSource;
    },
  ) => Promise<void>;
  handleCreate: (title: string) => Promise<void>;
  handleCreatePublic: (title: string) => Promise<void>;
  handleTransactionCancel: () => void;
  transactionApprovalWaiting: boolean;
  createModalVisible: boolean;
  setCreateModalVisible: (visible: boolean) => void;
  guestModalVisible: boolean;
  setGuestModalVisible: (visible: boolean) => void;
  createConditions: (conditions: AccessControlCondition[]) => Promise<void>;
}

export const AppContext = createContext<AppContextValue>({} as AppContextValue);

export const AppContextProvider = ({ children }: AppContextProviderProps) => {
  const {
    id,
    conversationId,
    path,
    isLanding,
    isDID,
    isIndex,
    isConversation,
  } = useRouteParams();
  const { api, ready: apiReady } = useApi();
  const { session, userDID } = useAuth();
  const router = useRouter();
  const dispatch = useAppDispatch();

  const [indexes, setIndexes] = useState<Indexes[]>([]);
  const [viewedIndex, setViewedIndex] = useState<Indexes | undefined>();
  const [viewedConversation, setViewedConversation] = useState<
    Conversation | undefined
  >();
  const [userProfile, setUserProfile] = useState<Users | undefined>();
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [guestModalVisible, setGuestModalVisible] = useState(false);
  const [editProfileModalVisible, setEditProfileModalVisible] = useState(false);
  const [transactionApprovalWaiting, setTransactionApprovalWaiting] =
    useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightTabKey, setRightTabKey] = useState<string>("history");
  const [leftTabKey, setLeftTabKey] = useState<IndexListTabKey>(
    IndexListTabKey.ALL,
  );
  const [loading, setLoading] = useState(false);

  const isFetchingRef = useRef(false);
  const isFetchingConversationRef = useRef(false);
  const isFetchingDIDRef = useRef(false);

  const fetchAndStoreConversation = useCallback(async () => {
    try {
      if (!apiReady || !conversationId || !api) return;
      if (isFetchingConversationRef.current) return;

      isFetchingConversationRef.current = true;

      const conversation = await dispatch(
        fetchConversation({ cID: conversationId, api }),
      ).unwrap();

      isFetchingConversationRef.current = false;
    } catch (error) {
      router.push(`/${userDID}`);
    }
  }, [dispatch, apiReady, api, conversationId]);

  const fetchAndStoreIndex = useCallback(
    async (indexID: string) => {
      try {
        if (!apiReady || !api || !indexID) return;
        if (isFetchingRef.current) return;

        isFetchingRef.current = true;

        await dispatch(fetchIndex({ indexID, api })).unwrap();

        isFetchingRef.current = false;
      } catch (error) {
        console.error("Error fetching index:", error);
      }
    },
    [dispatch, apiReady, api],
  );

  const fetchAndStoreDID = useCallback(
    async (didID: string) => {
      try {
        if (!apiReady || !api || !didID) return;
        if (isFetchingDIDRef.current) return;

        isFetchingDIDRef.current = true;

        await dispatch(
          fetchDID({ didID, api, isUser: session?.did.parent === didID }),
        ).unwrap();

        isFetchingDIDRef.current = false;
      } catch (error) {
        console.error("Error fetching DID:", error);
      }
    },
    [dispatch, apiReady, api],
  );

  useEffect(() => {
    if (path) {
      router.push("/");
      return;
    }

    if (isLanding || !apiReady) return;

    if (isConversation) {
      console.log("fetching conversation");
      fetchAndStoreConversation();
    }

    if (isIndex && id) {
      console.log("fetching index", id);
      fetchAndStoreIndex(id);
    }

    if (isDID && id) {
      console.log("fetching DID", id);
      fetchAndStoreDID(id);
    }
  }, [
    path,
    apiReady,
    isLanding,
    isConversation,
    fetchAndStoreConversation,
    fetchAndStoreDID,
    fetchAndStoreIndex,
  ]);

  const leftSectionIndexes = useMemo(() => {
    if (leftTabKey === IndexListTabKey.ALL) {
      return indexes;
    }
    if (leftTabKey === IndexListTabKey.OWNED) {
      return indexes.filter((i) => i.did.owned);
    }
    if (leftTabKey === IndexListTabKey.STARRED) {
      return indexes.filter((i) => i.did.starred);
    }
    return [];
  }, [indexes, leftTabKey]);

  const fetchIndexes = useCallback(
    async (did: string): Promise<void> => {
      console.log("fetching indexes");
      if (!apiReady) return;
      try {
        const fetchedIndexes = await api!.getAllIndexes(did);

        setIndexes(fetchedIndexes);
      } catch (error) {
        console.error("Error fetching indexes", error);
        toast.error("Error fetching indexes, please refresh the page");
      }
    },
    [apiReady, api],
  );

  const fetchIndexWithCreator = useCallback(
    async (
      indexId: string,
      {
        cancelSource,
      }: {
        cancelSource?: CancelTokenSource;
      },
    ): Promise<void> => {
      try {
        if (!apiReady) return;
        if (!viewedIndex?.roles.owner) {
          const indexWithIsOwner = await api!.getIndexWithIsCreator(indexId, {
            cancelSource,
          });
          setViewedIndex(indexWithIsOwner);
        }
      } catch (error) {
        console.error("Error fetching index", error);
      }
    },
    [apiReady, api],
  );

  const handleTransactionCancel = useCallback(() => {
    setTransactionApprovalWaiting(false);
  }, []);

  const handleCreate = useCallback(
    async (title: string = DEFAULT_CREATE_INDEX_TITLE) => {
      setCreateModalVisible(false);
      setTransactionApprovalWaiting(true);
      try {
        if (!apiReady || !api) return;
        const index = await dispatch(createIndex({ title, api })).unwrap();
        toast.success("Index created successfully");
        router.push(`/${index.id}`);
      } catch (err: any) {
        let message = "";
        if (err?.code === -32603) {
          message = ": Not enough balance";
        }
        if (err?.code === "ACTION_REJECTED") {
          message = ": Action rejected";
        }
        console.error("Couldn't create index", err.code);
        toast.error(`Couldn't create index${message}`);
        trackEvent(INDEX_CREATED);
      } finally {
        setTransactionApprovalWaiting(false);
      }
    },
    [apiReady, router],
  );

  const handleCreatePublic = useCallback(
    async (title: string = DEFAULT_CREATE_INDEX_TITLE) => {
      setTransactionApprovalWaiting(true);
      try {
        if (!apiReady) return;

        api?.setSessionToken(
          "eyJzZXNzaW9uS2V5U2VlZCI6IkM4YjB0SzJBTHNBOWRkLzVSV2tEUGE0ZEpOS3NKR3VyL2UzVXNxRElXU0E9IiwiY2FjYW8iOnsiaCI6eyJ0IjoiZWlwNDM2MSJ9LCJwIjp7ImRvbWFpbiI6ImxvY2FsaG9zdDozMDAwIiwiaWF0IjoiMjAyNC0wNS0yM1QwODoxMToyNC4yMjhaIiwiaXNzIjoiZGlkOnBraDplaXAxNTU6MToweEIxZEI4MTQ3YzZiNWRFMTVENzYyNTY2QzgzYTBjNmJlODc0ODFBN2UiLCJhdWQiOiJkaWQ6a2V5Ono2TWtnSE1VcW9KTDZpVWlSa1pDWXl4eTJZeFFkaEplVFpvckR4QXJhQlRIdTFnVCIsInZlcnNpb24iOiIxIiwibm9uY2UiOiJyUzZuMkoyNjZMIiwiZXhwIjoiMjAyNC0wNi0xN1QwODoxMToyNC4yMjhaIiwic3RhdGVtZW50IjoiR2l2ZSB0aGlzIGFwcGxpY2F0aW9uIGFjY2VzcyB0byBzb21lIG9mIHlvdXIgZGF0YSBvbiBDZXJhbWljIiwicmVzb3VyY2VzIjpbImNlcmFtaWM6Ly8qIl19LCJzIjp7InQiOiJlaXAxOTEiLCJzIjoiMHg1NzkyMmMwMjcwZTcxNmYwMTAwOWNjNzQ1MjM0MzdkMzBhZGM2NzM2NDY3MjAxNTg5NWU2YmRiZGRiNDBlNzc1NDQ4OTU5NmVmYzNhNjhkMGJjZTI0Y2EzYjg1OGFlNzFjODFkZWI2OTZmYjAzN2Q0Y2E5OGIzMjhlNWU3N2ZhZTFiIn19fQ",
        );
        const doc = await api!.createIndex(title);
        if (!doc) {
          throw new Error("API didn't return a doc");
        }
        setIndexes((prevIndexes) => [doc, ...prevIndexes]);
        toast.success("Index created successfully");
        router.push(`/${doc.id}`);
      } catch (err: any) {
        let message = "";
        if (err?.code === -32603) {
          message = ": Not enough balance";
        }
        if (err?.code === "ACTION_REJECTED") {
          message = ": Action rejected";
        }
        console.error("Couldn't create index", err);
        toast.error(`Couldn't create index${message}`);
      } finally {
        setTransactionApprovalWaiting(false);
      }
    },
    [apiReady, router],
  );

  const updateIndex = useCallback(
    (index: Indexes) => {
      const updatedIndexes = indexes.map((i) => {
        if (i.id === index.id) {
          return index;
        }
        return i;
      });

      setIndexes(updatedIndexes);
    },
    [indexes],
  );

  const updateUserIndexState = useCallback(
    (index: Indexes, value: boolean) => {
      setIndexes((prevIndexes) => {
        if (value) {
          return [...prevIndexes, index];
        }
        return prevIndexes.filter((i) => i.id !== index.id);
      });
    },
    [setIndexes],
  );

  const fetchProfile = useCallback(
    async (did: string) => {
      try {
        if (!apiReady) return;
        const profile = await api!.getProfile(did);
        return profile;
      } catch (error) {
        console.error("Error fetching profile", error);
        toast.error("Error fetching profile, please refresh the page");
      }
    },
    [apiReady, api],
  );

  const handleUserProfile = useCallback(async () => {
    if (session) {
      const profile = await fetchProfile(session.id);
      setUserProfile(profile);
    }
  }, [fetchProfile, session]);

  useEffect(() => {
    handleUserProfile();
  }, [handleUserProfile]);

  const createConditions = useCallback(
    async (conditions: AccessControlCondition[]) => {
      if (!apiReady || !viewedIndex || conditions.length === 0) return;

      const newAction = await api!.postLITAction(conditions);

      const updatedIndex = await api!.updateIndex(viewedIndex?.id, {
        signerFunction: newAction.cid,
      });

      setViewedIndex(updatedIndex);
    },
    [apiReady, viewedIndex],
  );

  const contextValue: AppContextValue = {
    indexes,
    leftSectionIndexes,
    setIndexes,
    fetchIndexes,
    setCreateModalVisible,
    createModalVisible,
    setGuestModalVisible,
    guestModalVisible,
    setTransactionApprovalWaiting,
    leftSidebarOpen,
    setLeftSidebarOpen,
    rightSidebarOpen,
    setRightSidebarOpen,
    setEditProfileModalVisible,
    rightTabKey,
    setRightTabKey,
    leftTabKey,
    setLeftTabKey,
    userProfile,
    setUserProfile,
    viewedIndex,
    setViewedIndex,
    viewedConversation,
    setViewedConversation,
    updateUserIndexState,
    updateIndex,
    fetchProfile,
    fetchIndexWithCreator,
    handleCreate,
    loading,
    handleTransactionCancel,
    editProfileModalVisible,
    transactionApprovalWaiting,
    createConditions,
    handleCreatePublic,
  };

  return (
    <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
  );
};

export const useApp = () => {
  const contextValue = useContext(AppContext);
  if (!contextValue) {
    throw new Error("useAppContext must be used within a AppContextProvider");
  }
  return contextValue;
};
