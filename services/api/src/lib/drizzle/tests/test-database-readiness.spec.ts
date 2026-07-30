import { describe, expect, mock, test } from 'bun:test';

import { checkTestDatabaseReadiness, hasParentTestDatabaseReadiness, readOriginalProcessArgv, REQUIRED_TEST_DATABASE_COLUMNS, REQUIRED_TEST_DATABASE_OBJECTS, shouldRequireTestDatabase, validateTestDatabaseUrl } from '../test-database-readiness';

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

  test('requires intent_proposals before database-backed fixtures run', () => {
    expect(REQUIRED_TEST_DATABASE_OBJECTS).toContain('public.intent_proposals');
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

  test('probes every repaired API-key column and user_id nullability', async () => {
    const client = makeClient();

    await checkTestDatabaseReadiness({
      databaseUrl: 'postgresql://user:pass@localhost:5432/test',
      safeMarker: '1',
      createClient: () => client,
    });

    const query = String(client.unsafe.mock.calls[0]?.[0]);
    for (const [table, column] of REQUIRED_TEST_DATABASE_COLUMNS) {
      expect(query).toContain(`table_name = '${table}' AND column_name = '${column}'`);
    }
    expect(query).toContain("column_name = 'user_id'");
    expect(query).toContain("is_nullable = 'YES'");
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  test('reports non-nullable API-key ownership as stale schema', async () => {
    const client = makeClient([{ missing: ['public.apikey.user_id (must be nullable)'] }]);

    await expect(
      checkTestDatabaseReadiness({
        databaseUrl: 'postgresql://user:pass@localhost:5432/test',
        safeMarker: '1',
        createClient: () => client,
      }),
    ).rejects.toThrow('public.apikey.user_id (must be nullable)');
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
  test('reads the original Bun test command on supported baseline platforms', () => {
    if (process.platform !== 'linux' && process.platform !== 'darwin') return;
    expect(readOriginalProcessArgv()).toContain('test');
  });

  test('requires readiness for bare and wrapper-driven full runs', () => {
    expect(shouldRequireTestDatabase(['/usr/bin/bun'], {})).toBe(true);
    expect(shouldRequireTestDatabase(['/usr/bin/bun', 'test'], {})).toBe(true);
    expect(
      shouldRequireTestDatabase(['/usr/bin/bun', 'test', '--timeout', '30000', '--coverage'], {}),
    ).toBe(true);
    expect(
      shouldRequireTestDatabase(['/usr/bin/bun', 'test', '/api/src/example.spec.ts'], {
        API_TEST_REQUIRE_DATABASE: '1',
      }),
    ).toBe(true);
  });

  test('does not treat option values as targeted test paths', () => {
    expect(
      shouldRequireTestDatabase(['/usr/bin/bun', 'test', '--timeout', '30000', '/api/src/example.spec.ts'], {}),
    ).toBe(false);
    expect(
      shouldRequireTestDatabase(['/usr/bin/bun', 'test', '--retry', '2', '/api/src/example.spec.ts'], {}),
    ).toBe(false);
  });

  test('lets targeted hermetic specs defer readiness to real Drizzle imports', () => {
    expect(
      shouldRequireTestDatabase(['/usr/bin/bun', 'test', '/api/src/example.spec.ts'], {}),
    ).toBe(false);
    expect(
      shouldRequireTestDatabase(['/usr/bin/bun', 'test', '--test-name-pattern', 'focused'], {}),
    ).toBe(false);
    expect(
      shouldRequireTestDatabase(['/usr/bin/bun', 'test', '--watch'], {}),
    ).toBe(false);
  });

  test('reuses readiness only for parent-attested isolated children', () => {
    expect(hasParentTestDatabaseReadiness({ API_TEST_DATABASE_READY: '1' }, 123)).toBe(false);
    expect(hasParentTestDatabaseReadiness({ API_TEST_ISOLATED_CHILD: '1' }, 123)).toBe(false);
    expect(
      hasParentTestDatabaseReadiness({
        API_TEST_DATABASE_READY: '1',
        API_TEST_ISOLATED_CHILD: '1',
        API_TEST_PARENT_PID: '999',
      }, 123),
    ).toBe(false);
    expect(
      hasParentTestDatabaseReadiness({
        API_TEST_DATABASE_READY: '1',
        API_TEST_ISOLATED_CHILD: '1',
        API_TEST_PARENT_PID: '123',
      }, 123),
    ).toBe(true);
  });
});
