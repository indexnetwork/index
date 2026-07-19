import { describe, expect, mock, test } from 'bun:test';

import { checkTestDatabaseReadiness, shouldRequireTestDatabase, validateTestDatabaseUrl } from '../test-database-readiness';

function makeClient(rows: ReadonlyArray<Record<string, unknown>> = [{ missing: [] }]) {
  return {
    unsafe: mock(async () => rows),
    end: mock(async () => undefined),
  };
}

describe('test database readiness', () => {
  test('rejects missing and malformed database URLs clearly', () => {
    expect(() => validateTestDatabaseUrl(undefined)).toThrow('[test-db] DATABASE_URL is missing');
    expect(() => validateTestDatabaseUrl('not-a-url')).toThrow(
      '[test-db] DATABASE_URL must be a valid postgres:// or postgresql:// URL.',
    );
    expect(() => validateTestDatabaseUrl('https://database.example.com')).toThrow(
      '[test-db] DATABASE_URL must be a valid postgres:// or postgresql:// URL.',
    );
  });

  test('accepts postgres URL schemes', () => {
    expect(validateTestDatabaseUrl('postgres://user:pass@localhost:5432/test')).toStartWith('postgres://');
    expect(validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/test')).toStartWith(
      'postgresql://',
    );
  });

  test('requires an explicit disposable-database marker', async () => {
    await expect(
      checkTestDatabaseReadiness({
        databaseUrl: 'postgresql://user:pass@localhost:5432/test',
        safeMarker: '0',
      }),
    ).rejects.toThrow('TEST_DATABASE_SAFE=1 is not set');
  });

  test('reports stale schema objects and closes the probe client', async () => {
    const client = makeClient([{ missing: ['public.negotiator_memories', 'public.opportunity_outcome_events'] }]);

    await expect(
      checkTestDatabaseReadiness({
        databaseUrl: 'postgresql://user:pass@localhost:5432/test',
        safeMarker: '1',
        createClient: () => client,
      }),
    ).rejects.toThrow(
      'Missing: public.negotiator_memories, public.opportunity_outcome_events. Run "bun run db:migrate:test"',
    );
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  test('passes a current schema probe and closes the client', async () => {
    const client = makeClient();

    await checkTestDatabaseReadiness({
      databaseUrl: 'postgresql://user:pass@localhost:5432/test',
      safeMarker: '1',
      createClient: () => client,
    });

    expect(client.unsafe).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  test('bounds unreachable probes and redacts driver details', async () => {
    const client = {
      unsafe: mock(async () => {
        throw new Error('connect ECONNREFUSED password=super-secret');
      }),
      end: mock(async () => undefined),
    };

    let message = '';
    try {
      await checkTestDatabaseReadiness({
        databaseUrl: 'postgresql://sensitive-user:super-secret@localhost:1/test',
        safeMarker: '1',
        timeoutMs: 10,
        createClient: () => client,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('[test-db] Test database is unreachable within 10ms');
    expect(message).not.toContain('super-secret');
    expect(message).not.toContain('ECONNREFUSED');
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  test('times out a probe that never settles', async () => {
    const client = {
      unsafe: mock(() => new Promise<ReadonlyArray<Record<string, unknown>>>(() => undefined)),
      end: mock(async () => undefined),
    };

    await expect(
      checkTestDatabaseReadiness({
        databaseUrl: 'postgresql://user:pass@localhost:5432/test',
        safeMarker: '1',
        timeoutMs: 5,
        createClient: () => client,
      }),
    ).rejects.toThrow('[test-db] Test database is unreachable within 5ms');
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});

describe('test database preload policy', () => {
  test('requires readiness for bare and wrapper-driven full runs', () => {
    expect(shouldRequireTestDatabase(['/usr/bin/bun', 'test'], {})).toBe(true);
    expect(
      shouldRequireTestDatabase(['/usr/bin/bun', 'test', 'src/example.spec.ts'], {
        API_TEST_REQUIRE_DATABASE: '1',
      }),
    ).toBe(true);
  });

  test('lets targeted hermetic specs defer readiness to real Drizzle imports', () => {
    expect(shouldRequireTestDatabase(['/usr/bin/bun', 'test', 'src/example.spec.ts'], {})).toBe(false);
  });
});
