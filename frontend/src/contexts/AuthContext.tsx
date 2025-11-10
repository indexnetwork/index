'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { usePrivy, PrivyProvider } from '@privy-io/react-auth';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthenticatedAPI } from '../lib/api';
import { User, APIResponse } from '../lib/types';

type AuthContextType = {
  isReady: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
  userLoading: boolean;
  error: string | null;
  refetchUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function AuthProviderInner({ children }: { children: ReactNode }) {
  const {
    ready,
    authenticated,
  } = usePrivy();

  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userFetchAttempted, setUserFetchAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const api = useAuthenticatedAPI();

  // Memoized fetch user function
  const fetchUser = useCallback(async () => {
    if (!authenticated || !ready) return;
    
    setUserLoading(true);
    setUserFetchAttempted(true);
    setError(null);
    try {
      const response = await api.get<APIResponse<User>>('/auth/me');
      if (response.user) {
        setUser(response.user);
      } else {
        throw new Error('No user data received');
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
      setError('Failed to load user data. Please try refreshing the page.');
      setUser(null);
    } finally {
      setUserLoading(false);
    }
  }, [authenticated, ready, api]);

  // Fetch user data when authenticated
  useEffect(() => {
    if (authenticated && ready && !user && !userLoading && !userFetchAttempted) {
      fetchUser();
    } else if (!authenticated) {
      setUser(null);
      setUserLoading(false);
      setUserFetchAttempted(false);
      setError(null);
    }
  }, [authenticated, ready, user, userLoading, userFetchAttempted, fetchUser]);

  // Handle navigation based on authentication status
  useEffect(() => {
    if (!ready) {
      return; // Keep loading until Privy is ready
    }

    // If authenticated, wait for user data to be loaded
    if (authenticated && userLoading) {
      return; // Keep loading until user data is available
    }
    
    // If authenticated but no user data and haven't attempted fetch yet
    if (authenticated && !user && !userFetchAttempted) {
      return; // Keep loading until user fetch is attempted
    }
    
    console.log('ready', ready);
    console.log('authenticated', authenticated);  
    console.log('pathname', pathname);
    
    const isHomePage = pathname === '/';
    const isOnboardingPage = pathname === '/onboarding';
    const isPublicPage = pathname.startsWith('/simulation') || pathname.startsWith('/l') || pathname.startsWith('/i');
    const isProtectedPage = pathname.startsWith('/inbox') || isOnboardingPage;
    
    // Determine if we need to redirect
    const shouldRedirectToIndexes = authenticated && isHomePage;
    const shouldRedirectToHome = !authenticated && (isProtectedPage || (!isHomePage && !isPublicPage));
    const shouldRedirectOnboardingToHome = !authenticated && isOnboardingPage;
    
    if (shouldRedirectToIndexes) {
      router.push('/inbox');
      return; // Will re-evaluate when pathname changes
    }
    
    if (shouldRedirectToHome || shouldRedirectOnboardingToHome) {
      router.push('/');
      return; // Will re-evaluate when pathname changes
    }
    
    // Only stop loading if we're on the correct page for our auth state
    // and user data is loaded (if authenticated) or user is not authenticated
    setIsLoading(false);
  }, [authenticated, ready, router, pathname, user, userLoading, userFetchAttempted]);

  return (
    <AuthContext.Provider
      value={{
        isReady: ready,
        isLoading,
        isAuthenticated: authenticated,
        user,
        userLoading,
        error,
        refetchUser: fetchUser,
      }}
    >
      {isLoading ? (
        <div className="min-h-screen flex items-center justify-center bg-white">
          <video autoPlay loop muted playsInline className="w-40 h-40">
            <source src="/loading-tree.m4v" type="video/mp4" />
          </video>
        </div>
      ) : error ? (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
            <p className="text-gray-600 mb-4">{error}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Refresh Page
            </button>
          </div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ""}
      clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || ""}
      config={{
        loginMethods: ['email', 'google']
      }}
    >
      <AuthProviderInner>{children}</AuthProviderInner>
    </PrivyProvider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
