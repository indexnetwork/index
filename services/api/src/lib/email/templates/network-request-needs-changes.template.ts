import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

export interface NetworkRequestNeedsChangesParams {
  networkName: string;
  reviewNote: string;
  networksUrl: string;
}

export interface NetworkRequestNeedsChangesEmail {
  subject: string;
  html: string;
  text: string;
}

/** Sent to the requester when staff need more context before creating the network. */
export const networkRequestNeedsChangesTemplate = (
  p: NetworkRequestNeedsChangesParams,
): NetworkRequestNeedsChangesEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const safeNote = escapeHtml(p.reviewNote);
  const safeUrl = escapeHtml(sanitizeUrlForHref(p.networksUrl));
  const subjectName = p.networkName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);

  return {
    subject: `A little more context on ${subjectName}`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p>Thanks for requesting <strong>${safeNetwork}</strong>. We need a little more context before creating it.</p>
  <blockquote style="margin: 12px 0; padding: 8px 12px; border-left: 3px solid #ddd; color: #444;">${safeNote}</blockquote>
  <p><a href="${safeUrl}">Update your request</a></p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `Thanks for requesting ${p.networkName}. We need a little more context before creating it.

"${p.reviewNote}"

Update your request: ${p.networksUrl}`,
  };
};
