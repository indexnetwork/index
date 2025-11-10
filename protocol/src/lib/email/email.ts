import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const IS_RESEND_EMAIL_ENABLED = process.env.RESEND_EMAIL_ENABLED === "true";

export const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}) => {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not configured, email not sent");
    return;
  }

  if (!IS_RESEND_EMAIL_ENABLED) {
    console.log("Email is disabled for now: not from mainnet yet");
    return;
  }

  try {
    const resend = new Resend(RESEND_API_KEY);
    const result = await resend.emails.send({
      from: "Index Network <updates@agent.index.network>",
      to: options.to,
      replyTo: "hello@index.network",
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    console.log("Email sent successfully:", result);
    return result;
  } catch (error) {
    console.error("Failed to send email:", error);
    throw error;
  }
};
