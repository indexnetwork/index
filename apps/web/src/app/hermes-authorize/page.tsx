import { useEffect, useRef, useState } from 'react';

import AuthForm from '@/components/AuthForm';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { HERMES_CAPABILITIES, buildHermesAuthorizationCallbackUrl, hasExactHermesCapabilities, parseHermesAuthorizationQuery, type HermesAuthorizationQuery } from '@/lib/hermes-auth';
import { hermesAuthorizationService, type HermesAuthorizationRequestView } from '@/services/connected-agents';

type PageStatus = 'loading' | 'login' | 'consent' | 'approving' | 'redirecting' | 'error';

function invalidMessage(): string {
  return 'This Hermes authorization request is invalid or has expired. Start a new connection from Hermes.';
}

function HermesAuthorizePage() {
  const [request] = useState<HermesAuthorizationQuery | null>(() =>
    window.location.hash === '' ? parseHermesAuthorizationQuery(window.location.search) : null,
  );
  const [status, setStatus] = useState<PageStatus>(request ? 'loading' : 'error');
  const [authorization, setAuthorization] = useState<HermesAuthorizationRequestView | null>(null);
  const [account, setAccount] = useState('');
  const [message, setMessage] = useState(request ? '' : invalidMessage());
  const loadStarted = useRef(false);

  useEffect(() => {
    if (!request || loadStarted.current) return;
    loadStarted.current = true;

    async function load(input: HermesAuthorizationQuery) {
      try {
        const session = await authClient.getSession();
        if (!session.data?.session) {
          setStatus('login');
          return;
        }

        const metadata = await hermesAuthorizationService.getRequest(input.requestId, input.state);
        if (
          metadata.requestId !== input.requestId
          || metadata.state !== input.state
          || metadata.redirectUri !== input.redirectUri
          || !hasExactHermesCapabilities(metadata.actions)
        ) {
          throw new Error('Authorization metadata mismatch');
        }

        setAccount(session.data.user?.email ?? session.data.user?.name ?? 'Your Index account');
        setAuthorization(metadata);
        setStatus('consent');
      } catch {
        setMessage(invalidMessage());
        setStatus('error');
      }
    }

    void load(request);
  }, [request]);

  async function approve() {
    if (!request || !authorization || status !== 'consent') return;
    setStatus('approving');
    setMessage('');
    try {
      const approved = await hermesAuthorizationService.approve(
        request.requestId,
        request.state,
        request.redirectUri,
      );
      if (approved.state !== request.state || approved.redirectUri !== request.redirectUri || !approved.code) {
        throw new Error('Authorization approval mismatch');
      }
      const callback = buildHermesAuthorizationCallbackUrl({
        redirectUri: approved.redirectUri,
        requestId: request.requestId,
        code: approved.code,
        state: approved.state,
      });
      setStatus('redirecting');
      window.location.href = callback;
    } catch {
      setMessage('Hermes could not be authorized. Start a new connection from Hermes and try again.');
      setStatus('error');
    }
  }

  return (
    <main className="flex-1 bg-white px-6 py-12">
      <div className="mx-auto max-w-2xl rounded-sm border border-gray-200 p-6 shadow-sm">
        {status === 'login' && request ? (
          <div className="auth auth-light">
            <AuthForm
              callbackURL={window.location.href}
              onAuthenticated={() => window.location.reload()}
            />
          </div>
        ) : null}

        {status === 'loading' ? (
          <div className="text-center" role="status">
            <h1 className="text-xl font-semibold text-gray-900">Checking Hermes connection</h1>
            <p className="mt-2 text-sm text-gray-500">Loading the authorization request…</p>
          </div>
        ) : null}

        {(status === 'consent' || status === 'approving') && authorization ? (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Hermes authorization</p>
              <h1 className="mt-2 text-2xl font-semibold text-gray-900">Connect Hermes to Index</h1>
              <p className="mt-2 text-sm text-gray-600">
                Signed in as <strong>{account}</strong>
              </p>
            </div>

            <div className="rounded-sm bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Installation</p>
              <code className="mt-1 block break-all text-sm text-gray-800">{authorization.installationId}</code>
            </div>

            <section aria-labelledby="capabilities-heading">
              <h2 id="capabilities-heading" className="font-semibold text-gray-900">Hermes will be able to</h2>
              <ul className="mt-3 space-y-2 text-sm text-gray-700">
                {HERMES_CAPABILITIES.map((capability) => (
                  <li key={capability.action} className="flex gap-2">
                    <span aria-hidden="true">✓</span>
                    <span>{capability.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="space-y-2 text-sm text-gray-600">
              <p>This connection expires after 30 days. Reconnecting always requires a new authorization.</p>
              <p className="font-medium text-gray-800">
                Hermes cannot manage your sign-in methods, API keys, connected agents, billing, or account deletion.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <a href="/agents/connected" className="inline-flex h-10 items-center px-4 text-sm text-gray-600 hover:text-black">
                Cancel
              </a>
              <Button onClick={approve} disabled={status === 'approving'}>
                {status === 'approving' ? 'Authorizing…' : 'Allow connection'}
              </Button>
            </div>
          </div>
        ) : null}

        {status === 'redirecting' ? (
          <div className="text-center" role="status">
            <h1 className="text-xl font-semibold text-gray-900">Hermes authorized</h1>
            <p className="mt-2 text-sm text-gray-500">Returning to your Hermes installation…</p>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900">Authorization unavailable</h1>
            <p className="mt-2 text-sm text-gray-500">{message}</p>
            <a href="/download" className="mt-5 inline-block text-sm font-medium text-gray-900 underline">
              Hermes connection instructions
            </a>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export const Component = HermesAuthorizePage;
