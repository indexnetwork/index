interface RedisTestEnvironment {
  [key: string]: string | undefined;
  REDIS_URL?: string;
  RUN_REDIS_INTEGRATION_TESTS?: string;
}

/**
 * Resolves an explicitly opted-in Redis integration target without connecting.
 *
 * @param environment - Environment values controlling Redis integration tests.
 * @returns A validated Redis URL, or null when the suite is not opted in.
 * @throws When the opt-in is enabled without a valid explicit Redis URL.
 */
export function resolveRedisIntegrationTestUrl(
  environment: RedisTestEnvironment = process.env,
): string | null {
  if (environment.RUN_REDIS_INTEGRATION_TESTS !== '1') return null;
  if (!environment.REDIS_URL?.trim()) {
    throw new Error(
      '[redis-test] RUN_REDIS_INTEGRATION_TESTS=1 requires REDIS_URL for a dedicated disposable Redis instance.',
    );
  }

  try {
    const parsed = new URL(environment.REDIS_URL);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error('[redis-test] REDIS_URL must be a valid redis:// or rediss:// URL.');
  }

  return environment.REDIS_URL;
}
