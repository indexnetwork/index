import { useApi } from "@/context/APIContext";
import { useAuth } from "@/context/AuthContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { DiscoveryType } from "@/types";
import ConfirmTransaction from "components/site/modal/Common/ConfirmTransaction";
import CreateModal from "components/site/modal/CreateModal";
import { useRouter } from "next/navigation";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Indexes, Users } from "types/entity";
import { DEFAULT_CREATE_INDEX_TITLE } from "utils/constants";
import { v4 as uuidv4 } from "uuid";

type AppContextProviderProps = {
  children: ReactNode;
};

export enum IndexListTabKey {
  ALL = "all",
  OWNER = "owner",
  STARRED = "starred",
}

type TabKey = string;

export interface AppContextValue {
  indexes: Indexes[];
  loading: boolean;
  discoveryType: DiscoveryType;
  setIndexes: (indexes: Indexes[]) => void;
  fetchIndexes: (did: string) => void;
  setCreateModalVisible: (visible: boolean) => void;
  setTransactionApprovalWaiting: (visible: boolean) => void;
  leftTabKey: TabKey;
  setLeftTabKey: (key: TabKey) => void;
  rightTabKey: TabKey;
  setRightTabKey: (key: TabKey) => void;
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
}

export const AppContext = createContext<AppContextValue>({} as AppContextValue);

export const AppContextProvider = ({ children }: AppContextProviderProps) => {
  const { id } = useRouteParams();
  const { apiService: api } = useApi();
  const { session } = useAuth();
  const router = useRouter();
  // const [discoveryType, setDiscoveryType] = useState<DiscoveryType | undefined>(
  //   undefined,
  // );
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
  const [rightTabKey, setRightTabKey] = useState<TabKey>("history");
  const [leftTabKey, setLeftTabKey] = useState<TabKey>("all");
  const [loading, setLoading] = useState(false);
  const [chatID, setChatID] = useState<string | undefined>(undefined);

  const { isLanding, discoveryType } = useRouteParams();

  const fetchIndexes = useCallback(
    async (did: string) => {
      if (!api) return;
      try {
        const fetchedIndexes = await api.getAllIndexes(did);
        setIndexes(fetchedIndexes);
      } catch (error) {
        console.error("Error fetching indexes", error);
      }
    },
    [api],
  );

  const fetchIndex = useCallback(async () => {
    try {
      console.log("fetching index", id, api);
      if (!api || !id) return;
      if (discoveryType !== DiscoveryType.INDEX) return;

      const index = await api.getIndex(id);
      setViewedIndex(index);
    } catch (error) {
      console.error("Error fetching index", error);
      // Handle error appropriately
    }
  }, [api, id, discoveryType]);

  const handleTransactionCancel = useCallback(() => {
    setTransactionApprovalWaiting(false);
  }, []);

  const handleCreate = useCallback(
    async (title: string = DEFAULT_CREATE_INDEX_TITLE) => {
      setCreateModalVisible(false);
      setTransactionApprovalWaiting(true);
      try {
        if (!api) return;
        const doc = await api.createIndex(title);
        if (!doc) {
          throw new Error("API didn't return a doc");
        }
        router.push(`/discovery/${doc.id}`);
      } catch (err) {
        console.error("Couldn't create index", err);
      } finally {
        setTransactionApprovalWaiting(false);
      }
    },
    [api, router],
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
        if (!api) return;
        const profile = await api.getProfile(did);
        setViewedProfile(profile);
      } catch (error) {
        console.error("Error fetching profile", error);
        // Handle error appropriately
      }
    },
    [api],
  );

  useEffect(() => {
    setChatID((prevChatID) => {
      if (!prevChatID) {
        const newChatID = uuidv4();
        localStorage.setItem("chatterID", newChatID);
        return newChatID;
      }
      return prevChatID;
    });
  }, []);

  useEffect(() => {
    if (isLanding) return;

    let targetDID;
    if (discoveryType === DiscoveryType.INDEX) {
      if (session) {
        targetDID = session.did.parent;
      } else {
        fetchIndex();
        targetDID = viewedIndex?.ownerDID?.id;
      }
    } else if (discoveryType === DiscoveryType.DID) {
      targetDID = id;
    }

    if (targetDID) {
      fetchProfile(targetDID);
      fetchIndexes(targetDID);
    }
  }, [
    discoveryType,
    id,
    fetchIndex,
    fetchIndexes,
    fetchProfile,
    isLanding,
    session,
    viewedIndex,
  ]);

  // useEffect(() => {
  //   if (discoveryType === DiscoveryType.DID) {
  //     setLoading(true);
  //     try {
  //       fetchIndexes(id);
  //     } catch (error) {
  //       console.error("Error fetching indexes", error);
  //     } finally {
  //       setLoading(false);
  //     }
  //   }
  // }, [discoveryType, id, fetchIndexes]);

  const contextValue: AppContextValue = {
    discoveryType,
    indexes,
    setIndexes,
    fetchIndexes,
    setCreateModalVisible,
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
  };

  return (
    <AppContext.Provider value={contextValue}>
      {children}
      {transactionApprovalWaiting && (
        <ConfirmTransaction
          handleCancel={handleTransactionCancel}
          visible={transactionApprovalWaiting}
        />
      )}
      {createModalVisible && (
        <CreateModal
          visible={createModalVisible}
          onClose={() => setCreateModalVisible(false)}
          onCreate={handleCreate}
        />
      )}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const contextValue = useContext(AppContext);
  if (!contextValue) {
    throw new Error("useAppContext must be used within a AppContextProvider");
  }
  return contextValue;
};