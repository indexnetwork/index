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
