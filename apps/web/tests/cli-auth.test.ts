import { describe, expect, test } from 'vitest';

import { buildCliApiKeyCallbackUrl, buildCliCredentialCreateBody, buildCliAuthReturnPath, buildLegacyCliCallbackUrl, parseCliAuthRequest, validateCliAuthReturnUrl, validateCliAuthState, validateCliCallbackUrl } from '@/lib/cli-auth';

describe('validateCliCallbackUrl', () => {
  test('accepts only a port-bound loopback callback path', () => {
    expect(validateCliCallbackUrl('http://127.0.0.1:43123/callback'))
      .toBe('http://127.0.0.1:43123/callback');
    expect(validateCliCallbackUrl('http://[::1]:43123/callback'))
      .toBe('http://[::1]:43123/callback');
  });

  test.each([
    null,
    'https://127.0.0.1:43123/callback',
    'http://localhost:43123/callback',
    'http://127.0.0.1/callback',
    'http://127.0.0.1:43123/other',
    'http://127.0.0.1:43123/callback?next=evil',
    'http://127.0.0.1:43123/callback#fragment',
    'http://attacker.example:43123/callback',
    'not-a-url',
  ])('rejects unsafe callback %s before credential minting', (value) => {
    expect(validateCliCallbackUrl(value)).toBeNull();
  });
});

describe('CLI one-time state', () => {
  test('accepts bounded URL-safe state and rejects missing, malformed, or unbounded values', () => {
    const valid = 'A'.repeat(31) + '_-9';
    expect(validateCliAuthState(valid)).toBe(valid);
    expect(validateCliAuthState(null)).toBeNull();
    expect(validateCliAuthState('short')).toBeNull();
    expect(validateCliAuthState(`${'A'.repeat(32)}=`)).toBeNull();
    expect(validateCliAuthState('A'.repeat(129))).toBeNull();
  });

  test('parses explicit v1 and v2 contracts and tags minted keys', () => {
    const callback = encodeURIComponent('http://127.0.0.1:43123/callback');
    const state = 'state_token-that-is-url-safe-1234567890';
    const v1 = parseCliAuthRequest(new URLSearchParams(`callback=${callback}`));
    const v2 = parseCliAuthRequest(new URLSearchParams(
      `callback=${callback}&version=2&state=${state}`,
    ));

    expect(v1).toEqual({
      protocolVersion: 1,
      callback: 'http://127.0.0.1:43123/callback',
    });
    expect(v2).toEqual({
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state,
    });
    expect(buildCliCredentialCreateBody(v1!)).toEqual({ protocolVersion: 1 });
    expect(buildCliCredentialCreateBody(v2!)).toEqual({ protocolVersion: 2 });
  });

  test.each([
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}&state=${'A'.repeat(43)}`,
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}&version=2`,
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}&version=2&state=short`,
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}&version=1`,
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}&version=3&state=${'A'.repeat(43)}`,
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}&version=&state=${'A'.repeat(43)}`,
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}&version=2&version=3&state=${'A'.repeat(43)}`,
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}&version=2&state=${'A'.repeat(43)}&state=${'B'.repeat(43)}`,
  ])('fails malformed or unknown versions closed instead of downgrading: %s', (query) => {
    expect(parseCliAuthRequest(new URLSearchParams(query))).toBeNull();
  });

  test('preserves exact v1 and v2 contracts through login return', () => {
    const v1Return = new URL(buildCliAuthReturnPath('/cli-auth', {
      protocolVersion: 1,
      callback: 'http://127.0.0.1:43123/callback',
    }), 'https://index.network');
    const v2Return = new URL(buildCliAuthReturnPath('/cli-auth', {
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state: 'state_token-that-is-url-safe-1234567890',
    }), 'https://index.network');

    expect(v1Return.origin).toBe('https://index.network');
    expect(v1Return.pathname).toBe('/cli-auth');
    expect(v1Return.searchParams.get('callback')).toBe('http://127.0.0.1:43123/callback');
    expect(v1Return.searchParams.has('version')).toBe(false);
    expect(v1Return.searchParams.has('state')).toBe(false);
    expect(v2Return.searchParams.get('version')).toBe('2');
    expect(v2Return.searchParams.get('state')).toBe('state_token-that-is-url-safe-1234567890');
  });

  test('validates only canonical same-origin v1 and v2 home returns', () => {
    const origin = 'https://index.network';
    const v1 = buildCliAuthReturnPath('/cli-auth', {
      protocolVersion: 1,
      callback: 'http://127.0.0.1:43123/callback',
    });
    const v2 = buildCliAuthReturnPath('/cli-auth', {
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state: 'state_token-that-is-url-safe-1234567890',
    });

    expect(validateCliAuthReturnUrl(v1, origin)).toBe(`${origin}${v1}`);
    expect(validateCliAuthReturnUrl(v2, origin)).toBe(`${origin}${v2}`);
  });

  test.each([
    'https://attacker.example/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback',
    '//attacker.example/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback',
    '/other?callback=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback',
    '/cli-auth?callback=http%3A%2F%2Fattacker.example%3A43123%2Fcallback',
    '/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&version=2',
    '/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&unexpected=1',
  ])('rejects unsafe home return %s', (value) => {
    expect(validateCliAuthReturnUrl(value, 'https://index.network')).toBeNull();
  });

  test('returns a v1 API-key secret under the legacy session_token field', () => {
    const callback = new URL(buildLegacyCliCallbackUrl(
      'http://127.0.0.1:43123/callback',
      'legacy-secret',
    ));

    expect(callback.searchParams.get('session_token')).toBe('legacy-secret');
    expect(callback.searchParams.has('api_key')).toBe(false);
    expect(callback.searchParams.has('state')).toBe(false);
  });

  test('returns the exact key ID, secret, and state only to the validated loopback callback', () => {
    const callback = buildCliApiKeyCallbackUrl(
      'http://127.0.0.1:43123/callback',
      'state_token-that-is-url-safe-1234567890',
      'secret+with/special characters',
      'key-row-id',
    );
    const url = new URL(callback);

    expect(url.origin).toBe('http://127.0.0.1:43123');
    expect(url.pathname).toBe('/callback');
    expect(url.searchParams.get('api_key')).toBe('secret+with/special characters');
    expect(url.searchParams.get('key_id')).toBe('key-row-id');
    expect(url.searchParams.get('state')).toBe('state_token-that-is-url-safe-1234567890');
  });
});
