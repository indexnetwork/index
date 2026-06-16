/**
 * Deterministic PII scanning for the profile privacy guarantee.
 *
 * The profile generator promises that public fields (bio, narrative.context, …)
 * never embed contact identifiers. These detectors back the `privacy` assertion:
 * any match in a public field is a leak. Kept conservative to avoid false
 * positives — emails and phone numbers are the highest-signal contact leaks.
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 7+ digit runs allowing spaces, dashes, dots, parens, and an optional leading +.
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

/** Strip obvious non-phone digit runs (years, counts) before phone matching. */
function looksLikePhone(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

/** Return the distinct PII strings found across the given text fields. */
export function findPII(fields: string[]): string[] {
  const hits = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const m of field.match(EMAIL_RE) ?? []) hits.add(m.trim());
    for (const m of field.match(PHONE_RE) ?? []) {
      if (looksLikePhone(m)) hits.add(m.trim());
    }
  }
  return [...hits];
}
