import { createHmac } from 'node:crypto';

export type IdKind = 'user' | 'intent' | 'opp' | 'session' | 'network';

const KIND_PREFIX: Record<IdKind, string> = {
  user: 'user_',
  intent: 'intent_',
  opp: 'opp_',
  session: 'session_',
  network: 'network_',
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /https?:\/\/[^\s)\]>'"]+/gi;
const HANDLE_RE = /(^|[^A-Z0-9_])@[A-Z0-9_]{2,30}\b/gi;
const PHONE_RE = /(?<!\d)(?:\+?\d{1,3}[\s.-])?(?:\(?\d{3}\)?[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g;
const CREDENTIAL_RE = /\b(?:idxh_|idxo_|sk-|sk_live_|sk_test_|Bearer\s+)[A-Za-z0-9._-]{8,}/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function hmacId(secret: string, kind: IdKind, rawId: string): string {
  const digest = createHmac('sha256', secret).update(`${kind}:${rawId}`).digest('hex').slice(0, 32);
  return `${KIND_PREFIX[kind]}${digest}`;
}

export function hmacIdOrNull(secret: string, kind: IdKind, rawId: string | null | undefined): string | null {
  if (!rawId) return null;
  return hmacId(secret, kind, rawId);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Unique dictionary terms, longest first, skipping very short tokens. */
export function uniqueTerms(values: Array<string | null | undefined>, minLength = 3): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length < minLength) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(trimmed);
  }
  terms.sort((a, b) => b.length - a.length);
  return terms;
}

export function redactKnownTerms(text: string, terms: string[]): string {
  let out = text;
  for (const term of terms) {
    out = out.replace(new RegExp(escapeRegExp(term), 'gi'), '[PERSON]');
  }
  return out;
}

export function redactPatterns(text: string): string {
  return text
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(URL_RE, '[URL]')
    .replace(HANDLE_RE, '$1[HANDLE]')
    .replace(PHONE_RE, '[PHONE]')
    .replace(CREDENTIAL_RE, '[CREDENTIAL]')
    .replace(UUID_RE, '');
}

export function redactText(text: string | null | undefined, terms: string[]): string | null {
  if (text == null) return null;
  const reduced = redactPatterns(redactKnownTerms(text, terms)).replace(/\s{2,}/g, ' ').trim();
  return reduced;
}
