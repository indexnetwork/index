import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { authClient, clearJwtToken } from '@/lib/auth-client';
import { APIError, useAuthenticatedAPI } from '../lib/api';
import { useAuthService } from '../services/auth';
import { User, APIResponse } from '../lib/types';
import { StatusPage } from '@/components/SiteSignIn';
import { log } from '@/lib/logger';

const logger = log.context.from('AuthContext');

/**
 * Server-driven feature flags returned alongside the user on GET /auth/me
 * (sibling of `user`, not part of it).
 */
export type UserFeatures = Record<string, boolean>;

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
  /** Sends the visitor to /login, returning to `callbackURL` (same-origin) afterwards. */
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
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const api = useAuthenticatedAPI();
  const authService = useAuthService();

  const ready = !session.isPending;
  const authenticated = !!session.data?.session;

  const updateUser = useCallback((updatedUser: User) => {
    setUser(updatedUser);
  }, []);

  // Web sign-in is always the public /login page, so every channel sees the
  // same form; the retro sign-in window belongs to the Mac app only.
  const openLoginModal = useCallback((callbackURL?: string) => {
    let next = '/';
    try {
      const target = new URL(callbackURL ?? window.location.href, window.location.origin);
      if (target.origin === window.location.origin) next = target.pathname + target.search + target.hash;
    } catch {
      // Unparseable target: fall back to home after sign-in.
    }
    navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
  }, [navigate]);

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

  useEffect(() => {
    if (!ready) return;

    const isHomePage = pathname === '/';
    const publicPrefixes = [
      '/l', '/blog', '/pages', '/about', '/hermes',
      '/login', '/s/', '/found-in-translation', '/protocol', '/cli-auth', '/u/', '/o/', '/i/', '/waitlist', '/download',
      '/9db20a5fbe',
    ];
    const isPublicPage = publicPrefixes.some(p => pathname.startsWith(p));
    const isProtectedPage = pathname.startsWith('/i/new');

    if (authenticated && userLoading && !isPublicPage) return;
    if (authenticated && !user && !userFetchAttempted && !isPublicPage) return;

    const shouldRedirectToHome = !authenticated && (isProtectedPage || (!isHomePage && !isPublicPage));

    if (shouldRedirectToHome) {
      // Preserve the destination so the user returns to it after authenticating,
      // instead of being stranded on the home page. This makes protected deep
      // links work when opened while logged out, e.g. an intent link surfaced
      // in the daily digest: /login?next= carries it through sign-in.
      openLoginModal(window.location.href);
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
        // The workbench blue with a white segmented bar filling while auth settles.
        <div className="index-splash" role="status" aria-label="loading">
          <div className="index-splash-bar" aria-hidden>
            {Array.from({ length: 12 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.1}s` }} />)}
          </div>
          <div className="index-splash-label">loading<span className="index-splash-blink">_</span></div>
        </div>
      ) : error ? (
        <StatusPage bar="error" title="Something went wrong" message={error}>
          <button type="button" className="site-btn" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </StatusPage>
      ) : (
        children
      )}
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
