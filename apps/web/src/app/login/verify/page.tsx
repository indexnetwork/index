import { useState } from 'react';

import { SiteSignInPage, SiteSignInPanel } from '@/components/SiteSignIn';
import { protocolOrigin } from '@/lib/protocol-origin';

export function Component() {
  const [params] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const [continuing, setContinuing] = useState(false);
  const token = params.get('token');

  const signIn = () => {
    if (!token) return;
    setContinuing(true);
    // Never navigate to an arbitrary URL supplied in the email. Better Auth
    // validates all callback origins when this fixed endpoint redeems the token.
    const url = new URL('/api/auth/magic-link/verify', protocolOrigin() || window.location.origin);
    for (const key of ['token', 'callbackURL', 'newUserCallbackURL']) {
      const value = params.get(key);
      if (value) url.searchParams.set(key, value);
    }
    if (!url.searchParams.has('callbackURL')) url.searchParams.set('callbackURL', window.location.origin);
    const retry = new URL('/login', window.location.origin);
    const callback = params.get('callbackURL');
    if (callback) {
      try {
        const destination = new URL(callback);
        if (destination.origin === window.location.origin) {
          retry.searchParams.set('next', destination.pathname + destination.search);
        }
      } catch { /* Fall back to home after signing in again. */ }
    }
    url.searchParams.set('errorCallbackURL', retry.toString());
    window.location.assign(url.toString());
  };

  return (
    <SiteSignInPage title="Sign in to Index">
      <SiteSignInPanel bar="Email sign-in">
        <p className="site-p">{token ? 'Continue to finish signing in.' : 'This sign-in link is incomplete. Request a new email link.'}</p>
        {token ? (
          <button type="button" className="site-btn site-btn--block" disabled={continuing} onClick={signIn}>
            {continuing ? 'Signing in…' : 'Continue to sign in'}
          </button>
        ) : <a className="site-btn" href="/login">Request a new link</a>}
      </SiteSignInPanel>
    </SiteSignInPage>
  );
}
