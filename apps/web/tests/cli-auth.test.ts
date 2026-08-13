import { describe, expect, test } from 'vitest';

import { buildCliApiKeyCallbackUrl, buildCliCredentialCreateBody, buildCliAuthReturnPath, parseCliAuthRequest, validateCliAuthState, validateCliCallbackUrl } from '@/lib/cli-auth';

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

  test('parses the exact v2 contract and tags minted keys', () => {
    const callback = encodeURIComponent('http://127.0.0.1:43123/callback');
    const state = 'state_token-that-is-url-safe-1234567890';
    const v2 = parseCliAuthRequest(new URLSearchParams(
      `callback=${callback}&version=2&state=${state}`,
    ));

    expect(v2).toEqual({
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state,
    });
    expect(buildCliCredentialCreateBody(v2!)).toEqual({ protocolVersion: 2 });
  });

  test.each([
    `callback=${encodeURIComponent('http://127.0.0.1:43123/callback')}`,
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

  test('preserves the exact v2 contract through login return', () => {
    const v2Return = new URL(buildCliAuthReturnPath('/cli-auth', {
      protocolVersion: 2,
      callback: 'http://127.0.0.1:43123/callback',
      state: 'state_token-that-is-url-safe-1234567890',
    }), 'https://index.network');

    expect(v2Return.origin).toBe('https://index.network');
    expect(v2Return.pathname).toBe('/cli-auth');
    expect(v2Return.searchParams.get('callback')).toBe('http://127.0.0.1:43123/callback');
    expect(v2Return.searchParams.get('version')).toBe('2');
    expect(v2Return.searchParams.get('state')).toBe('state_token-that-is-url-safe-1234567890');
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
