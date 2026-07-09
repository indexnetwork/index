import { Resend } from 'resend';

import { log } from '../log';

const logger = log.lib.from("email/transport.helper");
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const executeSendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}) => {
  if (!process.env.RESEND_API_KEY || !resend || process.env.RESEND_API_KEY === 'DISABLED') {
    logger.warn('RESEND_API_KEY not configured or disabled - email not sent');
    return { data: null, skipped: true, reason: 'resend_not_configured' };
  }

  const isProduction = process.env.EMAIL_PRODUCTION_MODE === 'true';
  let recipient: string | string[] = options.to;

  if (!isProduction) {
    const testAddress = process.env.TESTING_EMAIL_ADDRESS;
    if (!testAddress) {
      logger.debug('Non-production and no TESTING_EMAIL_ADDRESS - skipping');
      return { data: null, skipped: true, reason: 'no_test_recipient' };
    }
    recipient = testAddress;

    // Log to debug file in non-production mode
    try {
      const { appendFile } = await import('fs/promises');
      const { resolve } = await import('path');
      const debugPath = resolve(process.cwd(), 'email-debug.md');
      const separator = '='.repeat(80);
      const timestamp = new Date().toISOString();
      const headersStr = options.headers
        ? Object.entries(options.headers).map(([k, v]) => `${k}: ${v}`).join('\n      ')
        : '(none)';

      await appendFile(debugPath, `
${separator}
[${timestamp}] Email Sent (redirected to test address)
${separator}
Original To: ${Array.isArray(options.to) ? options.to.join(', ') : options.to}
Actual To: ${testAddress}
Subject: ${options.subject}
Headers: ${headersStr}

--- TEXT ---
${options.text}

--- HTML ---
${options.html}
`);
    } catch (err) {
      logger.error('Failed to log email to debug file', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.verbose('Sending email', {
    recipient: String(recipient),
    originalTo: String(options.to),
    production: isProduction,
  });

  try {
    const result = await resend!.emails.send({
      from: 'Index Network <updates@agent.index.network>',
      to: recipient,
      replyTo: 'hello@index.network',
      subject: options.subject,
      html: options.html,
      text: options.text,
      headers: options.headers,
    });

    if (result.error) {
      logger.error('Resend API returned error', {
        errorName: result.error.name,
        errorMessage: result.error.message,
        recipient: String(recipient),
        subject: options.subject,
      });
      throw new Error(`Resend error: ${result.error.message}`);
    }

    logger.info('Email sent successfully', {
      messageId: result.data?.id,
      recipient: String(recipient),
    });
    return result;
  } catch (error) {
    logger.error('Failed to send email via Resend API', {
      error: error instanceof Error ? error.message : String(error),
      recipient: String(recipient),
      subject: options.subject,
    });
    throw error;
  }
};
