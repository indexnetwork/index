import { useEffect, useState } from 'react';

import { decideMcpConsent, getMcpConsentDetails } from '@/lib/auth-client';
import { AppsShell } from '@/app/download/page';
import './consent.css';

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
    <AppsShell>
      <main className="mcp-consent__card">
        <span className="mcp-consent__eyebrow">MCP access request</span>
        <h1>Allow this client to access your Index account?</h1>
        {client ? (
          <>
            <p className="mcp-consent__client">{client.clientName}</p>
            <p className="mcp-consent__warning">This client name is unverified. Approving grants this client <strong>full Index MCP access</strong> to your account, including the ability to use MCP tools as you.</p>
            <p className="mcp-consent__label">Your authorization code will be sent to this exact callback destination:</p>
            <p className="mcp-consent__destination">{client.redirectURI}</p>
            <div className="mcp-consent__actions">
              <button type="button" disabled={submitting} onClick={() => decide(false)}>Deny</button>
              <button type="button" disabled={submitting} onClick={() => decide(true)}>Approve</button>
            </div>
          </>
        ) : !error ? <p>Checking authorization request…</p> : null}
        {error && <p role="alert" className="mcp-consent__error">{error}</p>}
      </main>
    </AppsShell>
  );
}

export const Component = McpConsentPage;
