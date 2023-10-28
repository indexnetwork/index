import React, { useContext } from "react";
import { Indexes } from "../types/entity";

export interface IndexContextValue {
	pkpCeramic: any;
	index?: Indexes;
	roles: any;
}
export const IndexContext = React.createContext<IndexContextValue>({
	roles: { creator: false, owner: false },
} as any);

export const useIndex = () => useContext(IndexContext);
