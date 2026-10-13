import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

export interface NewMessageLine {
  senderName: string;
  text: string;
}

export interface NewMessageParams {
  recipientName: string;
  messages: NewMessageLine[];
  url: string;
  settingsUrl: string;
}

export interface NewMessageEmail {
  subject: string;
  html: string;
  text: string;
}

const clip = (value: string, length: number) => (value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value);

/**
 * One email for every message still unread in a conversation, oldest first.
 */
export const newMessageTemplate = (p: NewMessageParams): NewMessageEmail => {
  const firstName = p.recipientName.trim().split(/\s+/)[0] || 'there';
  const messages = p.messages.map((message) => ({
    senderName: message.senderName.trim() || 'Someone',
    text: clip(message.text.trim(), 280),
  })).filter((message) => message.text);
  const senders = [...new Set(messages.map((message) => message.senderName))];
  const sender = senders.length === 1 ? senders[0] : '';
  const subject = sender
    ? (messages.length > 1 ? `${sender} sent you ${messages.length} messages` : `${sender} sent you a message`)
    : `${messages.length} new messages`;
  const href = (url: string) => escapeHtml(sanitizeUrlForHref(url));
  const line = (message: NewMessageLine) => sender ? message.text : `${message.senderName}: ${message.text}`;

  const html = `<div style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #111; max-width: 560px;">
  <p>${sender ? `${escapeHtml(sender)} wrote to you, ${escapeHtml(firstName)}.` : `${escapeHtml(firstName)}, you have new messages.`}</p>
  ${messages.map((message) => `<p style="color: #333;">${escapeHtml(line(message))}</p>`).join('\n  ')}
  <p><a href="${href(p.url)}" style="color: #111;">Open the chat</a></p>
  <p style="color: #999; font-size: 11px; margin-top: 28px;"><a href="${href(p.settingsUrl)}" style="color: #999;">Turn off message emails</a></p>
</div>`;

  const text = [
    sender ? `${sender} wrote to you, ${firstName}.` : `${firstName}, you have new messages.`,
    ...messages.flatMap((message) => ['', line(message)]),
    '',
    `Open the chat: ${p.url}`,
    '',
    `Turn off message emails: ${p.settingsUrl}`,
  ].join('\n');

  return { subject, html, text };
};
