import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

export interface NetworkInvitationParams {
  networkName: string;
  networkUrl: string;
  /** Recipient's display name, for the greeting. */
  recipientName?: string;
  /** Name of the owner who added them. */
  inviterName?: string;
}

export interface NetworkInvitationEmail {
  subject: string;
  html: string;
  text: string;
}

// Strip CR/LF and other control chars before splicing a name into the subject
// header, so a malicious network or user name cannot inject headers.
const headerSafe = (value: string) => value.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);

/**
 * Tells someone a network owner added them to a network. It carries no
 * credential: the invitee signs in normally to see it.
 *
 * @returns Subject, HTML and plain-text bodies.
 */
export const networkInvitationTemplate = (
  p: NetworkInvitationParams,
): NetworkInvitationEmail => {
  const firstName = p.recipientName?.trim().split(/\s+/)[0] || 'there';
  const inviter = p.inviterName?.trim() || '';
  const subjectNetwork = headerSafe(p.networkName);
  const subjectInviter = headerSafe(inviter);
  const subject = subjectInviter
    ? `${subjectInviter} added you to ${subjectNetwork}`
    : `You've been added to ${subjectNetwork}`;
  const line = inviter
    ? `${inviter} added you to ${p.networkName} on Index.`
    : `You've been added to ${p.networkName} on Index.`;
  const after = "Your agent now looks for opportunities among its members: people who fit what you're after, and people who are looking for someone like you. Tell it what you're looking for so it knows who to find.";
  const href = escapeHtml(sanitizeUrlForHref(p.networkUrl));

  const html = `<div style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #111; max-width: 560px;">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>${inviter ? `${escapeHtml(inviter)} added you to <b>${escapeHtml(p.networkName)}</b> on Index.` : `You've been added to <b>${escapeHtml(p.networkName)}</b> on Index.`}</p>
  <p style="color: #333;">${escapeHtml(after)}</p>
  <p><a href="${href}" style="color: #111;">Find opportunities in ${escapeHtml(p.networkName)} ›</a></p>
  <p style="color: #999; font-size: 11px; margin-top: 28px;">You can leave the network any time from its page.</p>
</div>`;

  const text = [
    `Hi ${firstName},`,
    '',
    line,
    '',
    after,
    '',
    `Find opportunities in ${p.networkName}: ${p.networkUrl}`,
    '',
    'You can leave the network any time from its page.',
  ].join('\n');

  return { subject, html, text };
};
