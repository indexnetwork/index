import React, { useContext } from "react";
import CeramicService from "../services/ceramic-service";

export interface IndexContextValue {
	pkpCeramic: CeramicService;
}
export const IndexContext = React.createContext<IndexContextValue>({} as any);

export const useIndex = () => useContext(IndexContext);
