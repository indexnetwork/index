import { useContext } from "react";
import { CeramicContext } from "components/site/context/CeramicProvider";

export function useCeramic() {
	const context = useContext(CeramicContext);

	if (!context) {
		throw new Error("useCeramic must be used within a CeramicProvider");
	}

	return context;
}
