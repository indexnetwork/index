import { describe, expect, it } from 'vitest';

import { buildIndexAppOwnerCallbackUrl, parseIndexAppOwnerAuthorizationQuery } from '../index-app-owner-auth';

describe('Index app owner browser authorization query', () => {
  it('accepts exactly one canonical request/state/high-port callback tuple', () => {
    expect(parseIndexAppOwnerAuthorizationQuery(
      '?request_id=00000000-0000-4000-8000-000000000001&state=abcdefghijklmnopqrstuvwxyzABCDEF&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
    )).toEqual({
      requestId: '00000000-0000-4000-8000-000000000001',
      state: 'abcdefghijklmnopqrstuvwxyzABCDEF',
      redirectUri: 'http://127.0.0.1:49152/callback',
    });
  });

  it.each([
    '?request_id=r&state=abcdefghijklmnopqrstuvwxyzABCDEF&redirect_uri=http%3A%2F%2Flocalhost%3A49152%2Fcallback',
    '?request_id=r&state=abcdefghijklmnopqrstuvwxyzABCDEF&redirect_uri=http%3A%2F%2F127.0.0.1%3A80%2Fcallback',
    '?request_id=r&state=abcdefghijklmnopqrstuvwxyzABCDEF&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback&extra=1',
    '?request_id=r&request_id=r2&state=abcdefghijklmnopqrstuvwxyzABCDEF&redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback',
  ])('rejects malformed or widened callback %s', (query) => {
    expect(parseIndexAppOwnerAuthorizationQuery(query)).toBeNull();
  });

  it('builds a callback containing only request_id, code, and state', () => {
    const callback = new URL(buildIndexAppOwnerCallbackUrl({
      redirectUri: 'http://127.0.0.1:49152/callback',
      requestId: '00000000-0000-4000-8000-000000000001',
      code: 'one-time-code', state: 'abcdefghijklmnopqrstuvwxyzABCDEF',
    }));
    expect([...callback.searchParams.keys()].sort()).toEqual(['code', 'request_id', 'state']);
    expect(callback.toString()).not.toMatch(/credential|api_key|idxo_/i);
  });
});
