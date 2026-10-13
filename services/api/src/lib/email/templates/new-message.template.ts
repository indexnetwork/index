import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

export interface NewMessageParams {
  recipientName: string;
  senderName: string;
  count: number;
  preview: string;
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
 * One email for a burst of human messages, sent after the conversation has been quiet.
 */
export const newMessageTemplate = (p: NewMessageParams): NewMessageEmail => {
  const firstName = p.recipientName.trim().split(/\s+/)[0] || 'there';
  const sender = p.senderName.trim() || 'Someone';
  const preview = clip(p.preview.trim(), 280);
  const subject = p.count > 1 ? `${sender} sent you ${p.count} messages` : `${sender} sent you a message`;
  const href = (url: string) => escapeHtml(sanitizeUrlForHref(url));

  const html = `<div style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #111; max-width: 560px;">
  <p>${escapeHtml(sender)} wrote to you, ${escapeHtml(firstName)}.</p>
  ${preview ? `<p style="color: #333;">${escapeHtml(preview)}</p>` : ''}
  <p><a href="${href(p.url)}" style="color: #111;">Open the chat</a></p>
  <p style="color: #999; font-size: 11px; margin-top: 28px;"><a href="${href(p.settingsUrl)}" style="color: #999;">Turn off message emails</a></p>
</div>`;

  const text = [
    `${sender} wrote to you, ${firstName}.`,
    ...(preview ? ['', preview] : []),
    '',
    `Open the chat: ${p.url}`,
    '',
    `Turn off message emails: ${p.settingsUrl}`,
  ].join('\n');

  return { subject, html, text };
};
