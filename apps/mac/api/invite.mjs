/**
 * Inviting someone who is not on Index yet.
 *
 * Accepting a person who has no account cannot open a chat, because there is
 * nobody on the other end to read it. What the app offers instead is a message
 * the user sends themselves, through X or their own mail, with the signal that
 * matched them so the invite says why.
 *
 * Each way to send only shows when there is somewhere to send it: X when they
 * have an X link, email when an address is on their profile (the API never
 * shares the account email, so it has to come from what they listed). With
 * neither, the user copies the invite link instead.
 *
 * Kept in step with apps/web/src/lib/invite.ts, which does the same job for
 * the web app.
 */

export const INVITE_URL = 'https://index.network';

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/**
 * The pre-written invite, in the sender's own voice.
 * @param {{name?: string, signal?: string, senderName?: string}} input
 */
export function buildInviteMessage({ name, signal, senderName } = {}) {
  const them = firstName(name);
  const me = firstName(senderName);
  const what = String(signal || '').trim().replace(/\s+/g, ' ');
  const lines = [
    them ? `Hi ${them},` : 'Hi,',
    '',
    what
      ? `My agent on Index thinks you're someone I should meet, for something I'm working on: "${what}"`
      : "My agent on Index thinks you're someone I should meet.",
    '',
    `Would you be up for connecting? Join me on Index and our agents can set it up: ${INVITE_URL}`,
  ];
  if (me) lines.push('', me);
  return lines.join('\n');
}

/** A subject line for the email version of the invite. */
export function inviteSubject(senderName) {
  const me = firstName(senderName);
  return me ? `${me} would like to connect` : 'Would you like to connect?';
}

const EMAIL = /^(?:mailto:)?([^\s@/]+@[^\s@/]+\.[a-z]{2,})$/i;

/**
 * An email address someone listed among their links, if any. Social links
 * resolve to web addresses only, so an address stored as a link is otherwise
 * dropped; this reads it from the raw {label, value} rows.
 * @param {Array<{label?: string, value?: string}> | undefined | null} socials
 */
export function emailFromSocials(socials) {
  for (const entry of Array.isArray(socials) ? socials : []) {
    const match = String(entry?.value ?? entry?.handle ?? '').trim().match(EMAIL);
    if (match) return match[1];
  }
  return '';
}

/** Opens the user's mail app with the invite filled in, addressed to `to`. */
export function inviteEmailHref({ to, subject, body }) {
  return `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
}

/** Opens the X DM composer with the invite as the message. */
export function inviteXHref(message) {
  return `https://x.com/messages/compose?text=${encodeURIComponent(message || '')}`;
}
