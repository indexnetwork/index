import { describe, expect, mock, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { checkTestDatabaseReadiness, hasParentTestDatabaseReadiness, readOriginalProcessArgv, REQUIRED_TEST_DATABASE_COLUMNS, REQUIRED_TEST_DATABASE_OBJECTS, resolveTestDatabasePreloadPolicy, shouldRequireTestDatabase, validateTestDatabaseUrl } from '../test-database-readiness';

const apiRoot = path.resolve(import.meta.dir, '../../../..');
const repositoryRoot = path.resolve(apiRoot, '../..');
const assuranceWorkflowPath = path.join(
  repositoryRoot,
  '.github/workflows/hermes-backend-production-assurance.yml',
);
const assuranceWorkflow = existsSync(assuranceWorkflowPath)
  ? readFileSync(assuranceWorkflowPath, 'utf8')
  : '';
const POSTGRES_ASSURANCE_REFERENCE = 'postgres:16@sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b';
const PGVECTOR_PACKAGE_VERSION = '0.8.6-1.pgdg13+1';
const PGVECTOR_EXTENSION_VERSION = '0.8.6';
const PGVECTOR_PACKAGE_SHA256 = '9aea9c1617bc99991d3730cfbf5878a0e9dc377e0d3d5ca2e41488a2309319bc';
const PGVECTOR_ARCHIVE_OBJECT_VERSION = 'x3lsgKtr53BtiGMRJqIlPZr52kLw0jvS';
const PGVECTOR_PACKAGE_URL = `https://apt-archive.postgresql.org/pub/repos/apt/pool/main/p/pgvector/postgresql-16-pgvector_${PGVECTOR_PACKAGE_VERSION}_amd64.deb?versionId=${PGVECTOR_ARCHIVE_OBJECT_VERSION}`;
const apiPackage = JSON.parse(
  readFileSync(path.join(apiRoot, 'package.json'), 'utf8'),
) as { scripts?: Record<string, string> };

function makeClient(rows: ReadonlyArray<Record<string, unknown>> = [{ missing: [] }]) {
  return {
    unsafe: mock(async () => rows),
    end: mock(async () => undefined),
  };
}

describe('Hermes production assurance contract', () => {
  test('allows the assurance database while rejecting its production-like variant', () => {
    expect(() => validateTestDatabaseUrl(
      'postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance',
    )).not.toThrow();
    expect(() => validateTestDatabaseUrl(
      'postgres://postgres:postgres@127.0.0.1:5432/hermes_prod',
    )).toThrow('production-like database name');
  });

  test('exposes the exact fresh-process database assurance wrapper', () => {
    expect(apiPackage.scripts?.['test:hermes-production-assurance']).toBe(
      'bash scripts/test-hermes-production-assurance.sh',
    );

    const runnerPath = path.join(apiRoot, 'scripts/test-hermes-production-assurance.sh');
    expect(existsSync(runnerPath)).toBe(true);
    const runner = existsSync(runnerPath) ? readFileSync(runnerPath, 'utf8') : '';
    expect(runner).toContain('src/lib/drizzle/tests/hermes-migration-preflight.database.isolated.ts');
    expect(runner).toContain('src/lib/drizzle/tests/hermes-runtime-telemetry.database.isolated.ts');
    expect(runner).toContain('src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts');
    expect(runner).toContain('tests/hermes-runtime-lifecycle.database.isolated.ts');
    expect(runner).toContain('tests/negotiation-runtime-authority.database.isolated.ts');
    expect(runner).toContain('bun run maintenance:hermes-preflight --');
    expect(runner).toContain('--max-lock-ms "$HERMES_PREFLIGHT_MAX_LOCK_MS"');
    expect(runner).toContain('--max-total-ms "$HERMES_PREFLIGHT_MAX_TOTAL_MS"');
    expect(runner).not.toContain('--max-lock-ms 5000 --max-total-ms 30000');
    expect(runner.match(/bun test src\/lib\/testing\/isolated-test-import-harness\.spec\.ts/g) ?? [])
      .toHaveLength(1);
    expect(runner).toContain('for target in');
    expect(runner).toContain('API_TEST_ISOLATED_TARGET="$target"');
    expect(runner).not.toContain('API_TEST_DATABASE_READY');
    expect(runner).not.toContain('API_TEST_REQUIRE_DATABASE=');
  });

  test('runs pull-request assurance for the canonical and stacked base branches', () => {
    expect(assuranceWorkflow).toContain(
      'branches: [dev, main, feat/hermes-secure-standalone-connect]',
    );
  });

  test('installs pgvector into the exact PostgreSQL service before migrations', () => {
    expect(assuranceWorkflow).toContain(
      'POSTGRES_SERVICE_CONTAINER: ${{ job.services.postgres.id }}',
    );
    expect(assuranceWorkflow).toContain(
      `image_ref="$(docker inspect --format '{{.Config.Image}}' "$POSTGRES_SERVICE_CONTAINER")"`,
    );
    expect(assuranceWorkflow).toContain(`POSTGRES_ASSURANCE_REFERENCE: ${POSTGRES_ASSURANCE_REFERENCE}`);
    expect(assuranceWorkflow).toContain('test "$image_ref" = "$POSTGRES_ASSURANCE_REFERENCE"');
    expect(assuranceWorkflow).toContain('test "${image_ref##*@}" = "${POSTGRES_ASSURANCE_REFERENCE##*@}"');
    expect(assuranceWorkflow).toContain(`PGVECTOR_PACKAGE_VERSION: ${PGVECTOR_PACKAGE_VERSION}`);
    expect(assuranceWorkflow).toContain(`PGVECTOR_EXTENSION_VERSION: ${PGVECTOR_EXTENSION_VERSION}`);
    expect(assuranceWorkflow).toContain(`PGVECTOR_PACKAGE_SHA256: ${PGVECTOR_PACKAGE_SHA256}`);
    expect(assuranceWorkflow).toContain(`PGVECTOR_PACKAGE_URL: ${PGVECTOR_PACKAGE_URL}`);
    expect(assuranceWorkflow).toContain(
      `docker exec --user root "$POSTGRES_SERVICE_CONTAINER" bash -ceu`,
    );
    expect(assuranceWorkflow).toContain('showformat=\\${db:Status-Status} postgresql-16)" = installed');
    expect(assuranceWorkflow).toContain('showformat=\\${db:Status-Status} libc6)" = installed');
    expect(assuranceWorkflow).toContain('! dpkg-query --show postgresql-16-jit-llvm');
    expect(assuranceWorkflow).toContain('sha256sum --check --strict');
    expect(assuranceWorkflow).toContain('dpkg --install "$package_file"');
    expect(assuranceWorkflow).toContain(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(assuranceWorkflow).not.toMatch(/apt-get\s+(?:update|install)/);
    const installStep = assuranceWorkflow.indexOf('- name: Install verified pgvector in PostgreSQL service');
    const assuranceStep = assuranceWorkflow.indexOf('- name: Run Hermes production assurance');
    expect(installStep).toBeGreaterThan(-1);
    expect(assuranceStep).toBeGreaterThan(-1);
    expect(installStep).toBeLessThan(assuranceStep);
  });

  test('uses a healthy disposable PostgreSQL 16 service with frozen dependencies', () => {
    expect(existsSync(assuranceWorkflowPath)).toBe(true);
    expect(assuranceWorkflow).toContain(`image: ${POSTGRES_ASSURANCE_REFERENCE}`);
    expect(assuranceWorkflow).not.toMatch(/image:\s+postgres:16\s*$/m);
    expect(assuranceWorkflow).toContain('POSTGRES_DB: hermes_assurance');
    expect(assuranceWorkflow).toContain('pg_isready -U postgres -d hermes_assurance');
    expect(assuranceWorkflow).toContain('bun install --frozen-lockfile');
    expect(assuranceWorkflow).toContain('bun run --cwd services/api build');
    expect(assuranceWorkflow).toContain('bun run --cwd services/api db:migrate:test');
    expect(assuranceWorkflow).toContain('bun run --cwd services/api test:hermes-production-assurance');
  });

  test('requests bounded readiness only in the exact database step without injecting proof', () => {
    const readinessRequests = assuranceWorkflow.match(/API_TEST_REQUIRE_DATABASE:\s*["']1["']/g) ?? [];
    expect(readinessRequests).toHaveLength(1);
    expect(assuranceWorkflow).not.toContain('API_TEST_DATABASE_READY');
    expect(assuranceWorkflow).toContain(`- name: Run Hermes production assurance
        env:
          DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance
          TEST_DATABASE_SAFE: "1"
          API_TEST_REQUIRE_DATABASE: "1"`);
  });

  test('scopes disposable-database markers to exact database operations', () => {
    const safetyMarkers = assuranceWorkflow.match(/TEST_DATABASE_SAFE:\s*["']1["']/g) ?? [];
    expect(safetyMarkers).toHaveLength(6);
    expect(assuranceWorkflow).toContain(`- name: Run Hermes production assurance
        env:
          DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance
          TEST_DATABASE_SAFE: "1"
          API_TEST_REQUIRE_DATABASE: "1"`);
    expect(assuranceWorkflow).toContain(`- name: Run emergency control dry-run only
        env:
          DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance
          TEST_DATABASE_SAFE: "1"`);
    expect(assuranceWorkflow).not.toMatch(/jobs:\n(?:[ ]{2}[^\n]+\n)*\s*env:\n\s*TEST_DATABASE_SAFE/);
  });
});

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

  test('refuses databases whose name marks them as carrying real data', () => {
    // Every Neon branch in this project — production, dev and local-dev alike —
    // exposes a `protocol_prod` database holding a copy of real user data, so the
    // name is a reliable marker of real data rather than of the production branch.
    for (const name of ['protocol_prod', 'prod', 'production', 'index_production', 'app_prod']) {
      expect(() => validateTestDatabaseUrl(`postgresql://user:pass@host.example.com/${name}`)).toThrow(
        '[test-db] Refusing to run tests against a database that carries real data',
      );
    }
  });

  test('names the remedy without leaking credentials', () => {
    try {
      validateTestDatabaseUrl('postgresql://user:sup3rs3cret@host.example.com/protocol_prod');
      throw new Error('expected a refusal');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('protocol_prod');
      expect(message).toContain('neondb');
      expect(message).not.toContain('sup3rs3cret');
    }
  });

  test('allows disposable database names, including query strings and ports', () => {
    expect(validateTestDatabaseUrl('postgresql://user:pass@host.example.com/neondb')).toContain('neondb');
    expect(
      validateTestDatabaseUrl('postgresql://user:pass@host.example.com:5432/neondb?sslmode=require'),
    ).toContain('neondb');
    expect(validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/index_test')).toContain(
      'index_test',
    );
    // "reproduction" contains "production" as a substring but is not a prod database.
    expect(validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/reproduction_fixtures')).toContain(
      'reproduction_fixtures',
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

  test('requires current authorization tables before database-backed fixtures run', () => {
    expect(REQUIRED_TEST_DATABASE_OBJECTS).toContain('public.intent_proposals');
    expect(REQUIRED_TEST_DATABASE_OBJECTS).toContain('public.hermes_authorizations');
    expect(REQUIRED_TEST_DATABASE_OBJECTS).toContain('public.hermes_agent_credentials');
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
  const registeredTarget = 'tests/negotiation-runtime-authority.database.isolated.ts';
  const registeredTargets = [registeredTarget];

  test('probes and closes a required exact isolated import without full-suite fanout', () => {
    expect(resolveTestDatabasePreloadPolicy(
      ['/usr/bin/bun', 'test', 'src/lib/testing/isolated-test-import-harness.spec.ts'],
      {
        API_TEST_REQUIRE_DATABASE: '1',
        API_TEST_ISOLATED_TARGET: registeredTarget,
      },
      registeredTargets,
    )).toEqual({
      checkDatabase: true,
      closeDatabase: true,
      runIsolatedSuite: false,
    });
  });

  test('keeps database readiness, closure, and fanout for bare suites with an ambient target', () => {
    expect(resolveTestDatabasePreloadPolicy(
      ['/usr/bin/bun', 'test'],
      { API_TEST_ISOLATED_TARGET: registeredTarget },
      registeredTargets,
    )).toEqual({
      checkDatabase: true,
      closeDatabase: true,
      runIsolatedSuite: true,
    });
  });

  test('suppresses fanout only for the exact harness and a registered target', () => {
    const requiredTarget = {
      API_TEST_REQUIRE_DATABASE: '1',
      API_TEST_ISOLATED_TARGET: registeredTarget,
    };
    expect(resolveTestDatabasePreloadPolicy(
      ['/usr/bin/bun', 'test', 'src/lib/drizzle/tests/test-database-readiness.spec.ts'],
      requiredTarget,
      registeredTargets,
    ).runIsolatedSuite).toBe(true);
    expect(resolveTestDatabasePreloadPolicy(
      ['/usr/bin/bun', 'test', 'src/lib/testing/isolated-test-import-harness.spec.ts'],
      requiredTarget,
      [],
    ).runIsolatedSuite).toBe(true);
    expect(resolveTestDatabasePreloadPolicy(
      ['/usr/bin/bun', 'test', './src/lib/testing/isolated-test-import-harness.spec.ts'],
      requiredTarget,
      registeredTargets,
    ).runIsolatedSuite).toBe(false);
  });

  test('keeps database readiness, closure, and isolated fanout for ordinary full suites', () => {
    expect(resolveTestDatabasePreloadPolicy(['/usr/bin/bun', 'test'], {}, [])).toEqual({
      checkDatabase: true,
      closeDatabase: true,
      runIsolatedSuite: true,
    });
  });

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
