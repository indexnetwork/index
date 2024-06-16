import { useApi } from "@/context/APIContext";
import { useAuth } from "@/context/AuthContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { DiscoveryType } from "@/types";
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
import { AccessControlCondition, Indexes, Users } from "types/entity";
import { DEFAULT_CREATE_INDEX_TITLE } from "utils/constants";
import { CancelTokenSource } from "axios";
import { INDEX_CREATED, trackEvent } from "@/services/tracker";

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
  discoveryType: DiscoveryType | undefined;
  setIndexes: (indexes: Indexes[]) => void;
  fetchIndexes: (did: string) => void;
  setCreateModalVisible: (visible: boolean) => void;
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
  viewedProfile: Users | undefined;
  setViewedProfile: (profile: Users | undefined) => void;
  userProfile: Users | undefined;
  setUserProfile: (profile: Users | undefined) => void;
  viewedIndex: Indexes | undefined;
  setViewedIndex: (index: Indexes | undefined) => void;
  fetchProfile: (did: string) => void;
  fetchIndex: (
    indexId: string,
    {
      cancelSource,
    }: {
      cancelSource?: CancelTokenSource;
    },
  ) => Promise<any>;
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
  chatID: string | undefined;
  transactionApprovalWaiting: boolean;
  createModalVisible: boolean;
  createConditions: (conditions: AccessControlCondition[]) => Promise<void>;
}

export const AppContext = createContext<AppContextValue>({} as AppContextValue);

export const AppContextProvider = ({ children }: AppContextProviderProps) => {
  const { id } = useRouteParams();
  const { api, ready: apiReady } = useApi();
  const { session } = useAuth();
  const router = useRouter();
  const [indexes, setIndexes] = useState<Indexes[]>([]);
  const [viewedIndex, setViewedIndex] = useState<Indexes | undefined>();
  const [viewedProfile, setViewedProfile] = useState<Users | undefined>();
  const [userProfile, setUserProfile] = useState<Users | undefined>();
  const [createModalVisible, setCreateModalVisible] = useState(false);
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
  const [chatID, setChatID] = useState<string | undefined>(undefined);

  const prevIndexID = useRef(id);
  const isFetchingRef = useRef(false);

  const { isLanding, discoveryType, isDID, isIndex, isConversation } =
    useRouteParams();

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

  const fetchIndex = useCallback(
    async (
      indexId: string,
      {
        cancelSource,
      }: {
        cancelSource?: CancelTokenSource;
      },
    ): Promise<any> => {
      try {
        if (!apiReady || !isIndex || !indexId) return;
        // if (viewedIndex?.id === id) return;
        if (isFetchingRef.current) return;

        isFetchingRef.current = true;

        const index = await api!.getIndex(indexId, { cancelSource });
        setViewedIndex(index);

        isFetchingRef.current = false;
        return index;
      } catch (error) {
        console.error("Error fetching index", error);
        toast.error("Error fetching index, please refresh the page");
      }
    },
    [isIndex, apiReady, api],
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
        if (!apiReady) return;

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

  const handleUserProfileChange = useCallback(async () => {
    if (isLanding) return;
    if (viewedProfile && isIndex) return;
    if (!id) return;

    let targetDID;
    if (isIndex && !viewedProfile) {
      if (viewedIndex) {
        targetDID = viewedIndex?.controllerDID?.id;
      } else {
        fetchIndex(id, {}).then((index) => {
          if (index) {
            targetDID = index?.controllerDID?.id;
            fetchIndexes(targetDID);
          }
        });
      }
    }

    if (isDID) {
      targetDID = id;
    }

    if (targetDID) {
      const profile = await fetchProfile(targetDID);
      setViewedProfile(profile);
    }
  }, [isLanding, isIndex, id, fetchProfile, isDID, session, viewedIndex]); // eslint-disable-line

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

  useEffect(() => {
    if (session) {
      if (viewedProfile?.id === session.id) {
        setViewedProfile(userProfile);
      }
    }
  }, [userProfile, session, id]);

  useEffect(() => {
    handleUserProfileChange();
  }, [handleUserProfileChange]);

  useEffect(() => {
    // const newChatID = uuidv4();
    const newChatID =
      "kjzl6kcym7w8yavyrq0oqt0pziy2aqhu1vqwptjo4m6k4zdn8xy0pebyqt8hk7p";
    localStorage.setItem("chatterID", newChatID);
    setChatID(newChatID);
  }, [id]);

  useEffect(() => {
    if (viewedProfile) {
      fetchIndexes(viewedProfile.id);
    }
  }, [viewedProfile, fetchIndexes]);

  const contextValue: AppContextValue = {
    discoveryType,
    indexes,
    leftSectionIndexes,
    setIndexes,
    fetchIndexes,
    setCreateModalVisible,
    createModalVisible,
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
    viewedProfile,
    setViewedProfile,
    userProfile,
    setUserProfile,
    viewedIndex,
    setViewedIndex,
    updateUserIndexState,
    updateIndex,
    fetchProfile,
    fetchIndex,
    fetchIndexWithCreator,
    handleCreate,
    loading,
    handleTransactionCancel,
    editProfileModalVisible,
    chatID,
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
