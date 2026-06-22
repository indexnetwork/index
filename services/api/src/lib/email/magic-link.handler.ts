import { executeSendEmail } from './transport.helper';
import { log } from '../log';

const logger = log.lib.from('email/magic-link.handler');

export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  logger.info('Sending magic link email', { email });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <p>Hey,</p>
      <p>Click the button below to sign in to Index Network.</p>

      <div style="margin: 24px 0;">
        <a href="${url}" style="text-decoration: none; font-weight: bold; color: #FFFFFF; background-color: #0A0A0A; font-size: 1.1em; padding: 10px 20px; border-radius: 5px; display: inline-block;">Sign In</a>
      </div>

      <p style="font-size: 0.9em; color: #666;">This link expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>

      <p>&mdash;Index</p>

      <div style="margin-top: 20px; text-align: center;">
        <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
      </div>
    </div>
  `;

  const text = `Sign in to Index Network\n\nClick this link to sign in: ${url}\n\nThis link expires in 10 minutes. If you didn't request this, you can safely ignore this email.\n\n—Index`;

  await executeSendEmail({
    to: email,
    subject: 'Sign in to Index Network',
    html,
    text,
  });
}
