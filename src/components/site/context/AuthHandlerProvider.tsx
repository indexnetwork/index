import { DIDSession } from "did-session";
import { EthereumWebAuth, getAccountId } from "@didtools/pkh-ethereum";

import { useAppDispatch, useAppSelector } from "hooks/store";
import { useRouter } from "next/router";
import React, { useEffect } from "react";
import ceramicService from "services/ceramic-service";
import {
	disconnectApp, selectConnection, setAuthLoading, setCeramicConnected, setMetaMaskConnected,
} from "store/slices/connectionSlice";
import { setProfile } from "store/slices/profileSlice";

declare global {
	interface Window {
		ethereum: any;
	}
}

export interface AuthHandlerContextType {
	connect(): Promise<void>;
	disconnect(): void;
}

let session: DIDSession | null | undefined;

export const AuthHandlerContext = React.createContext<AuthHandlerContextType>({} as any);

export const AuthHandlerProvider = ({ children }: any) => {
	const connection = useAppSelector(selectConnection);
	const dispatch = useAppDispatch();
	const router = useRouter();

	const disconnect = async () => {
		localStorage.removeItem("provider");
		localStorage.removeItem("did");
		session = null;
		dispatch(disconnectApp());
		router.push("/");
	};

	const checkExistingSession = async () => {
		const sessionStr = localStorage.getItem("did"); // for production, you will want a better place than localStorage for your sessions.
		if (sessionStr) {
			session = await DIDSession.fromSession(sessionStr);
			dispatch(setAuthLoading(false));
		}
	};
	const connectMetamask = async () => {
		// Metamask Login
		dispatch(setAuthLoading(true));

		await checkExistingSession();

		if (!connection.metaMaskConnected) {
			if (!session || (session.hasSession && session.isExpired)) {
				if (window.ethereum === null || window.ethereum === undefined) {
					dispatch(setAuthLoading(false));
					throw new Error("No injected Ethereum provider found.");
				}
				// We enable the ethereum provider to get the user's addresses.
				const ethProvider = window.ethereum;
				// request ethereum accounts.
				const addresses = await ethProvider.enable({
					method: "eth_requestAccounts",
				});
				const accountId = await getAccountId(ethProvider, addresses[0]);
				const authMethod = await EthereumWebAuth.getAuthMethod(ethProvider, accountId);
				try {
					session = await DIDSession.authorize(authMethod, { resources: ["ceramic://*"] });

					localStorage.setItem("did", session.serialize());
				} catch (err) {
					console.log(err);
				}
			}

			dispatch(setAuthLoading(false));
		}
	};
	const getProfile = async () => {
		try {
			const profile = await ceramicService.getProfile();
			if (profile) {
				console.log(profile);
				dispatch(setProfile({
					...profile,
					available: true,
				}));
			}
		} catch (err) {
			// profile error
		}
	};

	const authToCeramic = async () => {
		if (!ceramicService.isUserAuthenticated()) {
			const result = await ceramicService.authenticateUser(session?.did);
			dispatch(setCeramicConnected(result));
			// await ceramicService.syncContents();
		} else {
			dispatch(setCeramicConnected(true));
		}
	};

	const completeConnections = async () => {
		await authToCeramic();
		await getProfile();
	};

	// App Loads
	useEffect(() => {
		if (session && (session.hasSession && !session.isExpired)) {
			dispatch(setMetaMaskConnected({
				metaMaskConnected: true,
				did: session.did.parent,
			}));
		} else {
			dispatch(setMetaMaskConnected({
				metaMaskConnected: false,
			}));
		}
	}, [session]);

	useEffect(() => {
		if (connection.metaMaskConnected) {
			completeConnections();
		} else {
			checkExistingSession();
		}
	}, [connection.metaMaskConnected]);

	return <AuthHandlerContext.Provider value={{
		connect: connectMetamask,
		disconnect,
	}}>{children}</AuthHandlerContext.Provider>;
};
