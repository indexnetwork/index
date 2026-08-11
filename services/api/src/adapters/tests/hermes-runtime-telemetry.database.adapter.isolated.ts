process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

import { afterAll, describe, expect, it, mock } from 'bun:test';

const executeCalls: unknown[] = [];
const database = {
  execute: async (query: unknown) => {
    executeCalls.push(query);
    return [{ nearExpiry: 4, expired: 5 }];
  },
};
mock.module('../../lib/drizzle/drizzle', () => ({ default: database }));

const { HermesRuntimeTelemetryDatabaseAdapter } = await import('../hermes-runtime-telemetry.database.adapter');

afterAll(() => mock.restore());

describe('HermesRuntimeTelemetryDatabaseAdapter', () => {
  it('returns one authoritative aggregate count snapshot through one bounded query', async () => {
    const adapter = new HermesRuntimeTelemetryDatabaseAdapter(database as never);
    const now = new Date('2026-08-09T12:00:00.000Z');
    const nearExpiryCutoff = new Date('2026-08-16T12:00:00.000Z');

    await expect(adapter.countActiveCredentialExpiryHealth({ now, nearExpiryCutoff }))
      .resolves.toEqual({ nearExpiry: 4, expired: 5 });
    expect(executeCalls).toHaveLength(1);

    const source = await Bun.file(new URL('../hermes-runtime-telemetry.database.adapter.ts', import.meta.url)).text();
    expect(source).toContain("activation_state = 'active'");
    expect(source).toContain('expires_at >');
    expect(source).toContain('expires_at <=');
    expect(source).toContain('count(*)::int');
    expect(source).not.toContain('SELECT *');
  });
});
