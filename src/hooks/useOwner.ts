import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { selectConnection } from "store/slices/connectionSlice";
import { useAppSelector } from "./store";

export interface OwnerState {
	isOwner: boolean;
	did?: string;
}
export const useOwner = () => {
	const router = useRouter();
	const { did } = useAppSelector(selectConnection);

	const getState = () => ({
		isOwner: router.query && ((router.query || {}).id as string || "").toLowerCase() === (did || "").toLowerCase(),
		did: (router.query || {}).id === did ? did : (router.query || {}).id as string,
	});

	const [state, setState] = useState<OwnerState>(() => getState());

	useEffect(() => {
		setState(() => getState());
	}, [router.query.did, did]);

	return state;
};
