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

  test('NEVER uses the frontend APP_URL — defaults to the protocol host', () => {
    process.env.APP_URL = 'https://index.network';
    // The whole point of the fix: a frontend host must not leak into a
    // protocol-host URL. With no protocol var set, the default protocol host
    // is used instead of APP_URL.
    expect(resolveProtocolBaseUrl()).toBe('https://protocol.index.network');
  });

  test('uses a caller-supplied fallback over the default when no protocol var is set', () => {
    process.env.APP_URL = 'https://index.network';
    expect(resolveProtocolBaseUrl('http://localhost:3001')).toBe('http://localhost:3001');
  });
});
