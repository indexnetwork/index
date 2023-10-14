import {
	createContext, useState, useContext, useEffect,
} from "react";
import { appConfig } from "config";
import CreateModal from "components/site/modal/CreateModal";
import EditProfileModal from "components/site/modal/EditProfileModal";
import ConfirmTransaction from "components/site/modal/Common/ConfirmTransaction";
import LitService from "services/lit-service";
import CeramicService from "services/ceramic-service";
import {
	Indexes,
	Users,
	MultipleIndexListState,
	IndexListState,
} from "types/entity";
import { useCeramic } from "hooks/useCeramic";
import { useRouter } from "next/router";
import { useAppSelector } from "./store";
import { selectProfile } from "../store/slices/profileSlice";

export interface AppContextValue {
	indexes: MultipleIndexListState
	setIndexes: (indexes: MultipleIndexListState) => void
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

export const AppContextProvider = ({ children } : any) => {
	const [indexes, setIndexes] = useState<MultipleIndexListState>({
		all: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [] as Indexes[],
		} as IndexListState,
		owner: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [] as Indexes[],
		} as IndexListState,
		starred: {
			skip: 0,
			totalCount: 0,
			hasMore: true,
			indexes: [] as Indexes[],
		} as IndexListState,
	});
	const [createModalVisible, setCreateModalVisible] = useState(false);
	const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
	const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
	const [editProfileModalVisible, setEditProfileModalVisible] = useState(false);
	const [transactionApprovalWaiting, setTransactionApprovalWaiting] = useState(false);
	const [viewedProfile, setViewedProfile] = useState<Users>();
	const [section, setSection] = useState <keyof MultipleIndexListState>("all" as keyof MultipleIndexListState);
	const router = useRouter();
	const ceramic = useCeramic();
	const { did, indexId } = router.query;
	const profile = useAppSelector(selectProfile);

	const activeKey = () => {
		if (did) {
			const url = new URL(`https://index.network${router.asPath}`);
			return (url.searchParams.get("section") || "all") as keyof MultipleIndexListState;
		}
		return section;
	};
	useEffect(() => {
		setSection(activeKey());
	}, [router.asPath]);

	useEffect(() => {
		profile && (viewedProfile?.id === profile.id) && setViewedProfile(profile);
		did && profile && !viewedProfile && setViewedProfile(profile);
		updateProfile(profile);
	}, [profile]);

	const handleCreate = async (title: string) => {
		if (title) {
			// handleToggleCreateModal();
			setCreateModalVisible(false);
			setTransactionApprovalWaiting(true);
			const { pkpPublicKey } = await LitService.mintPkp();
			const sessionResponse = await LitService.getPKPSession(pkpPublicKey, appConfig.defaultCID);
			const c = new CeramicService();
			c.authenticateUser(sessionResponse.session.did);
			const doc = await c.createIndex(pkpPublicKey, { title } as Indexes);
			await ceramic.addUserIndex(doc.id, "owner");
			updateUserIndexState({ ...doc, ownerDID: profile } as Indexes, "owner", "add");
			if (doc) {
				setTransactionApprovalWaiting(false);
				await router.push(`/index/[indexId]`, `/index/${doc.id}`, { shallow: true });
			}
		}
	};
	const removeIndex = (group : IndexListState, index: Indexes) => {
		const newIndexes = group.indexes?.filter((i: Indexes) => i.id !== index.id) || [];
		if (newIndexes?.length < group.indexes!.length) {
			group.totalCount -= 1;
			group.skip -= 1;
		}
		group.indexes = newIndexes;
		return group;
	};
	const addIndex = (group : IndexListState, index: Indexes) => {
		const isExist = group.indexes?.filter((i: Indexes) => i.id === index.id) || [];
		if (isExist.length > 0) {
			return group;
		}
		if (group.indexes) {
			group.indexes.push(index);
			group.indexes.sort((a, b) => new Date(b.createdAt).getSeconds() - new Date(a.createdAt).getSeconds());
		}
		group.skip += 1;
		group.totalCount += 1;
		return group;
	};
	const updateIndex = (index: Indexes) => {
		const newState = { ...indexes };
		Object.keys(indexes).forEach((key) => {
			newState[key as keyof MultipleIndexListState].indexes = indexes[key as keyof MultipleIndexListState].indexes?.map(
				(i) => (i.id === index.id ? { ...i, ...index } : i),
			);
		});
		setIndexes(newState);
	};
	const updateProfile = (p: Users) => {
		const newState = { ...indexes };
		Object.keys(indexes).forEach((key) => {
			newState[key as keyof MultipleIndexListState].indexes = indexes[key as keyof MultipleIndexListState].indexes?.map(
				(i) => (i.ownerDID.id === p.id ? { ...i, ownerDID: p } : i),
			);
		});
		setIndexes(newState);
	};
	const updateUserIndexState = (index: Indexes, type: keyof MultipleIndexListState, op: string) => {
		const newState = { ...indexes };
		const allIndexes : keyof MultipleIndexListState = "all";
		if (op === "add") {
			newState[type]! = addIndex(newState[type]!, index);
			newState[allIndexes]! = addIndex(newState[allIndexes]!, index);
		} else {
			newState[type]! = removeIndex(newState[type]!, index);
			if (!index.isStarred && !index.isOwner) {
				newState[allIndexes]! = removeIndex(newState[allIndexes]!, index);
			}
		}
		setIndexes(newState);
	};
	const handleTransactionCancel = () => {
		setTransactionApprovalWaiting(false);
	};

	return (
		<AppContext.Provider value={{
			indexes,
			setIndexes,
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
