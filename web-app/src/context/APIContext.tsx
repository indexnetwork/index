"use client";

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import ApiService from "services/api-service-new";
import { useRouteParams } from "@/hooks/useRouteParams";
import { AuthContext } from "./AuthContext";

export const defaultAPIContext = {
  apiService: ApiService.getInstance(),
};

type APIContextType = typeof defaultAPIContext;

export const APIContext = createContext<APIContextType>(defaultAPIContext);

export const APIProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useContext(AuthContext);
  const { id } = useRouteParams();
  const [apiService, setApiService] = useState(ApiService.getInstance());

  useEffect(() => {
    if (session && !session.isExpired && session !== apiService.getSession()) {
      const updatedApiService = ApiService.getInstance();
      updatedApiService.setSession(session);
      setApiService(updatedApiService);

      console.log("APIProvider: session updated");
    }
  }, [session, id]);

  return (
    <APIContext.Provider value={{ apiService }}>{children}</APIContext.Provider>
  );
};

export const useApi = () => {
  const { status } = useContext(AuthContext);
  const context = useContext(APIContext);

  // if (status === AuthStatus.IDLE || status === AuthStatus.LOADING) {
  //   return { apiService: null };
  // }

  if (!context) {
    throw new Error("useApi must be used within an APIProvider");
  }
  return context;
};
