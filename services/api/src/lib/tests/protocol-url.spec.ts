import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { resolveProtocolBaseUrl } from '../protocol-url';

describe('resolveProtocolBaseUrl', () => {
  const saved = {
    API_URL: process.env.API_URL,
    WEB_APP_URL: process.env.WEB_APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  };

  beforeEach(() => {
    delete process.env.API_URL;
    delete process.env.WEB_APP_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('uses API_URL and strips trailing slashes', () => {
    process.env.API_URL = 'https://protocol.index.network/';
    expect(resolveProtocolBaseUrl()).toBe('https://protocol.index.network');
  });

  test('NEVER uses the web app WEB_APP_URL — defaults to the protocol host', () => {
    process.env.WEB_APP_URL = 'https://index.network';
    // The whole point of the fix: a web-app host must not leak into a
    // protocol-host URL. With no API_URL set, the default protocol host
    // is used instead of WEB_APP_URL.
    expect(resolveProtocolBaseUrl()).toBe('https://protocol.index.network');
  });

  test('uses a caller-supplied fallback over the default when API_URL is unset', () => {
    process.env.WEB_APP_URL = 'https://index.network';
    expect(resolveProtocolBaseUrl('http://localhost:3001')).toBe('http://localhost:3001');
  });
});
