import { describe, expect, it, mock } from 'bun:test';

import { latchTestInvocationNodeEnv, loadEnvironmentWithTestLock, requireSafeTestMigration, requireTestMode } from '../test-environment';

function loadWith(
  fileNodeEnv: string | undefined,
  environment: Record<string, string | undefined> = { NODE_ENV: 'test' },
) {
  const load = mock(() => {
    environment.NODE_ENV = fileNodeEnv ?? environment.NODE_ENV;
    return { parsed: fileNodeEnv === undefined ? {} : { NODE_ENV: fileNodeEnv } };
  });
  const loaded = loadEnvironmentWithTestLock({
    requestedNodeEnv: 'test',
    testEnvPath: '/safe/.env.test',
    developmentEnvPath: '/safe/.env.development',
    environment,
    load,
  });
  return { environment, load, loaded };
}

describe('test environment lock', () => {
  it('latches bare Bun test mode but rejects an inherited non-test mode', () => {
    expect(latchTestInvocationNodeEnv(undefined)).toBe('test');
    expect(latchTestInvocationNodeEnv('')).toBe('test');
    expect(latchTestInvocationNodeEnv('test')).toBe('test');
    expect(() => latchTestInvocationNodeEnv('development')).toThrow(
      'inherited NODE_ENV=development',
    );
  });

  it('accepts an omitted or matching file NODE_ENV and restores test mode', () => {
    expect(loadWith(undefined).environment.NODE_ENV).toBe('test');
    expect(loadWith('test').environment.NODE_ENV).toBe('test');
  });

  it('rejects a development NODE_ENV without leaving test mode downgraded', () => {
    const environment = { NODE_ENV: 'test' };

    expect(() => loadWith('development', environment)).toThrow(
      '.env.test declares NODE_ENV=development',
    );
    expect(environment.NODE_ENV).toBe('test');
  });

  it('rejects a production NODE_ENV without exposing other environment values', () => {
    const environment = { NODE_ENV: 'test', DATABASE_URL: 'postgres://secret@unsafe/prod' };
    let message = '';

    try {
      loadWith('production', environment);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('NODE_ENV=production');
    expect(message).not.toContain('secret');
    expect(environment.NODE_ENV).toBe('test');
  });

  it('latches the requested mode instead of trusting dotenv mutations', () => {
    const environment = { NODE_ENV: 'development' };
    const load = mock(() => ({ parsed: { NODE_ENV: 'test' } }));

    const loaded = loadEnvironmentWithTestLock({
      requestedNodeEnv: 'development',
      testEnvPath: '/safe/.env.test',
      developmentEnvPath: '/safe/.env.development',
      environment,
      load,
    });

    expect(loaded).toEqual({ envFile: '/safe/.env.development', testMode: false });
    expect(load).toHaveBeenCalledWith({ path: '/safe/.env.development', override: false });
    expect(() => requireTestMode(loaded)).toThrow('must be launched with NODE_ENV=test');
  });

  it('rejects reserved orchestration markers from .env.test and restores parent values', () => {
    const environment: Record<string, string | undefined> = {
      NODE_ENV: 'test',
      API_TEST_ISOLATED_CHILD: undefined,
      API_TEST_DATABASE_READY: undefined,
    };
    const load = mock(() => {
      environment.API_TEST_ISOLATED_CHILD = '1';
      environment.API_TEST_DATABASE_READY = '1';
      return {
        parsed: {
          API_TEST_ISOLATED_CHILD: '1',
          API_TEST_DATABASE_READY: '1',
        },
      };
    });

    expect(() =>
      loadEnvironmentWithTestLock({
        requestedNodeEnv: 'test',
        testEnvPath: '/safe/.env.test',
        developmentEnvPath: '/safe/.env.development',
        environment,
        load,
      }),
    ).toThrow('may not declare reserved variable API_TEST_DATABASE_READY');
    expect(environment.API_TEST_ISOLATED_CHILD).toBeUndefined();
    expect(environment.API_TEST_DATABASE_READY).toBeUndefined();
    expect(environment.NODE_ENV).toBe('test');
  });

  it('rejects an isolated assurance target from .env.test and restores the package target', () => {
    const packageTarget = 'tests/negotiation-runtime-authority.database.isolated.ts';
    const environment: Record<string, string | undefined> = {
      NODE_ENV: 'test',
      API_TEST_ISOLATED_TARGET: packageTarget,
    };
    const load = mock(() => {
      environment.API_TEST_ISOLATED_TARGET = 'src/services/tests/negotiation-polling.consult.isolated.ts';
      return {
        parsed: {
          API_TEST_ISOLATED_TARGET: 'src/services/tests/negotiation-polling.consult.isolated.ts',
        },
      };
    });

    expect(() =>
      loadEnvironmentWithTestLock({
        requestedNodeEnv: 'test',
        testEnvPath: '/safe/.env.test',
        developmentEnvPath: '/safe/.env.development',
        environment,
        load,
      }),
    ).toThrow('may not declare reserved variable API_TEST_ISOLATED_TARGET');
    expect(environment.API_TEST_ISOLATED_TARGET).toBe(packageTarget);
  });

  it('cannot bypass the test migration marker after dotenv mutates NODE_ENV', () => {
    const environment = { NODE_ENV: 'test', TEST_DATABASE_SAFE: '0' };
    const load = mock(() => {
      environment.NODE_ENV = 'development';
      return { parsed: {} };
    });
    const loaded = loadEnvironmentWithTestLock({
      requestedNodeEnv: 'test',
      testEnvPath: '/safe/.env.test',
      developmentEnvPath: '/safe/.env.development',
      environment,
      load,
    });

    expect(environment.NODE_ENV).toBe('test');
    expect(() => requireSafeTestMigration(loaded.testMode, environment.TEST_DATABASE_SAFE)).toThrow(
      'TEST_DATABASE_SAFE=1 is not set',
    );
    expect(() => requireSafeTestMigration(loaded.testMode, '1')).not.toThrow();
  });
});
