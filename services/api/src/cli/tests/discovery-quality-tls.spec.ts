import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';

import { parseQualityBaseRefreshTarget } from '../discovery-quality-refresh-target';
import { bindHistoricalQualityTls } from '../discovery-quality-tls';
import { parseHistoricalQualityManifest } from '../discovery.neon';

const strictDatabaseUrl = 'postgresql://quality:tls-secret@ep-quality.neon.tech/protocol_eval';

function strictManifest(databaseUrl = strictDatabaseUrl) {
  return JSON.stringify({
    version: 2,
    projectId: 'project-quality',
    baseBranchId: 'branch-base',
    baseReadReplica: { endpointId: 'endpoint-replica', databaseUrl },
    targets: [
      { sideId: 'a', branchId: 'branch-a', endpointId: 'endpoint-a', databaseUrl: 'postgresql://a:a-secret@ep-a.neon.tech/protocol_eval' },
      { sideId: 'b', branchId: 'branch-b', endpointId: 'endpoint-b', databaseUrl: 'postgresql://b:b-secret@ep-b.neon.tech/protocol_eval' },
    ],
  });
}

function strictRefreshTarget(databaseUrl = strictDatabaseUrl) {
  return JSON.stringify({
    version: 2,
    projectId: 'project-quality',
    branchId: 'branch-base',
    endpointId: 'endpoint-refresh',
    databaseName: 'protocol_eval',
    databaseUrl,
  });
}

describe('historical quality post-attestation TLS binding', () => {
  it('keeps the attested external URL query-free while requiring TLS for postgres and central imports', () => {
    const binding = bindHistoricalQualityTls(strictDatabaseUrl);

    expect(strictDatabaseUrl).not.toContain('?');
    expect(binding.postgresOptions).toEqual({ ssl: 'require' });
    expect(binding.internalDatabaseUrl).toBe(`${strictDatabaseUrl}?sslmode=require`);
    expect(JSON.stringify(binding.postgresOptions)).not.toContain('tls-secret');
  });

  it('preserves credentials, explicit port, and database path while adding only sslmode=require', () => {
    const externalUrl = 'postgresql://quality-user:p%40ssword-secret@ep-quality.neon.tech:5432/protocol_eval';
    const original = new URL(externalUrl);
    const binding = bindHistoricalQualityTls(externalUrl);
    const internal = new URL(binding.internalDatabaseUrl);

    expect(internal.protocol).toBe(original.protocol);
    expect(internal.username).toBe(original.username);
    expect(internal.password).toBe(original.password);
    expect(internal.hostname).toBe(original.hostname);
    expect(internal.port).toBe(original.port);
    expect(internal.pathname).toBe(original.pathname);
    expect([...internal.searchParams.entries()]).toEqual([['sslmode', 'require']]);
    expect(internal.hash).toBe('');
  });

  it('rejects preexisting query parameters or fragments without exposing or logging their secrets', async () => {
    const secret = 'reviewer-secret-sentinel';
    for (const unsafeUrl of [
      `${strictDatabaseUrl}?application_name=${secret}`,
      `${strictDatabaseUrl}#${secret}`,
    ]) {
      const error = await Promise.resolve().then(() => bindHistoricalQualityTls(unsafeUrl)).catch((caught: Error) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Historical quality TLS binding requires an attested query-free database URL');
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(secret);
    }

    const helperSource = await readFile(new URL('../discovery-quality-tls.ts', import.meta.url), 'utf8');
    expect(helperSource).not.toMatch(/\bconsole\.|\blog(?:ger)?\./);
  });

  it('does not weaken strict manifest or refresh-target query rejection', () => {
    expect(parseHistoricalQualityManifest(strictManifest()).baseReadReplica.databaseUrl).toBe(strictDatabaseUrl);
    expect(parseQualityBaseRefreshTarget(strictRefreshTarget()).databaseUrl).toBe(strictDatabaseUrl);

    const internalUrl = bindHistoricalQualityTls(strictDatabaseUrl).internalDatabaseUrl;
    expect(() => parseHistoricalQualityManifest(strictManifest(internalUrl))).toThrow();
    expect(() => parseQualityBaseRefreshTarget(strictRefreshTarget(internalUrl))).toThrow();
  });

  it('binds TLS at every quality-only runtime connection handoff without changing the generic client', async () => {
    const [baseRuntime, childRuntime, integration, genericDrizzle] = await Promise.all([
      readFile(new URL('../discovery-quality-base.main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../discovery-quality.child.ts', import.meta.url), 'utf8'),
      readFile(new URL('./discovery-quality-base.integration.spec.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../lib/drizzle/drizzle.ts', import.meta.url), 'utf8'),
    ]);

    expect(baseRuntime).toContain('bindHistoricalQualityTls(databaseUrl)');
    expect(baseRuntime).toMatch(/postgres\(databaseUrl, \{[^}]*\.\.\.postgresOptions[^}]*\}\)/s);

    expect(childRuntime.match(/bindHistoricalQualityTls\(databaseUrl\)/g)).toHaveLength(1);
    expect(childRuntime).toMatch(/postgresModule\.default\(databaseUrl, \{[^}]*\.\.\.postgresOptions[^}]*\}\)/s);
    expect(childRuntime).toContain('bindHistoricalQualityTls(selectedDatabaseUrl).internalDatabaseUrl');

    expect(integration).toContain('bindHistoricalQualityTls(databaseUrl).postgresOptions');
    expect(integration).toContain('bindHistoricalQualityTls(databaseUrl)');
    expect(integration).toContain('database(manifest.baseReadReplica.databaseUrl)');
    expect(genericDrizzle).toContain('postgres(connectionString, { prepare: false })');
  });
});
