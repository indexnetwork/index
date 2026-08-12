import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';

import { describeAbFailure } from '../discovery.contract';
import { bindAttestedNeonTls } from '../discovery-neon-tls';
import { bindHistoricalQualityTls } from '../discovery-quality-tls';
import { runDiscoveryBootstrap, type DiscoveryBootstrapDependencies } from '../discovery';

const sideAUrl = 'postgresql://legacy-user:legacy-password@ep-a.neon.tech/protocol_eval';
const sideBUrl = 'postgresql://legacy-user:other-password@ep-b.neon.tech/protocol_eval';

function manifest(sideDatabaseUrl = sideAUrl) {
  return {
    projectId: 'project',
    baseBranchId: 'base',
    targets: [
      { sideId: 'a' as const, branchId: 'branch-a', endpointId: 'endpoint-a', databaseUrl: sideDatabaseUrl },
      { sideId: 'b' as const, branchId: 'branch-b', endpointId: 'endpoint-b', databaseUrl: sideBUrl },
    ] as const,
  };
}

function childDependencies(input: {
  parsed?: ReturnType<typeof manifest>;
  calls: string[];
  bind?: (databaseUrl: string) => string;
  attest?: () => Promise<void>;
  importRuntime?: () => Promise<{ main(args: readonly string[]): Promise<void> }>;
}): DiscoveryBootstrapDependencies {
  return {
    assertConfirmation: () => { input.calls.push('gate'); },
    assertRuntimePrerequisites: () => { input.calls.push('runtime-prerequisites'); },
    parseManifest: () => { input.calls.push('parse'); return input.parsed ?? manifest(); },
    attestTargets: async () => {
      input.calls.push('attest');
      await input.attest?.();
    },
    bindLegacyChildTls: (databaseUrl) => {
      input.calls.push('bind');
      return (input.bind ?? bindAttestedNeonTls)(databaseUrl);
    },
    importRuntime: input.importRuntime ?? (async () => {
      input.calls.push('import');
      return { main: async () => { input.calls.push('main'); } };
    }),
  };
}

describe('legacy discovery post-attestation Neon TLS binding', () => {
  it('adds sslmode=require to a query-free attested Neon URL', () => {
    expect(bindAttestedNeonTls(sideAUrl)).toBe(`${sideAUrl}?sslmode=require`);
  });

  it('preserves an explicit compatible legacy sslmode byte-for-byte', () => {
    const explicit = `${sideAUrl}?application_name=legacy&sslmode=verify-full`;
    expect(bindAttestedNeonTls(explicit)).toBe(explicit);
  });

  it('preserves unrelated compatible legacy query parameters while adding TLS', () => {
    const internal = new URL(bindAttestedNeonTls(`${sideAUrl}?application_name=legacy&connect_timeout=10`));
    expect([...internal.searchParams.entries()]).toEqual([
      ['application_name', 'legacy'],
      ['connect_timeout', '10'],
      ['sslmode', 'require'],
    ]);
  });

  it('retains historical-quality strict query and hash rejection unchanged', () => {
    for (const unsafe of [`${sideAUrl}?application_name=quality`, `${sideAUrl}#quality`]) {
      expect(() => bindHistoricalQualityTls(unsafe))
        .toThrow('Historical quality TLS binding requires an attested query-free database URL');
    }
  });

  it('orders parse and attestation before binding, then binds before runtime import', async () => {
    const calls: string[] = [];
    const environment = { DATABASE_URL: sideAUrl, DISCOVERY_TARGETS: JSON.stringify(manifest()) };

    await runDiscoveryBootstrap(
      ['--side', 'a', '--child-output', '/tmp/provider-free-output.json'],
      environment,
      { log: () => {}, error: () => {} },
      childDependencies({ calls }),
    );

    expect(calls).toEqual(['gate', 'runtime-prerequisites', 'parse', 'attest', 'bind', 'import', 'main']);
    expect(environment.DATABASE_URL).toBe(`${sideAUrl}?sslmode=require`);
  });

  it('never binds or imports after failed authority or exact child equality checks', async () => {
    const authorityCalls: string[] = [];
    await expect(runDiscoveryBootstrap(
      ['--side', 'a'],
      { DATABASE_URL: sideAUrl, DISCOVERY_TARGETS: JSON.stringify(manifest()) },
      { log: () => {}, error: () => {} },
      childDependencies({
        calls: authorityCalls,
        attest: async () => { throw new Error('credential-bearing-control-plane-error'); },
      }),
    )).rejects.toThrow('credential-bearing-control-plane-error');
    expect(authorityCalls).toEqual(['gate', 'runtime-prerequisites', 'parse', 'attest']);

    const equalityCalls: string[] = [];
    await expect(runDiscoveryBootstrap(
      ['--side', 'a'],
      { DATABASE_URL: sideBUrl, DISCOVERY_TARGETS: JSON.stringify(manifest()) },
      { log: () => {}, error: () => {} },
      childDependencies({ calls: equalityCalls }),
    )).rejects.toThrow(/manifest entry declares/);
    expect(equalityCalls).toEqual(['gate', 'runtime-prerequisites', 'parse', 'attest']);
  });

  it('changes only the child internal environment and leaves manifest object and string byte-for-byte unchanged', async () => {
    const parsed = manifest();
    const originalObject = JSON.stringify(parsed);
    const originalManifest = ` ${originalObject} `;
    const environment = { DATABASE_URL: sideAUrl, DISCOVERY_TARGETS: originalManifest };
    const calls: string[] = [];

    await runDiscoveryBootstrap(
      ['--side', 'a'],
      environment,
      { log: () => {}, error: () => {} },
      childDependencies({
        parsed,
        calls,
        importRuntime: async () => {
          calls.push('import');
          expect(environment.DATABASE_URL).toBe(`${sideAUrl}?sslmode=require`);
          expect(environment.DISCOVERY_TARGETS).toBe(originalManifest);
          expect(JSON.stringify(parsed)).toBe(originalObject);
          expect(parsed.targets[0].databaseUrl).toBe(sideAUrl);
          return { main: async () => { calls.push('main'); } };
        },
      }),
    );

    expect(environment.DISCOVERY_TARGETS).toBe(originalManifest);
    expect(JSON.stringify(parsed)).toBe(originalObject);
  });

  it('uses fixed sanitized failures and emits no URL, password, or raw error', async () => {
    const local = 'postgresql://local-user:local-password@localhost:5432/protocol_eval';
    const localError = await Promise.resolve().then(() => bindAttestedNeonTls(local)).catch((error: Error) => error);
    expect(localError.message).toBe('TLS binding requires an attested Neon postgres URL');
    expect(localError.message).not.toContain('local-password');

    const output: string[] = [];
    const failure = await runDiscoveryBootstrap(
      ['--side', 'a'],
      { DATABASE_URL: sideBUrl, DISCOVERY_TARGETS: JSON.stringify(manifest()) },
      { log: (value?: unknown) => output.push(String(value)), error: (value?: unknown) => output.push(String(value)) },
      childDependencies({ calls: [] }),
    ).catch((error: unknown) => error);
    const report = describeAbFailure(failure, 'child');
    expect(output).toEqual([]);
    expect(report.message).not.toContain(sideAUrl);
    expect(report.message).not.toContain('legacy-password');
    expect(report.message).not.toContain('other-password');
  });

  it('leaves parent/local behavior and the generic Drizzle client untouched', async () => {
    const calls: string[] = [];
    const local = 'postgresql://local-user:local-password@localhost:5432/local_database';
    const environment = { DATABASE_URL: local, DISCOVERY_TARGETS: JSON.stringify(manifest()) };

    await runDiscoveryBootstrap(
      ['--env', 'DISCOVERY_ALLOWED_TYPES=intent'],
      environment,
      { log: () => {}, error: () => {} },
      childDependencies({ calls }),
    );

    expect(calls).toEqual(['gate', 'runtime-prerequisites', 'parse', 'attest', 'import', 'main']);
    expect(environment.DATABASE_URL).toBe(local);
    const genericDrizzle = await readFile(new URL('../../lib/drizzle/drizzle.ts', import.meta.url), 'utf8');
    expect(genericDrizzle).toContain('postgres(connectionString, { prepare: false })');
    expect(genericDrizzle).not.toContain('sslmode');
  });
});
