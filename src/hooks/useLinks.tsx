import React, { useContext } from "react";
import { Links } from "../types/entity";

export interface LinksContextValue {
	links: Links[];
	setLinks?: any
}
export const LinksContext = React.createContext<LinksContextValue>({ links: [] });

export const useLinks = () => useContext(LinksContext);
