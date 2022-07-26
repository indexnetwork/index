import { selectConnection } from "store/slices/connectionReducer";
import { useAppSelector } from "./store";

export function useAuth(autoConnect: boolean = true) {
	const { metaMaskConnected, ceramicConnected, tokenSigned } = useAppSelector(selectConnection);

	return metaMaskConnected && ceramicConnected && tokenSigned;
}
