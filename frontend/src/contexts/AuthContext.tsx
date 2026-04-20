import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { authClient, clearJwtToken } from '@/lib/auth-client';
import { useAuthenticatedAPI } from '../lib/api';
import { useAuthService } from '../services/auth';
import { User, APIResponse } from '../lib/types';
import AuthModal from '@/components/AuthModal';

type AuthContextType = {
  isReady: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
  userLoading: boolean;
  error: string | null;
  refetchUser: () => Promise<void>;
  updateUser: (user: User) => void;
  openLoginModal: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession();

  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userFetchAttempted, setUserFetchAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const api = useAuthenticatedAPI();
  const authService = useAuthService();

  const ready = !session.isPending;
  const authenticated = !!session.data?.session;

  const updateUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

  const openLoginModal = useCallback(() => {
    setLoginModalOpen(true);
  }, []);

  const signOut = useCallback(async () => {
    clearJwtToken();
    await authClient.signOut();
    navigate('/');
  }, [navigate]);

  const fetchUser = useCallback(async () => {
    if (!authenticated || !ready) return;

    setUserLoading(true);
    setUserFetchAttempted(true);
    setError(null);
    try {
      const response = await api.get<APIResponse<User>>('/auth/me');
      if (response.user) {
        setUser(response.user);

        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (browserTimezone && response.user.timezone !== browserTimezone) {
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

  // Close modal on successful auth
  useEffect(() => {
    if (authenticated && loginModalOpen) {
      setLoginModalOpen(false);
    }
  }, [authenticated, loginModalOpen]);

  useEffect(() => {
    if (!ready) return;

    if (authenticated && userLoading) return;
    if (authenticated && !user && !userFetchAttempted) return;

    const isHomePage = pathname === '/';
    const isOnboardingPage = pathname === '/onboarding';
    const isPublicPage = pathname.startsWith('/simulation') || pathname.startsWith('/l') || pathname.startsWith('/network/') || pathname.startsWith('/index/') || pathname.startsWith('/blog') || pathname.startsWith('/pages') || pathname.startsWith('/about') || pathname.startsWith('/login') || pathname.startsWith('/s/') || pathname.startsWith('/oauth/') || pathname.startsWith('/found-in-translation');
    const isProtectedPage = pathname.startsWith('/i/');

    const shouldRedirectToHome = !authenticated && (isProtectedPage || (!isHomePage && !isPublicPage));

    if (shouldRedirectToHome) {
      navigate('/');
      return;
    }

    // Force redirect to /onboarding when onboarding is not complete
    if (authenticated && user && !user.onboarding?.completedAt) {
      if (!isOnboardingPage && !isPublicPage) {
        navigate('/onboarding', { replace: true });
        return;
      }
    }

    setIsLoading(false);
  }, [authenticated, ready, navigate, pathname, user, userLoading, userFetchAttempted]);

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
        openLoginModal,
        signOut,
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
      <AuthModal
        isOpen={loginModalOpen}
        onClose={() => setLoginModalOpen(false)}
      />
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
