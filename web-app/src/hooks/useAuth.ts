import { selectConnection } from "store/slices/connectionSlice";
import { useAppSelector } from "./store";

export function useAuth(autoConnect: boolean = true) {
	const { metaMaskConnected, ceramicConnected } = useAppSelector(selectConnection);

	return metaMaskConnected && ceramicConnected;
}
