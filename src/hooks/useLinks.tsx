import React, { useContext } from "react";
import { IndexLink } from "../types/entity";

export interface LinksContextValue {
	links: IndexLink[];
	setLinks: (links: IndexLink[]) => void;
	hasMore: boolean;
	loadMore?: (page: number, init?: boolean) => void;
}
export const LinksContext = React.createContext<LinksContextValue>({
	links: [],
	setLinks: () => {},
	hasMore: false,
});

export const useLinks = () => useContext(LinksContext);
