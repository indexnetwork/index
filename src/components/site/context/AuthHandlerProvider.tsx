import { getAccountId } from "@didtools/pkh-ethereum";
import { Cacao, SiweMessage } from "@didtools/cacao";
import { normalizeAccountId } from "@ceramicnetwork/common";

import { useAppDispatch, useAppSelector } from "hooks/store";
import { useRouter } from "next/router";
import React, { useEffect } from "react";
import ceramicService from "services/ceramic-service";
import { getAddress } from "@ethersproject/address";
import { randomBytes, randomString } from "@stablelib/random";
import { DIDSession, createDIDKey, createDIDCacao } from "did-session";

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

type SessionResponse = {
	session: DIDSession,
	authSig: object
};
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
		const signature = await ethProvider.request({
			method: "personal_sign",
			params: [siweMessage.signMessage(), getAddress(accountId.address)],
		});
		siweMessage.signature = signature;
		const cacao = Cacao.fromSiweMessage(siweMessage);
		const did = await createDIDCacao(didKey, cacao);
		const session = new DIDSession({ cacao, keySeed, did });
		return {
			session,
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

		await checkExistingSession();

		if (!connection.metaMaskConnected) {
			if (!session || (session.hasSession && session.isExpired)) {
				const sessionResponse = await startNewSession();
				session = sessionResponse.session;
				try {
					localStorage.setItem("did", sessionResponse.session.serialize());
					localStorage.setItem("authSig", JSON.stringify(sessionResponse.authSig));
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
