import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

export interface AgentReplyParams {
  /** What the agent said, in the chat's markdown: `[label](url)` links and `- ` lists. */
  text: string;
  /** The subject of the email the owner replied to. */
  subject: string;
  /** Where the same chat lives on Index. */
  chatUrl: string;
}

export interface AgentReplyEmail {
  subject: string;
  html: string;
  text: string;
}

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** `Re: <subject>`, without stacking another Re: on one that has it. */
function replySubject(subject: string): string {
  const clean = subject.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return 'Re: your agent';
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

/** One line of the agent's markdown as HTML: escaped, with its links kept. */
function lineHtml(line: string): string {
  let html = '';
  let last = 0;
  for (const match of line.matchAll(LINK)) {
    const [whole, label, url] = match;
    html += escapeHtml(line.slice(last, match.index));
    html += `<a href="${escapeHtml(sanitizeUrlForHref(url))}" style="color: #111;">${escapeHtml(label)}</a>`;
    last = (match.index ?? 0) + whole.length;
  }
  return html + escapeHtml(line.slice(last));
}

/**
 * The personal agent's answer to an owner who replied to its email. Sent from
 * the agent, threaded under the email they replied to.
 */
export const agentReplyTemplate = (p: AgentReplyParams): AgentReplyEmail => {
  const lines = p.text.trim().split('\n');
  const body = lines.map((line) => (line.trim() ? lineHtml(line) : '')).join('<br />\n  ');
  const href = escapeHtml(sanitizeUrlForHref(p.chatUrl));
  const html = `<div style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #111; max-width: 560px;">
  <p>${body}</p>
  <p>Your agent</p>
  <p style="color: #999; font-size: 11px; margin-top: 28px;">Reply to this email to keep talking with me, or <a href="${href}" style="color: #999;">open our chat on Index</a>.</p>
</div>`;
  const text = [
    p.text.trim().replace(LINK, (_whole, label: string, url: string) => `${label} (${url})`),
    '',
    'Your agent',
    '',
    `Reply to this email to keep talking with me, or open our chat on Index: ${p.chatUrl}`,
  ].join('\n');
  return { subject: replySubject(p.subject), html, text };
};
