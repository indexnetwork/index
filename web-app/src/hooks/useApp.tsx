'use client';
import {
  createContext, useState, useContext, useEffect, useCallback, useMemo,
} from "react";
import CreateModal from "components/site/modal/CreateModal";
import EditProfileModal from "components/site/modal/EditProfileModal";
import ConfirmTransaction from "components/site/modal/Common/ConfirmTransaction";
import {
  Indexes,
  Users,
} from "types/entity";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_CREATE_INDEX_TITLE } from "utils/constants";
import { AuthContext, AuthStatus } from "components/site/context/AuthContext";
import { useApi } from "components/site/context/APIContext";



export enum DiscoveryType {
  index = "index",
  did = "did",
  invalid = "invalid",
}

export interface AppContextValue {
  indexes: Indexes[]
  setIndexes: (indexes: Indexes[]) => void
  // getAllIndexes: () => void

  setCreateModalVisible: (visible: boolean) => void
  setTransactionApprovalWaiting: (visible: boolean) => void

  leftTabKey: string
  setLeftTabKey: (key: string) => void
  rightTabKey: string
  setRightTabKey: (key: string) => void

  leftSidebarOpen: boolean
  setLeftSidebarOpen: (visible: boolean) => void
  rightSidebarOpen: boolean
  setRightSidebarOpen: (visible: boolean) => void

  setEditProfileModalVisible: (visible: boolean) => void

  updateIndex: (index: Indexes) => void
  updateUserIndexState: (index: Indexes, op: string) => void
  viewedProfile: Users | undefined
  setViewedProfile: (profile: Users | undefined) => void

  viewedIndex: Indexes | undefined
  setViewedIndex: (index: Indexes | undefined) => void

  // userProfile: Users | undefined
  // setUserProfile: (profile: Users | undefined) => void

  discoveryType: DiscoveryType
  setDiscoveryType: (type: DiscoveryType) => void
}

export const AppContext = createContext({} as AppContextValue);

export const AppContextProvider = ({ children }: any) => {
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  const [rightTabKey, setRightTabKey] = useState("history");
  const [leftTabKey, setLeftTabKey] = useState("all");
  
  const [editProfileModalVisible, setEditProfileModalVisible] = useState(false);
  const [transactionApprovalWaiting, setTransactionApprovalWaiting] = useState(false);

  const [viewedIndex, setViewedIndex] = useState<Indexes>();
  const [viewedProfile, setViewedProfile] = useState<Users>();

  // const [userProfile, setUserProfile] = useState<Users>();

  const router = useRouter();
  // const { did } = router.query;
  // const profile = useAppSelector(selectProfile);

  // const [viewed, setViewedUser] = useState<Users>();

  const { status, session } = useContext(AuthContext); // Consume AuthContext
  const { apiService: api } = useApi(); // Consume ApiContext

  const [indexes, setIndexes] = useState<Indexes[]>([]);
  const [discoveryType, setDiscoveryType] = useState<DiscoveryType>(DiscoveryType.invalid);


  // const fetchUserProfile = useCallback(async () => {
  //   if (!session?.did) return;
  //   try {
  //     const res = await api.getProfile(session.did.parent);
  //     setUserProfile(res);
  //   } catch (err) {
  //     console.error("Couldn't get user profile", err);
  //     // Handle the error appropriately
  //   }
  // }, [api, session?.did]);

  // useEffect(() => {
  //   fetchUserProfile();
  // }, [fetchUserProfile]);

  const handleCreate = async (title: string = DEFAULT_CREATE_INDEX_TITLE) => {
    setCreateModalVisible(false);
    setTransactionApprovalWaiting(true);

    try {
      const doc = await api!.createIndex(title);
      if (!doc) {
        throw new Error("API didn't return a doc");
      }

      // updateUserIndexState({ ...doc, ownerDID: profile } as Indexes, "add");
      setTransactionApprovalWaiting(false);
      await router.push(`/index/[indexId]`, `/index/${doc.id}`);
    } catch (err) {
      console.error("Couldn't create index", err)
      alert("Couldn't create index :/") // TODO: handle better
    }
  };

  const updateIndex = (index: Indexes) => {
    const updatedIndexes = indexes
      .map((i) => (i.id === index.id ? { ...i, ...index } : i));

    setIndexes(updatedIndexes);
  };

  // const spreadProfileToIndexes = (profile: Users) => {
  //   const updatedIndexes = indexes
  //     .map((i) => (i.ownerDID.id === profile.id ? { ...i, ownerDID: profile } : i));

  //   setIndexes(updatedIndexes);
  // };

  const updateUserIndexState = (index: Indexes, op: string) => {
    let updatedIndexes = [...indexes];

    if (op === "add" && !indexes.some(i => i.id === index.id)) {
      updatedIndexes.push(index);
    } else if (op === "remove") {
      updatedIndexes = updatedIndexes.filter(i => i.id !== index.id);
    }

    setIndexes(updatedIndexes);
  };

  const handleTransactionCancel = () => {
    setTransactionApprovalWaiting(false);
  };

  // DEBUG
  useEffect(() => {
    console.log("auth changed status", status)
    // TODO: allow public view
    // if (status !== AuthStatus.CONNECTED) {
    //   return;
    // }

    console.log("session", session)

    // if (status === AuthStatus.CONNECTED) {
    //   router.push(`/discovery/${session?.did.parent}`);
    // }

    // console.log("fetchIndexes...")
    // fetchIndexes();
    // fetchProfile();
  }, [status]);


  // set the viewed profile each time the page changes (get from url param)
  // useEffect(() => {
  //   if (!router.query.did) {
  //     return;
  //   }
  //   const { did } = router.query;
  //   console.log("999 did", did)

  // }, [router.query.did]);

  // const getAllIndexes = useCallback(async () => {
  //   if (!viewedProfile || !viewedProfile.id) return; // TODO: handle better maybe?

  //   try {
  //     const res = await api.getAllIndexes(viewedProfile.id);
  //     setIndexes(res);
  //   } catch (err) {
  //     console.error("Couldn't get indexes", err)
  //     alert("Couldn't get indexes :/") // TODO: handle better
  //   }
  // }, [viewedProfile?.id]);

  // useEffect(() => {
  //   viewedProfile && getAllIndexes();
  //   console.log("viewedProfile", viewedProfile)
  // }, [viewedProfile?.id]);

  // const activeKey = () => {
  //   if (did) {
  //     const url = new URL(`https://index.network${router.asPath}`);
  //     return (url.searchParams.get("section") || "all") as keyof MultipleIndexListState;
  //   }
  //   return section;
  // };

  useEffect(() => {
    if (!localStorage.getItem("chatterID")) {
      localStorage.setItem("chatterID", uuidv4());
    }
  }, []);

  // useEffect(() => {
  //   setSection(activeKey());
  // }, [router.asPath]);

  // useEffect(() => {
  //   if (!profile) return;
  //   viewedProfile && profile.id === viewedProfile.id && setViewedProfile(profile);
  //   spreadProfileToIndexes(profile);
  // }, [profile]);

  return (
    <AppContext.Provider value={{
      indexes,
      setIndexes,
      // getAllIndexes,
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
      // userProfile,
      // setUserProfile,
      discoveryType,
      setDiscoveryType,
      viewedProfile,
      setViewedProfile,
      viewedIndex,
      setViewedIndex,
      updateUserIndexState,
      updateIndex,
    }}>
      {children}
      {/* eslint-disable-next-line max-len */}
      {transactionApprovalWaiting ? <ConfirmTransaction handleCancel={handleTransactionCancel} visible={transactionApprovalWaiting}></ConfirmTransaction> : <></>}
      {/* eslint-disable-next-line max-len */}
      {createModalVisible ? <CreateModal visible={createModalVisible} onClose={() => setCreateModalVisible(false)} onCreate={handleCreate}></CreateModal> : <></>}
      {/* eslint-disable-next-line max-len */}
      {editProfileModalVisible ? <EditProfileModal visible={editProfileModalVisible} onClose={() => setEditProfileModalVisible(false)}></EditProfileModal> : <></>}

    </AppContext.Provider>
  );
};

// Custom hook to use the Boolean context
export const useApp = () => {
  const contextValue = useContext(AppContext);
  if (contextValue === undefined) {
    throw new Error("useAppContext must be used within a AppContextProvider");
  }
  return contextValue;
};
