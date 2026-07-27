import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { authClient, clearJwtToken } from '@/lib/auth-client';
import { APIError, useAuthenticatedAPI } from '../lib/api';
import { useAuthService } from '../services/auth';
import { User, APIResponse } from '../lib/types';
import AuthModal from '@/components/AuthModal';
import { log } from '@/lib/logger';

const logger = log.context.from('AuthContext');

/**
 * Server-driven feature flags returned alongside the user on GET /auth/me
 * (sibling of `user`, not part of it). `negotiatorChat` gates the pinned
 * Personal Agent entry; `signalAgent` gates the main-web Signal cutover;
 * `agentSurface` gates the read-only Reporter Agent surface.
 */
export type UserFeatures = {
  negotiatorChat?: boolean;
  signalAgent?: boolean;
  agentSurface?: boolean;
};

type AuthContextType = {
  isReady: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  user: User | null;
  features: UserFeatures | null;
  userLoading: boolean;
  error: string | null;
  refetchUser: () => Promise<void>;
  updateUser: (user: User) => void;
  openLoginModal: (callbackURL?: string) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession();

  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [features, setFeatures] = useState<UserFeatures | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userFetchAttempted, setUserFetchAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [pendingCallbackURL, setPendingCallbackURL] = useState<string | undefined>(undefined);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const api = useAuthenticatedAPI();
  const authService = useAuthService();

  const ready = !session.isPending;
  const authenticated = !!session.data?.session;

  const updateUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

  const openLoginModal = useCallback((callbackURL?: string) => {
    setPendingCallbackURL(callbackURL);
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
      const response = await api.get<APIResponse<User> & { features?: UserFeatures }>('/auth/me');
      if (response.user) {
        setUser(response.user);
        setFeatures(response.features ?? null);

        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (browserTimezone && response.user.timezone !== browserTimezone) {
          authService.updateProfile({ timezone: browserTimezone })
            .then(updatedUser => {
              setUser(updatedUser);
            })
            .catch(err => {
              logger.error('Failed to update timezone', { error: err });
            });
        }
      } else {
        throw new Error('No user data received');
      }
    } catch (error) {
      logger.error('Failed to fetch user', { error });

      // The browser can retain a Better Auth session/JWT for a user that no
      // longer exists in the currently selected dev database. Treat auth/user
      // lookup failures as stale auth state and clear it automatically instead
      // of trapping the user on the error screen.
      if (error instanceof APIError && (error.status === 401 || error.status === 404)) {
        clearJwtToken();
        await authClient.signOut().catch(signOutError => {
          logger.error('Failed to clear stale auth session', { error: signOutError });
        });
        setUser(null);
        setFeatures(null);
        setUserFetchAttempted(false);
        setError(null);
        return;
      }

      setError('Failed to load user data. Please try refreshing the page.');
      setUser(null);
      setFeatures(null);
    } finally {
      setUserLoading(false);
    }
  }, [authenticated, ready, api, authService]);

  useEffect(() => {
    if (authenticated && ready && !user && !userLoading && !userFetchAttempted) {
      fetchUser();
    } else if (!authenticated) {
      setUser(null);
      setFeatures(null);
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
    const publicPrefixes = [
      '/simulation', '/l', '/index/', '/blog', '/pages', '/about',
      '/login', '/s/', '/oauth/', '/found-in-translation', '/overview', '/protocol', '/cli-auth', '/u/', '/c/',
    ];
    const isPublicPage = publicPrefixes.some(p => pathname.startsWith(p));
    const isProtectedPage = pathname.startsWith('/i/');

    const shouldRedirectToHome = !authenticated && (isProtectedPage || (!isHomePage && !isPublicPage));

    if (shouldRedirectToHome) {
      // Preserve the destination so the user returns to it after authenticating,
      // instead of being stranded on the home page. This makes protected deep
      // links work when opened while logged out — e.g. the negotiation-trace
      // link (`/chat/:conversationId`) surfaced in the daily digest. The
      // captured URL is forwarded to Better Auth as `callbackURL`, mirroring the
      // public `/u/:id/chat` page's `openLoginModal(window.location.href)` flow.
      if (typeof window !== 'undefined') {
        // Guarded one-shot: we open the modal and immediately redirect+return, so
        // this does not cascade renders despite the set-state-in-effect lint.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        openLoginModal(window.location.href);
      }
      navigate('/');
      return;
    }

    // Force redirect to /onboarding only from the authenticated home page.
    if (authenticated && user && !user.onboarding?.completedAt && isHomePage) {
      navigate('/onboarding', { replace: true });
      return;
    }

    setIsLoading(false);
  }, [authenticated, ready, navigate, pathname, user, userLoading, userFetchAttempted, openLoginModal]);

  return (
    <AuthContext.Provider
      value={{
        isReady: ready,
        isLoading,
        isAuthenticated: authenticated,
        user,
        features,
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
        onClose={() => { setPendingCallbackURL(undefined); setLoginModalOpen(false); }}
        callbackURL={pendingCallbackURL}
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
