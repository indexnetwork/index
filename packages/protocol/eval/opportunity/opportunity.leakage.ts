/**
 * Deterministic leakage / formatting detectors for opportunity cards.
 *
 * The presenter promises user-facing copy with no raw identifiers, no internal
 * role labels, and a plain-prose greeting. These back the deterministic
 * `no_leakage` and `greeting` assertions.
 */

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** Internal labels / field names that must never reach user-facing copy. */
const LABEL_RE = /\b(the source user|the candidate|source user|candidate user|userId|intentId|networkId)\b/i;

/** True when any UUID appears in the text. */
export function hasUuid(text: string): boolean {
  return UUID_RE.test(text);
}

/** True when an internal role label / field name leaks into the text. */
export function hasInternalLabel(text: string): boolean {
  return LABEL_RE.test(text);
}

/**
 * True when the greeting carries markdown. Greetings must be plain prose:
 * no emphasis, headers, links, code, or bullet markers.
 */
export function hasMarkdown(text: string): boolean {
  return (
    /\*\*|__|`|^#{1,6}\s|\]\(|\[[^\]]*\]\(|^\s*[-*]\s+/m.test(text)
  );
}

/**
 * True when the greeting opens with a salutation prefix like "Hey Sarah," or
 * "Hi there," — the presenter requires the greeting body only, no prefix.
 */
export function hasGreetingPrefix(text: string): boolean {
  return /^\s*(hey|hi|hello|dear|greetings)\b[^.!?\n]{0,40},/i.test(text);
}
