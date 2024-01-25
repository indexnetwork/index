import React, { useContext } from "react";
import { Indexes } from "../types/entity";

export interface IndexContextValue {
  pkpCeramic: any;
  index?: Indexes;
}
export const IndexContext = React.createContext<IndexContextValue>({} as any);

export const useIndex = () => useContext(IndexContext);
