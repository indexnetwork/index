import { FC, createContext, useContext, useEffect, useState } from "react";
import ApiService from "services/api-service-new";
import { AuthStatus, useAuth } from "./AuthContext";

interface APIContextType {
  api: ApiService | null;
  ready: boolean;
}

export const APIContext = createContext<APIContextType>({
  api: null,
  ready: false,
});

export const APIProvider: FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { session, status } = useAuth();
  const [apiService] = useState<ApiService>(ApiService.getInstance());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    console.log("APIProvider: status", status, session);
    if (status === AuthStatus.CONNECTED && session) {
      console.log("APIProvider: connected");
      apiService!.setSession(session);
      setReady(true);
    }

    if (status === AuthStatus.NOT_CONNECTED) {
      console.log("APIProvider: not connected");
      setReady(true);
    }
  }, [apiService, session, status]);

  return (
    <APIContext.Provider value={{ api: apiService, ready }}>
      {children}
    </APIContext.Provider>
  );
};

export const useApi = () => useContext(APIContext);
