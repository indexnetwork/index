import { escapeHtml, sanitizeUrlForHref } from '../escapeHtml';
import { log } from '../log';

import { executeSendEmail } from './transport.helper';

const logger = log.lib.from('email/magic-link.handler');

export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  logger.info('Sending magic link email', { email });

  const href = escapeHtml(sanitizeUrlForHref(url));
  const html = `<div style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #111; max-width: 560px;">
  <p>Sign in to Index Network.</p>
  <p><a href="${href}" style="color: #111;">Sign in</a></p>
  <p style="color: #999; font-size: 11px; margin-top: 28px;">This link expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
</div>`;

  const text = `Sign in to Index Network.\n\n${url}\n\nThis link expires in 10 minutes. If you didn't request this, you can ignore this email.`;

  await executeSendEmail({
    to: email,
    subject: 'Sign in to Index Network',
    html,
    text,
  });
}
