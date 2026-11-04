import { escapeHtml, sanitizeUrlForHref } from '../escapeHtml';

import { executeSendEmail } from './transport.helper';

export async function sendVerificationEmail(email: string, url: string): Promise<void> {
  const href = escapeHtml(sanitizeUrlForHref(url));
  const result = await executeSendEmail({
    to: email,
    subject: 'Verify your email for Index Network',
    html: `<div style="font-family: monospace; font-size: 13px; line-height: 1.7; color: #111; max-width: 560px;">
<p>Verify this email address for your Index Network account.</p>
<p><a href="${href}">Verify email</a></p>
<p>Your account email will change only after verification. This link expires in one hour. If you didn't request this, ignore this email.</p>
</div>`,
    text: `Verify this email address for your Index Network account.\n\n${url}\n\nYour account email will change only after verification. This link expires in one hour. If you didn't request this, ignore this email.`,
  });
  if ('skipped' in result && result.skipped) throw new Error('Verification email could not be sent.');
}
