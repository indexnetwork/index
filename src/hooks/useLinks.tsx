import React, { useContext } from "react";
import { IndexLink } from "../types/entity";

export interface LinksContextValue {
	links: IndexLink[];
	setLinks?: any
}
export const LinksContext = React.createContext<LinksContextValue>({ links: [] });

export const useLinks = () => useContext(LinksContext);
