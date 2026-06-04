import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { resolveProtocolBaseUrl } from '../protocol-url';

describe('resolveProtocolBaseUrl', () => {
  const saved = {
    BASE_URL: process.env.BASE_URL,
    API_BASE_URL: process.env.API_BASE_URL,
    APP_URL: process.env.APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  };

  beforeEach(() => {
    delete process.env.BASE_URL;
    delete process.env.API_BASE_URL;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('prefers BASE_URL and strips trailing slashes', () => {
    process.env.BASE_URL = 'https://protocol.index.network/';
    expect(resolveProtocolBaseUrl()).toBe('https://protocol.index.network');
  });

  test('falls back to API_BASE_URL when BASE_URL is unset', () => {
    process.env.API_BASE_URL = 'https://api.index.network';
    expect(resolveProtocolBaseUrl()).toBe('https://api.index.network');
  });

  test('NEVER uses the frontend APP_URL', () => {
    process.env.APP_URL = 'https://index.network';
    // The whole point of the fix: a frontend host must not leak into a
    // protocol-host URL. With no protocol var set, the dev fallback is used.
    expect(resolveProtocolBaseUrl()).toBe('http://localhost:3001');
  });

  test('uses the provided fallback when no protocol var is set', () => {
    process.env.APP_URL = 'https://index.network';
    expect(resolveProtocolBaseUrl('https://protocol.index.network')).toBe(
      'https://protocol.index.network',
    );
  });
});
