import { getAccountId } from "@didtools/pkh-ethereum";
import { Cacao, SiweMessage } from "@didtools/cacao";
import { normalizeAccountId } from "@ceramicnetwork/common";

import { useAppDispatch, useAppSelector } from "hooks/store";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import ceramicService from "services/ceramic-service";
import { getAddress } from "@ethersproject/address";
import { randomBytes, randomString } from "@stablelib/random";
import { DIDSession, createDIDKey, createDIDCacao } from "did-session";

import {
	disconnectApp, selectConnection, setAuthLoading, setCeramicConnected, setMetaMaskConnected, setOriginNFTModalVisible,
} from "store/slices/connectionSlice";
import { setProfile } from "store/slices/profileSlice";
import litService from "../../../services/lit-service";
import OriginWarningModal from "../modal/OriginWarningModal";

declare global {
	interface Window {
		ethereum: any;
	}
}

export interface AuthHandlerContextType {
	connect(): Promise<void>;
	disconnect(): void;
}

type SessionResponse = {
	session: DIDSession,
	authSig: object
};

export const AuthHandlerContext = React.createContext<AuthHandlerContextType>({} as any);

export const AuthHandlerProvider = ({ children }: any) => {
	const { metaMaskConnected, originNFTModalVisible, loading } = useAppSelector(selectConnection);
	const dispatch = useAppDispatch();
	const router = useRouter();

	const [session, setSession] = useState<DIDSession | null | undefined>();

	const disconnect = async () => {
		localStorage.removeItem("provider");
		localStorage.removeItem("did");
		setSession(null);
		dispatch(disconnectApp());
		await router.push("/");
	};
	const getExistingSession = async () => {
		const sessionStr = localStorage.getItem("did");
		// for production, you will want a better place than localStorage for your sessions.
		if (sessionStr) {
			const existingSession = await DIDSession.fromSession(sessionStr);
			setSession(existingSession);
			dispatch(setAuthLoading(false));
		}
	};
	const startNewSession = async (): Promise<SessionResponse> => {
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
		const normAccount = normalizeAccountId(accountId);

		const keySeed = randomBytes(32);
		const didKey = await createDIDKey(keySeed);

		const now = new Date();
		const threeMonthsLater = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

		const siweMessage = new SiweMessage({
			domain: "index.as",
			address: getAddress(normAccount.address),
			statement: "Give this application access to some of your data on Ceramic",
			uri: didKey.id,
			version: "1",
			chainId: normAccount.chainId.reference,
			nonce: randomString(10),
			issuedAt: now.toISOString(),
			expirationTime: threeMonthsLater.toISOString(),
			resources: ["ceramic://*"],
		});
		siweMessage.signature = await ethProvider.request({
			method: "personal_sign",
			params: [siweMessage.signMessage(), getAddress(accountId.address)],
		});
		const cacao = Cacao.fromSiweMessage(siweMessage);
		const did = await createDIDCacao(didKey, cacao);
		const newSession = new DIDSession({ cacao, keySeed, did });
		return {
			session: newSession,
			authSig: {
				signedMessage: siweMessage.toMessage(),
				address: getAddress(accountId.address),
				derivedVia: "web3.eth.personal.sign",
				sig: siweMessage.signature,
			},
		} as SessionResponse;
	};
	const connectMetamask = async () => {
		// Metamask Login
		dispatch(setAuthLoading(true));
		if (!metaMaskConnected) {
			if (!session || (session.hasSession && session.isExpired)) {
				const sessionResponse = await startNewSession();
				localStorage.setItem("authSig", JSON.stringify(sessionResponse.authSig));
				localStorage.setItem("did", sessionResponse.session.serialize());
				setSession(sessionResponse.session);
			}
		} else {
			const hasOrigin = await litService.hasOriginNFT();
			if (!hasOrigin) {
				dispatch(setOriginNFTModalVisible(true));
			}
		}

		dispatch(setAuthLoading(false));
	};
	const getProfile = async () => {
		try {
			const profile = await ceramicService.getProfile();
			if (profile) {
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
		} else {
			dispatch(setCeramicConnected(true));
		}
	};

	const completeConnections = async () => {
		const hasOrigin = await litService.hasOriginNFT();
		if (!hasOrigin) {
			dispatch(setOriginNFTModalVisible(true));
		} else {
			await authToCeramic();
			await getProfile();
		}
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
		if (metaMaskConnected) {
			// Just connected

			completeConnections();
		} else {
			// Not connected but session exists.
			getExistingSession();
		}
	}, [metaMaskConnected]);

	return <AuthHandlerContext.Provider value={{
		connect: connectMetamask,
		disconnect,
	}}>
		{!loading && originNFTModalVisible ? <OriginWarningModal visible={originNFTModalVisible}></OriginWarningModal> : <></>}
		{children}</AuthHandlerContext.Provider>;
};
