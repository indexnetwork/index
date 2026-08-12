/**
 * Adds the internal TLS policy for a database URL whose Neon authority has
 * already been established by the caller. External manifests and handoffs must
 * retain their original attested URL.
 *
 * @param alreadyAttestedDatabaseUrl Exact URL proven against the Neon control plane.
 * @returns An internal-only URL with an explicit TLS policy.
 * @throws A fixed credential-free error when the value is not a Neon postgres URL.
 */
export function bindAttestedNeonTls(alreadyAttestedDatabaseUrl: string): string {
  let internalUrl: URL;
  try {
    internalUrl = new URL(alreadyAttestedDatabaseUrl);
  } catch {
    throw new Error('TLS binding requires an attested Neon postgres URL');
  }
  if ((internalUrl.protocol !== 'postgres:' && internalUrl.protocol !== 'postgresql:')
    || !internalUrl.hostname.endsWith('.neon.tech')) {
    throw new Error('TLS binding requires an attested Neon postgres URL');
  }
  if (internalUrl.searchParams.has('sslmode')) return alreadyAttestedDatabaseUrl;
  internalUrl.searchParams.set('sslmode', 'require');
  return internalUrl.toString();
}
