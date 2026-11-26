import { useEffect, useState } from 'react';

import { SiteSignInPage, SiteSignInPanel } from '@/components/SiteSignIn';
import { protocolOrigin } from '@/lib/protocol-origin';
import { readSignInBrowserKey } from '@/lib/sign-in-browser-key';

/** Where to land when the link can't be used here: login, resuming the same page. */
function retryURL(params: URLSearchParams, error?: string): URL {
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
  if (error) retry.searchParams.set('error', error);
  return retry;
}

/** The fixed API endpoint that spends the token; never a URL from the email. */
function verifyURL(params: URLSearchParams, browserKey?: string): string {
  // Better Auth validates all callback origins when this endpoint redeems the token.
  const url = new URL('/api/auth/magic-link/verify', protocolOrigin() || window.location.origin);
  for (const key of ['token', 'callbackURL', 'newUserCallbackURL']) {
    const value = params.get(key);
    if (value) url.searchParams.set(key, value);
  }
  if (!url.searchParams.has('callbackURL')) url.searchParams.set('callbackURL', window.location.origin);
  url.searchParams.set('errorCallbackURL', retryURL(params).toString());
  if (browserKey) url.searchParams.set('browserKey', browserKey);
  return url.toString();
}

export function Component() {
  const [params] = useState(() => new URLSearchParams(window.location.hash.slice(1)));
  const [continuing, setContinuing] = useState(false);
  const token = params.get('token');
  // A bound link was requested from a browser holding a sign-in key. Only that
  // key can spend it, so it signs in on arrival with no click: a mail scanner
  // has no key, lands on login, and leaves the token for the recipient.
  const bound = Boolean(token) && params.get('bound') === '1';

  useEffect(() => {
    if (!bound) return;
    const browserKey = readSignInBrowserKey();
    if (browserKey) window.location.replace(verifyURL(params, browserKey));
    else window.location.replace(retryURL(params, 'OTHER_BROWSER').toString());
  }, [bound, params]);

  const signIn = () => {
    if (!token) return;
    setContinuing(true);
    window.location.assign(verifyURL(params));
  };

  if (bound) {
    return (
      <SiteSignInPage title="sign in to index">
        <SiteSignInPanel bar="email sign-in">
          <p className="site-p">signing in…</p>
        </SiteSignInPanel>
      </SiteSignInPage>
    );
  }

  // Links sent without a browser key (older clients) still need an explicit click.
  return (
    <SiteSignInPage title="sign in to index">
      <SiteSignInPanel bar="email sign-in">
        <p className="site-p">{token ? 'one click and you\'re in.' : 'this sign-in link is cut off. send yourself a new one.'}</p>
        {token ? (
          <button type="button" className="site-btn site-btn--block" disabled={continuing} onClick={signIn}>
            {continuing ? 'signing in…' : 'continue →'}
          </button>
        ) : <a className="site-btn" href="/login">send a new link →</a>}
      </SiteSignInPanel>
    </SiteSignInPage>
  );
}
