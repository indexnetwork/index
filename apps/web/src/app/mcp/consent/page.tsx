import { useEffect, useState } from 'react';

import { decideMcpConsent, getMcpConsentDetails } from '@/lib/auth-client';
import { SiteSignInPage, SiteSignInPanel } from '@/components/SiteSignIn';

const consentCode = new URLSearchParams(window.location.search).get('consent_code');

type ClientDetails = Awaited<ReturnType<typeof getMcpConsentDetails>>;

function McpConsentPage() {
  const [client, setClient] = useState<ClientDetails | null>(null);
  const [error, setError] = useState<string | null>(
    consentCode ? null : 'This authorization request is invalid. Start again from your MCP client.',
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!consentCode) return;
    getMcpConsentDetails(consentCode).then(setClient).catch((cause: Error) => setError(cause.message));
  }, []);

  async function decide(accept: boolean) {
    if (!consentCode || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const destination = await decideMcpConsent(consentCode, accept);
      window.location.assign(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authorization failed.');
      setSubmitting(false);
    }
  }

  return (
    <SiteSignInPage title="Allow this client to access your Index account?">
      <SiteSignInPanel bar="MCP access request" wide>
        {client ? (
          <>
            <p className="signin-subtitle" style={{ overflowWrap: "anywhere" }}>{client.clientName}</p>
            <p className="site-p">This client name is unverified. Approving grants this client <strong>full Index MCP access</strong> to your account, including the ability to use MCP tools as you.</p>
            <p className="signin-label">Your authorization code will be sent to this exact callback destination:</p>
            <p className="signin-code">{client.redirectURI}</p>
            <div className="signin-actions">
              <button type="button" className="site-btn site-btn--secondary" disabled={submitting} onClick={() => decide(false)}>Deny</button>
              <button type="button" className="site-btn" disabled={submitting} onClick={() => decide(true)}>Approve</button>
            </div>
          </>
        ) : !error ? <p className="site-p">Checking authorization request…</p> : null}
        {error && <p role="alert" className="signin-error">{error}</p>}
        {error && !client && (
          // Nothing to retry here: a fresh request has to come from the MCP client.
          <div className="signin-actions">
            <a className="site-btn" href="/">Go home</a>
          </div>
        )}
      </SiteSignInPanel>
    </SiteSignInPage>
  );
}

export const Component = McpConsentPage;
