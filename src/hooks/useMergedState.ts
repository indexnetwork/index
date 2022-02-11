import { useState } from "react";

export function useMergedState<S>(initialState: S | (() => S)): [S, (newState: Partial<S> | ((oldState: S) => Partial<S>)) => void] {
	const [state, setState] = useState<S>(initialState);

	function mergeState(newState: Partial<S> | ((oldState: S) => Partial<S>)) {
		if (typeof newState === "function") {
			setState((oldState) => ({
				...oldState,
				...newState(oldState),
			}));
			return;
		}
		setState((oldState: typeof state) => (
			{
				...oldState,
				...newState,
			}));
	}

	return [state, mergeState];
}
