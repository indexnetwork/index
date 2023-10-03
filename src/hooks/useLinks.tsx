import React, { useContext } from "react";
import { IndexLink } from "../types/entity";

export interface LinksContextValue {
	links: IndexLink[];
	setLinks: (links: IndexLink[]) => void;
}
export const LinksContext = React.createContext<LinksContextValue>({ links: [], setLinks: () => {} });

export const useLinks = () => useContext(LinksContext);
