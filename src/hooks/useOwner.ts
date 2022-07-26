import { CeramicContext } from "components/site/context/CeramicProvider";
import { useRouter } from "next/router";
import { useContext, useEffect, useState } from "react";

export interface OwnerState {
	isOwner: boolean;
	address?: string;
}
export const useOwner = () => {
	const router = useRouter();
	const { address } = useContext(CeramicContext);

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
