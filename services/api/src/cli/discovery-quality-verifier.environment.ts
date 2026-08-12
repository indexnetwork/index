/**
 * Construct the fresh base verifier environment from nothing. The runtime path
 * is absolute, so no shell, manifest, writable-target, provider, or credential
 * state is required or inherited.
 */
export function buildHistoricalQualityBaseVerifierEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: databaseUrl,
    PGOPTIONS: '-c transaction_read_only=on',
  };
}
