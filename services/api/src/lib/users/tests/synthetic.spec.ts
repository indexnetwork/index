import { describe, expect, it } from 'bun:test';

import { isSyntheticUserEmail, resolvePrincipalUnreachable } from '../synthetic';

describe('isSyntheticUserEmail', () => {
  it('recognizes every domain the seed CLIs own', () => {
    expect(isSyntheticUserEmail('seed-tester-1@index-network.test')).toBe(true);
    expect(isSyntheticUserEmail('sandbox-person-01@index-network.test')).toBe(true);
    expect(isSyntheticUserEmail('persona@sandbox.test')).toBe(true);
  });

  it('reads the final label case-insensitively and tolerates an FQDN dot', () => {
    expect(isSyntheticUserEmail('Seed@Index-Network.TEST')).toBe(true);
    expect(isSyntheticUserEmail('seed@index-network.Test')).toBe(true);
    expect(isSyntheticUserEmail('seed@index-network.test.')).toBe(true);
    expect(isSyntheticUserEmail('  seed@index-network.test  '.trim())).toBe(true);
  });

  it('leaves real users alone', () => {
    expect(isSyntheticUserEmail('someone@index.network')).toBe(false);
    expect(isSyntheticUserEmail('someone@gmail.com')).toBe(false);
    // `test` is a label here, but not the FINAL one: a real domain, a real mailbox.
    expect(isSyntheticUserEmail('test@test.example.com')).toBe(false);
    expect(isSyntheticUserEmail('test@testing.com')).toBe(false);
    expect(isSyntheticUserEmail('test.user@example.org')).toBe(false);
  });

  it('treats anything that is not an address as reachable', () => {
    expect(isSyntheticUserEmail(null)).toBe(false);
    expect(isSyntheticUserEmail(undefined)).toBe(false);
    expect(isSyntheticUserEmail('')).toBe(false);
    expect(isSyntheticUserEmail('not-an-address')).toBe(false);
    expect(isSyntheticUserEmail('trailing@')).toBe(false);
  });
});

describe('resolvePrincipalUnreachable', () => {
  it('resolves the principal through the reader', async () => {
    const reader = { getUser: async () => ({ email: 'seed-tester-3@index-network.test' }) };
    expect(await resolvePrincipalUnreachable('user-seed', reader)).toBe(true);
  });

  it('reports a real user as reachable', async () => {
    const reader = { getUser: async () => ({ email: 'real@index.network' }) };
    expect(await resolvePrincipalUnreachable('user-real', reader)).toBe(false);
  });

  it('fails open when the user is missing or the read throws', async () => {
    expect(await resolvePrincipalUnreachable('gone', { getUser: async () => null })).toBe(false);
    expect(await resolvePrincipalUnreachable('boom', {
      getUser: async () => { throw new Error('db down'); },
    })).toBe(false);
  });
});
