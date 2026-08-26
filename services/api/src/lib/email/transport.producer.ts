import { executeSendEmail } from './transport.helper';

/**
 * Send an email through Resend. Callers used to wait on a background job;
 * the send is the work.
 */
export const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<unknown> => {
  await executeSendEmail(options);
  return undefined;
};
