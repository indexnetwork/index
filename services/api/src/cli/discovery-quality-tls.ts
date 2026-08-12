/**
 * Runtime-only TLS authority for historical-quality database URLs that have
 * already passed the strict query-free manifest and control-plane attestations.
 * The internal URL is never projected back into manifests or parent handoffs.
 */
export function bindHistoricalQualityTls(alreadyAttestedDatabaseUrl: string): Readonly<{
  postgresOptions: Readonly<{ ssl: 'require' }>;
  internalDatabaseUrl: string;
}> {
  const internalUrl = new URL(alreadyAttestedDatabaseUrl);
  if (internalUrl.search !== '' || internalUrl.hash !== '') {
    throw new Error('Historical quality TLS binding requires an attested query-free database URL');
  }
  internalUrl.searchParams.set('sslmode', 'require');
  return Object.freeze({
    postgresOptions: Object.freeze({ ssl: 'require' as const }),
    internalDatabaseUrl: internalUrl.toString(),
  });
}
