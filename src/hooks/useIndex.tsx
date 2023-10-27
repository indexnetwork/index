import React, { useContext } from "react";
import CeramicService from "../services/ceramic-service";
import { Indexes } from "../types/entity";

export interface IndexContextValue {
	pkpCeramic: CeramicService;
	index: Partial<Indexes>;
	roles: any;
}
export const IndexContext = React.createContext<IndexContextValue>({
	index: {} as Indexes,
	roles: { creator: false, owner: false },
} as any);

export const useIndex = () => useContext(IndexContext);
