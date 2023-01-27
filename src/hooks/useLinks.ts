import { LinksContext } from "pages/[did]/[id]";
import { useContext } from "react";

export function useLinks() {
	const context = useContext(LinksContext);

	return context;
}
