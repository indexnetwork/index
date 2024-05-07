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
import { v4 as uuidv4 } from "uuid";

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
  discoveryType: DiscoveryType;
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
  fetchIndex: () => void;
  handleCreate: (title: string) => Promise<void>;
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

  const { isLanding, discoveryType, isDID, isIndex } = useRouteParams();

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
        const sortedIndexes = fetchedIndexes.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setIndexes(sortedIndexes);
      } catch (error) {
        console.error("Error fetching indexes", error);
        toast.error("Error fetching indexes, please refresh the page");
      }
    },
    [apiReady, api],
  );

  const fetchIndex = useCallback(async (): Promise<void> => {
    try {
      if (!apiReady || !id || !isIndex) return;
      if (viewedIndex?.id === id) return;
      if (isFetchingRef.current) return;

      isFetchingRef.current = true;

      const index = await api!.getIndex(id);
      setViewedIndex(index);

      if (!index?.roles.owner) {
        const indexWithIsOwner = await api!.getIndexWithIsCreator(id);
        setViewedIndex(indexWithIsOwner);
      }

      prevIndexID.current = id;
      isFetchingRef.current = false;
    } catch (error) {
      console.error("Error fetching index", error);
      toast.error("Error fetching index, please refresh the page");
    }
  }, [id, viewedIndex, isIndex, apiReady, api]);

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

    let targetDID;
    if (isIndex && !viewedProfile) {
      if (viewedIndex) {
        targetDID = viewedIndex?.ownerDID?.id;
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
    const newChatID = uuidv4();
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
    handleCreate,
    loading,
    handleTransactionCancel,
    editProfileModalVisible,
    chatID,
    transactionApprovalWaiting,
    createConditions,
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
