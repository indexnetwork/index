import { escapeHtml } from '../../escapeHtml';

export interface NetworkInvitationParams {
  networkName: string;
  apiKey: string;
  connectCommand: string;
  /** When true, render the "key has been refreshed" variant. */
  isResend?: boolean;
}

export interface NetworkInvitationEmail {
  subject: string;
  html: string;
  text: string;
}

const REFRESH_NOTE = 'Your previous key has been revoked. Use the key below going forward.';

/**
 * Plain-text + HTML invitation that delivers the user's raw API key. Possession
 * of this email verifies delivery of the scoped key only — it is not a general
 * index.network account verification. The key is bound to a single network via
 * the agent's `agent_permissions.scope='network'` row.
 *
 * When `isResend` is true, the subject and body are switched to the "refreshed
 * key" variant. This is sent by `networkInvitationService.resendInvite`.
 */
export const networkInvitationTemplate = (
  p: NetworkInvitationParams,
): NetworkInvitationEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const safeKey = escapeHtml(p.apiKey);
  const safeCmd = escapeHtml(p.connectCommand);
  // Strip CR/LF and other control chars from the network name before splicing
  // it into the subject header — defends against header injection if someone
  // ever sets a malicious title on a network they own.
  const subjectName = p.networkName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);

  const subject = p.isResend
    ? `Your access key for ${subjectName} (refreshed)`
    : `Your invitation to ${subjectName}`;

  const refreshLeadHtml = p.isResend
    ? `<p>${escapeHtml(REFRESH_NOTE)}</p>\n  `
    : '';
  const refreshLeadText = p.isResend ? `${REFRESH_NOTE}\n\n` : '';
  const introLine = p.isResend
    ? `<p>You're using <strong>${safeNetwork}</strong> on Index Network.</p>`
    : `<p>You've been added to <strong>${safeNetwork}</strong> on Index Network.</p>`;
  const introTextLine = p.isResend
    ? `You're using ${p.networkName} on Index Network.`
    : `You've been added to ${p.networkName} on Index Network.`;

  return {
    subject,
    html: `<div style="font-family: Arial, sans-serif;">
  ${refreshLeadHtml}${introLine}
  <p>Your personal agent's API key:</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px;">${safeKey}</pre>
  <p>To connect a self-hosted OpenClaw agent, run:</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px;">${safeCmd}</pre>
  <p>This key is bound to ${safeNetwork} only. Treat it like a password.</p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `${refreshLeadText}${introTextLine}

Your personal agent's API key:
${p.apiKey}

To connect a self-hosted OpenClaw agent, run:
${p.connectCommand}

This key is bound to ${p.networkName} only. Treat it like a password.`,
  };
};
