import { escapeHtml, sanitizeUrlForHref } from '../escapeHtml';
import { log } from '../log';

import { executeSendEmail } from './transport.helper';

const logger = log.lib.from('email/magic-link.handler');

export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  logger.info('Sending magic link email', { email });

  // Keep the one-time verification endpoint out of the email: mail scanners
  // may follow links before the recipient. Only an explicit browser action
  // on the landing page redeems the token. The fragment stays out of HTTP logs.
  const verification = new URL(url);
  const landing = new URL('/login/verify', process.env.WEB_APP_URL || 'https://index.network');
  landing.hash = verification.searchParams.toString();
  const signInURL = landing.toString();
  const href = escapeHtml(sanitizeUrlForHref(signInURL));
  const html = `<div style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #111; max-width: 560px;">
  <p>Sign in to Index Network.</p>
  <p><a href="${href}" style="color: #111;">Sign in</a></p>
  <p style="color: #999; font-size: 11px; margin-top: 28px;">This link expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
</div>`;

  const text = `Sign in to Index Network.\n\n${signInURL}\n\nThis link expires in 10 minutes. If you didn't request this, you can ignore this email.`;

  const result = await executeSendEmail({
    to: email,
    subject: 'Sign in to Index Network',
    html,
    text,
  });
  if ('skipped' in result && result.skipped) {
    throw new Error('Sign-in email could not be sent. Please try again later.');
  }
}
