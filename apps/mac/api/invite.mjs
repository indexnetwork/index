/**
 * Inviting someone who is not on Index yet.
 *
 * Accepting a person who has no account cannot open a chat, because there is
 * nobody on the other end to read it. What the app offers instead is a message
 * the user sends themselves, through X or their own mail, with the signal that
 * matched them so the invite says why.
 *
 * The API never hands the client a not-yet-on-Index person's email, so the
 * mail link leaves the recipient blank for the user to fill in, and X opens the
 * DM composer with the text ready, where they pick the person.
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

/** Opens the user's mail app with the invite filled in and no recipient. */
export function inviteEmailHref({ subject, body }) {
  return `mailto:?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
}

/** Opens the X DM composer with the invite as the message. */
export function inviteXHref(message) {
  return `https://x.com/messages/compose?text=${encodeURIComponent(message || '')}`;
}
