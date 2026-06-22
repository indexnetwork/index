import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

/**
 * Email template for new opportunity notification (high-priority).
 */
export function opportunityNotificationTemplate(
  recipientName: string,
  summary: string,
  opportunityUrl: string,
  unsubscribeUrl?: string
) {
  const subject = `New opportunity for you on Index`;

  const safeOpportunityUrl = escapeHtml(sanitizeUrlForHref(opportunityUrl));
  const safeUnsubscribeUrl = unsubscribeUrl
    ? escapeHtml(sanitizeUrlForHref(unsubscribeUrl))
    : null;
  const sanitizedOpportunityUrlForText = sanitizeUrlForHref(opportunityUrl);

  const html = `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${escapeHtml(recipientName)},</p>
      <p>You have a new opportunity on Index that might be a good fit.</p>
      <p><strong>Summary:</strong> ${escapeHtml(summary)}</p>
      <div style="margin: 20px 0;">
        <a href="${safeOpportunityUrl}" style="text-decoration: none; font-weight: bold; color: #FFFFFF; background-color: #0A0A0A; font-size: 1.1em; padding: 10px 20px; border-radius: 5px; display: inline-block;">View opportunity</a>
      </div>
      <p>—Index</p>
      ${safeUnsubscribeUrl ? `
        <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; font-size: 0.8em; color: #888;">
          <p><a href="${safeUnsubscribeUrl}" style="color: #888; text-decoration: underline;">Unsubscribe from opportunity emails</a></p>
        </div>
      ` : ''}
    </div>
  `;
  const text = `Hey ${recipientName},

You have a new opportunity on Index that might be a good fit.

Summary: ${summary}

View opportunity: ${sanitizedOpportunityUrlForText}

—Index
`;
  return { subject, html, text };
}
