import { useState, useEffect } from 'react';
import { authClient } from '@/lib/auth-client';
import { ensureLandingFonts } from '@/app/landing/Nav';
import './AuthModal.css';

const PROTOCOL_BASE = import.meta.env.VITE_PROTOCOL_URL || '';
const API_BASE = `${PROTOCOL_BASE}/api`;

interface AuthFormProps {
  /** Override the post-login redirect URL. Defaults to window.location.origin. */
  callbackURL?: string;
  /** Called after a non-redirecting (email/password) sign-in succeeds. */
  onAuthenticated?: () => void;
  /** Hide default title/lede when embedded (e.g. invite landing). */
  variant?: 'default' | 'inline';
}

type AuthView = 'main' | 'magic-link-sent' | 'email-password';

/**
 * Sign-in form (Google, magic link, optional email/password). Rendered inside
 * the AuthModal overlay or inline on a page (e.g. /cli-auth) — the surrounding
 * `.auth` / `.auth-light` wrapper picks the dark or light theme.
 */
export default function AuthForm({ callbackURL, onAuthenticated, variant = 'default' }: AuthFormProps) {
  const [view, setView] = useState<AuthView>('main');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socialProviders, setSocialProviders] = useState<string[]>([]);
  const [emailPasswordEnabled, setEmailPasswordEnabled] = useState(false);
  const [providersStatus, setProvidersStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [providersRetryKey, setProvidersRetryKey] = useState(0);
  const [isSignUp, setIsSignUp] = useState(false);

  useEffect(() => {
    ensureLandingFonts();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      setProvidersStatus('loading');
      fetch(`${API_BASE}/auth/providers`)
        .then((r) => {
          if (!r.ok) throw new Error(`providers request failed: ${r.status}`);
          return r.json();
        })
        .then((data: { providers?: string[]; emailPassword?: boolean }) => {
          if (cancelled) return;
          setSocialProviders(data.providers ?? []);
          setEmailPasswordEnabled(data.emailPassword ?? false);
          setProvidersStatus('ready');
        })
        .catch(() => {
          if (cancelled) return;
          // Retry twice with backoff — covers transient API restarts (bun --watch).
          if (attempt < 2) {
            timer = setTimeout(() => load(attempt + 1), 1000 * (attempt + 1));
          } else {
            setProvidersStatus('error');
          }
        });
    };
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [providersRetryKey]);

  const hasGoogle = socialProviders.includes('google');
  const resolvedCallbackURL =
    callbackURL ?? (typeof window !== 'undefined' ? window.location.origin : '/');

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setName('');
    setError(null);
    setView('main');
    setIsSignUp(false);
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: magicLinkError } = await authClient.signIn.magicLink({
        email,
        callbackURL: resolvedCallbackURL,
      });
      if (magicLinkError) {
        setError(magicLinkError.message || 'Failed to send sign-in link');
        return;
      }
      setView('magic-link-sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name: name || email.split('@')[0],
          callbackURL: resolvedCallbackURL,
        });
        if (signUpError) {
          setError(signUpError.message || 'Sign up failed');
          return;
        }
      } else {
        const { error: signInError } = await authClient.signIn.email({
          email,
          password,
          callbackURL: resolvedCallbackURL,
        });
        if (signInError) {
          setError(signInError.message || 'Sign in failed');
          return;
        }
      }
      resetForm();
      onAuthenticated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: resolvedCallbackURL,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign in failed');
      setLoading(false);
    }
  };

  const inline = variant === 'inline';

  return (
    <>
      {view === 'magic-link-sent' && (
        <>
          <div className="av-head">
            <h2 id="auth-modal-title" className="av-title">
              Check your email
            </h2>
          </div>
          <p className="av-lede">
            We sent a sign-in link to <strong>{email}</strong>.
          </p>
          <p className="av-note">
            Click the link in the email to sign in. It expires in 10 minutes.
          </p>
          <button
            type="button"
            className="av-submit ghost"
            onClick={resetForm}
          >
            Back to sign in
          </button>
        </>
      )}

      {view === 'main' && (
        <>
          {!inline && (
            <>
              <div className="av-head">
                <h2 id="auth-modal-title" className="av-title">
                  Sign in to the Index Network
                </h2>
              </div>
              <p className="av-lede">
                Write what you want — let the network bring people to you.
              </p>
            </>
          )}

          {providersStatus === 'error' && (
            <p className="av-note">
              Couldn&apos;t load all sign-in options.{' '}
              <button
                type="button"
                className="av-link"
                onClick={() => setProvidersRetryKey((k) => k + 1)}
              >
                Retry
              </button>
            </p>
          )}

          {hasGoogle && (
            <button
              type="button"
              className="av-oauth"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          )}

          {hasGoogle && <div className="av-divider">or</div>}

          <form onSubmit={handleMagicLink} className="av-form">
            <label htmlFor="auth-email" className="av-label">Email</label>
            <input
              id="auth-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="av-input"
            />

            {error && <p className="av-error">{error}</p>}

            <button type="submit" disabled={loading} className="av-submit">
              {loading ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>

          {emailPasswordEnabled && (
            <p className="av-alt">
              or{' '}
              <button
                type="button"
                className="av-link"
                onClick={() => setView('email-password')}
              >
                sign in with a password
              </button>
            </p>
          )}
        </>
      )}

      {view === 'email-password' && emailPasswordEnabled && (
        <>
          <div className="av-head">
            <button
              type="button"
              className="av-back"
              onClick={() => { setView('main'); setError(null); }}
              aria-label="Back"
            >
              ←
            </button>
            <h2 id="auth-modal-title" className="av-title">
              {isSignUp ? 'Create an account' : 'Sign in with a password'}
            </h2>
          </div>

          <form onSubmit={handleEmailPassword} className="av-form">
            {isSignUp && (
              <>
                <label htmlFor="auth-name" className="av-label">Name</label>
                <input
                  id="auth-name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="av-input"
                />
              </>
            )}
            <label htmlFor="auth-email-pw" className="av-label">Email</label>
            <input
              id="auth-email-pw"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="av-input"
            />
            <label htmlFor="auth-password" className="av-label">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="av-input"
            />

            {error && <p className="av-error">{error}</p>}

            <button type="submit" disabled={loading} className="av-submit">
              {loading ? 'Loading…' : isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="av-alt">
            {isSignUp ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="av-link"
                  onClick={() => { setIsSignUp(false); setError(null); }}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  className="av-link"
                  onClick={() => { setIsSignUp(true); setError(null); }}
                >
                  Sign up
                </button>
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}
