import { Web3Provider } from "@ethersproject/providers";
import { useWeb3React } from "@web3-react/core";
import connectors from "connectors";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import useApiToken from "./useApiToken";

export function useAuth(autoConnect: boolean = true) {
	const [loading, setLoading] = useState(true);

	const router = useRouter();

	const {
		account, activate, active, deactivate,
	} = useWeb3React<Web3Provider>();

	const [tokenLoading, token, checkToken] = useApiToken();

	const [connected, setConnected] = useState(false);

	const connect = async (provider: keyof typeof connectors) => {
		try {
			setLoading(true);
			await activate(connectors[provider]);
			localStorage.setItem("provider", provider);
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	};

	const disconnect = () => {
		resetProvider();
		deactivate();
	};

	const resetProvider = () => {
		localStorage.removeItem("provider");
		localStorage.removeItem("auth_token");
		router.push("/");
	};

	useEffect(() => {
		if (autoConnect) {
			const provider = localStorage.getItem("provider");
			if (provider) {
				connect(provider as any);
			} else {
				setLoading(false);
			}
		}
	}, []);

	const init = async () => {
		if (account && !autoConnect) {
			const result = await checkToken(account);
			setConnected(result);
		} else {
			setConnected(autoConnect);
		}
	};

	useEffect(() => {
		init();
	}, [account]);

	return {
		account,
		active,
		connected,
		connect,
		disconnect,
		token,
		loading,
	};
}
