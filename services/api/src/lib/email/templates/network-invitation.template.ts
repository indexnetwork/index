import { escapeHtml } from '../../escapeHtml';

export interface NetworkInvitationParams {
  networkName: string;
}

export interface NetworkInvitationEmail {
  subject: string;
  html: string;
  text: string;
}

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'https://index.network';

/**
 * Notifies someone that a network owner added them to a network. It carries no
 * credential — the invitee signs in normally to see it.
 *
 * @param p - Display name of the network they were added to.
 * @returns Subject, HTML and plain-text bodies.
 */
export const networkInvitationTemplate = (
  p: NetworkInvitationParams,
): NetworkInvitationEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const safeUrl = escapeHtml(WEB_APP_URL);
  // Strip CR/LF and other control chars from the network name before splicing
  // it into the subject header — defends against header injection if someone
  // ever sets a malicious title on a network they own.
  const subjectName = p.networkName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);

  return {
    subject: `You've been added to ${subjectName}`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p>You've been added to <strong>${safeNetwork}</strong> on Index Network.</p>
  <p>Sign in to see it:</p>
  <p><a href="${safeUrl}">${safeUrl}</a></p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `You've been added to ${p.networkName} on Index Network.

Sign in to see it: ${WEB_APP_URL}`,
  };
};
