import { Web3Provider } from "@ethersproject/providers";
import { useWeb3React } from "@web3-react/core";
import connectors from "connectors";
import { useAppDispatch, useAppSelector } from "hooks/store";
import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import ceramicService from "services/ceramic-service";
import {
	disconnectApp, selectConnection, setApiTokenSigned, setAuthLoading, setCeramicConnected, setMetaMaskConnected,
} from "store/slices/connectionSlice";
import { setProfile } from "store/slices/profileSlice";
import * as Web3Token from "web3-token";

export interface AuthHandlerContextType {
	connect(provider: keyof typeof connectors): Promise<void>;
	disconnect(): void;
}

export const AuthHandlerContext = React.createContext<AuthHandlerContextType>({} as any);

export const AuthHandlerProvider: React.FC = ({ children }) => {
	const connection = useAppSelector(selectConnection);
	const dispatch = useAppDispatch();
	const [init, setInit] = useState(false);
	// Metamask Members

	const router = useRouter();

	const {
		account, activate, active, deactivate, library,
	} = useWeb3React<Web3Provider>();

	const disconnect = async () => {
		dispatch(disconnectApp());
		deactivate();
		await ceramicService.close();
		resetProvider();
		router.push("/");
	};

	const resetProvider = () => {
		localStorage.removeItem("provider");
		localStorage.removeItem("auth_token");
	};

	const connectMetamask = async (initProvider?: keyof typeof connectors) => {
		// Metamask Login
		dispatch(setAuthLoading(true));
		if (!connection.metaMaskConnected) {
			const provider = initProvider || localStorage.getItem("provider");
			if (provider) {
				try {
					const connector = connectors[provider as keyof typeof connectors];
					connector.getProvider().then((p) => {
						const chainIdAsInt = Number.parseInt(p.chainId, 16);

						if ([1, 5].indexOf(chainIdAsInt) >= 0) {
							console.log("Correct network!", p.chainId);
						} else {
							console.log("Wrong network!", p.chainId);
							p.request({
								method: "wallet_switchEthereumChain",
								params: [{ chainId: "0x5" }],
							}).catch((error: any) => {
								console.log(error);
							});
						}
					});
					await activate(connector);
					localStorage.setItem("provider", provider);
				} catch (err) {
					console.error(err);
					dispatch(setAuthLoading(false));
				}
			}
		}
	};

	// Api Sign Request

	const removeToken = () => {
		localStorage.removeItem("auth_token");
		dispatch(setApiTokenSigned({
			authToken: undefined,
			tokenSigned: false,
		}));
	};

	const getToken = () => localStorage.getItem("auth_token");

	const setToken = (newToken: string) => {
		localStorage.setItem("auth_token", newToken);
		dispatch(setApiTokenSigned({
			authToken: newToken,
			tokenSigned: true,
		}));
	};

	const generateToken = async (acc: string): Promise<void> => {
		try {
			if (acc) {
				const signer = library?.getSigner();
				const newToken = await Web3Token.sign((msg) => signer!.signMessage(msg), "1d");
				if (newToken) {
					setToken(newToken);
				}
			} else {
				removeToken();
			}
		} catch {
			removeToken();
		}
	};

	const checkToken = async (acc: string): Promise<void> => {
		if (acc) {
			const oldToken = getToken();
			if (oldToken) {
				try {
					const result = Web3Token.verify(oldToken);
					if (result?.address.toLowerCase() !== acc.toLowerCase()) {
						await generateToken(acc);
					}
					setToken(oldToken);
				} catch (err) {
					await generateToken(acc);
				}
			} else {
				await generateToken(acc);
			}
		}
	};

	const authToCeramic = async () => {
		if (!ceramicService.isAuthenticated()) {
			const result = await ceramicService.authenticate(account!);
			dispatch(setCeramicConnected(result));
			await ceramicService.syncContents();
		} else {
			dispatch(setCeramicConnected(true));
		}
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

	const completeConnections = async () => {
		try {
			await checkToken(account!);
			await authToCeramic();
			await getProfile();
		} finally {
			dispatch(setAuthLoading(false));
		}
	};

	// App Loads
	useEffect(() => {
		if (account && active) {
			dispatch(setMetaMaskConnected({
				address: account,
				metaMaskConnected: true,
			}));
		} else if (init) {
			dispatch(setMetaMaskConnected({
				metaMaskConnected: false,
			}));
		} else if (!init) {
			setInit(true);
		}
	}, [account, active]);

	useEffect(() => {
		if (!connection.metaMaskConnected) {
			connectMetamask();
		} else {
			completeConnections();
		}
	}, [connection.metaMaskConnected]);

	return <AuthHandlerContext.Provider value={{
		connect: connectMetamask,
		disconnect,
	}}>{children}</AuthHandlerContext.Provider>;
};
