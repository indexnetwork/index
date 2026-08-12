process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

import { afterAll, describe, expect, it, mock } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

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

    const rendered = new PgDialect().sqlToQuery(executeCalls[0] as never);
    const normalizedSql = rendered.sql.replace(/\s+/g, ' ').trim();
    expect(rendered.params.filter((param) => param instanceof Date)).toEqual([]);
    expect(rendered.params).toEqual([
      now.toISOString(),
      nearExpiryCutoff.toISOString(),
      now.toISOString(),
    ]);
    expect(normalizedSql).toContain("activation_state = 'active' AND expires_at > $1::timestamptz AND expires_at <= $2::timestamptz");
    expect(normalizedSql).toContain("activation_state = 'active' AND expires_at <= $3::timestamptz");
    expect(normalizedSql.match(/::timestamptz/g)).toHaveLength(3);
    expect(normalizedSql.match(/count\(\*\)::int/g)).toHaveLength(2);
    expect(normalizedSql).not.toContain('SELECT *');
  });
});
