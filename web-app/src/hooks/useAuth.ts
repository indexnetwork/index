import { selectConnection } from "store/slices/connectionSlice";
import { useAppSelector } from "./store";

export function useAuth(autoConnect: boolean = true) {
	const { metaMaskConnected } = useAppSelector(selectConnection);

	return metaMaskConnected;
}
