import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}) => {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not configured, email not sent');
    return;
  }

  try {
    const result = await resend.emails.send({
      from: 'Index Network <updates@agent.index.network>',
      to: options.to,
      replyTo: 'hello@index.network',
      subject: options.subject,
      html: options.html,
      text: options.text
    });
    
    console.log('Email sent successfully:', result);
    return result;
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}; 