import { useEffect, useRef, useState } from 'react';

import AuthForm from '@/components/AuthForm';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { buildIndexAppOwnerCallbackUrl, parseIndexAppOwnerAuthorizationQuery, type IndexAppOwnerAuthorizationQuery } from '@/lib/index-app-owner-auth';
import { indexAppOwnerAuthorizationService, type IndexAppOwnerAuthorizationRequestView } from '@/services/index-app-owner-authorization';

type Status = 'loading' | 'login' | 'consent' | 'approving' | 'redirecting' | 'error';

function IndexAppAuthorizePage() {
  const [request] = useState<IndexAppOwnerAuthorizationQuery | null>(() =>
    window.location.hash === '' ? parseIndexAppOwnerAuthorizationQuery(window.location.search) : null,
  );
  const [metadata, setMetadata] = useState<IndexAppOwnerAuthorizationRequestView | null>(null);
  const [account, setAccount] = useState('');
  const [status, setStatus] = useState<Status>(request ? 'loading' : 'error');
  const started = useRef(false);

  useEffect(() => {
    if (!request || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const session = await authClient.getSession();
        if (!session.data?.session) { setStatus('login'); return; }
        const response = await indexAppOwnerAuthorizationService.getRequest(
          request.requestId, request.state, request.redirectUri,
        );
        if (response.requestId !== request.requestId) throw new Error('request mismatch');
        setAccount(session.data.user?.email ?? session.data.user?.name ?? 'Your Index account');
        setMetadata(response);
        setStatus('consent');
      } catch { setStatus('error'); }
    })();
  }, [request]);

  async function approve() {
    if (!request || !metadata || status !== 'consent') return;
    setStatus('approving');
    try {
      const result = await indexAppOwnerAuthorizationService.approve(
        request.requestId, request.state, request.redirectUri,
      );
      if (result.requestId !== request.requestId || result.state !== request.state || !result.code) {
        throw new Error('approval mismatch');
      }
      setStatus('redirecting');
      window.location.href = buildIndexAppOwnerCallbackUrl({
        redirectUri: request.redirectUri,
        requestId: result.requestId,
        code: result.code,
        state: result.state,
      });
    } catch { setStatus('error'); }
  }

  return (
    <main className="flex-1 bg-white px-6 py-12">
      <div className="mx-auto max-w-xl rounded-sm border border-gray-200 p-6 shadow-sm">
        {status === 'login' && request ? (
          <div className="auth auth-light">
            <AuthForm callbackURL={window.location.href} onAuthenticated={() => window.location.reload()} />
          </div>
        ) : null}
        {status === 'loading' ? <p role="status">Checking this Index app sign-in…</p> : null}
        {(status === 'consent' || status === 'approving') && metadata ? (
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Sign in to Index for macOS</h1>
              <p className="mt-2 text-sm text-gray-600">Signed in as <strong>{account}</strong></p>
            </div>
            <div className="rounded-sm bg-gray-50 p-4">
              <p className="text-sm font-medium">Installation</p>
              <code className="mt-1 block break-all text-sm">{metadata.installationId}</code>
            </div>
            <div className="space-y-2 text-sm text-gray-700">
              <p>A new app-only credential will be stored in macOS Keychain and expires after 30 days.</p>
              {metadata.legacyRevocationRequired ? (
                <p className="font-medium">Your previous plaintext app credential will be revoked before the replacement can be used.</p>
              ) : null}
              <p>The browser receives only a one-time code. It never receives the app credential.</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={approve} disabled={status === 'approving'}>
                {status === 'approving' ? 'Authorizing…' : 'Sign in to this Mac'}
              </Button>
            </div>
          </div>
        ) : null}
        {status === 'redirecting' ? <p role="status">Returning to Index for macOS…</p> : null}
        {status === 'error' ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold">Sign-in unavailable</h1>
            <p className="mt-2 text-sm text-gray-500">Return to the Index app and start a fresh sign-in.</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export const Component = IndexAppAuthorizePage;
