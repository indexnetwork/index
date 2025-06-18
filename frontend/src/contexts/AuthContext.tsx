'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { usePrivy, PrivyProvider } from '@privy-io/react-auth';
import { useRouter, usePathname } from 'next/navigation';

type AuthContextType = {
  isReady: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function AuthProviderInner({ children }: { children: ReactNode }) {
  const {
    ready,
    authenticated,
  } = usePrivy();

  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // Handle navigation based on authentication status
  useEffect(() => {
    if (!ready) {
      return; // Keep loading until Privy is ready
    }
    
    console.log('ready', ready);
    console.log('authenticated', authenticated);  
    console.log('pathname', pathname);
    
    const isHomePage = pathname === '/';
    const isPublicPage = pathname.startsWith('/share') || pathname.startsWith('/simulation');
    
    // Determine if we need to redirect
    const shouldRedirectToIndexes = authenticated && isHomePage;
    const shouldRedirectToHome = !authenticated && !isHomePage && !isPublicPage;
    
    if (shouldRedirectToIndexes) {
      router.push('/indexes');
      return; // Will re-evaluate when pathname changes
    }
    
    if (shouldRedirectToHome) {
      router.push('/');
      return; // Will re-evaluate when pathname changes
    }
    
    // Only stop loading if we're on the correct page for our auth state
    setIsLoading(false);
  }, [authenticated, ready, router, pathname]);

  return (
    <AuthContext.Provider
      value={{
        isReady: ready,
        isLoading,
        isAuthenticated: authenticated,
      }}
    >
      {isLoading ? (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
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
        // Only allow email login
        loginMethods: ['email', 'google'],
        // Disable wallet features
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets'
          }
        }
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
