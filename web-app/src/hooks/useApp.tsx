import {
  createContext, useState, useContext, useEffect, useCallback,
} from "react";
import CreateModal from "components/site/modal/CreateModal";
import EditProfileModal from "components/site/modal/EditProfileModal";
import ConfirmTransaction from "components/site/modal/Common/ConfirmTransaction";
import apiService from "services/api-service";
import {
  Indexes,
  Users,
  MultipleIndexListState,
} from "types/entity";
import { useRouter } from "next/router";
import { v4 as uuidv4 } from "uuid";
import { useAppSelector } from "./store";
import { selectProfile } from "../store/slices/profileSlice";
import api from "../services/api-service";
import { DEFAULT_CREATE_INDEX_TITLE } from "utils/constants";

export interface AppContextValue {
  indexes: Indexes[]
  setIndexes: (indexes: Indexes[]) => void
  getAllIndexes: () => void
  section: keyof MultipleIndexListState
  setSection: (section: keyof MultipleIndexListState) => void
  setCreateModalVisible: (visible: boolean) => void
  setTransactionApprovalWaiting: (visible: boolean) => void
  leftSidebarOpen: boolean
  setLeftSidebarOpen: (visible: boolean) => void
  rightSidebarOpen: boolean
  setRightSidebarOpen: (visible: boolean) => void
  viewedProfile: Users | undefined
  setViewedProfile: (profile: Users | undefined) => void
  setEditProfileModalVisible: (visible: boolean) => void
  updateUserIndexState: (index: Indexes, type: keyof MultipleIndexListState, op: string) => void
  updateIndex: (index: Indexes) => void
}

export const AppContext = createContext({} as AppContextValue);

export const AppContextProvider = ({ children }: any) => {
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [editProfileModalVisible, setEditProfileModalVisible] = useState(false);
  const [transactionApprovalWaiting, setTransactionApprovalWaiting] = useState(false);
  const [viewedProfile, setViewedProfile] = useState<Users>();
  const [section, setSection] = useState<keyof MultipleIndexListState>("all" as keyof MultipleIndexListState);
  const router = useRouter();
  const { did } = router.query;
  const profile = useAppSelector(selectProfile);

  const [indexes, setIndexes] = useState<Indexes[]>([]);

  const handleCreate = async (title: string = DEFAULT_CREATE_INDEX_TITLE) => {
    setCreateModalVisible(false);
    setTransactionApprovalWaiting(true);
    try {
      const doc = await apiService.createIndex(title);

      // ASK: why no doc check here, but below instead?
      updateUserIndexState({ ...doc, ownerDID: profile } as Indexes, "add");

      if (doc) {
        setTransactionApprovalWaiting(false);
        await router.push(`/index/[indexId]`, `/index/${doc.id}`, { shallow: true });
      }
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

  const spreadProfileToIndexes = (profile: Users) => {
    const updatedIndexes = indexes
      .map((i) => (i.ownerDID.id === profile.id ? { ...i, ownerDID: profile } : i));

    setIndexes(updatedIndexes);
  };

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

  const getAllIndexes = useCallback(async () => {
    if (!viewedProfile || !viewedProfile.id) return; // TODO: handle better maybe?

    try {
      const res = await api.getAllIndexes(viewedProfile.id);
      setIndexes(res);
    } catch (err) {
      console.error("Couldn't get indexes", err)
      alert("Couldn't get indexes :/") // TODO: handle better
    }
  }, [viewedProfile?.id]);

  useEffect(() => {
    viewedProfile && getAllIndexes();
  }, [viewedProfile?.id]);

  const activeKey = () => {
    if (did) {
      const url = new URL(`https://index.network${router.asPath}`);
      return (url.searchParams.get("section") || "all") as keyof MultipleIndexListState;
    }
    return section;
  };

  useEffect(() => {
    if (!localStorage.getItem("chatterID")) {
      localStorage.setItem("chatterID", uuidv4());
    }
  }, []);

  useEffect(() => {
    setSection(activeKey());
  }, [router.asPath]);

  useEffect(() => {
    if (!profile) return;
    viewedProfile && profile.id === viewedProfile.id && setViewedProfile(profile);
    spreadProfileToIndexes(profile);
  }, [profile]);

  return (
    <AppContext.Provider value={{
      indexes,
      setIndexes,
      getAllIndexes,
      section,
      setSection,
      setCreateModalVisible,
      setTransactionApprovalWaiting,
      leftSidebarOpen,
      setLeftSidebarOpen,
      rightSidebarOpen,
      setRightSidebarOpen,
      viewedProfile,
      setViewedProfile,
      setEditProfileModalVisible,
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
