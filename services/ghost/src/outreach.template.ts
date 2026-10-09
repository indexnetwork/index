import { escapeHtml } from '@indexnetwork/api/src/lib/escapeHtml';

export interface GhostOutreachParams {
  memberName: string;
  memberSignal: string;
  reason: string | null;
}

export interface GhostOutreachEmail {
  subject: string;
  html: string;
  text: string;
}

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'https://index.network';

/**
 * First contact with someone Index found on the public web, sent only after a
 * member accepted the match. Signing in with this address claims the profile.
 *
 * @param p - Who wants to connect, what they are working on, and why it fits.
 * @returns Subject, HTML and plain-text bodies.
 */
export const ghostOutreachTemplate = (p: GhostOutreachParams): GhostOutreachEmail => {
  const subjectName = p.memberName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);
  const safeUrl = escapeHtml(WEB_APP_URL);
  const reasonHtml = p.reason ? `<p>Why it's a fit: ${escapeHtml(p.reason)}</p>` : '';
  const reasonText = p.reason ? `\nWhy it's a fit: ${p.reason}\n` : '';

  return {
    subject: `${subjectName} would like to connect`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p><strong>${escapeHtml(p.memberName)}</strong> would like to connect with you on Index Network.</p>
  <p>They're working on: ${escapeHtml(p.memberSignal)}</p>
  ${reasonHtml}
  <p>Sign in with this email to see it and reply:</p>
  <p><a href="${safeUrl}">${safeUrl}</a></p>
  <p style="color: #666; font-size: 12px;">We found you through public information. Not interested? Reply "stop" and we'll delete it and never contact you again.</p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `${p.memberName} would like to connect with you on Index Network.

They're working on: ${p.memberSignal}
${reasonText}
Sign in with this email to see it and reply: ${WEB_APP_URL}

We found you through public information. Not interested? Reply "stop" and we'll delete it and never contact you again.`,
  };
};
