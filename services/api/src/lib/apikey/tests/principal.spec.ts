import { describe, expect, test } from 'bun:test';

import { ApiKeyPrincipalMismatchError, resolveApiKeyUserId } from '../principal';

describe('resolveApiKeyUserId', () => {
  test('prefers a verified session user', () => {
    expect(resolveApiKeyUserId({ userId: 'row-user', referenceId: 'row-user' }, 'session-user')).toBe('session-user');
  });

  test('prefers the key userId when both columns agree and no session is present', () => {
    expect(resolveApiKeyUserId({ userId: 'u', referenceId: 'u' })).toBe('u');
  });

  test('falls back to userId when referenceId is null', () => {
    expect(resolveApiKeyUserId({ userId: 'u', referenceId: null })).toBe('u');
  });

  test('falls back to referenceId when userId is null', () => {
    expect(resolveApiKeyUserId({ userId: null, referenceId: 'ref' })).toBe('ref');
  });

  test('returns null when neither column is set', () => {
    expect(resolveApiKeyUserId({ userId: null, referenceId: null })).toBeNull();
  });

  test('rejects when both columns are set but disagree', () => {
    expect(() => resolveApiKeyUserId({ userId: 'a', referenceId: 'b' })).toThrow(ApiKeyPrincipalMismatchError);
  });

  test('a verified session does not override a divergent-column rejection', () => {
    expect(() => resolveApiKeyUserId({ userId: 'a', referenceId: 'b' }, 'session-user')).toThrow(ApiKeyPrincipalMismatchError);
  });
});
