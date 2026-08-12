const HERMES_CREDENTIAL = /\bidxh_[A-Za-z0-9_-]+\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LABELED_HASH = /\b(keyHashPrefix|secretHash|credentialHash|digest)\s*[=:]\s*["']?[A-Za-z0-9_-]+["']?/gi;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const BASE64URL_HASH = /\b[A-Za-z0-9_-]{40,64}\b/g;

/** Keep Bun failure diagnostics while removing all credential-derived and fixture identity material. */
export function sanitizeHermesAssuranceOutput(output: string): string {
  return output
    .replace(HERMES_CREDENTIAL, '[REDACTED_CREDENTIAL]')
    .replace(UUID, '[REDACTED_ID]')
    .replace(LABELED_HASH, (_match, label: string) => `${label}=[REDACTED_HASH]`)
    .replace(LONG_HEX, '[REDACTED_HASH]')
    .replace(BASE64URL_HASH, '[REDACTED_HASH]');
}
