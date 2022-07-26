import { Web3Provider } from "@ethersproject/providers";
import { useWeb3React } from "@web3-react/core";
import { useState } from "react";
import * as Web3Token from "web3-token";

const useApiToken = (): [boolean, string, (acc: string) => Promise<boolean>] => {
	const [activeToken, setActiveToken] = useState<string>("");
	const [loading, setLoading] = useState<boolean>(true);
	const [init, setInit] = useState(false);
	const {
		library,
	} = useWeb3React<Web3Provider>();

	const removeToken = () => localStorage.removeItem("auth_token");

	const getToken = () => localStorage.getItem("auth_token");

	const setToken = (newToken: string) => {
		localStorage.setItem("auth_token", newToken);
		setActiveToken(newToken);
	};

	const generateToken = async (acc: string): Promise<boolean> => {
		try {
			if (acc) {
				const signer = library?.getSigner();
				const newToken = await Web3Token.sign((msg) => signer!.signMessage(msg), "1d");
				if (newToken) {
					setToken(newToken);
					return true;
				}
			}
			return false;
		} catch {
			return false;
		}
	};

	const checkToken = async (acc: string): Promise<boolean> => {
		try {
			setLoading(true);
			if (acc) {
				const oldToken = getToken();
				if (oldToken) {
					try {
						const result = Web3Token.verify(oldToken);
						if (result?.address.toLowerCase() !== acc.toLowerCase()) {
							removeToken();
							return generateToken(acc);
						}
						return true;
					} catch (err) {
						removeToken();
						return generateToken(acc);
					}
				} else {
					return generateToken(acc);
				}
			}
			return false;
		} catch (err) {
			return false;
		} finally {
			setLoading(false);
		}
	};

	return [loading, activeToken, checkToken];
};

export default useApiToken;
