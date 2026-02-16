'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { usePrivy, PrivyProvider } from '@privy-io/react-auth';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthenticatedAPI } from '../lib/api';
import { useAuthService } from '../services/auth';
import { User, APIResponse } from '../lib/types';

type AuthContextType = {
  isReady: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
  userLoading: boolean;
  error: string | null;
  refetchUser: () => Promise<void>;
  updateUser: (user: User) => void;
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
  const authService = useAuthService();

  // Update user data directly (for optimistic updates after profile changes)
  const updateUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

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

        // Check and update timezone if needed
        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (browserTimezone && response.user.timezone !== browserTimezone) {
          console.log(`Updating timezone from ${response.user.timezone} to ${browserTimezone}`);
          authService.updateProfile({ timezone: browserTimezone })
            .then(updatedUser => {
              setUser(updatedUser);
            })
            .catch(err => {
              console.error('Failed to update timezone:', err);
            });
        }
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
  }, [authenticated, ready, api, authService]);

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

    const isPublicPage = pathname.startsWith('/simulation') || pathname.startsWith('/l') || pathname.startsWith('/index/') || pathname.startsWith('/blog') || pathname.startsWith('/pages');
    const isProtectedPage = pathname.startsWith('/i/');
    // DISABLED: Removed isOnboardingPage from isProtectedPage

    // Determine if we need to redirect
    // Don't redirect authenticated users from root - they should see inbox there
    const shouldRedirectToHome = !authenticated && (isProtectedPage || (!isHomePage && !isPublicPage));
    // DISABLED: Onboarding redirect logic
    // const shouldRedirectOnboardingToHome = !authenticated && isOnboardingPage;

    if (shouldRedirectToHome) {
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
        updateUser,
      }}
    >
      {isLoading ? (
        <div className="min-h-screen flex items-center justify-center bg-[#FDFDFD]">
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
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;
  
  // During build time, env vars may not be available - render children without Privy
  if (!appId || !clientId) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        loginMethods: ['email', 'google'],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'all-users',
          },
        },
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
