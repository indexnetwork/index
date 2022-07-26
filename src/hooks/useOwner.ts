import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { selectConnection } from "store/slices/connectionReducer";
import { useAppSelector } from "./store";

export interface OwnerState {
	isOwner: boolean;
	address?: string;
}
export const useOwner = () => {
	const router = useRouter();
	const { address } = useAppSelector(selectConnection);

	const getState = () => ({
		isOwner: router.query && router.query.address === address,
		address: (router.query || {}).address === address ? address : (router.query || {}).address as string,
	});

	const [state, setState] = useState<OwnerState>(() => getState());

	useEffect(() => {
		setState(() => getState());
	}, [router.query.address, address]);

	return state;
};
