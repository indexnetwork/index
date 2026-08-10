import { describe, expect, test } from 'vitest';

import { buildHermesAuthorizationCallbackUrl, parseHermesAuthorizationQuery } from '@/lib/hermes-auth';

const valid = '?request_id=req_123&state=opaque_state&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback';

describe('parseHermesAuthorizationQuery', () => {
  test('accepts exactly one request, state, and high-loopback callback', () => {
    expect(parseHermesAuthorizationQuery(valid)).toEqual({
      requestId: 'req_123',
      state: 'opaque_state',
      redirectUri: 'http://127.0.0.1:49152/callback',
    });
  });

  test.each([
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2Flocalhost%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F%5B%3A%3A1%5D%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2Fuser%40127.0.0.1%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback%23fragment',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fother',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.2%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F2130706433%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F0x7f000001%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A049152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49151%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A65536%2Fcallback',
    '?request_id=req&state=s&redirect_uri=https%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback%3Fx%3D1',
  ])('rejects unsafe redirect %s', (query) => {
    expect(parseHermesAuthorizationQuery(query)).toBeNull();
  });

  test.each([
    '',
    '?request_id=req&state=s',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback&extra=1',
    '?request_id=req&request_id=other&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    '?request_id=req&state=s&state=other&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback&redirect_uri=http%3A%2F%2F127.0.0.1%3A49153%2Fcallback',
    '?request_id=&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    '?%72equest_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    '?request_id=req&&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback&',
    '?request_id=req+alias&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    '?request_id=req%ZZ&state=s&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    '?request_id=req&state=s&redirect_uri=http%3a%2F%2F127.0.0.1%3A49152%2Fcallback',
  ])('rejects noncanonical raw query grammar: %s', (query) => {
    expect(parseHermesAuthorizationQuery(query)).toBeNull();
  });
});

describe('buildHermesAuthorizationCallbackUrl', () => {
  test('returns only the request id, one-time code, and original state', () => {
    expect(buildHermesAuthorizationCallbackUrl({
      redirectUri: 'http://127.0.0.1:60000/callback',
      requestId: 'req_123',
      code: 'one-time-code',
      state: 'opaque_state',
    })).toBe('http://127.0.0.1:60000/callback?request_id=req_123&code=one-time-code&state=opaque_state');
  });
});
