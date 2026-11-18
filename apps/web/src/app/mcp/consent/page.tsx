import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { decideMcpConsent, getMcpConsentDetails, type McpConsentDetails } from '@/lib/auth-client';
import { SiteSignInPage, SiteSignInPanel } from '@/components/SiteSignIn';

const consentCode = new URLSearchParams(window.location.search).get('consent_code');

function McpConsentPage() {
  const { t } = useTranslation();
  const [client, setClient] = useState<McpConsentDetails | null>(null);
  const [error, setError] = useState<string | null>(
    consentCode ? null : t('This authorization request is invalid. Start again from your MCP client.'),
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
      setError(cause instanceof Error ? cause.message : t('Authorization failed.'));
      setSubmitting(false);
    }
  }

  return (
    // A request that can't be loaded asks nothing, so it doesn't get the question as its title.
    <SiteSignInPage bar={t("MCP access request")} title={error && !client ? t("Request unavailable") : t("Allow this client to access your Index account?")}>
      <SiteSignInPanel bar={t("MCP access request")} wide>
        {client ? (
          <>
            <p className="signin-subtitle" style={{ overflowWrap: "anywhere" }}>{client.knownClientName ?? client.clientName}</p>
            {client.knownClientName ? (
              <p className="site-p"><Trans i18nKey="Verified: approval returns to <strong>{{host}}</strong>. Approving grants {{client}} <strong>full Index MCP access</strong> to your account, including the ability to use MCP tools as you." values={{ host: client.redirectHost, client: client.knownClientName }} components={{ strong: <strong /> }} /></p>
            ) : (
              // Clients name themselves when they register, so only the redirect host says who gets access.
              <p className="site-p"><Trans i18nKey="This client named itself, so the name is unverified. Approval returns to <host>{{host}}</host>. Approving grants this client <strong>full Index MCP access</strong> to your account, including the ability to use MCP tools as you." values={{ host: client.redirectHost }} components={{ host: <strong style={{ overflowWrap: "anywhere" }} />, strong: <strong /> }} /></p>
            )}
            {/* Above the actions, so a failed decision reads next to the buttons (and clear of the sticky bar on phones). */}
            {error && <p role="alert" className="signin-error">{error}</p>}
            <div className="signin-actions signin-actions--sticky">
              <button type="button" className="site-btn site-btn--secondary" disabled={submitting} onClick={() => decide(false)}>{t("Deny")}</button>
              <button type="button" className="site-btn" disabled={submitting} onClick={() => decide(true)}>{t("Approve")}</button>
            </div>
          </>
        ) : !error ? <p className="site-p">{t("Checking authorization request…")}</p> : null}
        {error && !client && <p role="alert" className="signin-error">{error}</p>}
        {error && !client && (
          // Nothing to retry here: a fresh request has to come from the MCP client.
          <div className="signin-actions">
            <a className="site-btn" href="/">{t("Go home")}</a>
          </div>
        )}
      </SiteSignInPanel>
    </SiteSignInPage>
  );
}

export const Component = McpConsentPage;
