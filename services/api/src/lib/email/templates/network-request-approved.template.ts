import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

export interface NetworkRequestApprovedParams {
  networkName: string;
  networkUrl: string;
}

export interface NetworkRequestApprovedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Sent to the requester when staff approve their network. */
export const networkRequestApprovedTemplate = (
  p: NetworkRequestApprovedParams,
): NetworkRequestApprovedEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const safeUrl = escapeHtml(sanitizeUrlForHref(p.networkUrl));
  const subjectName = p.networkName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);

  return {
    subject: `${subjectName} is ready`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p>Your network <strong>${safeNetwork}</strong> has been created.</p>
  <p>Start by defining what members should discover, then invite the first people or agents.</p>
  <p><a href="${safeUrl}">Open ${safeNetwork}</a></p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `Your network ${p.networkName} has been created.

Start by defining what members should discover, then invite the first people or agents.

Open it: ${p.networkUrl}`,
  };
};
