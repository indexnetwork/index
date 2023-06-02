import { createContext, useState, useContext } from "react";

import CreateModal from "components/site/modal/CreateModal";
import ConfirmTransaction from "components/site/modal/Common/ConfirmTransaction";
import LitService from "services/lit-service";
import { appConfig } from "config";
import CeramicService from "services/ceramic-service";
import { Indexes } from "types/entity";
import { useCeramic } from "hooks/useCeramic";
import { useRouter } from "next/router";

export interface AppContextValue {
	createModalVisible: boolean
	setCreateModalVisible: (visible: boolean) => void
}
// Create Context Object
export const AppContext = createContext({
	createModalVisible: false,
} as AppContextValue);

export const AppContextProvider = ({ children } : any) => {
	const [createModalVisible, setCreateModalVisible] = useState(false);
	const router = useRouter();
	const ceramic = useCeramic();

	const handleCreate = async (title: string) => {
		if (title) {
			// handleToggleCreateModal();
			setTransactionApprovalWaiting(true);
			const { pkpPublicKey } = await LitService.mintPkp();
			const sessionResponse = await LitService.getPKPSession(pkpPublicKey, appConfig.defaultCID);
			const c = new CeramicService(sessionResponse.session.did);
			const doc = await c.createIndex(pkpPublicKey, { title } as Indexes);
			await ceramic.addUserIndex(doc.id, "my_indexes");
			if (doc != null) {
				setTransactionApprovalWaiting(false);
				await router.push(`/${doc.id}`);
			}
		}
	};

	const [transactionApprovalWaiting, setTransactionApprovalWaiting] = useState(false);
	const handleCancel = () => {
		setTransactionApprovalWaiting(false);
	};	
	return (
		<AppContext.Provider value={{ createModalVisible, setCreateModalVisible }}>
			{children}
			{transactionApprovalWaiting ? <ConfirmTransaction handleCancel={handleCancel} visible={transactionApprovalWaiting}></ConfirmTransaction> : <></>}
			{createModalVisible ? <CreateModal visible={createModalVisible} onClose={() => setCreateModalVisible(false)} onCreate={handleCreate}></CreateModal> : <></>}
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
