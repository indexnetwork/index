'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { setAuthToken, removeAuthToken } from '@/lib/auth';

type AuthContextType = {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login: privyLogin, logout: privyLogout } = usePrivy();
  const [isLoading, setIsLoading] = useState(true);

  // Store authentication token when user is authenticated
  useEffect(() => {
    console.log('Authenticated:', authenticated);
    if (authenticated && user?.id) {
      setAuthToken(user.id);
      console.log('User authenticated:', user);
    }
  }, [authenticated, user]);

  // Update loading state when ready
  useEffect(() => {
    if (ready) {
      setIsLoading(false);
    }
  }, [ready]);

  const login = () => {
    console.log("logging in")
    privyLogin();
  };

  const logout = async () => {
    try {
      await privyLogout();
      // Clear auth token
      removeAuthToken();
    } catch (error) {
      console.error('Logout error:', error);
      // Still remove token even if privy logout fails
      removeAuthToken();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: authenticated,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
} 