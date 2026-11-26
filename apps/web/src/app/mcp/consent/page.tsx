import { useEffect, useState } from 'react';

import { decideMcpConsent, getMcpConsentDetails, type McpConsentDetails } from '@/lib/auth-client';
import { SiteSignInPage, SiteSignInPanel } from '@/components/SiteSignIn';
import { Placeholder } from "@/components/ui/Placeholder";

const consentCode = new URLSearchParams(window.location.search).get('consent_code');

function McpConsentPage() {
  const [client, setClient] = useState<McpConsentDetails | null>(null);
  const [error, setError] = useState<string | null>(
    consentCode ? null : 'this access request isn\'t valid. start again from your mcp client.',
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
      setError(cause instanceof Error ? cause.message : 'couldn\'t finish that. try again.');
      setSubmitting(false);
    }
  }

  return (
    // A request that can't be loaded asks nothing, so it doesn't get the question as its title.
    <SiteSignInPage bar="mcp access request" title={error && !client ? "request unavailable" : "let this client use your index account?"}>
      <SiteSignInPanel bar="mcp access request" wide>
        {client ? (
          <>
            <p className="signin-subtitle" style={{ overflowWrap: "anywhere" }}>{client.knownClientName ?? client.clientName}</p>
            {client.knownClientName ? (
              <p className="site-p">verified: approving returns you to <strong>{client.redirectHost}</strong> and gives {client.knownClientName} <strong>full access to your index account</strong> over mcp, including using index's tools as you.</p>
            ) : (
              // Clients name themselves when they register, so only the redirect host says who gets access.
              <p className="site-p">this client named itself, so the name isn't verified. approving returns you to <strong style={{ overflowWrap: "anywhere" }}>{client.redirectHost}</strong> and gives this client <strong>full access to your index account</strong> over mcp, including using index's tools as you.</p>
            )}
            {/* Above the actions, so a failed decision reads next to the buttons (and clear of the sticky bar on phones). */}
            {error && <p role="alert" className="signin-error">{error}</p>}
            <div className="signin-actions signin-actions--sticky">
              <button type="button" className="site-btn site-btn--secondary" disabled={submitting} onClick={() => decide(false)}>deny</button>
              <button type="button" className="site-btn" disabled={submitting} onClick={() => decide(true)}>approve</button>
            </div>
          </>
        ) : !error ? <Placeholder.Text lines={3} title label="checking authorization request" /> : null}
        {error && !client && <p role="alert" className="signin-error">{error}</p>}
        {error && !client && (
          // Nothing to retry here: a fresh request has to come from the MCP client.
          <div className="signin-actions">
            <a className="site-btn" href="/">go home →</a>
          </div>
        )}
      </SiteSignInPanel>
    </SiteSignInPage>
  );
}

export const Component = McpConsentPage;
