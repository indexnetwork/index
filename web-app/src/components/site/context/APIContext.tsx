"use client";

// eslint-disable-next-line
import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import ApiService from "services/api-service-new";
import { AuthContext, AuthStatus } from "./AuthContext";

// Update the type definition of the context
// export const APIContext = createContext({
//   apiService: null as ApiService | null, // Set the initial value to null
// });

export const defaultAPIContext = {
  apiService: ApiService.getInstance(),
};

type APIContextType = typeof defaultAPIContext;

export const APIContext = createContext<APIContextType>(defaultAPIContext);

// export const APIProvider = ({ children }: { children: ReactNode }) => {
//   const { session, pkpPublicKey } = useContext(AuthContext);
//   // if (!session) {
//   //   throw new Error('APIProvider must be used within an AuthProvider');
//   // }

//   const [apiService] = useState(ApiService.getInstance());

//   useEffect(() => {
//     if (session) {
//       apiService.setSession(session);
//     }
//   }, [session, apiService]);

//   // useEffect(() => {
//   //   if (!pkpPublicKey || !apiService) {
//   //     return;
//   //   }
//   //   apiService.setPkpPublicKey(pkpPublicKey);
//   // }, [pkpPublicKey]);

//   return (
//     <APIContext.Provider value={{ apiService }}>
//       {children}
//     </APIContext.Provider>
//   );
// };

export const APIProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useContext(AuthContext);
  const [apiService, setApiService] = useState(ApiService.getInstance());

  useEffect(() => {
    if (session && !session.isExpired && session !== apiService.getSession()) {
      const updatedApiService = ApiService.getInstance();
      updatedApiService.setSession(session);
      setApiService(updatedApiService);

      console.log("APIProvider: session updated");
    }
  }, [session]);

  return (
    <APIContext.Provider value={{ apiService }}>{children}</APIContext.Provider>
  );
};

export const useApi = () => {
  const { status } = useContext(AuthContext);
  const context = useContext(APIContext);

  if (status === AuthStatus.IDLE || status === AuthStatus.LOADING) {
    return { apiService: null };
  }

  if (!context) {
    throw new Error("useApi must be used within an APIProvider");
  }
  return context;
};

// export const useApi = () => {
//   const context = useContext(APIContext);
//   const { session, status } = useContext(AuthContext);
//   console.log("useApi", context, status);

//   if (!context) {
//     // Return null or an empty object if the session is not ready
//     return { apiService: null };
//   }
//   if (status === AuthStatus.LOADING) {
//     // Return null or an empty object if the session is not ready
//     return { apiService: null };
//   }
//   return context;
// };
