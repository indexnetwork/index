import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

export interface NetworkMasterKeyRotatedParams {
  networkName: string;
  actorDisplay: string;
  newKey: string;
  integrationsUrl: string;
}

export interface NetworkMasterKeyRotatedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * One-time delivery of a rotated master key to every owner of an experiment
 * network. The plaintext key is shown inline; the recipient must store it in
 * a secret manager — Index Network does not retain a recoverable copy.
 */
export const networkMasterKeyRotatedTemplate = (
  p: NetworkMasterKeyRotatedParams,
): NetworkMasterKeyRotatedEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const safeActor = escapeHtml(p.actorDisplay);
  const safeKey = escapeHtml(p.newKey);
  const safeUrl = escapeHtml(sanitizeUrlForHref(p.integrationsUrl));
  // Strip CR/LF and other control chars from the network name before splicing
  // it into the Subject header — defends against header injection.
  const subjectName = p.networkName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);

  return {
    subject: `Master key rotated for ${subjectName}`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p>The master key for <strong>${safeNetwork}</strong> has just been rotated by <strong>${safeActor}</strong>.</p>
  <p>The previous key is no longer valid. Any backend (InstaClaw, EdgeOS) still using the old key will return 403 until it is reconfigured.</p>
  <p>Your new master key (shown only once):</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px;">${safeKey}</pre>
  <p>Treat this like a password — store it in your backend's secret manager. You can view the integration on the <a href="${safeUrl}">${safeNetwork} integrations tab</a>.</p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `The master key for ${p.networkName} has just been rotated by ${p.actorDisplay}.

The previous key is no longer valid. Any backend (InstaClaw, EdgeOS) still using the old key will return 403 until it is reconfigured.

Your new master key (shown only once):

${p.newKey}

Treat this like a password — store it in your backend's secret manager. Integrations tab: ${p.integrationsUrl}`,
  };
};
