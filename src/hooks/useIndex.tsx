import React, { useContext } from "react";
import CeramicService from "../services/ceramic-service";
import { Indexes } from "../types/entity";

export interface IndexContextValue {
	pkpCeramic: CeramicService;
	isOwner: boolean;
	isCreator: boolean;
	index: Partial<Indexes>;
}
export const IndexContext = React.createContext<IndexContextValue>({
	isOwner: false,
	isCreator: false,
	index: {} as Indexes,
} as any);

export const useIndex = () => useContext(IndexContext);
