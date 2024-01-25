'use client';

import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { AuthContext } from './AuthContext';
import ApiService from 'services/api-service-new';

// Update the type definition of the context
// export const APIContext = createContext({
//   apiService: null as ApiService | null, // Set the initial value to null
// });


export const defaultAPIContext = {
  apiService: ApiService.getInstance(),
};

type APIContextType = typeof defaultAPIContext;

export const APIContext = React.createContext<APIContextType>(defaultAPIContext);


export const APIProvider = ({ children }: { children: ReactNode }) => {
  const { session, pkpPublicKey, status } = useContext(AuthContext);
  // if (!session) {
  //   throw new Error('APIProvider must be used within an AuthProvider');
  // }

  const [apiService] = useState(ApiService.getInstance());

  useEffect(() => {
    if (session) {
      apiService.setSession(session);
    }
  }, [session, apiService]);

  useEffect(() => {
    if (!pkpPublicKey || !apiService) {
      return;
    }
    apiService.setPkpPublicKey(pkpPublicKey);
  }, [pkpPublicKey]);

  return (
    <APIContext.Provider value={{ apiService }}>
      {children}
    </APIContext.Provider>
  );
};

export const useApi = () => {
  const context = useContext(APIContext);
  if (!context) {
    throw new Error('useApi must be used within an APIProvider');
  }
  return context;
};
