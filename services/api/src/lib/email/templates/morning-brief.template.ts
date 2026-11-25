import { actionLink, appLink, morningOffLink } from '../../app-link';
import { escapeHtml, sanitizeUrlForHref } from '../../escapeHtml';

export interface MorningBriefParams {
  viewerId: string;
  name: string;
  talked: number;
  /** Your agent's lines after the greeting, about what your intents did. */
  opening: string;
  waiting: { opportunityId: string; userId: string; name: string; context: string | null; fresh: boolean }[];
  /** Waiting on the owner, but with someone they are already connected to. Listed apart; never sent for on their own. */
  connected?: { userId: string; name: string; context: string | null; hasChat: boolean; noReply: boolean }[];
  /** Question groups not emailed before, each linked to Home with /q/<id>. */
  questions: { text: string; url: string }[];
  appUrl: string;
}

export interface MorningBriefEmail {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export const MAX_WAITING = 3;
const MAX_QUESTIONS = 3;

const clip = (value: string, length: number) => (value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value);

/**
 * The daily brief, from the owner's personal agent: its opening, then code
 * lists who is waiting and what to answer. Sent only when someone new is
 * waiting on the owner, or a question group is in it. Each person
 * appears once. Accept and pass are signed links that act without signing in.
 *
 * @returns Null when there is nothing to send.
 */
export const morningBriefTemplate = (p: MorningBriefParams): MorningBriefEmail | null => {
  const everyone = p.waiting;
  if (!p.questions.length && !everyone.some((person) => person.fresh)) return null;
  const firstName = p.name.trim().split(/\s+/)[0] || 'there';
  const waiting = everyone.slice(0, MAX_WAITING).map((person) => ({
    name: person.name,
    context: person.context ? clip(person.context, 90) : null,
    profile: appLink('u', person.userId),
    accept: actionLink(person.opportunityId, p.viewerId, 'accept'),
    pass: actionLink(person.opportunityId, p.viewerId, 'decline'),
  }));
  const more = everyone.length - waiting.length;
  const connected = (p.connected ?? []).map((person) => ({
    name: person.name,
    context: person.context ? clip(person.context, 90) : null,
    url: person.hasChat ? `${appLink('u', person.userId)}/chat` : appLink('u', person.userId),
    label: person.hasChat ? 'open chat ›' : 'view profile',
    status: `You're already connected.${person.noReply ? ' Their last message has no reply yet.' : ''}`,
  }));
  const questions = p.questions.slice(0, MAX_QUESTIONS);

  const shown = Math.min(everyone.length, MAX_WAITING);
  const subject = shown
    ? shown === 1 ? `${everyone[0].name} wants to meet you` : `${shown} people want to meet you`
    : questions.length === 1 ? 'I have a question for you' : `I have ${Math.min(questions.length, MAX_QUESTIONS)} questions for you`;
  const opening = [
    p.opening.trim(),
    shown ? (shown === 1 ? '1 person wants to meet you:' : `${shown} people want to meet you:`) : '',
  ].filter(Boolean).join(' ');
  const ask = questions.length === 1 ? 'One thing I need from you.' : 'A few things I need from you.';

  const offUrl = morningOffLink(p.viewerId);
  const href = (url: string) => escapeHtml(sanitizeUrlForHref(url));
  const small = (url: string, label: string) => `<a href="${href(url)}" style="color: #999; font-size: 11px;">${escapeHtml(label)}</a>`;
  const act = (url: string, label: string) => `<a href="${href(url)}" style="color: #111; font-size: 12px;">${label}</a>`;
  const html = `<div style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 13px; line-height: 1.7; color: #111; max-width: 560px;">
  <p>Good morning, ${escapeHtml(firstName)}.</p>
  ${questions.length ? `<p>${ask}</p>
  ${questions.map((q) => `<p style="margin: 0 0 14px;">${escapeHtml(q.text)}<br />${act(q.url, 'answer →')}</p>`).join('\n  ')}` : ''}
  ${opening ? `<p>${escapeHtml(opening)}</p>` : ''}
  ${waiting.map((person) => `<p style="margin: 0 0 14px;"><a href="${href(person.profile)}" style="color: #111; font-weight: bold; text-decoration: none;">${escapeHtml(person.name)}</a>${person.context ? `<span style="color: #666;">: ${escapeHtml(person.context)}</span>` : ''}<br />${act(person.accept, 'accept')} <span style="color: #ccc;">·</span> ${act(person.pass, 'pass')}</p>`).join('\n  ')}
  ${more ? `<p>${small(p.appUrl, 'and more')}</p>` : ''}
  ${connected.length ? `<p>From someone you're already connected with:</p>
  ${connected.map((person) => `<p style="margin: 0 0 14px;"><b>${escapeHtml(person.name)}</b>${person.context ? `<span style="color: #666;">: ${escapeHtml(person.context)}</span>` : ''}<br /><span style="color: #666; font-size: 12px;">${escapeHtml(person.status)}</span> ${act(person.url, escapeHtml(person.label))}</p>`).join('\n  ')}` : ''}
  <p>I'll keep going in the background.<br />Your agent</p>
  <p style="color: #999; font-size: 11px; margin-top: 28px;">I only write when I need you. <a href="${href(offUrl)}" style="color: #999;">Turn off the daily brief</a></p>
</div>`;

  const text = [
    `Good morning, ${firstName}.`,
    ...(questions.length ? ['', ask, ...questions.flatMap((q) => ['', q.text, `Answer: ${q.url}`])] : []),
    ...(opening ? ['', opening] : []),
    ...waiting.flatMap((person) => ['', `${person.name}${person.context ? `: ${person.context}` : ''}`, `Accept: ${person.accept}`, `Pass: ${person.pass}`]),
    ...(more ? ['', `and more: ${p.appUrl}`] : []),
    ...(connected.length ? ['', "From someone you're already connected with:", ...connected.flatMap((person) => ['', `${person.name}${person.context ? `: ${person.context}` : ''}`, person.status, `${person.label}: ${person.url}`])] : []),
    '',
    "I'll keep going in the background.",
    'Your agent',
    '',
    `I only write when I need you. Turn off the daily brief: ${offUrl}`,
  ].join('\n');

  return {
    subject,
    html,
    text,
    headers: { 'List-Unsubscribe': `<${offUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
};
