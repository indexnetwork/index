'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { usePrivy, useLogin, User, Wallet } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

type AuthContextType = {
  isReady: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    ready,
    authenticated,
    user,
    logout: privyLogout,
    createWallet,
    linkWallet,
    unlinkWallet,
  } = usePrivy();
  const { login: privyLogin } = useLogin();

  const [isLoading, setIsLoading] = useState(!ready);
  const router = useRouter();

  // Handle navigation based on authentication status
  useEffect(() => {
    if (!ready) return;

    const pathname = window.location.pathname;
    const isHomePage = pathname === '/';
    const isSharePage = pathname.startsWith('/share');
    
    if (authenticated && isHomePage) {
      router.push('/indexes');
    } else if (!authenticated && !isHomePage && !isSharePage) {
      router.push('/');
    }
    
    setIsLoading(false);
  }, [authenticated, ready, router]);


  const logout = async () => {
    try {
      await privyLogout();
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
      router.push('/');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isReady: ready,
        isLoading,
        isAuthenticated: authenticated,
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
