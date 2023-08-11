import React, { useContext } from "react";
import CeramicService from "../services/ceramic-service";

export interface IndexContextValue {
	pkpCeramic: CeramicService;
	isOwner: boolean;
	isCreator: boolean;
}
export const IndexContext = React.createContext<IndexContextValue>({
	isOwner: false,
	isCreator: false,
} as any);

export const useIndex = () => useContext(IndexContext);
