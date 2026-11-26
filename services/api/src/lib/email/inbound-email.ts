/**
 * Inbound email from Resend: the `email.received` webhook carries only
 * metadata, so the body, headers and authentication results are read from
 * the Receiving API. SDK 4.x has no receiving methods, so this calls REST.
 */

/** What the `email.received` webhook says about one email. */
export interface ReceivedEmailEvent {
  emailId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
}

/** One received email, as the Receiving API returns it. */
export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  messageId: string | null;
  /** Computed by Resend's receiving server. Null for mail received before Resend recorded it. */
  authentication: { spf?: string; dkim?: string; dmarc?: string } | null;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Read an `email.received` webhook payload.
 *
 * @returns The email's metadata, or null when the payload is another event or malformed.
 */
export function parseReceivedEvent(payload: unknown): ReceivedEmailEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { type, data } = payload as { type?: unknown; data?: Record<string, unknown> };
  if (type !== 'email.received' || !data) return null;
  const emailId = text(data.email_id);
  if (!emailId) return null;
  return { emailId, from: text(data.from), to: strings(data.to), cc: strings(data.cc), subject: text(data.subject) };
}

/**
 * Fetch a received email's body, headers and authentication results.
 *
 * @throws When RESEND_API_KEY is missing or Resend does not answer with the email.
 */
export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  const key = process.env.RESEND_API_KEY;
  if (!key || key === 'DISABLED') throw new Error('RESEND_API_KEY is required to read received email');
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend receiving API returned ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;

  const headers: Record<string, string> = {};
  const raw = body.headers;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') headers[name.toLowerCase()] = value;
      else if (Array.isArray(value)) headers[name.toLowerCase()] = value.filter((item) => typeof item === 'string').join(', ');
    }
  }
  const auth = body.authentication && typeof body.authentication === 'object' ? (body.authentication as Record<string, unknown>) : null;
  return {
    id: text(body.id) || emailId,
    from: text(body.from),
    to: strings(body.to),
    cc: strings(body.cc),
    subject: text(body.subject),
    text: typeof body.text === 'string' ? body.text : null,
    html: typeof body.html === 'string' ? body.html : null,
    headers,
    messageId: text(body.message_id) || headers['message-id'] || null,
    authentication: auth ? { spf: text(auth.spf), dkim: text(auth.dkim), dmarc: text(auth.dmarc) } : null,
  };
}

/** The bare, lowercase address in `Name <a@b.c>` or `a@b.c`. */
export function bareAddress(value: string): string {
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
}

/**
 * True when the receiving server vouches for the sender: DMARC did not fail,
 * and SPF or DKIM passed. Mail with no results is not trusted.
 */
export function senderAuthenticated(email: Pick<ReceivedEmail, 'authentication'>): boolean {
  const auth = email.authentication;
  if (!auth) return false;
  if (auth.dmarc === 'fail') return false;
  return auth.dmarc === 'pass' || auth.spf === 'pass' || auth.dkim === 'pass';
}

/** True for out-of-office notes, vacation responders and other mail no person wrote. */
export function isAutomatedReply(email: Pick<ReceivedEmail, 'headers' | 'subject'>): boolean {
  const h = email.headers;
  const submitted = h['auto-submitted']?.trim().toLowerCase();
  if (submitted && submitted !== 'no') return true;
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-auto-response-suppress']?.toLowerCase().includes('all')) return true;
  if (/^(bulk|junk|list|auto_reply)$/i.test(h.precedence?.trim() ?? '')) return true;
  return /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|abwesenheit|réponse automatique)\b/i.test(email.subject.trim());
}

/** Plain text from an HTML body, for mail that came without a text part. */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<div class="gmail_quote[\s\S]*$/i, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Lines where the quoted email begins in common clients. */
const QUOTE_START: RegExp[] = [
  /^on\s.+(wrote|schrieb|a écrit|escribió|ha scritto|yazdı)\s*:?\s*$/i,
  /^-{2,}\s*(original message|forwarded message|ursprüngliche nachricht)\s*-{2,}/i,
  /^_{10,}\s*$/,
  /^from:\s.+$/i,
  /^sent from my\s/i,
  /^get outlook for\s/i,
];

/**
 * What the person wrote in a reply, without the email they replied to or
 * their signature.
 *
 * @returns The new text, trimmed; empty when they wrote nothing.
 */
export function replyText(email: Pick<ReceivedEmail, 'text' | 'html'>): string {
  const source = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : '';
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Gmail wraps a long "On <date>, <name> wrote:" over two lines.
    const joined = i + 1 < lines.length ? `${line} ${lines[i + 1].trim()}` : line;
    if (QUOTE_START.some((pattern) => pattern.test(line)) || (/^on\s/i.test(line) && QUOTE_START[0].test(joined))) break;
    if (line === '--' || line === '-- ') break;
    if (line.startsWith('>')) continue;
    kept.push(lines[i].trimEnd());
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
