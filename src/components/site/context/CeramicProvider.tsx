import { useMergedState } from "hooks/useMergedState";
import React, { useEffect } from "react";
import ceramicService from "services/ceramic-service";

import { Web3Provider } from "@ethersproject/providers";
import { useWeb3React } from "@web3-react/core";

export interface CeramicContextState {
}

export interface CeramicContextValue {
  createDoc?(): void;
  updateDoc?(): void;
  getAccount?(): void;
}

export const CeramicContext = React.createContext<CeramicContextValue>({});

const CeramicProvider: React.FC<CeramicContextValue> = ({
	children,
}) => {
	const {
		account, active,
	} = useWeb3React<Web3Provider>();

	const [state, setState] = useMergedState<CeramicContextState>({});

	const createDoc = () => {

	};

	const updateDoc = () => {

	};

	const getAccount = () => account;

	useEffect(() => {
		if (account && active) {
			ceramicService.authenticate(account);
		}
	}, [account, active]);

	return (
		<CeramicContext.Provider value={{
			createDoc,
			updateDoc,
			getAccount,
		}}>
			{children}
		</CeramicContext.Provider>
	);
};

export default CeramicProvider;
