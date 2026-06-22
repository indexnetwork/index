import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

/**
 * Email template for ghost user invite — sent when an onboarded user
 * messages a ghost user for the first time.
 */
export function ghostInviteTemplate(
  recipientName: string,
  senderName: string,
  messageContent: string,
  replyUrl: string,
  unsubscribeUrl: string
) {
  const subject = `${senderName} reached out to you on Index`;

  const safeReplyUrl = escapeHtml(sanitizeUrlForHref(replyUrl));
  const safeUnsubscribeUrl = escapeHtml(sanitizeUrlForHref(unsubscribeUrl));
  const sanitizedReplyUrlForText = sanitizeUrlForHref(replyUrl);
  const sanitizedUnsubscribeUrlForText = sanitizeUrlForHref(unsubscribeUrl);

  const html = `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${escapeHtml(recipientName)},</p>
      <p><strong>${escapeHtml(senderName)}</strong> reached out to you on Index:</p>
      <div style="margin: 16px 0; padding: 16px; background-color: #f9f9f9; border-left: 3px solid #041729; border-radius: 4px;">
        <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(messageContent)}</p>
      </div>
      <div style="margin: 20px 0;">
        <a href="${safeReplyUrl}" style="text-decoration: none; font-weight: bold; color: #FFFFFF; background-color: #0A0A0A; font-size: 1.1em; padding: 10px 20px; border-radius: 5px; display: inline-block;">Reply on Index</a>
      </div>
      <p>—Index</p>
      <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; font-size: 0.8em; color: #888;">
        <p><a href="${safeUnsubscribeUrl}" style="color: #888; text-decoration: underline;">Unsubscribe</a></p>
      </div>
    </div>
  `;

  const text = `Hey ${recipientName},

${senderName} reached out to you on Index:

"${messageContent}"

Reply on Index: ${sanitizedReplyUrlForText}

—Index

To unsubscribe: ${sanitizedUnsubscribeUrlForText}
`;

  return { subject, html, text };
}
