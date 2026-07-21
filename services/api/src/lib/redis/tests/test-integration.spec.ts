import { describe, expect, it } from 'bun:test';

import { resolveRedisIntegrationTestUrl } from '../test-integration';

describe('Redis integration test gate', () => {
  it('does not inspect or return a target unless explicitly enabled', () => {
    const environment = {
      RUN_REDIS_INTEGRATION_TESTS: '0',
      REDIS_URL: 'redis://shared.example.com:6379',
    };

    expect(resolveRedisIntegrationTestUrl(environment)).toBeNull();
  });

  it('requires an explicit URL instead of falling back to localhost', () => {
    expect(() =>
      resolveRedisIntegrationTestUrl({ RUN_REDIS_INTEGRATION_TESTS: '1' }),
    ).toThrow('requires REDIS_URL');
  });

  it('rejects non-Redis URLs without exposing credentials', () => {
    let message = '';
    try {
      resolveRedisIntegrationTestUrl({
        RUN_REDIS_INTEGRATION_TESTS: '1',
        REDIS_URL: 'https://secret@example.com/redis',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('redis:// or rediss://');
    expect(message).not.toContain('secret');
  });

  it('returns explicitly opted-in redis and rediss targets', () => {
    expect(
      resolveRedisIntegrationTestUrl({
        RUN_REDIS_INTEGRATION_TESTS: '1',
        REDIS_URL: 'redis://localhost:6379/15',
      }),
    ).toBe('redis://localhost:6379/15');
    expect(
      resolveRedisIntegrationTestUrl({
        RUN_REDIS_INTEGRATION_TESTS: '1',
        REDIS_URL: 'rediss://redis.example.com:6380',
      }),
    ).toStartWith('rediss://');
  });
});
